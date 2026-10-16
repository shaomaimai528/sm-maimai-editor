/** 画布舞台：渲染文档 + 选区叠加层 + 手势 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer as KLayer, Image as KImage, Line, Rect } from 'react-konva'
import Konva from 'konva'
import { useEditor } from '../../state/editorStore'
import { LassoTool } from '../../core/selection/lasso'
import { RectTool } from '../../core/selection/rect'
import { BrushTool } from '../../core/selection/brush'
import { DEFAULT_BRUSH } from '../../core/selection/brush'
import { magicWand, createMask, feather } from '../../core/selection/mask'
import { useComposedBitmap } from './useComposedBitmap'
import { SelectionOverlay } from './SelectionOverlay'
import { SelectionBar } from './SelectionBar'
import { useGestures } from './useGestures'
import './CanvasStage.css'

const lasso = new LassoTool()
const rect = new RectTool()
const brush = new BrushTool()

export function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })

  const doc = useEditor((s) => s.doc)
  const tool = useEditor((s) => s.tool)
  const selection = useEditor((s) => s.selection)
  const setSelection = useEditor((s) => s.setSelection)
  const commit = useEditor((s) => s.commit)
  const setView = useEditor((s) => s.setView)
  const showOriginal = useEditor((s) => s.showOriginal)
  const setShowOriginal = useEditor((s) => s.setShowOriginal)
  const sourceBitmap = useEditor((s) => s.sourceBitmap)
  const pushSelectionHistory = useEditor((s) => s.pushSelectionHistory)

  // 切换工具时清掉未完成的预览，避免残留图形
  useEffect(() => {
    lasso.cancel()
    rect.cancel()
    brush.end()
    setLassoPoints([])
    setRectPreview(null)
  }, [tool])

  const [lassoPoints, setLassoPoints] = useState<number[]>([])
  const [rectPreview, setRectPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number } | null>(null)
  const isDrawing = useRef(false)

  // 按渲染管线合成真实画面（含调整层、图层蒙版、AI 图层）
  const composed = useComposedBitmap(doc)

  // 容器尺寸自适应
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const view = useEditor((s) => ({ zoom: s.zoom, panX: s.panX, panY: s.panY }))

  // 画布在屏幕上的基准尺寸（适配容器）
  const base = useMemo(() => {
    if (!doc) return { w: 0, h: 0, scale: 1 }
    const padding = 24
    const availW = size.w - padding * 2
    const availH = size.h - 200
    const s = Math.min(availW / doc.width, availH / doc.height, 1)
    return { w: doc.width * s, h: doc.height * s, scale: s }
  }, [doc, size])

  /**
   * Stage 本地坐标 → 文档像素坐标
   * Stage 坐标系原点在容器左上角，图片被放在 transform 指定的位置并缩放。
   * 必须先减去 transform 的平移量，再除以总缩放，才是文档坐标。
   */
  const toDoc = useCallback((stageX: number, stageY: number) => {
    if (!doc) return { x: 0, y: 0 }
    const total = base.scale * view.zoom
    const tx = size.w / 2 + view.panX - (base.w * view.zoom) / 2
    const ty = size.h / 2 + view.panY - (base.h * view.zoom) / 2
    return {
      x: (stageX - tx) / total,
      y: (stageY - ty) / total,
    }
  }, [doc, base, view, size])

  // 手势回调用 ref 读取最新值，避免闭包捕获旧的 view
  const viewRef = useRef(view)
  viewRef.current = view
  const sizeRef = useRef(size)
  sizeRef.current = size
  const toolRef = useRef(tool)
  toolRef.current = tool

  useGestures(containerRef.current, {
    onPan: (dx, dy) => {
      // 画笔类工具下，单指用于涂抹，不平移
      const t = toolRef.current
      if (t === 'brush' || t === 'erase' || t === 'lasso' || t === 'rect' || t === 'wand') return
      const v = viewRef.current
      setView({ panX: v.panX + dx, panY: v.panY + dy })
    },

    // 双指缩放：任何工具下都可用，这是移动端的基本预期
    onZoomAt: ({ factor, cx, cy }) => {
      const s = sizeRef.current
      useEditor.getState().zoomAt(factor, cx, cy, s.w, s.h)
    },

    // 双击在「适应窗口」与 2 倍之间切换
    onDoubleTap: (_x, _y) => {
      const v = viewRef.current
      if (v.zoom > 1.05) {
        setView({ zoom: 1, panX: 0, panY: 0 })
      } else {
        setView({ zoom: 2, panX: v.panX, panY: v.panY })
      }
    },

    onLongPress: () => setShowOriginal(true),
    onLongPressEnd: () => setShowOriginal(false),
    enabled: true,
  })

  // ---- 指针事件：选区与笔刷 ----
  const handlePointerDown = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!doc || tool === 'move' || tool === 'adjust') return
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    isDrawing.current = true
    const p = toDoc(pos.x, pos.y)

    if (tool === 'rect') {
      rect.begin(p.x, p.y)
      setRectPreview(null)
    } else if (tool === 'lasso') {
      lasso.begin(p.x, p.y)
      setLassoPoints([p.x, p.y])
    } else if (tool === 'wand') {
      // 以屏幕显示的画面取色，所见即所得
      const bmp = composed?.bitmap
      if (!bmp) return
      const canvas = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bmp, 0, 0)
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height)
      // 坐标换算到画面尺寸
      const px = Math.round(p.x * (bmp.width / doc.width))
      const py = Math.round(p.y * (bmp.height / doc.height))
      const mask = magicWand(img.data, bmp.width, bmp.height, px, py, 32)
      setSelection(mask)
    } else if (tool === 'brush' || tool === 'erase') {
      // 原实现首次落笔只建空蒙版就 return，导致第一下涂抹丢失。
      // 改为：没有蒙版就用当前笔触直接建立，然后再应用这一笔。
      const base = selection ?? createMask(doc.width, doc.height, 0)
      const s = { ...DEFAULT_BRUSH, erase: tool === 'erase' }
      setSelection(brush.begin(base, s, p.x, p.y))
    }
  }, [doc, tool, toDoc, composed, selection, setSelection])

  const handlePointerMove = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!doc) return
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    const p = toDoc(pos.x, pos.y)

    if (tool === 'brush' || tool === 'erase') setBrushCursor(p)

    // 用自维护的按下状态判断，比 evt.buttons 可靠
    if (!isDrawing.current) return

    if (tool === 'rect' && !rect.isEmpty()) {
      rect.move(p.x, p.y)
      setRectPreview(rect.getRect())
    } else if (tool === 'lasso' && !lasso.isEmpty()) {
      lasso.move(p.x, p.y)
      const pts = lasso.getPoints()
      setLassoPoints(pts.flatMap((q) => [q.x, q.y]))
    } else if ((tool === 'brush' || tool === 'erase') && selection) {
      const s = { ...DEFAULT_BRUSH, erase: tool === 'erase' }
      setSelection(brush.move(selection, s, p.x, p.y))
    }
  }, [doc, tool, toDoc, selection, setSelection])

  const handlePointerUp = useCallback(() => {
    isDrawing.current = false
    if (tool === 'rect' && doc) {
      const m = rect.finish(doc.width, doc.height)
      if (m) pushSelectionHistory('矩形选框', m)
      setRectPreview(null)
    }
    if (tool === 'lasso' && !lasso.isEmpty() && doc) {
      const m = lasso.finish(doc.width, doc.height)
      if (m) pushSelectionHistory('套索选区', m)
      setLassoPoints([])
    }
    // 笔刷/擦除结束后把选区写入历史，否则撤销无效
    if ((tool === 'brush' || tool === 'erase') && selection) {
      pushSelectionHistory(tool === 'erase' ? '擦除选区' : '涂抹选区', selection)
    }
    brush.end()
  }, [tool, doc, selection, setSelection, pushSelectionHistory])

  const stageW = size.w
  const stageH = size.h

  const transform = {
    x: stageW / 2 + view.panX - (base.w * view.zoom) / 2,
    y: stageH / 2 + view.panY - (base.h * view.zoom) / 2,
    scale: view.zoom,
  }

  return (
    <div className="canvas-stage" ref={containerRef}>
      <Stage
        width={stageW}
        height={stageH}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ touchAction: 'none' }}
      >
        <KLayer x={transform.x} y={transform.y} scaleX={transform.scale} scaleY={transform.scale}>
          {/* 合成结果：含全部图层、蒙版与调整参数 */}
          {!showOriginal && composed && (
            <KImage image={composed.bitmap} width={base.w} height={base.h} />
          )}
          {/* 长按看原图 */}
          {showOriginal && doc && sourceBitmap && (
            <KImage image={sourceBitmap} width={base.w} height={base.h} />
          )}

          {/* 选区可视化：蚂蚁线 + 半透明遮罩 */}
          {selection && !showOriginal && (
            <SelectionOverlay
              selection={selection}
              docWidth={doc?.width || 1}
              docHeight={doc?.height || 1}
              viewWidth={base.w}
              viewHeight={base.h}
              zoom={view.zoom}
            />
          )}

          {/* 矩形选框预览 */}
          {rectPreview && doc && (
            <Rect
              x={(rectPreview.x / doc.width) * base.w}
              y={(rectPreview.y / doc.height) * base.h}
              width={(rectPreview.w / doc.width) * base.w}
              height={(rectPreview.h / doc.height) * base.h}
              stroke="#2563EB"
              strokeWidth={2 / view.zoom}
              dash={[6 / view.zoom, 4 / view.zoom]}
              fill="rgba(37,99,235,0.12)"
              listening={false}
            />
          )}

          {/* 套索轨迹 */}
          {lassoPoints.length >= 4 && (
            <Line
              points={lassoPoints.map((v, i) => (i % 2 === 0 ? (v / (doc?.width || 1)) * base.w : (v / (doc?.height || 1)) * base.h))}
              stroke="#2563EB"
              strokeWidth={2 / view.zoom}
              dash={[8 / view.zoom, 6 / view.zoom]}
              closed
              listening={false}
            />
          )}
        </KLayer>
      </Stage>

      {/* 笔刷光标：跟随手指 */}
      {brushCursor && (tool === 'brush' || tool === 'erase') && (
        <div
          className="brush-cursor"
          style={{
            left: transform.x + brushCursor.x * base.scale * view.zoom,
            top: transform.y + brushCursor.y * base.scale * view.zoom,
          }}
        />
      )}

      {showOriginal && <div className="original-badge">原图</div>}

      <SelectionBar />
    </div>
  )
}

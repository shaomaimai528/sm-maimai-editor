/** 画布舞台：渲染文档 + 选区叠加层 + 手势 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer as KLayer, Image as KImage, Line, Rect } from 'react-konva'
import Konva from 'konva'
import { useEditor } from '../../state/editorStore'
import { LassoTool } from '../../core/selection/lasso'
import { RectTool } from '../../core/selection/rect'
import { BrushTool } from '../../core/selection/brush'
import { magicWand, createMask, feather } from '../../core/selection/mask'
import { useComposedBitmap } from './useComposedBitmap'
import { SelectionOverlay } from './SelectionOverlay'
import { SelectionBar } from './SelectionBar'
import { BrushBar } from './BrushBar'
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
  const brushSettings = useEditor((s) => s.brush)
  const brushTarget = useEditor((s) => s.brushTarget)
  const paintLayerMask = useEditor((s) => s.paintLayerMask)
  const activeLayerId = useEditor((s) => s.doc?.activeLayerId)
  const setLiveRect = useEditor((s) => s.setLiveRect)
  const liveRect = useEditor((s) => s.liveRect)

  // 笔刷要实时读到最新参数，用 ref 避免闭包捕获旧值
  const brushRef = useRef({ settings: brushSettings, target: brushTarget, layerId: activeLayerId })
  brushRef.current = { settings: brushSettings, target: brushTarget, layerId: activeLayerId }

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

  // 框选比例锁：用户改了就同步给工具，下一次落笔即生效
  const aspectLock = useEditor((s) => s.aspectLock)
  useEffect(() => {
    rect.setAspectLock(aspectLock)
  }, [aspectLock])

  // 按渲染管线合成真实画面（含调整层、图层蒙版、AI 图层）
  const composed = useComposedBitmap(doc)

  // 容器尺寸自适应
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const view = useEditor((s) => ({ zoom: s.zoom, panX: s.panX, panY: s.panY }))

  /**
   * 可视区域
   *
   * 非遮挡面板（图层/调整）停靠底部时，把它的高度从可视区里扣掉，
   * 图片就在剩下的空间里居中 —— 否则面板会直接盖住图片下半截，
   * 用户"看不到图"，实际是排版挤掉的，不是渲染问题。
   */
  const chrome = useEditor((s) => s.chrome)

  // 画布在屏幕上的基准尺寸（适配可视区）
  const base = useMemo(() => {
    if (!doc) return { w: 0, h: 0, scale: 1 }
    const padding = 24
    const availW = size.w - padding * 2
    const availH = Math.max(120, size.h - 200 - chrome.bottomInset)
    const s = Math.min(availW / doc.width, availH / doc.height, 1)
    return { w: doc.width * s, h: doc.height * s, scale: s }
  }, [doc, size, chrome.bottomInset])

  /**
   * 画布内容的视觉中心（Stage 坐标）
   * 底部有非遮挡面板时，中心整体上移半个面板高度
   */
  const center = useMemo(() => ({
    x: size.w / 2,
    y: (size.h - chrome.bottomInset) / 2,
  }), [size, chrome.bottomInset])

  /**
   * Stage 本地坐标 → 文档像素坐标
   * Stage 坐标系原点在容器左上角，图片被放在 transform 指定的位置并缩放。
   * 必须先减去 transform 的平移量，再除以总缩放，才是文档坐标。
   */
  const toDoc = useCallback((stageX: number, stageY: number) => {
    if (!doc) return { x: 0, y: 0 }
    const total = base.scale * view.zoom
    const tx = center.x + view.panX - (base.w * view.zoom) / 2
    const ty = center.y + view.panY - (base.h * view.zoom) / 2
    return {
      x: (stageX - tx) / total,
      y: (stageY - ty) / total,
    }
  }, [doc, base, view, center])

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
      const bs = brushRef.current
      // 涂蒙版时默认涂黑（遮住），涂选区时默认涂白（选中）
      const isMask = bs.target === 'layer-mask'
      const s = { ...bs.settings, erase: tool === 'erase', target: (isMask ? 0 : 255) as 0 | 255 }

      if (isMask && bs.layerId) {
        // 图层的蒙版：落笔涂黑＝遮住，与 PS 一致
        const layer = doc.layers.find((l) => l.id === bs.layerId)
        const existing = layer?.mask?.data
          ? { data: layer.mask.data, width: layer.mask.width, height: layer.mask.height }
          : createMask(doc.width, doc.height, 255)
        setSelection(brush.begin(existing, s, p.x, p.y))
      } else {
        // 原实现首次落笔只建空蒙版就 return，导致第一下涂抹丢失。
        // 改为：没有蒙版就用当前笔触直接建立，然后再应用这一笔。
        const base = selection ?? createMask(doc.width, doc.height, 0)
        setSelection(brush.begin(base, s, p.x, p.y))
      }
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
      const r = rect.getRect()
      setRectPreview(r)
      // 实时尺寸要报给浮动标记，拖动时就能看到选了多少像素
      setLiveRect(r)
    } else if (tool === 'lasso' && !lasso.isEmpty()) {
      lasso.move(p.x, p.y)
      const pts = lasso.getPoints()
      setLassoPoints(pts.flatMap((q) => [q.x, q.y]))
    } else if ((tool === 'brush' || tool === 'erase') && selection) {
      const bs = brushRef.current
      const s = {
        ...bs.settings,
        erase: tool === 'erase',
        target: (bs.target === 'layer-mask' ? 0 : 255) as 0 | 255,
      }
      setSelection(brush.move(selection, s, p.x, p.y))
    }
  }, [doc, tool, toDoc, selection, setSelection])

  const handlePointerUp = useCallback(() => {
    isDrawing.current = false
    setLiveRect(null)
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
    // 笔刷/擦除结束后写入历史，否则撤销无效
    if ((tool === 'brush' || tool === 'erase') && selection) {
      const bs = brushRef.current
      if (bs.target === 'layer-mask' && bs.layerId) {
        // 图层蒙版是图层属性，走图层历史
        paintLayerMask(bs.layerId, selection)
      } else {
        pushSelectionHistory(tool === 'erase' ? '擦除选区' : '涂抹选区', selection)
      }
    }
    brush.end()
  }, [tool, doc, selection, setSelection, pushSelectionHistory, paintLayerMask, setLiveRect])

  const stageW = size.w
  const stageH = size.h

  const transform = {
    x: center.x + view.panX - (base.w * view.zoom) / 2,
    y: center.y + view.panY - (base.h * view.zoom) / 2,
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

          {/* 选区可视化：蚂蚁线 + 只在选区外缘轻压一层，绝不整幅盖暗 */}
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

      {/* 笔刷光标：跟随手指，直径与真实笔触一致 */}
      {brushCursor && (tool === 'brush' || tool === 'erase') && (
        <div
          className="brush-cursor"
          data-erase={tool === 'erase'}
          style={{
            left: transform.x + brushCursor.x * base.scale * view.zoom,
            top: transform.y + brushCursor.y * base.scale * view.zoom,
            width: brushSettings.radius * 2 * base.scale * view.zoom,
            height: brushSettings.radius * 2 * base.scale * view.zoom,
          }}
        />
      )}

      {/*
        框选实时尺寸：跟着指尖走，拖动过程中就能看到选了多少像素。
        放在屏幕上而不是 Konva 层里 —— 它不该跟着缩放一起放大缩小。
      */}
      {liveRect && doc && (
        <div
          className="rect-size-badge"
          style={{
            left: transform.x + (liveRect.x + liveRect.w / 2) * base.scale * view.zoom,
            top: transform.y + liveRect.y * base.scale * view.zoom - 12,
          }}
        >
          {Math.round(liveRect.w)} × {Math.round(liveRect.h)} px
        </div>
      )}

      {showOriginal && <div className="original-badge">原图</div>}

      <SelectionBar />
      <BrushBar />
    </div>
  )
}

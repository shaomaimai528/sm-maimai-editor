/** 滑杆：跟手反馈 + 数值显示，统一用于所有参数调整 */
import { useCallback, useRef } from 'react'
import './Slider.css'

interface Props {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  /** 双击/按钮快速归零 */
  resetValue?: number
  unit?: string
}

export function Slider({
  label, value, min, max, step = 1, onChange, resetValue = 0, unit = '',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const pct = ((value - min) / (max - min)) * 100

  const reset = useCallback(() => {
    onChange(resetValue)
  }, [onChange, resetValue])

  return (
    <div className="slider">
      <div className="slider-head">
        <span className="slider-label">{label}</span>
        <button className="slider-value" onClick={reset} title="点击归零">
          {round(value)}{unit}
        </button>
      </div>
      <div className="slider-track-wrap">
        <div className="slider-track">
          <div className="slider-fill" style={{ width: `${pct}%` }} />
          <div className="slider-thumb" style={{ left: `${pct}%` }} />
        </div>
        <input
          ref={inputRef}
          className="slider-input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  )
}

function round(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

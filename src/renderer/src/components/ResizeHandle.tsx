/**
 * Draggable divider between two panes. Drag with the mouse, double-click to reset,
 * or focus it and use the arrow keys (Shift for bigger steps).
 */
import { useRef, useState } from 'react'
import { cn } from './ui'

export function ResizeHandle({ value, min, max, onChange, onReset, grow = 'right', label }: { value: number; min: number; max: number; onChange: (w: number) => void; onReset: () => void; grow?: 'right' | 'left'; label: string }) {
  const start = useRef<{ x: number; w: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const sign = grow === 'right' ? 1 : -1
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label}: drag to resize, double-click to reset`}
      className={cn('group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize outline-none', dragging && 'cursor-col-resize')}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, w: value }
        setDragging(true)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        onChange(start.current.w + sign * (e.clientX - start.current.x))
      }}
      onPointerUp={(e) => {
        start.current = null
        setDragging(false)
        e.currentTarget.releasePointerCapture(e.pointerId)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16
        if (e.key === 'ArrowRight') onChange(value + sign * step)
        else if (e.key === 'ArrowLeft') onChange(value - sign * step)
        else if (e.key === 'Home') onReset()
        else return
        e.preventDefault()
      }}
    >
      <div className={cn('absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent/60 group-focus-visible:bg-accent', dragging && 'bg-accent')} />
    </div>
  )
}

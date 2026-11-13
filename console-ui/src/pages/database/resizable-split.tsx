import { useI18n } from '../../i18n'
import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import {
  clampSplit, readSplitWidth, saveSplitWidth, splitKeyTarget, SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN,
} from './database-console-model.mjs'

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

/** Width of the table list pane, remembered per browser (blocked storage keeps the default). */
export function useSplitWidth() {
  const [width, setWidth] = useState(() => readSplitWidth(browserStorage()))
  const commit = useCallback((next: number) => { setWidth(next); saveSplitWidth(browserStorage(), next) }, [])
  return { width, setWidth, commit }
}

/**
 * Vertical separator between the list and the detail (md and up; phones show one pane at a time).
 * Drag with a pointer; ← / → move it (Shift: faster), Home / End jump to the bounds, double-click resets.
 */
export function SplitHandle({ width, onChange, onCommit, containerRef }: {
  width: number
  onChange: (width: number) => void
  onCommit: (width: number) => void
  containerRef: RefObject<HTMLElement | null>
}) {
  const i18n = useI18n()
  const drag = useRef<{ x: number; width: number; last: number } | null>(null)
  const container = () => containerRef.current?.getBoundingClientRect().width
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { x: event.clientX, width, last: width }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const next = clampSplit(drag.current.width + event.clientX - drag.current.x, container())
    drag.current.last = next
    onChange(next)
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    onCommit(drag.current.last)
    drag.current = null
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = splitKeyTarget(event.key, width, container(), event.shiftKey)
    if (next === null) return
    event.preventDefault()
    onCommit(next)
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={i18n.t('调整列表宽度')}
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={SPLIT_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title={i18n.t('拖动或用方向键调整宽度，双击恢复默认')}
      data-split-handle
      className="group relative hidden md:block w-1.5 -mx-[3px] shrink-0 z-10 cursor-col-resize touch-none select-none focus-visible:outline-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(clampSplit(SPLIT_DEFAULT, container()))}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-primary/60 group-focus-visible:w-0.5 group-focus-visible:bg-primary group-active:bg-primary" />
    </div>
  )
}

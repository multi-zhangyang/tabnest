import { useLayoutEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import type { BookmarkItem } from "@/lib/types"
import { useVisibleCanvas } from "@/hooks/use-visible-canvas"

export function BookmarkGrid({
  items,
  className,
  selected = -1,
  virtualize = false,
  children,
}: {
  items: BookmarkItem[]
  className: string
  selected?: number
  virtualize?: boolean
  children: (item: BookmarkItem, index: number) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const virtual = items.length > 250 || virtualize
  const range = useVisibleCanvas(ref, virtual)
  const [metrics, setMetrics] = useState({
    columns: 1,
    stride: 100,
    gap: 6,
    rowGap: 6,
  })
  const [focus, setFocus] = useState(-1)
  const pending = useRef(-1)
  const keyboardFocus = useRef(false)
  // Visible and pinned cells share row coordinates; changing the mounted range
  // must not move a focused cell between normal flow and absolute positioning.
  const rows = Math.ceil(items.length / metrics.columns)
  const first = Math.min(
    Math.max(0, rows - 1),
    Math.max(0, Math.floor(range.top / metrics.stride))
  )
  const last = Math.min(
    rows,
    Math.max(first + 1, Math.ceil(range.bottom / metrics.stride))
  )
  const start = virtual ? first * metrics.columns : 0
  const end = virtual
    ? Math.min(items.length, last * metrics.columns)
    : items.length
  const pinned =
    virtual &&
    focus >= 0 &&
    focus < items.length &&
    (focus < start || focus >= end)
      ? focus
      : -1
  useLayoutEffect(() => {
    if (!ref.current) return
    const element = ref.current
    const first = element.querySelector<HTMLElement>(
      ".bookmark-grid-item:not([data-pinned])"
    )
    const measure = () => {
      const style = getComputedStyle(element)
      const columns = style.gridTemplateColumns.split(" ").length
      const rowGap = parseFloat(style.rowGap) || 0
      const stride = (first?.getBoundingClientRect().height || 82) + rowGap
      const gap = parseFloat(style.columnGap) || 0
      setMetrics((previous) =>
        previous.columns === columns &&
        previous.gap === gap &&
        previous.rowGap === rowGap &&
        Math.abs(previous.stride - stride) < 0.5
          ? previous
          : { columns, stride, gap, rowGap }
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (first) observer.observe(first)
    measure()
    return () => observer.disconnect()
  }, [virtual, items.length, start])
  useLayoutEffect(() => {
    if (!virtual || selected < 0 || !ref.current) return
    const top =
      ref.current.getBoundingClientRect().top +
      scrollY +
      Math.floor(selected / metrics.columns) * metrics.stride
    if (top < scrollY + 100 || top + metrics.stride > scrollY + innerHeight)
      window.scrollTo({ top: Math.max(0, top - 125), behavior: "instant" })
  }, [virtual, selected, metrics])
  useLayoutEffect(() => {
    if (pending.current < 0) return
    const cell = ref.current?.querySelector<HTMLElement>(
      `[data-grid-index="${pending.current}"]`
    )
    const element =
      cell?.querySelector<HTMLElement>(".bookmark-checkbox:not(:disabled)") ||
      cell?.querySelector<HTMLElement>("a[data-bookmark-id]")
    if (element) {
      element.focus({ preventScroll: true })
      pending.current = -1
    }
  }, [focus, start, end])
  useLayoutEffect(() => {
    if (focus < 0) return
    const cancel = () => {
      keyboardFocus.current = false
      pending.current = -1
    }
    const events = ["wheel", "touchstart", "pointerdown", "keydown"]
    for (const event of events)
      window.addEventListener(event, cancel, { capture: true, passive: true })
    return () => {
      for (const event of events)
        window.removeEventListener(event, cancel, true)
    }
  }, [focus])
  useLayoutEffect(() => {
    if (!virtual || focus < 0 || !ref.current) return
    let frame = 0
    const reveal = () => {
      frame = 0
      const element = document.activeElement
      if (
        !keyboardFocus.current ||
        !(element instanceof HTMLElement) ||
        !ref.current?.contains(element)
      )
        return
      const bounds = element.getBoundingClientRect()
      const margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 88
      const delta =
        bounds.top < margin
          ? Math.floor(bounds.top - margin)
          : Math.max(0, Math.ceil(bounds.bottom - innerHeight))
      if (delta) window.scrollBy({ top: delta, behavior: "instant" })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(reveal)
    }
    // The browser can clamp an initial scroll against the previous scroll extent.
    // Reconcile after it reports the new canvas size, without following scrolls.
    const observer = new ResizeObserver(schedule)
    observer.observe(ref.current, { box: "border-box" })
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [virtual, metrics, focus])
  return (
    <div
      ref={ref}
      className={className}
      style={
        virtual
          ? {
              position: "relative",
              overflowAnchor: "none",
              height: Math.max(0, rows * metrics.stride - metrics.rowGap),
            }
          : undefined
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setFocus(-1)
      }}
      onKeyDown={(event) => {
        if (
          ![
            "Tab",
            "Home",
            "End",
            "ArrowDown",
            "ArrowUp",
            "ArrowLeft",
            "ArrowRight",
          ].includes(event.key) ||
          !(event.target as HTMLElement).matches(
            "a[data-bookmark-id], .bookmark-checkbox"
          )
        )
          return
        const index = Number(
          (event.target as HTMLElement).closest<HTMLElement>(
            "[data-grid-index]"
          )?.dataset.gridIndex
        )
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : index +
                (event.key === "ArrowDown"
                  ? metrics.columns
                  : event.key === "ArrowUp"
                    ? -metrics.columns
                    : event.key === "ArrowLeft" ||
                        (event.key === "Tab" && event.shiftKey)
                      ? -1
                      : 1)
        if (next < 0 || next >= items.length) return
        event.preventDefault()
        keyboardFocus.current = true
        pending.current = next
        setFocus(next)
        const top =
          (ref.current?.getBoundingClientRect().top || 0) +
          scrollY +
          Math.floor(next / metrics.columns) * metrics.stride
        if (top < scrollY + 100 || top + metrics.stride > scrollY + innerHeight)
          window.scrollTo({ top: Math.max(0, top - 125), behavior: "instant" })
      }}
    >
      {[
        ...Array.from({ length: end - start }, (_, offset) => start + offset),
        ...(pinned >= 0 ? [pinned] : []),
      ]
        .sort((a, b) => a - b)
        .map((index) => (
          <div
            className="bookmark-grid-item"
            data-grid-index={index}
            data-pinned={index === pinned || undefined}
            key={items[index].id}
            style={
              virtual
                ? {
                    position: "absolute",
                    top: Math.floor(index / metrics.columns) * metrics.stride,
                    left: `calc(${((index % metrics.columns) * 100) / metrics.columns}% + ${((index % metrics.columns) * metrics.gap) / metrics.columns}px)`,
                    width: `calc(${100 / metrics.columns}% - ${((metrics.columns - 1) * metrics.gap) / metrics.columns}px)`,
                  }
                : undefined
            }
          >
            {children(items[index], index)}
          </div>
        ))}
    </div>
  )
}

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
  const [metrics, setMetrics] = useState({ columns: 1, stride: 100, gap: 6 })
  const [focus, setFocus] = useState(-1)
  const pending = useRef(-1)
  useLayoutEffect(() => {
    if (!virtual || !ref.current) return
    const element = ref.current
    const measure = () => {
      const style = getComputedStyle(element)
      const columns = style.gridTemplateColumns.split(" ").length
      const first = element.querySelector<HTMLElement>(".bookmark-grid-item")
      const stride =
        (first?.getBoundingClientRect().height || 82) +
        (parseFloat(style.rowGap) || 0)
      const gap = parseFloat(style.columnGap) || 0
      setMetrics((previous) =>
        previous.columns === columns &&
        previous.gap === gap &&
        Math.abs(previous.stride - stride) < 0.5
          ? previous
          : { columns, stride, gap }
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [virtual, items.length])
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
  return (
    <div
      ref={ref}
      className={className}
      style={
        virtual
          ? {
              position: "relative",
              paddingTop: first * metrics.stride,
              paddingBottom: (rows - last) * metrics.stride,
            }
          : undefined
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setFocus(-1)
      }}
      onKeyDown={(event) => {
        if (
          !virtual ||
          event.key !== "Tab" ||
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
        const next = index + (event.shiftKey ? -1 : 1)
        if (next < 0 || next >= items.length) return
        event.preventDefault()
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
            key={items[index].id}
            style={
              index === pinned
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

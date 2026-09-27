import { useLayoutEffect, useState } from "react"
import type { RefObject } from "react"

export function useVisibleCanvas(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean
) {
  const [range, setRange] = useState({ top: 0, bottom: 1600 })
  useLayoutEffect(() => {
    if (!enabled) return
    let frame = 0
    const update = () => {
      const top = -(ref.current?.getBoundingClientRect().top || 0)
      const next = { top: top - 600, bottom: top + innerHeight + 600 }
      setRange((previous) =>
        previous.top === next.top && previous.bottom === next.bottom
          ? previous
          : next
      )
      frame = 0
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    const observer = new ResizeObserver(schedule)
    observer.observe(document.body)
    if (ref.current) observer.observe(ref.current)
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
    }
  }, [ref, enabled])
  return range
}

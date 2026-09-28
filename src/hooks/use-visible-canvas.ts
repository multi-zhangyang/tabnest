import { useLayoutEffect, useState } from "react"
import type { RefObject } from "react"
import { subscribeViewport } from "@/lib/viewport"

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
    if (ref.current) observer.observe(ref.current)
    const unsubscribe = subscribeViewport(update)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      unsubscribe()
    }
  }, [ref, enabled])
  return range
}

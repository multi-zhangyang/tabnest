import { useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import type { LayoutMode } from "@/lib/types"

export function useViewTransition(layout: LayoutMode, ready: boolean) {
  const [displayed, setDisplayed] = useState(layout)
  const shown = useRef(layout)
  const initialized = useRef(false)
  const revision = useRef(0)
  const animation = useRef<Animation | undefined>(undefined)
  const scroll = useRef<Partial<Record<LayoutMode, number>>>({})

  useEffect(() => {
    if (!ready) return
    const element = document.querySelector<HTMLElement>(".view-panel")
    if (!element) return
    const first = !initialized.current
    initialized.current = true
    const id = ++revision.current
    let cancelled = false
    const finish = () => {
      if (cancelled || id !== revision.current) return
      element.style.removeProperty("height")
      element.style.removeProperty("opacity")
      delete element.dataset.switching
      element.inert = false
      animation.current = undefined
    }
    if (first || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animation.current?.cancel()
      shown.current = layout
      setDisplayed(layout)
      finish()
      return
    }
    const initialOpacity = Number(getComputedStyle(element).opacity)
    animation.current?.cancel()
    const changed = layout !== shown.current
    if (!changed && initialOpacity >= 0.999) {
      finish()
      return
    }
    if (changed) scroll.current[shown.current] = scrollY
    if (!element.style.height)
      element.style.height = element.getBoundingClientRect().height + "px"
    element.style.opacity = String(initialOpacity)
    element.dataset.switching = "true"
    element.inert = true
    const fade = async (from: number, to: number, duration: number) => {
      const next = element.animate([{ opacity: from }, { opacity: to }], {
        duration,
        easing: "cubic-bezier(.4,0,.6,1)",
        fill: "forwards",
      })
      animation.current = next
      try {
        await next.finished
      } catch {
        return false
      }
      if (cancelled || id !== revision.current) return false
      element.style.opacity = String(to)
      next.cancel()
      return true
    }
    const run = async () => {
      if (changed) {
        if (!(await fade(initialOpacity, 0, Math.max(30, 90 * initialOpacity))))
          return
        flushSync(() => setDisplayed(layout))
        shown.current = layout
        // Measure mounted content while it is invisible, then reveal a valid frame.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        )
      }
      while (
        !cancelled &&
        id === revision.current &&
        element.querySelector('.heat-canvas[data-layout-ready="false"]')
      )
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        )
      if (cancelled || id !== revision.current) return
      if (changed) {
        window.scrollTo({
          top: scroll.current[layout] || 0,
          behavior: "instant",
        })
      }
      if (!(await fade(changed ? 0 : initialOpacity, 1, 150))) return
      finish()
    }
    void run()
    return () => {
      cancelled = true
      element.style.opacity = getComputedStyle(element).opacity
      animation.current?.cancel()
    }
  }, [layout, ready])
  useEffect(
    () => () => {
      animation.current?.cancel()
    },
    []
  )
  return displayed
}

import { useLayoutEffect } from "react"

export function useStartupReveal(ready: boolean) {
  useLayoutEffect(() => {
    if (!ready || document.documentElement.dataset.startup !== "pending") return
    let current = true,
      frame = 0,
      fontReady = false
    const reveal = () => {
      if (
        !current ||
        !fontReady ||
        !document.querySelector(
          ".heat-card, .section-card, [data-slot=empty], [data-startup-error]"
        )
      )
        return
      frame = requestAnimationFrame(() => {
        if (current) document.documentElement.dataset.startup = "ready"
      })
      observer.disconnect()
    }
    const observer = new MutationObserver(reveal)
    observer.observe(document.getElementById("root")!, {
      childList: true,
      subtree: true,
    })
    void Promise.race([
      document.fonts.load('14px "Geist Variable"').catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 120)),
    ]).then(() => {
      fontReady = true
      reveal()
    })
    return () => {
      current = false
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [ready])
}

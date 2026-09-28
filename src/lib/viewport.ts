const listeners = new Set<() => void>()
let observer: ResizeObserver | undefined
let frame = 0
function schedule() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    listeners.forEach((listener) => listener())
  })
}
export function subscribeViewport(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    observer = new ResizeObserver(schedule)
    observer.observe(document.body)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      observer?.disconnect()
      observer = undefined
      cancelAnimationFrame(frame)
      frame = 0
    }
  }
}

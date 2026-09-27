export type OpenTarget = "current" | "background" | "foreground" | "window"

export function openTarget(
  event: {
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
    button?: number
  },
  newTab = false
): OpenTarget {
  if (event.ctrlKey || event.metaKey || event.button === 1)
    return event.shiftKey ? "foreground" : "background"
  if (event.shiftKey) return "window"
  return newTab ? "foreground" : "current"
}

export function isComposing(event: {
  isComposing?: boolean
  keyCode?: number
}) {
  return event.isComposing || event.keyCode === 229
}

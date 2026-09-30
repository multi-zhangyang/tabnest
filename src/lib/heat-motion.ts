import { safeHeatTransition } from "./heat-layout"
import type { HeatBox } from "./heat-layout"

type Rect = Pick<HeatBox, "x" | "y" | "width" | "height">
export const HEAT_DURATION = 240
export function heatMotionFrame(
  before: Rect[],
  after: Rect[],
  progress: number,
  continuous: boolean
) {
  const t = Math.max(0, Math.min(1, progress))
  if (!continuous)
    return { boxes: t < 0.5 ? before : after, opacity: Math.abs(1 - 2 * t) }
  const p = 1 - (1 - t) ** 3
  return {
    boxes: after.map((b, i) => ({
      x: before[i].x + (b.x - before[i].x) * p,
      y: before[i].y + (b.y - before[i].y) * p,
      width: before[i].width + (b.width - before[i].width) * p,
      height: before[i].height + (b.height - before[i].height) * p,
    })),
    opacity: 1,
  }
}
export const canInterpolateHeat = safeHeatTransition

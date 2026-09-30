import { useLayoutEffect, useRef } from "react"
import type { RefObject } from "react"
import { safeHeatTransition, heatLimits } from "@/lib/heat-layout"
import type { HeatBox } from "@/lib/heat-layout"
import { HEAT_DURATION, heatMotionFrame } from "@/lib/heat-motion"

type Rect = Pick<HeatBox, "x" | "y" | "width" | "height">
function paint(
  container: HTMLElement | null,
  current: Map<string, Rect>,
  ids?: Set<string>
) {
  for (const cell of container?.querySelectorAll<HTMLElement>(".heat-cell") ||
    []) {
    const id = cell.dataset.itemId || ""
    if (ids && !ids.has(id)) continue
    const rect = current.get(id)
    if (!rect) continue
    cell.style.left = rect.x + "px"
    cell.style.top = rect.y + "px"
    cell.style.width = rect.width + "px"
    cell.style.height = rect.height + "px"
  }
}
export function useHeatAnimation(
  container: RefObject<HTMLElement | null>,
  boxes: HeatBox[],
  snapshot: import("@/lib/heat-layout").HeatSnapshot | undefined,
  frozen: boolean,
  gap: number,
  scale: number
) {
  const key = snapshot?.key
  const current = useRef(new Map<string, Rect>())
  const previousKey = useRef(key)
  const frame = useRef(0)
  const opacity = useRef(1)
  const fadingIds = useRef(new Set<string>())
  useLayoutEffect(() => {
    const resetOpacity = () => {
      for (const cell of container.current?.querySelectorAll<HTMLElement>(
        ".heat-cell"
      ) || [])
        cell.style.removeProperty("opacity")
      opacity.current = 1
      fadingIds.current.clear()
    }
    cancelAnimationFrame(frame.current)
    const targets = new Map(
      boxes.map(({ item, x, y, width, height }) => [
        item.id,
        { x, y, width, height },
      ])
    )
    const sameCollection = previousKey.current === key
    previousKey.current = key
    for (const id of current.current.keys()) if (!targets.has(id)) current.current.delete(id)
    for (const [id, rect] of targets) if (!current.current.has(id)) current.current.set(id, rect)
    if (
      !sameCollection ||
      !current.current.size ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      current.current = targets
      resetOpacity()
      paint(container.current, current.current)
      return
    }
    if (frozen) {
      paint(container.current, current.current)
      return
    }
    const starts = new Map(current.current)
    const moving = [...targets].filter(([id, end]) => {
      const from = starts.get(id)
      return (
        from &&
        (from.x !== end.x ||
          from.y !== end.y ||
          from.width !== end.width ||
          from.height !== end.height)
      )
    })
    if (!moving.length) {
      paint(container.current, current.current)
      if (opacity.current < 1) {
        const start = performance.now(),
          initial = opacity.current
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / (HEAT_DURATION / 2))
          opacity.current = initial + (1 - initial) * t
          for (const cell of container.current?.querySelectorAll<HTMLElement>(
            ".heat-cell"
          ) || [])
            if (fadingIds.current.has(cell.dataset.itemId || ""))
              cell.style.opacity = String(opacity.current)
          if (t < 1) frame.current = requestAnimationFrame(tick)
          else resetOpacity()
        }
        tick(start)
        return () => cancelAnimationFrame(frame.current)
      }
      resetOpacity()
      return
    }
    const changedIds = new Set(moving.map(([id]) => id))
    const groups = snapshot?.regions
      .filter((r) => r.ids.some((id) => changedIds.has(id)))
      .map((r) => ({
        ids: r.ids,
        limits: heatLimits(r.width, r.height, scale),
      })) || [{ ids: [...targets.keys()], limits: heatLimits(0, 0, scale) }]
    if (
      opacity.current < 1 ||
      groups.some(
        ({ ids, limits }) =>
          !safeHeatTransition(
            ids.filter((id) => targets.has(id)).map((id) => starts.get(id) || targets.get(id)!),
            ids.filter((id) => targets.has(id)).map((id) => targets.get(id)!),
            gap,
            scale,
            limits
          )
      )
    ) {
      const start = performance.now()
      for (const id of fadingIds.current) changedIds.add(id)
      fadingIds.current = changedIds
      const initialOpacities = new Map<string, number>()
      for (const cell of container.current?.querySelectorAll<HTMLElement>(
        ".heat-cell"
      ) || [])
        initialOpacities.set(
          cell.dataset.itemId || "",
          Number(cell.style.opacity || 1)
        )
      let switched = false
      const tick = (now: number) => {
        const t = Math.max(0, Math.min(1, (now - start) / HEAT_DURATION))
        const sample = heatMotionFrame([], [], t, false)
        opacity.current = sample.opacity
        if (t >= 0.5 && !switched) {
          for (const cell of container.current?.querySelectorAll<HTMLElement>(
            ".heat-cell"
          ) || [])
            if (changedIds.has(cell.dataset.itemId || ""))
              cell.style.opacity = "0"
          current.current = targets
          paint(container.current, current.current)
          switched = true
          opacity.current = 0
          frame.current = requestAnimationFrame(tick)
          return
        }
        for (const cell of container.current?.querySelectorAll<HTMLElement>(
          ".heat-cell"
        ) || [])
          if (changedIds.has(cell.dataset.itemId || ""))
            cell.style.opacity = String(
              opacity.current *
                (t < 0.5
                  ? (initialOpacities.get(cell.dataset.itemId || "") ?? 1)
                  : 1)
            )
        if (t < 1) frame.current = requestAnimationFrame(tick)
        else resetOpacity()
      }
      tick(start)
      return () => cancelAnimationFrame(frame.current)
    }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / HEAT_DURATION))
      const sample = heatMotionFrame(
        moving.map(([id]) => starts.get(id)!),
        moving.map(([, end]) => end),
        t,
        true
      )
      moving.forEach(([id], i) => current.current.set(id, sample.boxes[i]))
      paint(container.current, current.current, changedIds)
      if (t < 1) frame.current = requestAnimationFrame(tick)
    }
    tick(start)
    return () => cancelAnimationFrame(frame.current)
  }, [boxes, key, snapshot, frozen, container, gap, scale])
  useLayoutEffect(() => paint(container.current, current.current))
}

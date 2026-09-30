import { planHeatRegions, solveHeatRegion, heatRegionBoxes, rememberHeatSnapshot, validHeatRegion } from "./heat-layout"
import type { HeatInput, HeatSnapshot, HeatRegion, HeatBox } from "./heat-layout"
export type RegionTask = { index: number; region: HeatRegion; counts: number[]; initial: boolean }
export type RegionResult = { index: number; region: HeatRegion; affectedIds: string[] }
export function solveRegionTasks(tasks: RegionTask[], gap: number, scale: number): RegionResult[] {
  return tasks.map(({ index, region, counts, initial }) => {
    const next = solveHeatRegion(region, counts, gap, scale, initial)
    if (!validHeatRegion(next, gap, scale)) throw new Error("布局无效")
    return { index, region: next, affectedIds: next.ids.filter((_,i) => JSON.stringify(next.boxes[i]) !== JSON.stringify(region.boxes[i])) }
  })
}
export function createHeatSession(input: HeatInput) {
  const snapshot = planHeatRegions(input)
  if (!snapshot) return undefined
  const byId = new Map(input.items.map(item => [item.id, item]))
  const location = new Map<string, { region: number; index: number }>()
  const byUrl = new Map<string, Set<number>>()
  const pending = new Set<number>()
  const initial = new Set<number>()
  const counts = new Map<number, number[]>()
  let current: HeatSnapshot = snapshot
  let clicks = input.clicks
  const updateRegion = (index: number) => {
    const r = current.regions[index]
    const next = r.urls.map((url, i) => Math.max(clicks[url] || 0, r.counts[i]))
    if (initial.has(index) || next.some((n, i) => n !== r.counts[i])) {
      pending.add(index)
      counts.set(index, next)
    }
  }
  current.regions.forEach((r, index) => {
    r.ids.forEach((id, i) => location.set(id, { region: index, index: i }))
    r.urls.forEach(url => {
      if (!byUrl.has(url)) byUrl.set(url, new Set())
      byUrl.get(url)!.add(index)
    })
    if (current.allocationVersion !== 1 && r.urls.some((url,i) => (input.clicks[url] || r.counts[i]) > 0)) initial.add(index)
    updateRegion(index)
  })
  if (!pending.size) { current = { ...current, allocationVersion: 1 }; rememberHeatSnapshot(current) }
  const tasks = (indices: Iterable<number>): RegionTask[] => [...indices].filter(i => pending.has(i)).map(index => ({
    index, region: current.regions[index], counts: counts.get(index)!, initial: initial.has(index),
  }))
  const accept = (results: RegionResult[]) => {
    if (!results.length) return
    const regions = [...current.regions]
    for (const { index, region } of results) {
      const expected = counts.get(index)
      if (!expected || region.counts.some((n, i) => n !== expected[i])) continue
      const before = current.regions[index]
      if (region.x !== before.x || region.y !== before.y || region.width !== before.width || region.height !== before.height ||
          region.ids.join("\0") !== before.ids.join("\0") || !validHeatRegion(region, current.gap, current.scale)) throw new Error("布局无效")
      regions[index] = region
      initial.delete(index)
      pending.delete(index)
      counts.delete(index)
    }
    current = { ...current, regions, allocationVersion: pending.size ? current.allocationVersion : 1 }
    if (!pending.size) rememberHeatSnapshot(current)
  }
  const visibleIndices = (top: number, bottom: number, focusedId = "") => {
    const result = new Set<number>()
    let lo = 0, hi = current.regions.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (current.regions[mid].y + current.regions[mid].height < top) lo = mid + 1
      else hi = mid
    }
    while (lo > 0 && current.regions[lo - 1].y === current.regions[lo]?.y) lo--
    for (let i = lo; i < current.regions.length; i++) {
      const r = current.regions[i]
      if (r.y > bottom) break
      if (r.y + r.height >= top) result.add(i)
    }
    const focused = location.get(focusedId)
    if (focused) result.add(focused.region)
    return result
  }
  return {
    get snapshot() { return current }, pending, tasks, accept, visibleIndices,
    update(next: Record<string, number>, urls?: string[]) {
      const changed = urls ?? Object.keys(next).filter(url => next[url] !== clicks[url])
      clicks = next
      const indices = new Set<number>()
      changed.forEach(url => byUrl.get(url)?.forEach(i => indices.add(i)))
      indices.forEach(updateRegion)
    },
    visible(top: number, bottom: number, focusedId: string): HeatBox[] {
      return heatRegionBoxes([...visibleIndices(top, bottom, focusedId)].map(i => current.regions[i]), byId)
    },
    box(id: string): HeatBox | undefined {
      const at = location.get(id)
      if (!at) return undefined
      const r = current.regions[at.region], b = r.boxes[at.index]
      return { ...b, x: b.x + r.x, y: b.y + r.y, item: byId.get(id)! }
    },
    solve(indices: Iterable<number>) { accept(solveRegionTasks(tasks(indices), current.gap, current.scale)) },
  }
}

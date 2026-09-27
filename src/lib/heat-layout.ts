import type { BookmarkItem } from "./types"
import { hash } from "./brands"

export type HeatBox = {
  item: BookmarkItem
  x: number
  y: number
  width: number
  height: number
}
type Partition =
  { index: number } | { left: Partition; right: Partition; horizontal: boolean }
type Rectangle = { x: number; y: number; width: number; height: number }
const topologyCache = new Map<string, Partition>()
let cacheRevision = 0
let savedRevision = 0
const CACHE_KEY = "tabnest:heat-topologies:v1"
export function hydrateHeatTopologies() {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]")
    if (!Array.isArray(entries) || entries.length > 4) return
    for (const [key, tree] of entries) {
      const [, ids] = JSON.parse(key)
      if (!Array.isArray(ids) || ids.length > 20000) continue
      const seen = new Set<number>()
      function valid(node: Partition, depth = 0): boolean {
        if (!node || depth > 100) return false
        if ("index" in node) {
          if (
            !Number.isInteger(node.index) ||
            node.index < 0 ||
            node.index >= ids.length ||
            seen.has(node.index)
          )
            return false
          seen.add(node.index)
          return true
        }
        return (
          typeof node.horizontal === "boolean" &&
          valid(node.left, depth + 1) &&
          valid(node.right, depth + 1)
        )
      }
      if (valid(tree) && seen.size === ids.length) topologyCache.set(key, tree)
    }
  } catch {
    /* Layout is disposable; unreadable caches are rebuilt. */
  }
}
export function persistHeatTopologies() {
  if (savedRevision === cacheRevision) return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([...topologyCache]))
    savedRevision = cacheRevision
  } catch {
    /* A full cache never prevents opening bookmarks. */
  }
}

export function heatWeight(count: number) {
  return 2 + Math.log2(1 + (Number.isFinite(count) ? Math.max(0, count) : 0))
}

function partition(
  indices: number[],
  weights: number[],
  width: number,
  height: number,
  aspect: number
): Partition {
  if (indices.length === 1) return { index: indices[0] }
  const total = indices.reduce((sum, index) => sum + weights[index], 0)
  let accumulated = weights[indices[0]],
    pivot = 1
  while (
    pivot < indices.length - 1 &&
    Math.abs(accumulated + weights[indices[pivot]] - total / 2) <
      Math.abs(accumulated - total / 2)
  ) {
    accumulated += weights[indices[pivot]]
    pivot++
  }
  const horizontal = width / height > aspect
  const ratio = accumulated / total
  return {
    horizontal,
    left: partition(
      indices.slice(0, pivot),
      weights,
      horizontal ? width * ratio : width,
      horizontal ? height : height * ratio,
      aspect
    ),
    right: partition(
      indices.slice(pivot),
      weights,
      horizontal ? width * (1 - ratio) : width,
      horizontal ? height : height * (1 - ratio),
      aspect
    ),
  }
}

function rectangles(
  tree: Partition,
  weights: number[],
  width: number,
  height: number,
  gap: number
): Rectangle[] {
  const totals = new Map<Partition, number>()
  const sum = (node: Partition): number => {
    const value =
      "index" in node ? weights[node.index] : sum(node.left) + sum(node.right)
    totals.set(node, value)
    return value
  }
  sum(tree)
  const result: Rectangle[] = []
  function visit(node: Partition, x: number, y: number, w: number, h: number) {
    if ("index" in node) {
      result[node.index] = { x, y, width: w, height: h }
      return
    }
    const ratio = totals.get(node.left)! / totals.get(node)!
    const gutter = Math.min(gap, (node.horizontal ? w : h) * 0.15)
    if (node.horizontal) {
      const first = (w - gutter) * ratio
      visit(node.left, x, y, first, h)
      visit(node.right, x + first + gutter, y, w - first - gutter, h)
    } else {
      const first = (h - gutter) * ratio
      visit(node.left, x, y, w, first)
      visit(node.right, x, y + first + gutter, w, h - first - gutter)
    }
  }
  visit(tree, 0, 0, width, height)
  return result
}

export function heatLayout(
  items: BookmarkItem[],
  clicks: Record<string, number>,
  width: number,
  height: number,
  gap = 8
): HeatBox[] {
  if (!items.length || width <= 0 || height <= 0) return []
  const desired = items.map((item) => heatWeight(clicks[item.url] || 0))
  // Build once for a collection/viewport, then retain the tree as heat changes.
  const designHeight = height
  const aspect = width > designHeight ? 1.55 : 1
  const key = JSON.stringify([Math.round(width), items.map((item) => item.id)])
  let bestTree: Partition | undefined,
    bestScore = Infinity
  bestTree = topologyCache.get(key)
  const gutter = Math.min(
    gap,
    Math.sqrt((width * height) / items.length) * 0.07
  )
  for (let attempt = 0; !topologyCache.has(key) && attempt < 12; attempt++) {
    const order = items.map((_, index) => index)
    if (attempt)
      order.sort(
        (a, b) =>
          hash(`${items[a].id}:${attempt}`) - hash(`${items[b].id}:${attempt}`)
      )
    const tree = partition(order, desired, width, designHeight, aspect)
    const boxes = rectangles(tree, desired, width, designHeight, gutter)
    const minEdge = Math.min(
      75,
      Math.sqrt((width * height) / items.length) * 0.4
    )
    const score = boxes.reduce(
      (sum, box) =>
        sum +
        Math.log(box.width / box.height / 1.4) ** 2 * 60 +
        Math.max(0, minEdge - Math.min(box.width, box.height)) ** 2 * 10,
      0
    )
    if (score < bestScore) {
      bestScore = score
      bestTree = tree
    }
  }
  if (!topologyCache.has(key)) {
    if (topologyCache.size >= 4)
      topologyCache.delete(topologyCache.keys().next().value!)
    topologyCache.set(key, bestTree!)
    cacheRevision++
  }
  // Keep the split topology fixed while compensating for the space taken by gutters.
  // This preserves heat proportions without variable gaps or high-count saturation.
  let values = [...desired],
    boxes: Rectangle[] = []
  const total = desired.reduce((a, b) => a + b, 0)
  for (let pass = 0; pass < 40; pass++) {
    boxes = rectangles(bestTree!, values, width, height, gutter)
    const areas = boxes.map((box) => box.width * box.height)
    const unit = areas.reduce((a, b) => a + b, 0) / total
    if (
      areas.every(
        (area, index) => Math.abs(area / (desired[index] * unit) - 1) < 1e-10
      )
    )
      break
    values = values.map(
      (value, index) => (value * desired[index] * unit) / areas[index]
    )
  }
  return boxes.map((box, index) => ({ ...box, item: items[index] }))
}

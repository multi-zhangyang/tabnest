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
const CACHE_KEY = "tabnest:heat-topologies:v5"
export const heatTopologySnapshot = () => [...topologyCache]
export function hydrateHeatTopologies(snapshot?: unknown) {
  try {
    const entries: unknown =
      snapshot ?? JSON.parse(localStorage.getItem(CACHE_KEY) || "[]")
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
      if (valid(tree) && seen.size === ids.length) {
        if (topologyCache.size >= 4 && !topologyCache.has(key))
          topologyCache.delete(topologyCache.keys().next().value!)
        topologyCache.set(key, tree)
        cacheRevision++
      }
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
  gap: number,
  minimum = 0
): Rectangle[] {
  const limits = new Map<Partition, { width: number; height: number }>()
  const measure = (node: Partition): { width: number; height: number } => {
    if ("index" in node) {
      const size = { width: minimum, height: minimum }
      limits.set(node, size)
      return size
    }
    const a = measure(node.left),
      b = measure(node.right)
    const size = node.horizontal
      ? { width: a.width + b.width + gap, height: Math.max(a.height, b.height) }
      : { width: Math.max(a.width, b.width), height: a.height + b.height + gap }
    limits.set(node, size)
    return size
  }
  if (minimum) measure(tree)
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
      const desired = (w - gutter) * ratio
      let low = minimum ? limits.get(node.left)!.width : 0
      let high = minimum
        ? w - gutter - limits.get(node.right)!.width
        : w - gutter
      if (minimum) {
        const shapeLow = Math.max(
          low,
          "index" in node.left ? h / 2.8 : 0,
          "index" in node.right ? w - gutter - h * 2.8 : 0
        )
        const shapeHigh = Math.min(
          high,
          "index" in node.left ? h * 2.8 : Infinity,
          "index" in node.right ? w - gutter - h / 2.8 : Infinity
        )
        if (shapeLow <= shapeHigh) {
          low = shapeLow
          high = shapeHigh
        }
      }
      const first = Math.max(low, Math.min(high, desired))
      visit(node.left, x, y, first, h)
      visit(node.right, x + first + gutter, y, w - first - gutter, h)
    } else {
      const desired = (h - gutter) * ratio
      let low = minimum ? limits.get(node.left)!.height : 0
      let high = minimum
        ? h - gutter - limits.get(node.right)!.height
        : h - gutter
      if (minimum) {
        const shapeLow = Math.max(
          low,
          "index" in node.left ? w / 2.8 : 0,
          "index" in node.right ? h - gutter - w * 2.8 : 0
        )
        const shapeHigh = Math.min(
          high,
          "index" in node.left ? w * 2.8 : Infinity,
          "index" in node.right ? h - gutter - w / 2.8 : Infinity
        )
        if (shapeLow <= shapeHigh) {
          low = shapeLow
          high = shapeHigh
        }
      }
      const first = Math.max(low, Math.min(high, desired))
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

function minimumSize(
  tree: Partition,
  gap: number
): { width: number; height: number } {
  if ("index" in tree) return { width: 48, height: 48 }
  const left = minimumSize(tree.left, gap),
    right = minimumSize(tree.right, gap)
  return tree.horizontal
    ? {
        width: left.width + right.width + gap,
        height: Math.max(left.height, right.height),
      }
    : {
        width: Math.max(left.width, right.width),
        height: left.height + right.height + gap,
      }
}

function mosaicPartition(
  indices: number[],
  weights: number[],
  width: number,
  height: number,
  gap: number
) {
  const build = (
    ids: number[],
    w: number,
    h: number
  ): { tree: Partition; score: number } => {
    if (ids.length === 1) {
      const ratio = w / h
      const target = [1, 1, 1, 2, 0.5][ids[0] % 5]
      return {
        tree: { index: ids[0] },
        score:
          Math.log(ratio / target) ** 2 * (target === 1 ? 2 : 4) +
          Math.max(0, Math.abs(Math.log(ratio)) - Math.log(2.6)) ** 2 * 1000 +
          Math.max(0, 48 - Math.min(w, h)) ** 2,
      }
    }
    const total = ids.reduce((sum, id) => sum + weights[id], 0)
    const balance = total * (0.5 + ((ids[0] % 3) - 1) * 0.08)
    let sum = weights[ids[0]],
      pivot = 1
    while (
      pivot < ids.length - 1 &&
      Math.abs(sum + weights[ids[pivot]] - balance) < Math.abs(sum - balance)
    )
      sum += weights[ids[pivot++]]
    const pivots =
      ids.length <= 6 ? ids.slice(1).map((_, index) => index + 1) : [pivot]
    let best: { tree: Partition; score: number } | undefined
    for (const split of pivots) {
      const ratio =
        ids.slice(0, split).reduce((value, id) => value + weights[id], 0) /
        total
      for (const horizontal of ids.length <= 6 ? [true, false] : [w > h]) {
        const space = (horizontal ? w : h) - gap
        const a = build(
          ids.slice(0, split),
          horizontal ? space * ratio : w,
          horizontal ? h : space * ratio
        )
        const b = build(
          ids.slice(split),
          horizontal ? space * (1 - ratio) : w,
          horizontal ? h : space * (1 - ratio)
        )
        const score = a.score + b.score
        if (!best || score < best.score)
          best = { tree: { horizontal, left: a.tree, right: b.tree }, score }
      }
    }
    return best!
  }
  return build(indices, width, height)
}

function reuseCollection(
  items: BookmarkItem[],
  weights: number[],
  width: number,
  height: number,
  gap: number
): Partition | undefined {
  const current = new Map(items.map((item, index) => [item.id, index]))
  for (const [key, previous] of [...topologyCache].reverse()) {
    const [cachedWidth, ids] = JSON.parse(key) as [number, string[]]
    if (cachedWidth !== Math.round(width)) continue
    const retained = ids.filter((id) => current.has(id))
    const changes = ids.length + items.length - 2 * retained.length
    if (!retained.length || changes > Math.max(2, items.length * 0.05)) continue
    const remap = (node: Partition): Partition | undefined => {
      if ("index" in node) {
        const index = current.get(ids[node.index])
        return index === undefined ? undefined : { index }
      }
      const left = remap(node.left),
        right = remap(node.right)
      return left && right
        ? { horizontal: node.horizontal, left, right }
        : left || right
    }
    let tree = remap(previous)!
    const previousIds = new Set(ids)
    for (const item of items.filter((item) => !previousIds.has(item.id))) {
      const boxes = rectangles(tree, weights, width, height, gap, 48)
      let target = -1,
        largest = -1
      boxes.forEach((box, index) => {
        const area = box.width * box.height
        if (area > largest) {
          target = index
          largest = area
        }
      })
      const box = boxes[target]
      const insert = (node: Partition): Partition =>
        "index" in node
          ? node.index === target
            ? {
                horizontal: box.width >= box.height,
                left: node,
                right: { index: current.get(item.id)! },
              }
            : node
          : { ...node, left: insert(node.left), right: insert(node.right) }
      tree = insert(tree)
    }
    return tree
  }
}

export function heatCanvas(
  items: BookmarkItem[],
  clicks: Record<string, number>,
  width: number,
  available: number,
  gap = 8,
  scale = 1
): { boxes: HeatBox[]; height: number } {
  if (!items.length || width < 48) return { boxes: [], height: available }
  const height = Math.max(
    available,
    Math.ceil((items.length * 10500 * scale ** 2) / width)
  )
  const key = JSON.stringify([Math.round(width), items.map((item) => item.id)])
  const desired = items.map((item) => heatWeight(clicks[item.url] || 0))
  if (!topologyCache.has(key)) {
    const reused = reuseCollection(items, desired, width, height, gap)
    if (reused) {
      if (topologyCache.size >= 4)
        topologyCache.delete(topologyCache.keys().next().value!)
      topologyCache.set(key, reused)
      cacheRevision++
    }
  }
  if (!topologyCache.has(key)) {
    const indices = items.map((_, index) => index)
    // Shape preferences change the cuts, never the measured click weights.
    let best = mosaicPartition(indices, desired, width, height, gap)
    const compositionScore = (candidate: typeof best) => {
      const cells = rectangles(candidate.tree, desired, width, height, gap, 48)
      const squares = cells.filter(
        (cell) =>
          cell.width / cell.height >= 0.82 && cell.width / cell.height <= 1.22
      ).length
      return (
        candidate.score +
        Math.max(0, Math.ceil(items.length / 4) - squares) ** 2 * 40
      )
    }
    let bestScore = compositionScore(best)
    for (let attempt = 1; attempt < (items.length <= 250 ? 24 : 1); attempt++) {
      const order = [...indices].sort(
        (a, b) =>
          hash(`${items[a].id}:${attempt}`) - hash(`${items[b].id}:${attempt}`)
      )
      const candidate = mosaicPartition(order, desired, width, height, gap)
      const score = compositionScore(candidate)
      if (score < bestScore) {
        best = candidate
        bestScore = score
      }
    }
    const tree = best.tree
    if (topologyCache.size >= 4)
      topologyCache.delete(topologyCache.keys().next().value!)
    topologyCache.set(key, tree)
    cacheRevision++
  }
  let tree = topologyCache.get(key)!
  let limits = minimumSize(tree, gap)
  if (limits.width > width) {
    // Rebuild only infeasible branches, retaining their leaf order.
    const leaves = (node: Partition): number[] =>
      "index" in node
        ? [node.index]
        : [...leaves(node.left), ...leaves(node.right)]
    const fit = (node: Partition, space: number): Partition => {
      const size = minimumSize(node, gap)
      if (size.width <= space || "index" in node) return node
      if (node.horizontal) {
        const left = minimumSize(node.left, gap),
          right = minimumSize(node.right, gap)
        if (left.width + right.width + gap > space)
          return {
            horizontal: false,
            left: fit(node.left, space),
            right: fit(node.right, space),
          }
      }
      const indices = leaves(node),
        middle = Math.ceil(indices.length / 2)
      return {
        horizontal: false,
        left: fit(
          partition(
            indices.slice(0, middle),
            items.map(() => 2),
            space,
            height / 2,
            1.3
          ),
          space
        ),
        right: fit(
          partition(
            indices.slice(middle),
            items.map(() => 2),
            space,
            height / 2,
            1.3
          ),
          space
        ),
      }
    }
    tree = fit(tree, width)
    topologyCache.set(key, tree)
    cacheRevision++
    limits = minimumSize(tree, gap)
  }
  const canvasHeight = Math.max(height, limits.height)
  let values = [...desired]
  let boxes: Rectangle[] = []
  const total = desired.reduce((sum, value) => sum + value, 0)
  for (let pass = 0; pass < 12; pass++) {
    boxes = rectangles(tree, values, width, canvasHeight, gap, 48)
    const unit =
      boxes.reduce((sum, box) => sum + box.width * box.height, 0) / total
    let error = 0
    values = values.map((value, index) => {
      const box = boxes[index],
        ratio = (desired[index] * unit) / (box.width * box.height)
      error = Math.max(error, Math.abs(1 - ratio))
      return Math.min(
        1e12,
        Math.max(1e-8, value * Math.max(0.75, Math.min(1.35, ratio)))
      )
    })
    if (error < 0.0001) break
  }
  return {
    height: canvasHeight,
    boxes: boxes.map((box, index) => ({ ...box, item: items[index] })),
  }
}

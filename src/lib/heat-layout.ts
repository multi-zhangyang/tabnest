import { withLock } from "./platform"
import type { BookmarkItem } from "./types"

export const HEAT_MINIMUM = 56
export const HEAT_CACHE_KEY = "tabnest:heat-layouts:v8"
const EPS = 1e-5
export type Geometry = { x: number; y: number; width: number; height: number }
export type HeatBox = Geometry & { item: BookmarkItem }
type Tree =
  | { index: number }
  | { horizontal: boolean; cut: number; left: Tree; right: Tree }
export type HeatRegion = Geometry & {
  ids: string[]
  urls: string[]
  counts: number[]
  tree: Tree
  cuts: number[]
  boxes: Geometry[]
}
type Region = HeatRegion
export type HeatSnapshot = {
  version: 8
  allocationVersion?: 1
  key: string
  width: number
  height: number
  gap: number
  scale: number
  regions: Region[]
}
export type HeatLayout = {
  boxes: HeatBox[]
  height: number
  snapshot?: HeatSnapshot
  affectedIds: string[]
}
export type HeatInput = {
  items: BookmarkItem[]
  clicks: Record<string, number>
  width: number
  available: number
  gap: number
  scale: number
  previous?: HeatSnapshot
}
export type HeatResult = Omit<HeatLayout, "boxes"> & {
  boxes: (Geometry & { id: string })[]
}
export function calculateHeat(input: HeatInput): HeatResult {
  const result = heatCanvas(
    input.items,
    input.clicks,
    input.width,
    input.available,
    input.gap,
    input.scale,
    input.previous
  )
  return {
    ...result,
    boxes: result.boxes.map(({ item, ...box }) => ({ ...box, id: item.id })),
  }
}
const cache = new Map<string, HeatSnapshot>()
const templates = new Map<
  string,
  { tree: Tree; cuts: number[]; boxes: Geometry[] }
>()
const heatSeeds = new Map<string, Pick<Region, "tree" | "cuts" | "boxes">>()
let dirty = false
const area = (b: Geometry) => b.width * b.height
export function heatWeight(count: number) {
  return 2 + Math.sqrt(Number.isFinite(count) ? Math.max(0, count) : 0)
}

export function heatLimits(width: number, height: number, scale = 1) {
  return {
    edge: Math.max(480 * scale, Math.min(700 * scale, Math.max(width, height))),
    area: Math.max(
      (360 * scale) ** 2,
      Math.min((520 * scale) ** 2, width * height * 0.3)
    ),
  }
}
export function validHeatBox(
  b: Geometry,
  scale = 1,
  limits = heatLimits(0, 0, scale)
) {
  return (
    [b.x, b.y, b.width, b.height].every(Number.isFinite) &&
    b.width >= 56 - EPS &&
    b.height >= 56 - EPS &&
    b.width <= limits.edge + EPS &&
    b.height <= limits.edge + EPS &&
    b.width * b.height <= limits.area + EPS &&
    b.width <= 2 * b.height + EPS &&
    b.height <= 2 * b.width + EPS &&
    b.width <= 3 * b.height - 112 + EPS &&
    b.height <= 3 * b.width - 112 + EPS
  )
}
export function safeHeatTransition(
  before: Geometry[],
  after: Geometry[],
  gap = 0,
  scale = 1,
  limits = heatLimits(0, 0, scale)
) {
  if (before.length !== after.length) return false
  for (let i = 0; i < before.length; i++) {
    const a = before[i],
      b = after[i]
    if (!validHeatBox(a, scale, limits) || !validHeatBox(b, scale, limits))
      return false
    const dw = b.width - a.width,
      dh = b.height - a.height
    const t = dw * dh < 0 ? -(a.width * dh + a.height * dw) / (2 * dw * dh) : -1
    if (
      t > 0 &&
      t < 1 &&
      (a.width + dw * t) * (a.height + dh * t) > limits.area + EPS
    )
      return false
  }
  for (let i = 0; i < before.length; i++)
    for (let j = i + 1; j < before.length; j++) {
      const a = before[i],
        b = before[j],
        c = after[i],
        d = after[j]
      if (
        !(
          a.x + a.width + gap <= b.x + EPS && c.x + c.width + gap <= d.x + EPS
        ) &&
        !(
          b.x + b.width + gap <= a.x + EPS && d.x + d.width + gap <= c.x + EPS
        ) &&
        !(
          a.y + a.height + gap <= b.y + EPS && c.y + c.height + gap <= d.y + EPS
        ) &&
        !(
          b.y + b.height + gap <= a.y + EPS && d.y + d.height + gap <= c.y + EPS
        )
      )
        return false
    }
  return true
}
function remember(snapshot: HeatSnapshot) {
  cache.delete(snapshot.key)
  cache.set(snapshot.key, snapshot)
  while (cache.size > 4) cache.delete(cache.keys().next().value!)
  dirty = true
}
export const heatTopologySnapshot = () => [...cache]
export function clearHeatWorkingCaches() {
  templates.clear()
  heatSeeds.clear()
}
export function rememberHeatSnapshot(snapshot: HeatSnapshot) {
  remember(snapshot)
}
function snapshotKey(
  width: number,
  gap: number,
  scale: number,
  ids: string[],
  urls: string[],
  available: number
) {
  return JSON.stringify([width, gap, scale, ids, urls, Math.round(available)])
}
export function savedHeatSnapshot(input: HeatInput) {
  return cache.get(
    snapshotKey(
      Math.round(input.width),
      input.gap,
      input.scale,
      input.items.map((i) => i.id),
      input.items.map((i) => i.url),
      input.available
    )
  )
}
export function hydrateHeatTopologies(input?: unknown) {
  try {
    const stored =
      input === undefined
        ? localStorage.getItem(HEAT_CACHE_KEY) || "[]"
        : undefined
    if (stored && stored.length > 4 * 1024 * 1024) return
    const raw = input ?? JSON.parse(stored!)
    if (!Array.isArray(raw) || raw.length > 4) return
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const [key, s] = entry as [string, HeatSnapshot]
      if (
        !s ||
        s.version !== 8 ||
        (s.allocationVersion !== undefined && s.allocationVersion !== 1) ||
        s.key !== key ||
        !Number.isFinite(s.width) ||
        s.width < 56 ||
        !Number.isFinite(s.height) ||
        s.height < 0 ||
        ![5, 8, 12].includes(s.gap) ||
        !Number.isFinite(s.scale) ||
        s.scale < 0.75 ||
        s.scale > 1.5 ||
        !Array.isArray(s.regions) ||
        s.regions.length > 20000
      )
        continue
      const ids = new Set<string>()
      const valid = s.regions.every((r) => {
        if (
          !Array.isArray(r.ids) ||
          !r.ids.length ||
          r.ids.length > 24 ||
          !Array.isArray(r.urls) ||
          !Array.isArray(r.boxes) ||
          r.boxes.length !== r.ids.length ||
          !Array.isArray(r.counts) ||
          r.counts.length !== r.ids.length ||
          r.urls.length !== r.ids.length ||
          !Array.isArray(r.cuts) ||
          !r.cuts.every(Number.isFinite) ||
          ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
          r.x < 0 ||
          r.y < 0 ||
          r.x + r.width > s.width + EPS ||
          r.y + r.height > s.height + EPS
        )
          return false
        if (!validHeatRegion(r, s.gap, s.scale)) return false
        return r.ids.every((id, i) => {
          if (
            typeof id !== "string" ||
            ids.has(id) ||
            typeof r.urls[i] !== "string" ||
            !Number.isSafeInteger(r.counts[i]) ||
            r.counts[i] < 0
          )
            return false
          ids.add(id)
          return true
        })
      })
      if (
        valid &&
        ids.size <= 20000 &&
        Array.isArray(JSON.parse(s.key)) &&
        JSON.stringify(JSON.parse(s.key).slice(0, 5)) ===
          JSON.stringify([
            s.width,
            s.gap,
            s.scale,
            [...ids],
            s.regions.flatMap((r) => r.urls),
          ]) &&
        (() => {
          const ordered = [...s.regions].sort((a, b) => a.y - b.y || a.x - b.x)
          let rowBottom = 0,
            rowY = -1,
            lastRight = 0
          for (const r of ordered) {
            if (r.y !== rowY) {
              if (r.y < rowBottom - EPS) return false
              rowY = r.y
              lastRight = 0
            }
            if (r.x < lastRight - EPS) return false
            lastRight = r.x + r.width
            rowBottom = Math.max(rowBottom, r.y + r.height)
          }
          return true
        })()
      )
        remember(s)
    }
  } catch {
    /* Disposable caches never prevent navigation. */
  }
}
export async function persistHeatTopologies() {
  if (!dirty) return
  await withLock("heat-cache", async () => {
    try {
      const own = [...cache]
      hydrateHeatTopologies()
      for (const [, snapshot] of own) {
        const saved = cache.get(snapshot.key)
        if (
          saved &&
          snapshot.regions.every((r, i) =>
            r.counts.every((n, j) => n === saved.regions[i]?.counts[j])
          )
        ) {
          cache.set(snapshot.key, snapshot)
          continue
        }
        if (
          !saved ||
          snapshot.regions.some((r, i) =>
            r.counts.some((n, j) => n > (saved.regions[i]?.counts[j] ?? -1))
          )
        )
          remember(snapshot)
      }
      let entries = [...cache],
        text = JSON.stringify(entries)
      while (
        new TextEncoder().encode(text).byteLength > 4 * 1024 * 1024 &&
        entries.length
      ) {
        cache.delete(entries[0][0])
        entries = entries.slice(1)
        text = JSON.stringify(entries)
      }
      if (localStorage.getItem(HEAT_CACHE_KEY) !== text)
        localStorage.setItem(HEAT_CACHE_KEY, text)
      for (const key of ["tabnest:heat-layouts:v6", "tabnest:heat-layouts:v7"])
        localStorage.removeItem(key)
      dirty = false
    } catch {
      /* Storage exhaustion leaves the current layout usable. */
    }
  })
}

export function validHeatRegion(r: HeatRegion, gap: number, scale: number) {
  try {
    if (
      !r ||
      !r.ids.length ||
      r.ids.length > 24 ||
      r.urls.length !== r.ids.length ||
      r.counts.length !== r.ids.length ||
      r.boxes.length !== r.ids.length ||
      ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
      !r.cuts.every(Number.isFinite)
    )
      return false
    const leaves = new Set<number>(),
      cuts = new Set<number>()
    const check = (tree: Tree, depth = 0): boolean => {
      if (!tree || depth > 32) return false
      if ("index" in tree) {
        if (
          !Number.isInteger(tree.index) ||
          tree.index < 0 ||
          tree.index >= r.ids.length ||
          leaves.has(tree.index)
        )
          return false
        leaves.add(tree.index)
        return true
      }
      if (
        typeof tree.horizontal !== "boolean" ||
        !Number.isInteger(tree.cut) ||
        tree.cut < 0 ||
        tree.cut >= r.cuts.length ||
        cuts.has(tree.cut)
      )
        return false
      cuts.add(tree.cut)
      return check(tree.left, depth + 1) && check(tree.right, depth + 1)
    }
    if (
      !check(r.tree) ||
      leaves.size !== r.ids.length ||
      cuts.size !== r.cuts.length
    )
      return false
    const reconstructed = geometry(r.tree, r.cuts, r.width, r.height, gap)
    return (
      r.boxes.every(
        (b, i) =>
          b.x >= -EPS &&
          b.y >= -EPS &&
          b.x + b.width <= r.width + EPS &&
          b.y + b.height <= r.height + EPS &&
          (Object.keys(b) as (keyof Geometry)[]).every(
            (k) => Math.abs(b[k] - reconstructed[i][k]) < EPS
          )
      ) &&
      safeHeatTransition(
        r.boxes,
        r.boxes,
        gap,
        scale,
        heatLimits(r.width, r.height, scale)
      )
    )
  } catch {
    return false
  }
}
function geometry(
  tree: Tree,
  cuts: number[],
  width: number,
  height: number,
  gap: number
): Geometry[] {
  const result: Geometry[] = []
  const visit = (t: Tree, x: number, y: number, w: number, h: number) => {
    if ("index" in t) {
      result[t.index] = { x, y, width: w, height: h }
      return
    }
    const c = cuts[t.cut]
    if (t.horizontal) {
      visit(t.left, x, y, c - gap / 2 - x, h)
      visit(t.right, c + gap / 2, y, x + w - c - gap / 2, h)
    } else {
      visit(t.left, x, y, w, c - gap / 2 - y)
      visit(t.right, x, c + gap / 2, w, y + h - c - gap / 2)
    }
  }
  visit(tree, 0, 0, width, height)
  return result
}
type Ref = { index: number; offset: number }
type Linear = { terms: [number, number][]; constant: number }
type Constraint = { terms: [number, number][]; limit: number; norm: number }
function constraints(
  tree: Tree,
  width: number,
  height: number,
  gap: number,
  scale: number,
  reference?: Geometry[],
  limits = heatLimits(width, height, scale)
) {
  const result: Constraint[] = []
  const subtract = (a: Ref, b: Ref): Linear => ({
    terms: [
      ...(a.index < 0 ? [] : [[a.index, 1] as [number, number]]),
      ...(b.index < 0 ? [] : [[b.index, -1] as [number, number]]),
    ],
    constant: a.offset - b.offset,
  })
  const add = (w: Linear, h: Linear, a: number, b: number, limit: number) => {
    const coefficients = new Map<number, number>()
    for (const [i, v] of w.terms)
      coefficients.set(i, (coefficients.get(i) || 0) + a * v)
    for (const [i, v] of h.terms)
      coefficients.set(i, (coefficients.get(i) || 0) + b * v)
    const terms = [...coefficients].filter(([, v]) => v !== 0)
    result.push({
      terms,
      limit: limit - a * w.constant - b * h.constant,
      norm: terms.reduce((s, [, v]) => s + v * v, 0),
    })
  }
  const visit = (t: Tree, l: Ref, r: Ref, top: Ref, bottom: Ref) => {
    if ("index" in t) {
      const w = subtract(r, l),
        h = subtract(bottom, top)
      const box = reference?.[t.index]
      const aspect = box ? Math.sqrt(box.height / box.width) : 1
      for (const [a, b, limit] of [
        [-1, 0, -56],
        [0, -1, -56],
        [1, 0, limits.edge],
        [0, 1, limits.edge],
        [aspect, 1 / aspect, 2 * Math.sqrt(limits.area)],
        [1, -2, 0],
        [-2, 1, 0],
        [1, -3, -112],
        [-3, 1, -112],
      ])
        add(w, h, a, b, limit)
      return
    }
    const near = { index: t.cut, offset: -gap / 2 },
      far = { index: t.cut, offset: gap / 2 }
    if (t.horizontal) {
      visit(t.left, l, near, top, bottom)
      visit(t.right, far, r, top, bottom)
    } else {
      visit(t.left, l, r, top, near)
      visit(t.right, l, r, far, bottom)
    }
  }
  visit(
    tree,
    { index: -1, offset: 0 },
    { index: -1, offset: width },
    { index: -1, offset: 0 },
    { index: -1, offset: height }
  )
  return result
}
function project(cuts: number[], rules: Constraint[], passes = 80) {
  const x = [...cuts]
  for (let pass = 0; pass < passes; pass++) {
    let error = 0
    for (const rule of rules) {
      let excess = 0
      for (let term = 0; term < rule.terms.length; term++) {
        const coefficient = rule.terms[term]
        excess += coefficient[1] * x[coefficient[0]]
      }
      excess -= rule.limit
      if (excess > 0 && rule.norm) {
        error = Math.max(error, excess)
        for (let term = 0; term < rule.terms.length; term++) {
          const coefficient = rule.terms[term]
          x[coefficient[0]] -= (excess * coefficient[1]) / rule.norm
        }
      }
    }
    if (error < 1e-7) break
  }
  return x
}
function buildTree(
  n: number,
  width: number,
  height: number,
  gap: number,
  seed: number
) {
  const cuts: number[] = []
  const build = (
    ids: number[],
    x: number,
    y: number,
    w: number,
    h: number
  ): Tree => {
    if (ids.length === 1) return { index: ids[0] }
    const choices = []
    for (const horizontal of [true, false])
      for (let p = 1; p < ids.length; p++) {
        const dimension = horizontal ? w : h,
          first = ((dimension - gap) * p) / ids.length
        const aw = horizontal ? first : w,
          ah = horizontal ? h : first
        const bw = horizontal ? dimension - gap - first : w,
          bh = horizontal ? h : dimension - gap - first
        const cellA = Math.sqrt((aw * ah) / p),
          cellB = Math.sqrt((bw * bh) / (ids.length - p))
        const cost =
          Math.abs(Math.log(aw / ah / Math.sqrt(p))) +
          Math.abs(Math.log(bw / bh / Math.sqrt(ids.length - p))) +
          (Math.min(cellA, cellB) < 75 ? 100 : 0) +
          Math.abs(p - ids.length / 2) * 0.015 +
          (ids.length <= 4
            ? Math.abs(
                Math.log(
                  aw /
                    ah /
                    (p === 1 ? [1, 1.65, 0.606][(ids[0] + seed) % 3] : 1)
                )
              ) * 0.6
            : 0)
        choices.push({ horizontal, p, first, cost })
      }
    choices.sort((a, b) => a.cost - b.cost)
    const { horizontal, p, first } = choices[0],
      cut = cuts.length
    cuts.push((horizontal ? x : y) + first + gap / 2)
    return {
      horizontal,
      cut,
      left: build(
        ids.slice(0, p),
        x,
        y,
        horizontal ? first : w,
        horizontal ? h : first
      ),
      right: build(
        ids.slice(p),
        horizontal ? x + first + gap : x,
        horizontal ? y : y + first + gap,
        horizontal ? w - first - gap : w,
        horizontal ? h : h - first - gap
      ),
    }
  }
  const tree = build(
    Array.from({ length: n }, (_, i) => i),
    0,
    0,
    width,
    height
  )
  return { tree, cuts }
}
type ShapeTree =
  { index: number } | { horizontal: boolean; left: ShapeTree; right: ShapeTree }
function initialTree(
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
  ): { tree: ShapeTree; score: number } => {
    if (ids.length === 1) {
      const ratio = w / h
      const target = [1, 1, 1, 2, 0.5][ids[0] % 5]
      return {
        tree: { index: ids[0] },
        score:
          Math.log(ratio / target) ** 2 * (target === 1 ? 2 : 4) +
          Math.max(0, Math.abs(Math.log(ratio)) - Math.log(2)) ** 2 * 1000 +
          Math.max(0, 56 - Math.min(w, h)) ** 2,
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
    let best: { tree: ShapeTree; score: number } | undefined
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

function template(
  n: number,
  width: number,
  height: number,
  gap: number,
  scale: number
) {
  const key = JSON.stringify([n, width, height, gap, scale])
  const cached = templates.get(key)
  if (cached) return cached
  let best:
    { tree: Tree; cuts: number[]; boxes: Geometry[]; score: number } | undefined
  const shapeCuts: number[] = []
  const shape = initialTree(
    Array.from({ length: n }, (_, i) => i),
    Array.from({ length: n }, () => 1),
    width,
    height,
    gap
  ).tree
  const size = (t: ShapeTree): number =>
    "index" in t ? 1 : size(t.left) + size(t.right)
  const convert = (
    t: ShapeTree,
    x: number,
    y: number,
    w: number,
    h: number
  ): Tree => {
    if ("index" in t) return t
    const first = (((t.horizontal ? w : h) - gap) * size(t.left)) / size(t),
      cut = shapeCuts.length
    shapeCuts.push((t.horizontal ? x : y) + first + gap / 2)
    return {
      horizontal: t.horizontal,
      cut,
      left: convert(
        t.left,
        x,
        y,
        t.horizontal ? first : w,
        t.horizontal ? h : first
      ),
      right: convert(
        t.right,
        t.horizontal ? x + first + gap : x,
        t.horizontal ? y : y + first + gap,
        t.horizontal ? w - first - gap : w,
        t.horizontal ? h : h - first - gap
      ),
    }
  }
  const shapeTree = convert(shape, 0, 0, width, height)
  const candidates = Array.from({ length: 8 }, (_, seed) =>
    buildTree(n, width, height, gap, seed)
  )
  candidates.push({ tree: shapeTree, cuts: shapeCuts })
  for (let rows = 1; rows <= n; rows++) {
    const cuts: number[] = []
    let index = 0
    const rowTrees: Tree[] = []
    for (let row = 0; row < rows; row++) {
      const count = Math.floor(n / rows) + (row < n % rows ? 1 : 0)
      const w = (width - (count - 1) * gap) / count
      let rowTree: Tree = { index: index++ }
      for (let col = 1; col < count; col++) {
        const cut = cuts.length
        cuts.push(col * (w + gap) - gap / 2)
        rowTree = {
          horizontal: true,
          cut,
          left: rowTree,
          right: { index: index++ },
        }
      }
      rowTrees.push(rowTree)
    }
    let tree = rowTrees[0]
    for (let row = 1; row < rows; row++) {
      const cut = cuts.length
      cuts.push(row * ((height + gap) / rows) - gap / 2)
      tree = { horizontal: false, cut, left: tree, right: rowTrees[row] }
    }
    candidates.push({ tree, cuts })
  }
  for (const initial of candidates) {
    const cuts = project(
      initial.cuts,
      constraints(initial.tree, width, height, gap, scale),
      600
    )
    let boxes = geometry(initial.tree, cuts, width, height, gap)
    if (
      !boxes.every((b) =>
        validHeatBox(b, scale, heatLimits(width, height, scale))
      )
    )
      continue
    const rules = constraints(initial.tree, width, height, gap, scale)
    const balance = (bs: Geometry[]) => {
      const mean = bs.reduce((s, b) => s + area(b), 0) / n
      return bs.reduce((s, b) => s + (area(b) / mean - 1) ** 2, 0)
    }
    for (let step = 0; step < 100; step++) {
      const base = balance(boxes)
      if (base < 0.001) break
      const gradient = cuts.map((_, j) => {
        const probe = [...cuts]
        probe[j] += 0.1
        return (
          (balance(geometry(initial.tree, probe, width, height, gap)) - base) /
          0.1
        )
      })
      const norm = Math.max(1e-9, Math.hypot(...gradient))
      let accepted = false
      for (const rate of [8, 2, 0.5]) {
        const candidate = project(
          cuts.map((v, i) => v - (gradient[i] / norm) * rate),
          rules,
          100
        )
        const next = geometry(initial.tree, candidate, width, height, gap)
        if (
          next.every((b) =>
            validHeatBox(b, scale, heatLimits(width, height, scale))
          ) &&
          balance(next) < base - 1e-9
        ) {
          cuts.splice(0, cuts.length, ...candidate)
          boxes = next
          accepted = true
          break
        }
      }
      if (!accepted) break
    }
    const mean = boxes.reduce((s, b) => s + area(b), 0) / n
    const squares = boxes.filter(
      (b) => b.width / b.height >= 0.8 && b.width / b.height <= 1.25
    ).length
    const score =
      boxes.reduce(
        (s, b, i) =>
          s +
          (area(b) / mean - 1) ** 2 * 30 +
          Math.log(b.width / b.height / [1, 1, 1, 1.7, 0.588][i % 5]) ** 2,
        0
      ) +
      Math.max(0, Math.ceil(n / 4) - squares) * 10 +
      (boxes.some((b) => b.width / b.height > 1.35) ? 0 : 10) +
      (boxes.some((b) => b.width / b.height < 0.75) ? 0 : 10)
    if (!best || score < best.score)
      best = { tree: initial.tree, cuts, boxes, score }
  }
  if (!best) throw new Error("拼图尺寸无法分配")
  const result = { tree: best.tree, cuts: best.cuts, boxes: best.boxes }
  templates.set(key, result)
  if (templates.size > 32) templates.delete(templates.keys().next().value!)
  return result
}
export function allocateHeatAreas(
  counts: number[],
  capacity: number,
  maximum: number
) {
  const minimum = HEAT_MINIMUM ** 2
  const weights = counts.map(heatWeight)
  if (!weights.length) return []
  const available = Math.max(
    minimum * weights.length,
    Math.min(capacity, maximum * weights.length)
  )
  let low = 0,
    high = maximum / Math.min(...weights)
  for (let step = 0; step < 48; step++) {
    const factor = (low + high) / 2
    const sum = weights.reduce(
      (value, weight) =>
        value + Math.min(maximum, Math.max(minimum, factor * weight)),
      0
    )
    if (sum < available) low = factor
    else high = factor
  }
  const factor = (low + high) / 2
  return weights.map((weight) =>
    Math.min(maximum, Math.max(minimum, factor * weight))
  )
}
function requestedHeatArea(
  r: Region,
  counts: number[],
  index: number,
  scale: number
) {
  const usableArea = r.boxes.reduce((sum, box) => sum + area(box), 0)
  const maximum = heatLimits(r.width, r.height, scale).area
  const shares = allocateHeatAreas(counts, usableArea, maximum)
  const previousShares = allocateHeatAreas(r.counts, usableArea, maximum)
  const totalWeight = r.counts.reduce(
    (sum, count) => sum + heatWeight(count),
    0
  )
  const floorIncrement = Math.min(
    HEAT_MINIMUM ** 2 / 2,
    (usableArea / totalWeight) *
      Math.max(0, heatWeight(counts[index]) - heatWeight(r.counts[index]))
  )
  const minimumShare =
    shares[index] <= HEAT_MINIMUM ** 2 + EPS &&
    previousShares[index] <= HEAT_MINIMUM ** 2 + EPS
  const currentArea = area(r.boxes[index])
  const clickDelta = Math.max(0, counts[index] - r.counts[index])
  const visibleIncrement = clickDelta
    ? (Math.sqrt(currentArea) + Math.min(2, Math.sqrt(clickDelta)) * 6) ** 2 -
      currentArea
    : 0
  return Math.min(
    maximum,
    Math.max(
      area(r.boxes[index]) +
        Math.max(
          0,
          shares[index] - previousShares[index],
          minimumShare ? floorIncrement : 0,
          visibleIncrement
        ),
      shares[index]
    )
  )
}
function heatNeighbourDistances(
  boxes: Geometry[],
  targets: number[],
  gap: number
) {
  const distances = boxes.map(() => Infinity)
  const queue = [...targets]
  targets.forEach((index) => (distances[index] = 0))
  const adjacent = (a: Geometry, b: Geometry) => {
    const vertical =
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    const horizontal =
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    return (
      (vertical > EPS &&
        (Math.abs(a.x + a.width + gap - b.x) < 0.01 ||
          Math.abs(b.x + b.width + gap - a.x) < 0.01)) ||
      (horizontal > EPS &&
        (Math.abs(a.y + a.height + gap - b.y) < 0.01 ||
          Math.abs(b.y + b.height + gap - a.y) < 0.01))
    )
  }
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]
    boxes.forEach((box, index) => {
      if (distances[index] === Infinity && adjacent(boxes[current], box)) {
        distances[index] = distances[current] + 1
        queue.push(index)
      }
    })
  }
  return distances
}
function redistribute(
  r: Region,
  counts: number[],
  gap: number,
  scale: number
): Region {
  const targets = counts.flatMap((n, i) => (n > r.counts[i] ? [i] : []))
  if (!targets.length) return { ...r, counts }
  const maximum = heatLimits(r.width, r.height, scale).area
  if (
    targets.every(
      (index) => area(r.boxes[index]) >= maximum - Math.sqrt(maximum) / 2
    )
  )
    return { ...r, counts }
  let first = adjustCuts(r, counts, gap, scale)
  if (
    targets.every(
      (i) =>
        area(first.boxes[i]) - area(r.boxes[i]) >=
        Math.max(
          0,
          0.7 * (requestedHeatArea(r, counts, i, scale) - area(r.boxes[i])) -
            EPS
        )
    )
  )
    return first
  const progresses = (candidate: Region) =>
    targets.filter((i) => area(candidate.boxes[i]) > area(r.boxes[i]) + 1)
      .length
  const better = (candidate: Region) =>
    progresses(candidate) > progresses(first) ||
    (targets.every(
      (i) => area(candidate.boxes[i]) >= area(first.boxes[i]) - EPS
    ) &&
      targets.some((i) => area(candidate.boxes[i]) > area(first.boxes[i]) + 1))
  const responsive = (candidate: Region) =>
    targets.every((i) => {
      const currentArea = area(r.boxes[i]),
        delta = requestedHeatArea(r, counts, i, scale) - currentArea
      const ordinary =
        counts[i] - r.counts[i] < 10 &&
        delta <= (Math.sqrt(currentArea) + 24) ** 2 - currentArea
      return (
        area(candidate.boxes[i]) - currentArea >=
        Math.max(
          0,
          ordinary
            ? Math.min(Math.max(100, Math.sqrt(currentArea)), 0.7 * delta)
            : 0.7 * delta
        ) -
          EPS
      )
    })
  const local =
    targets.length > 1 || targets.every((i) => counts[i] - r.counts[i] < 10)
      ? repartitionHeatNeighbourhood(r, counts, gap, scale)
      : { ...r, counts }
  if (
    responsive(local) &&
    (safeHeatTransition(
      r.boxes,
      local.boxes,
      gap,
      scale,
      heatLimits(r.width, r.height, scale)
    ) ||
      targets.every((i) => area(local.boxes[i]) >= area(first.boxes[i]) - EPS))
  )
    return local
  if (better(local)) first = local
  if (responsive(first)) return first
  const packed = pressureLayout(r, counts, gap, scale)
  if (better(packed)) return packed
  return first
}
function repartitionHeatNeighbourhood(
  r: Region,
  counts: number[],
  gap: number,
  scale: number
): Region {
  const targets = counts.flatMap((count, i) => (count > r.counts[i] ? [i] : []))
  const limits = heatLimits(r.width, r.height, scale)
  const candidates: { node: Tree; leaves: number[]; slots: number[] }[] = []
  const collect = (node: Tree): { leaves: number[]; slots: number[] } => {
    if ("index" in node) return { leaves: [node.index], slots: [] }
    const a = collect(node.left),
      b = collect(node.right)
    const group = {
      leaves: [...a.leaves, ...b.leaves],
      slots: [node.cut, ...a.slots, ...b.slots],
    }
    if (
      group.leaves.length <= 8 &&
      group.leaves.some((i) => targets.includes(i))
    )
      candidates.push({ node, ...group })
    return group
  }
  collect(r.tree)
  candidates.sort((a, b) => a.leaves.length - b.leaves.length)
  let best = { ...r, counts }
  for (const { node, leaves, slots } of candidates) {
    const x = Math.min(...leaves.map((i) => r.boxes[i].x)),
      y = Math.min(...leaves.map((i) => r.boxes[i].y))
    const width =
      Math.max(...leaves.map((i) => r.boxes[i].x + r.boxes[i].width)) - x
    const height =
      Math.max(...leaves.map((i) => r.boxes[i].y + r.boxes[i].height)) - y
    const convert = (tree: Tree): Tree =>
      "index" in tree
        ? { index: leaves.indexOf(tree.index) }
        : {
            horizontal: tree.horizontal,
            cut: slots.indexOf(tree.cut),
            left: convert(tree.left),
            right: convert(tree.right),
          }
    const local: Region = {
      x: 0,
      y: 0,
      width,
      height,
      ids: leaves.map((i) => r.ids[i]),
      urls: leaves.map((i) => r.urls[i]),
      counts: leaves.map((i) => r.counts[i]),
      tree: convert(node),
      cuts: slots.map((slot) => r.cuts[slot]),
      boxes: leaves.map((i) => ({
        ...r.boxes[i],
        x: r.boxes[i].x - x,
        y: r.boxes[i].y - y,
      })),
    }
    const offsetCuts = (tree: Tree) => {
      if ("index" in tree) return
      local.cuts[tree.cut] -= tree.horizontal ? x : y
      offsetCuts(tree.left)
      offsetCuts(tree.right)
    }
    offsetCuts(local.tree)
    const localCounts = leaves.map((i) => counts[i])
    const localTargets = leaves.flatMap((i, j) =>
      targets.includes(i) ? [j] : []
    )
    const desired = local.boxes.map(area)
    for (const target of localTargets) {
      const currentArea = desired[target]
      let delta = Math.min(
        requestedHeatArea(r, counts, leaves[target], scale) - currentArea,
        (Math.sqrt(currentArea) + 6) ** 2 - currentArea
      )
      const distances = heatNeighbourDistances(local.boxes, [target], gap)
      const donors = leaves
        .map((_, i) => i)
        .filter((i) => !localTargets.includes(i))
        .sort(
          (a, b) =>
            distances[a] - distances[b] ||
            localCounts[a] - localCounts[b] ||
            a - b
        )
      for (const donor of donors) {
        const amount = Math.min(
          Math.max(0, desired[donor] - HEAT_MINIMUM ** 2),
          delta
        )
        desired[donor] -= amount
        desired[target] += amount
        delta -= amount
      }
    }
    if (localTargets.every((i) => desired[i] <= area(local.boxes[i]) + 1))
      continue
    const fitted = fitHeatAreas(
      local,
      localCounts,
      desired,
      localTargets,
      gap,
      scale,
      { limits, local: true }
    )
    const boxes = [...best.boxes]
    leaves.forEach(
      (i, j) =>
        (boxes[i] = {
          ...fitted.boxes[j],
          x: fitted.boxes[j].x + x,
          y: fitted.boxes[j].y + y,
        })
    )
    if (
      !targets.every((i) => area(boxes[i]) >= area(best.boxes[i]) - EPS) ||
      !targets.some((i) => area(boxes[i]) > area(best.boxes[i]) + 1)
    )
      continue
    const cuts = [...best.cuts]
    const restore = (tree: Tree): Tree => {
      if ("index" in tree) return { index: leaves[tree.index] }
      cuts[slots[tree.cut]] = fitted.cuts[tree.cut] + (tree.horizontal ? x : y)
      return {
        horizontal: tree.horizontal,
        cut: slots[tree.cut],
        left: restore(tree.left),
        right: restore(tree.right),
      }
    }
    const replacement = restore(fitted.tree)
    const replace = (tree: Tree): Tree =>
      "index" in tree
        ? tree
        : "cut" in node && tree.cut === node.cut
          ? replacement
          : {
              ...tree,
              left: replace(tree.left),
              right: replace(tree.right),
            }
    const candidate = { ...r, counts, tree: replace(best.tree), cuts, boxes }
    if (!validHeatRegion(candidate, gap, scale)) continue
    best = candidate
    if (
      targets.every(
        (i) =>
          area(best.boxes[i]) - area(r.boxes[i]) >=
          Math.max(
            0,
            0.7 * (requestedHeatArea(r, counts, i, scale) - area(r.boxes[i])) -
              EPS
          )
      )
    )
      return best
  }
  return best
}
function pressureLayout(
  r: Region,
  counts: number[],
  gap: number,
  scale: number
): Region {
  const targets = counts.flatMap((n, i) => (n > r.counts[i] ? [i] : []))
  if (!targets.length) return { ...r, counts }
  const desired = r.boxes.map(area)
  const distances = heatNeighbourDistances(r.boxes, targets, gap)
  for (const target of targets) {
    const requested = requestedHeatArea(r, counts, target, scale)
    let delta = requested - desired[target]
    const distance = (i: number) => {
      const a = r.boxes[i],
        b = r.boxes[target]
      return Math.hypot(
        Math.max(0, a.x - b.x - b.width - gap, b.x - a.x - a.width - gap),
        Math.max(0, a.y - b.y - b.height - gap, b.y - a.y - a.height - gap)
      )
    }
    const donors = r.ids
      .map((_, i) => i)
      .filter((i) => !targets.includes(i))
      .sort(
        (a, b) =>
          distances[a] - distances[b] ||
          counts[a] - counts[b] ||
          distance(a) - distance(b) ||
          a - b
      )
    for (const donor of donors) {
      const amount = Math.min(Math.max(0, desired[donor] - 56 ** 2), delta)
      desired[donor] -= amount
      desired[target] += amount
      delta -= amount
      if (delta < 0.01) break
    }
  }
  return fitHeatAreas(r, counts, desired, targets, gap, scale)
}
function fitHeatAreas(
  r: Region,
  counts: number[],
  desired: number[],
  targets: number[],
  gap: number,
  scale: number,
  options?: { limits: ReturnType<typeof heatLimits>; local: boolean }
): Region {
  const limits = options?.limits || heatLimits(r.width, r.height, scale)
  const weights = desired
  const score = (boxes: Geometry[]) =>
    boxes.reduce(
      (sum, b, i) =>
        sum +
        (Math.sqrt(area(b)) - Math.sqrt(desired[i])) ** 2 *
          (targets.includes(i) ? 4 : 1) +
        Math.hypot(b.x - r.boxes[i].x, b.y - r.boxes[i].y) * 0.02,
      0
    )
  let best = { ...r, counts }
  let bestScore = Infinity
  const active = targets.filter(
    (i) => area(r.boxes[i]) < limits.area - Math.sqrt(limits.area) / 2
  )
  const progresses = (boxes: Geometry[]) =>
    active.reduce(
      (sum, i) => sum + Number(area(boxes[i]) > area(r.boxes[i]) + 1),
      0
    )
  const fulfilled = (boxes: Geometry[]) =>
    active.length > 0 &&
    active.every(
      (i) =>
        area(boxes[i]) - area(r.boxes[i]) >=
        0.7 *
          (options?.local
            ? Math.min(
                desired[i] - area(r.boxes[i]),
                (Math.sqrt(area(r.boxes[i])) + 6) ** 2 - area(r.boxes[i])
              )
            : desired[i] - area(r.boxes[i])) -
          EPS
    )
  const better = (boxes: Geometry[], value: number, tolerance = 0) => {
    const nextProgress = progresses(boxes),
      currentProgress = progresses(best.boxes)
    if (nextProgress !== currentProgress) return nextProgress > currentProgress
    const nextSafe =
      fulfilled(boxes) && safeHeatTransition(r.boxes, boxes, gap, scale, limits)
    const currentSafe =
      fulfilled(best.boxes) &&
      safeHeatTransition(r.boxes, best.boxes, gap, scale, limits)
    return nextSafe !== currentSafe ? nextSafe : value < bestScore - tolerance
  }
  const orders = [
    r.ids.map((_, i) => i),
    r.ids.map((_, i) => i).sort((a, b) => desired[a] - desired[b] || a - b),
    r.ids.map((_, i) => i).sort((a, b) => desired[b] - desired[a] || a - b),
    r.ids
      .map((_, i) => i)
      .sort(
        (a, b) => r.boxes[a].y - r.boxes[b].y || r.boxes[a].x - r.boxes[b].x
      ),
    r.ids
      .map((_, i) => i)
      .sort(
        (a, b) => r.boxes[a].x - r.boxes[b].x || r.boxes[a].y - r.boxes[b].y
      ),
  ]
  const existingRules = constraints(
    r.tree,
    r.width,
    r.height,
    gap,
    scale,
    r.boxes,
    limits
  )
  if (!targets.length) {
    bestScore = score(r.boxes)
  }
  for (const ratio of [0, 0.4, 1]) {
    const intermediate = desired.map(
      (value, i) => area(r.boxes[i]) + (value - area(r.boxes[i])) * ratio
    )
    const cuts = [...r.cuts]
    const visit = (
      tree: Tree,
      x: number,
      y: number,
      width: number,
      height: number
    ): number => {
      if ("index" in tree) return intermediate[tree.index]
      const sum = (node: Tree): number =>
        "index" in node
          ? intermediate[node.index]
          : sum(node.left) + sum(node.right)
      const left = sum(tree.left),
        total = left + sum(tree.right)
      const space = (tree.horizontal ? width : height) - gap
      const edge = (space * left) / total
      cuts[tree.cut] = (tree.horizontal ? x : y) + edge + gap / 2
      visit(
        tree.left,
        x,
        y,
        tree.horizontal ? edge : width,
        tree.horizontal ? height : edge
      )
      visit(
        tree.right,
        tree.horizontal ? x + edge + gap : x,
        tree.horizontal ? y : y + edge + gap,
        tree.horizontal ? width - edge - gap : width,
        tree.horizontal ? height : height - edge - gap
      )
      return total
    }
    if (ratio) visit(r.tree, 0, 0, r.width, r.height)
    const projected = ratio
      ? project(cuts, existingRules, targets.length ? 1200 : 120)
      : cuts
    const boxes = geometry(r.tree, projected, r.width, r.height, gap)
    if (
      boxes.every((box) => validHeatBox(box, scale, limits)) &&
      targets.every((i) => area(boxes[i]) >= area(r.boxes[i]) - EPS)
    ) {
      const value = score(boxes)
      if (better(boxes, value)) {
        bestScore = value
        best = { ...r, counts, cuts: projected, boxes }
      }
    }
  }
  for (const target of targets.slice(0, 4)) {
    const other = r.ids.map((_, i) => i).filter((i) => i !== target)
    orders.push([target, ...other], [...other, target])
  }
  const candidateOrders = targets.length ? orders : [orders[0], orders[2]]
  for (const order of candidateOrders)
    for (const mode of targets.length
      ? options?.local
        ? [0, 1, 2]
        : [0, 1, 2, 3]
      : [0]) {
      const cuts: number[] = []
      const build = (
        ids: number[],
        x: number,
        y: number,
        w: number,
        h: number
      ): Tree => {
        if (ids.length === 1) return { index: ids[0] }
        const sum = ids.reduce((s, i) => s + weights[i], 0)
        let first = weights[ids[0]],
          p = 1
        while (
          p < ids.length - 1 &&
          Math.abs(first + weights[ids[p]] - sum / 2) <
            Math.abs(first - sum / 2)
        )
          first += weights[ids[p++]]
        const horizontal =
            mode === 0 ? w > h : mode === 1 ? w > h * 0.7 : w > h * 1.4,
          cut = cuts.length
        const split = (horizontal ? w : h) - gap,
          a = (split * first) / sum
        cuts.push((horizontal ? x : y) + a + gap / 2)
        return {
          horizontal,
          cut,
          left: build(
            ids.slice(0, p),
            x,
            y,
            horizontal ? a : w,
            horizontal ? h : a
          ),
          right: build(
            ids.slice(p),
            horizontal ? x + a + gap : x,
            horizontal ? y : y + a + gap,
            horizontal ? w - a - gap : w,
            horizontal ? h : h - a - gap
          ),
        }
      }
      const shape =
        mode === 3
          ? initialTree(order, weights, r.width, r.height, gap).tree
          : undefined
      const sumWeights = (t: ShapeTree): number =>
        "index" in t
          ? weights[t.index]
          : sumWeights(t.left) + sumWeights(t.right)
      const convert = (
        t: ShapeTree,
        x: number,
        y: number,
        w: number,
        h: number
      ): Tree => {
        if ("index" in t) return t
        const first =
            (((t.horizontal ? w : h) - gap) * sumWeights(t.left)) /
            sumWeights(t),
          cut = cuts.length
        cuts.push((t.horizontal ? x : y) + first + gap / 2)
        return {
          horizontal: t.horizontal,
          cut,
          left: convert(
            t.left,
            x,
            y,
            t.horizontal ? first : w,
            t.horizontal ? h : first
          ),
          right: convert(
            t.right,
            t.horizontal ? x + first + gap : x,
            t.horizontal ? y : y + first + gap,
            t.horizontal ? w - first - gap : w,
            t.horizontal ? h : h - first - gap
          ),
        }
      }
      const tree = shape
        ? convert(shape, 0, 0, r.width, r.height)
        : build(order, 0, 0, r.width, r.height)
      const rules = constraints(
        tree,
        r.width,
        r.height,
        gap,
        scale,
        undefined,
        limits
      )
      const projected = project(
        cuts,
        rules,
        targets.length ? (options?.local ? 160 : 2400) : 80
      )
      const boxes = geometry(tree, projected, r.width, r.height, gap)
      if (!boxes.every((b) => validHeatBox(b, scale, limits))) continue
      if (targets.some((i) => area(boxes[i]) < area(r.boxes[i]) - EPS)) continue
      const value = score(boxes)
      if (better(boxes, value, 0.1)) {
        bestScore = value
        best = { ...r, counts, tree, cuts: projected, boxes }
      }
      if (
        options?.local &&
        fulfilled(best.boxes) &&
        safeHeatTransition(r.boxes, best.boxes, gap, scale, limits)
      )
        return best
    }
  if (best.boxes !== r.boxes) {
    const rules = constraints(
      best.tree,
      r.width,
      r.height,
      gap,
      scale,
      best.boxes,
      limits
    )
    for (
      let step = 0;
      step < (targets.length ? (options?.local ? 8 : 30) : 0);
      step++
    ) {
      const gradient = best.cuts.map((_, j) => {
        const probe = [...best.cuts]
        probe[j] += 0.1
        return (
          (score(geometry(best.tree, probe, r.width, r.height, gap)) -
            bestScore) /
          0.1
        )
      })
      const norm = Math.max(1, Math.hypot(...gradient))
      let accepted = false
      for (const rate of [16, 4, 1]) {
        const cuts = project(
          best.cuts.map((v, i) => v - (rate * gradient[i]) / norm),
          rules,
          120
        )
        const boxes = geometry(best.tree, cuts, r.width, r.height, gap)
        const value = score(boxes)
        if (
          value < bestScore - 0.01 &&
          boxes.every((b) => validHeatBox(b, scale, limits)) &&
          targets.every((i) => area(boxes[i]) >= area(best.boxes[i]) - EPS)
        ) {
          bestScore = value
          best = { ...best, cuts, boxes }
          accepted = true
          break
        }
      }
      if (!accepted) break
    }
  }
  return best
}
function adjustCuts(r: Region, counts: number[], gap: number, scale: number) {
  const increased = counts.flatMap((count, i) =>
    count > r.counts[i] ? [i] : []
  )
  if (!increased.length) return { ...r, counts }
  const rules = constraints(r.tree, r.width, r.height, gap, scale, r.boxes)
  const distances = heatNeighbourDistances(r.boxes, increased, gap)
  let cuts = [...r.cuts],
    boxes = r.boxes
  const limit = increased.every((i) => counts[i] - r.counts[i] < 10) ? 10 : 36
  for (const target of increased) {
    const desired = requestedHeatArea(r, counts, target, scale)
    if (desired <= area(boxes[target]) + EPS) continue
    const original = boxes,
      center = {
        x: boxes[target].x + boxes[target].width / 2,
        y: boxes[target].y + boxes[target].height / 2,
      }
    const objective = (bs: Geometry[]) =>
      (Math.sqrt(desired) - Math.sqrt(area(bs[target]))) ** 2 +
      bs.reduce((sum, b, i) => {
        if (i === target) return sum
        const shared = distances[i] === 1
        const distance = Math.hypot(
          original[i].x + original[i].width / 2 - center.x,
          original[i].y + original[i].height / 2 - center.y
        )
        const loss = Math.sqrt(area(b)) - Math.sqrt(area(original[i]))
        return (
          sum +
          loss *
            loss *
            (shared ? 0.012 : 0.08 + distance / 10000) *
            (1 + heatWeight(counts[i]) / 20)
        )
      }, 0)
    for (let step = 0; step < limit; step++) {
      const base = objective(boxes),
        gradient = cuts.map((_, j) => {
          const probe = [...cuts]
          probe[j] += 0.05
          return (
            (objective(geometry(r.tree, probe, r.width, r.height, gap)) -
              base) /
            0.05
          )
        })
      const norm = Math.max(1, Math.hypot(...gradient))
      let accepted = false
      for (const rate of [24, 8, 2, 0.5]) {
        const candidate = project(
          cuts.map((value, i) => value - (gradient[i] / norm) * rate),
          rules,
          120
        )
        const next = geometry(r.tree, candidate, r.width, r.height, gap)
        if (
          next.every((b) =>
            validHeatBox(b, scale, heatLimits(r.width, r.height, scale))
          ) &&
          safeHeatTransition(
            r.boxes,
            next,
            gap,
            scale,
            heatLimits(r.width, r.height, scale)
          ) &&
          objective(next) < base - 1e-6 &&
          increased.every((i) => area(next[i]) >= area(r.boxes[i]) - EPS) &&
          area(next[target]) >= area(boxes[target]) - EPS
        ) {
          cuts = candidate
          boxes = next
          accepted = true
          break
        }
      }
      if (!accepted) {
        let best = base,
          chosen: number[] | undefined
        for (let j = 0; j < cuts.length; j++)
          for (const rate of [-16, 16, -4, 4, -1, 1]) {
            const probe = [...cuts]
            probe[j] += rate
            const candidate = project(probe, rules, 120)
            const next = geometry(r.tree, candidate, r.width, r.height, gap)
            if (
              next.every((b) =>
                validHeatBox(b, scale, heatLimits(r.width, r.height, scale))
              ) &&
              safeHeatTransition(
                r.boxes,
                next,
                gap,
                scale,
                heatLimits(r.width, r.height, scale)
              ) &&
              increased.every((i) => area(next[i]) >= area(r.boxes[i]) - EPS) &&
              area(next[target]) > area(boxes[target]) + EPS &&
              objective(next) < best - 1e-6
            ) {
              best = objective(next)
              chosen = candidate
            }
          }
        if (chosen) {
          cuts = chosen
          boxes = geometry(r.tree, cuts, r.width, r.height, gap)
          accepted = true
        }
      }
      if (!accepted || area(boxes[target]) >= desired - 0.1) break
    }
  }
  if (
    !safeHeatTransition(
      r.boxes,
      boxes,
      gap,
      scale,
      heatLimits(r.width, r.height, scale)
    )
  )
    return { ...r, counts }
  return { ...r, counts, cuts, boxes }
}
export function heatCanvas(
  items: BookmarkItem[],
  clicks: Record<string, number>,
  width: number,
  available: number,
  gap = 8,
  scale = 1,
  previous?: HeatSnapshot
): HeatLayout {
  const snapshot = planHeatRegions({
    items,
    clicks,
    width,
    available,
    gap,
    scale,
    previous,
  })
  if (!snapshot)
    return { boxes: [], height: Math.max(0, available), affectedIds: [] }
  const affectedIds: string[] = []
  const regions = snapshot.regions.map((r) => {
    const counts = r.urls.map((url, i) =>
      Math.max(clicks[url] || 0, r.counts[i])
    )
    const next = solveHeatRegion(
      r,
      counts,
      snapshot.gap,
      snapshot.scale,
      snapshot.allocationVersion !== 1
    )
    next.boxes.forEach((b, i) => {
      if (
        (Object.keys(b) as (keyof Geometry)[]).some(
          (k) => b[k] !== r.boxes[i][k]
        )
      )
        affectedIds.push(r.ids[i])
    })
    return next
  })
  const result = { ...snapshot, allocationVersion: 1 as const, regions }
  remember(result)
  const byId = new Map(items.map((i) => [i.id, i]))
  return {
    height: result.height,
    snapshot: result,
    affectedIds,
    boxes: heatRegionBoxes(result.regions, byId),
  }
}

export function heatRegionBoxes(
  regions: HeatRegion[],
  byId: Map<string, BookmarkItem>
): HeatBox[] {
  return regions.flatMap((r) =>
    r.boxes.map((b, i) => ({
      ...b,
      x: b.x + r.x,
      y: b.y + r.y,
      item: byId.get(r.ids[i])!,
    }))
  )
}

export function solveHeatRegion(
  r: HeatRegion,
  counts: number[],
  gap: number,
  scale: number,
  initial = false
): HeatRegion {
  if (!initial && counts.every((count, i) => count === r.counts[i])) return r
  if (!counts.some((count) => count > 0)) return { ...r, counts }
  if (!initial) return redistribute(r, counts, gap, scale)
  const seedKey = JSON.stringify([
    r.ids.length,
    r.width,
    r.height,
    gap,
    scale,
    counts,
  ])
  let seed = heatSeeds.get(seedKey)
  if (!seed) {
    const fitted = fitHeatAreas(
      r,
      counts,
      allocateHeatAreas(
        counts,
        r.boxes.reduce((sum, box) => sum + area(box), 0),
        heatLimits(r.width, r.height, scale).area
      ),
      [],
      gap,
      scale
    )
    seed = { tree: fitted.tree, cuts: fitted.cuts, boxes: fitted.boxes }
    heatSeeds.set(seedKey, seed)
    if (heatSeeds.size > 32) heatSeeds.delete(heatSeeds.keys().next().value!)
  }
  return { ...r, ...seed, counts }
}

export function planHeatRegions(input: HeatInput): HeatSnapshot | undefined {
  const { items, previous } = input
  let { width, scale } = input
  const { available, gap } = input
  if (!items.length || !Number.isFinite(width) || width < 56) return undefined
  width = Math.round(width)
  scale = Math.max(0.75, Math.min(1.5, scale))
  const key = snapshotKey(
    width,
    gap,
    scale,
    items.map((i) => i.id),
    items.map((i) => i.url),
    available
  )
  if (previous?.key === key && cache.get(key) !== previous)
    hydrateHeatTopologies([[key, previous]])
  let snapshot = cache.get(key)
  if (!snapshot) {
    const regions: Region[] = []
    const columns = Math.min(
      Math.ceil(items.length / 24),
      Math.max(1, Math.floor(width / (600 * scale)))
    )
    const columnWidth = (width - gap * (columns - 1)) / columns
    const regionCount = Math.ceil(items.length / 24)
    const groups = Array.from({ length: regionCount }, (_, i) =>
      items.slice(
        Math.floor((i * items.length) / regionCount),
        Math.floor(((i + 1) * items.length) / regionCount)
      )
    )
    let y = 0
    for (let start = 0; start < regionCount; start += columns) {
      let rowHeight = 0
      for (let col = 0; col < columns; col++) {
        const group = groups[start + col] || []
        if (!group.length) break
        const n = group.length
        let w = columnWidth,
          h: number
        if (n <= 4) {
          w = Math.min(w, (160 * scale + gap) * Math.min(n, 2) - gap)
          h = Math.ceil(n / 2) * (160 * scale + gap) - gap
          if (n === 1) h = w
        } else if (n < 12) {
          w = Math.min(w, Math.sqrt(n * 18000 * scale * scale * 1.6))
          h = Math.max(w / 1.6, (n * 18000 * scale * scale) / w)
        } else
          h = Math.max(
            320 * scale,
            (n * Math.max(9500, 12000 * scale * scale)) / w,
            regionCount <= columns
              ? Math.min(available, (n * (360 * scale) ** 2) / w)
              : 0
          )
        const base = template(n, w, h, gap, scale)
        const r: Region = {
          x: col * (columnWidth + gap),
          y,
          width: w,
          height: h,
          ids: group.map((i) => i.id),
          urls: group.map((i) => i.url),
          counts: group.map(() => 0),
          tree: base.tree,
          cuts: base.cuts,
          boxes: base.boxes,
        }
        regions.push(r)
        rowHeight = Math.max(rowHeight, h)
      }
      y += rowHeight + gap
    }
    snapshot = {
      version: 8,
      key,
      width,
      height: Math.max(0, y - gap),
      gap,
      scale,
      regions,
    }
  }
  return snapshot
}

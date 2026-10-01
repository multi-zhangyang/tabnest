import { test, after } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "vite"
import { assertMotion, assertTiled } from "./heat-assertions.mjs"

const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  logLevel: "error",
})
after(() => server.close())
const heat = await server.ssrLoadModule("/src/lib/heat-layout.ts")
const motion = await server.ssrLoadModule("/src/lib/heat-motion.ts")
const demo = await server.ssrLoadModule("/src/lib/demo.ts")
const itemsFor = (n, tag) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${tag}-${i}`,
    title: `Site ${i}`,
    url: `https://${tag}.test/${i}`,
  }))
const area = (b) => b.width * b.height

test("packed corners grow inside a small neighbourhood instead of repacking their region", async () => {
  const fixtures = JSON.parse(
    await readFile(
      new URL("./fixtures/heat-pressure.json", import.meta.url),
      "utf8"
    )
  )
  for (const name of ["pressure-0-12", "pressure-0-14", "pressure-9-44"]) {
    const { region, counts, scale, gap, target } = fixtures.find(
      (f) => f.name === name
    )
    const next = heat.solveHeatRegion(region, counts, gap, scale)
    assert.ok(area(next.boxes[target]) > area(region.boxes[target]) + 100, name)
    assert.ok(heat.validHeatRegion(next, gap, scale), name)
    const changed = next.boxes.filter((b, i) =>
      Object.keys(b).some((k) => Math.abs(b[k] - region.boxes[i][k]) > 1e-4)
    )
    if (name === "pressure-0-12")
      assert.ok(
        changed.length <= 3,
        "an isolated corner repacked the whole region"
      )
    if (name === "pressure-0-14") {
      assert.ok(
        changed.length <= 2,
        "a shared boundary moved distant bookmarks"
      )
      assert.ok(
        heat.safeHeatTransition(
          region.boxes,
          next.boxes,
          gap,
          scale,
          heat.heatLimits(region.width, region.height, scale)
        )
      )
    }
    if (name === "pressure-9-44")
      assert.ok(
        heat.safeHeatTransition(
          region.boxes,
          next.boxes,
          gap,
          scale,
          heat.heatLimits(region.width, region.height, scale)
        )
      )
    const snapshot = { scale, gap, regions: [region] }
    const layout = (r) => ({
      snapshot: { ...snapshot, regions: [r] },
      boxes: r.boxes.map((b, i) => ({ ...b, item: { id: r.ids[i] } })),
    })
    assertTiled(layout(next))
    assertMotion(heat, motion, layout(region), layout(next))
    assert.strictEqual(heat.solveHeatRegion(next, counts, gap, scale), next)
  }
})

test("a constrained heat target does not prevent another target from growing in the same update", async () => {
  const fixtures = JSON.parse(
    await readFile(
      new URL("./fixtures/heat-pressure.json", import.meta.url),
      "utf8"
    )
  )
  for (const name of ["pressure-7-8", "saturated-copy"]) {
    const { region, counts, scale, gap, target } = fixtures.find(
      (f) => f.name === name
    )
    const next = heat.solveHeatRegion(region, counts, gap, scale)
    assert.ok(area(next.boxes[target]) > area(region.boxes[target]) + 100, name)
    for (const [i, count] of counts.entries())
      if (count > region.counts[i])
        assert.ok(
          area(next.boxes[i]) >= area(region.boxes[i]) - 1e-5,
          `target shrank: ${name}/${i}`
        )
    assert.deepEqual(next.counts, counts)
    assert.ok(heat.validHeatRegion(next, gap, scale))
    const snapshot = { scale, gap, regions: [region] }
    const layout = (r) => ({
      snapshot: { ...snapshot, regions: [r] },
      boxes: r.boxes.map((b, i) => ({ ...b, item: { id: r.ids[i] } })),
    })
    assertTiled(layout(next))
    assertMotion(heat, motion, layout(region), layout(next))
  }
})

test("a 37-card remembered layout grows visibly at the smallest visual scale", async () => {
  const snapshot = JSON.parse(
    await readFile(new URL("./fixtures/heat-37.json", import.meta.url), "utf8")
  )
  let region = snapshot.regions[0]
  const target = 4
  for (let click = 0; click < 5; click++) {
    const counts = [...region.counts]
    counts[target]++
    const next = heat.solveHeatRegion(
      region,
      counts,
      snapshot.gap,
      snapshot.scale
    )
    const before = region.boxes[target],
      after = next.boxes[target]
    assert.ok(
      Math.sqrt(area(after)) - Math.sqrt(area(before)) >= 3,
      "growth remains imperceptible"
    )
    assert.ok(heat.validHeatRegion(next, snapshot.gap, snapshot.scale))
    const start = {
      snapshot: { ...snapshot, regions: [region] },
      boxes: region.boxes.map((b, i) => ({
        ...b,
        item: { id: region.ids[i] },
      })),
    }
    const end = {
      snapshot: { ...snapshot, regions: [next] },
      boxes: next.boxes.map((b, i) => ({ ...b, item: { id: next.ids[i] } })),
    }
    assertTiled(end)
    assertMotion(heat, motion, start, end)
    region = next
  }
})

test("large cards with mixed historical heat keep visibly growing on individual clicks", () => {
  const scenarios = [
    {
      width: 720,
      available: 560,
      target: 0,
      counts: [
        2860, 60, 3, 203, 473, 293, 3424, 361, 841, 1371, 524, 18, 2239, 0,
        2036, 1497, 1598, 328, 1384, 1486, 862, 674, 127, 2514,
      ],
    },
    {
      width: 1356,
      available: 360,
      target: 8,
      counts: [
        3350, 1383, 110, 1950, 0, 455, 1659, 26, 4415, 73, 273, 34, 4246, 1374,
        5, 5, 1469, 1801, 1032, 3, 2704, 7, 4265, 4086,
      ],
    },
    {
      width: 1814,
      available: 560,
      target: 1,
      counts: [
        163, 4554, 2086, 1580, 2497, 3393, 2801, 1146, 286, 297, 4256, 13, 169,
        0, 2725, 749, 1978, 278, 5, 1186, 936, 95, 486, 3060,
      ],
    },
  ]
  for (const [index, scenario] of scenarios.entries()) {
    const items = itemsFor(48, `large-history-${index}`)
    const clicks = Object.fromEntries(
      items.map((item, i) => [item.url, scenario.counts[i % 24]])
    )
    let previous = heat.heatCanvas(
      items,
      clicks,
      scenario.width,
      scenario.available
    )
    const fixed = previous.snapshot.regions.filter(
      (r) => !r.ids.includes(items[scenario.target].id)
    )
    for (let click = 1; click <= 5; click++) {
      clicks[items[scenario.target].url]++
      const next = heat.heatCanvas(
        items,
        clicks,
        scenario.width,
        scenario.available
      )
      const before = previous.boxes[scenario.target],
        after = next.boxes[scenario.target]
      assert.ok(
        area(after) > area(before) + 50,
        `large card stalled at ${index}/${click}`
      )
      assert.ok(
        next.boxes.some(
          (box, i) =>
            i !== scenario.target && area(box) < area(previous.boxes[i]) - 1
        )
      )
      assert.equal(next.height, previous.height)
      assert.deepEqual(
        next.snapshot.regions.filter(
          (r) => !r.ids.includes(items[scenario.target].id)
        ),
        fixed
      )
      assertTiled(next)
      assertMotion(heat, motion, previous, next)
      previous = next
    }
  }
})

test("a bookmark squeezed to its logo reclaims its cumulative heat share on a real increment", () => {
  const items = itemsFor(24, "reclaim-history")
  heat.heatCanvas(items, {}, 1356, 728)
  const squeezed = heat.heatCanvas(items, { [items[0].url]: 10000 }, 1356, 728)
  const target = squeezed.boxes.findIndex(
    (box, i) => i !== 0 && area(box) < 6200
  )
  const snapshot = structuredClone(squeezed.snapshot)
  const clicks = { [items[0].url]: 74, [items[target].url]: 96 }
  snapshot.regions[0].counts = items.map((item) => clicks[item.url] || 0)
  heat.hydrateHeatTopologies([[snapshot.key, snapshot]])
  const previous = heat.heatCanvas(items, clicks, 1356, 728)
  assert.ok(area(previous.boxes[target]) < 6200, "fixture must be logo-only")
  clicks[items[target].url]++
  const next = heat.heatCanvas(items, clicks, 1356, 728)
  assert.ok(
    area(next.boxes[target]) > area(previous.boxes[target]) + 10000,
    "cumulative heat was multiplied against the squeezed area"
  )
  assert.ok(
    next.boxes.some(
      (box, i) => i !== target && area(box) < area(previous.boxes[i]) - 1000
    )
  )
  assert.equal(next.height, previous.height)
  assertTiled(next)
  assertMotion(heat, motion, previous, next)
})

test("bounded heat shares conserve area and release saturated excess to other bookmarks", () => {
  const counts = [Number.MAX_SAFE_INTEGER, 400, 0, 0, 0, 0]
  const capacity = 300000,
    maximum = 129600
  const shares = heat.allocateHeatAreas(counts, capacity, maximum)
  assert.ok(Math.abs(shares.reduce((sum, a) => sum + a, 0) - capacity) < 1e-5)
  assert.equal(shares[0], maximum)
  assert.ok(shares.every((a) => a >= 56 ** 2 && a <= maximum))
  assert.ok(shares[1] > shares[2])
  for (const index of [1, 2]) {
    const next = [...counts]
    next[index]++
    assert.ok(
      heat.allocateHeatAreas(next, capacity, maximum)[index] > shares[index]
    )
  }
})

test("old cached heat allocation updates on reload without clearing clicks or region memory", () => {
  const items = itemsFor(48, "old-allocation")
  heat.heatCanvas(items, {}, 1356, 728)
  const old = heat.heatCanvas(items, { [items[0].url]: 10000 }, 1356, 728)
  const region = old.snapshot.regions[0]
  const target = region.boxes.findIndex((box, i) => i !== 0 && area(box) < 6200)
  assert.ok(target >= 0)
  const clicks = { [items[0].url]: 74, [items[target].url]: 96 }
  const snapshot = structuredClone(old.snapshot)
  snapshot.regions[0].counts = snapshot.regions[0].urls.map(
    (url) => clicks[url] || 0
  )
  delete snapshot.allocationVersion
  heat.hydrateHeatTopologies([[snapshot.key, snapshot]])
  const next = heat.heatCanvas(items, clicks, 1356, 728)
  assert.ok(area(next.boxes[target]) > area(old.boxes[target]) + 10000)
  assert.equal(next.snapshot.allocationVersion, 1)
  assert.deepEqual(next.snapshot.regions[0].counts, snapshot.regions[0].counts)
  for (const key of ["x", "y", "width", "height"])
    assert.equal(next.snapshot.regions[0][key], snapshot.regions[0][key])
  assert.equal(next.height, old.height)
  assert.deepEqual(next.boxes.slice(24), old.boxes.slice(24))
  assertTiled(next)
  assert.deepEqual(heat.heatCanvas(items, clicks, 1356, 728).boxes, next.boxes)
})

test("historical heat is allocated together instead of squeezing early bookmarks during replay", () => {
  const items = demo
    .demoGroups()
    .flatMap((group) => group.items)
    .map((item) => ({
      ...item,
      id: `fair-seed-${item.id}`,
    }))
  const layout = heat.heatCanvas(items, demo.DEMO_CLICKS, 1356, 728)
  const youtube = layout.boxes.find((box) => box.item.title === "YouTube")
  assert.ok(
    area(youtube) > 60000,
    "highest historical heat was squeezed to a tiny tile"
  )
  assertTiled(layout)
})

test("a cold tile grows on its first click even when historical heat clamps both shares to minimum", () => {
  const items = itemsFor(24, "cold-floor")
  const clicks = Object.fromEntries(
    items.map((item, i) => [
      item.url,
      i % 5 === 0 ? 0 : ((i * 2654435761) >>> 0) % 4096,
    ])
  )
  const before = heat.heatCanvas(items, clicks, 1356, 728)
  const after = heat.heatCanvas(
    items,
    { ...clicks, [items[0].url]: 1 },
    1356,
    728
  )
  assert.ok(
    area(after.boxes[0]) > area(before.boxes[0]) + 1,
    "cold tile did not grow"
  )
  assertTiled(after)
  assertMotion(heat, motion, before, after)
})

test("mixed hot bookmarks grow on their own turns without changing remote regions", () => {
  const items = itemsFor(72, "mixed-turns")
  let previous = heat.heatCanvas(items, {}, 1356, 728)
  const remote = previous.boxes.filter(
    (box) => !previous.snapshot.regions[0].ids.includes(box.item.id)
  )
  const clicks = {}
  for (let turn = 0; turn < 60; turn++) {
    const target = [0, 4, 13][Math.floor(turn / 20)]
    clicks[items[target].url] = (clicks[items[target].url] || 0) + 1
    const next = heat.heatCanvas(items, clicks, 1356, 728)
    assert.ok(
      area(next.boxes[target]) > area(previous.boxes[target]) + 0.1,
      `mixed hotspot stalled ${turn}`
    )
    assert.deepEqual(
      next.boxes.filter((box) =>
        remote.some((old) => old.item.id === box.item.id)
      ),
      remote
    )
    assertTiled(next)
    previous = next
  }
})

test("near maximum cards stop moving while their persisted counters keep increasing", () => {
  const items = itemsFor(24, "stable-cap")
  heat.heatCanvas(items, {}, 1356, 728)
  let snapshot
  for (let count = 1; count <= 400; count++)
    snapshot = heat.heatCanvas(
      items,
      { [items[4].url]: count },
      1356,
      728
    ).snapshot
  const region = snapshot.regions[0]
  const target = region.boxes.findIndex(
    (box) =>
      area(box) >= heat.heatLimits(region.width, region.height).area - 260
  )
  assert.ok(target >= 0, "fixture needs saturated geometry")
  const clicks = Object.fromEntries(
    region.urls.map((url, i) => [url, region.counts[i]])
  )
  let previous = heat.heatCanvas(items, clicks, 1356, 728)
  for (let turn = 0; turn < 8; turn++) {
    clicks[items[target].url]++
    const next = heat.heatCanvas(items, clicks, 1356, 728)
    assert.deepEqual(next.boxes, previous.boxes)
    assert.equal(
      next.snapshot.regions[0].counts[target],
      clicks[items[target].url]
    )
    previous = next
  }
})

test("37-bookmark wide canvas remains filled through mixed heat and cache reload", () => {
  const items = itemsFor(37, "wide-regression")
  let previous = heat.heatCanvas(items, {}, 1814, 728)
  assert.equal(previous.height, 728)
  const clicks = {}
  for (const [index, count] of [
    [2, 12],
    [4, 100],
    [0, 10000],
    [19, 10000],
    [31, 500],
    [4, 1000000],
  ]) {
    clicks[items[index].url] = count
    const next = heat.heatCanvas(items, clicks, 1814, 728)
    assert.equal(next.height, 728)
    bounds(next, 1814)
    assertTiled(next)
    assertMotion(heat, motion, previous, next)
    assert.ok(area(next.boxes[index]) >= area(previous.boxes[index]) - 1e-4)
    const untouched = previous.snapshot.regions.find(
      (r) => !r.ids.includes(items[index].id)
    ).ids
    assert.deepEqual(
      next.boxes.filter((b) => untouched.includes(b.item.id)),
      previous.boxes.filter((b) => untouched.includes(b.item.id))
    )
    previous = next
  }
  const regions = previous.snapshot.regions
  assert.equal(regions[0].x, 0)
  assert.equal(regions[1].x, regions[0].width + 8)
  assert.equal(regions[1].x + regions[1].width, 1814)
  heat.hydrateHeatTopologies([
    [previous.snapshot.key, structuredClone(previous.snapshot)],
  ])
  assert.deepEqual(
    heat.heatCanvas(items, clicks, 1814, 728).boxes,
    previous.boxes
  )
})

test("each sequential click grows interior cards until a geometric boundary and icon squares are reachable", () => {
  const items = itemsFor(24, "single-step")
  let previous = heat.heatCanvas(items, {}, 1356, 728)
  for (let count = 1; count <= 40; count++) {
    const next = heat.heatCanvas(items, { [items[4].url]: count }, 1356, 728)
    assert.ok(
      area(next.boxes[4]) > area(previous.boxes[4]) + 0.01,
      `stalled click ${count}`
    )
    assertTiled(next)
    previous = next
  }
  const exactItems = itemsFor(24, "minimum-square")
  heat.heatCanvas(exactItems, {}, 1356, 728)
  const last = heat.heatCanvas(
    exactItems,
    { [exactItems[0].url]: 10000 },
    1356,
    728
  )
  assert.ok(
    last.boxes.some((b) => Math.max(b.width, b.height) < 58),
    "56px logo square unavailable"
  )
  bounds(last, 1356)
  assertTiled(last)
})
test("interior hot cards keep taking available space instead of stalling above minimum donors", () => {
  const items = itemsFor(24, "pressure-regression")
  let previous = heat.heatCanvas(items, {}, 1356, 728)
  for (const count of [1, 2, 5, 10, 20, 100, 1000, 10000]) {
    const next = heat.heatCanvas(items, { [items[4].url]: count }, 1356, 728)
    assert.ok(area(next.boxes[4]) >= area(previous.boxes[4]) - 1e-4)
    assertTiled(next)
    previous = next
  }
  assert.ok(
    area(previous.boxes[4]) > 180000,
    "interior card stalled with unused space"
  )
  assert.ok(
    previous.boxes.some((b) => Math.max(b.width, b.height) < 90),
    "nearby cards never become icon squares"
  )
})
function bounds(layout, width, scale = 1) {
  for (const b of layout.boxes) {
    assert.ok(
      b.width >= 56 - 1e-5 && b.height >= 56 - 1e-5,
      `minimum ${b.width}×${b.height}`
    )
    assert.ok(
      area(b) <= heat.heatLimits(width, layout.height, scale).area + 1e-3,
      "maximum area"
    )
    assert.ok(
      Math.max(b.width, b.height) <=
        heat.heatLimits(width, layout.height, scale).edge + 1e-5,
      "maximum edge"
    )
    assert.ok(
      Math.max(b.width / b.height, b.height / b.width) <= 2 + 1e-5,
      "aspect"
    )
    assert.ok(
      b.width <= 3 * b.height - 112 + 1e-5 &&
        b.height <= 3 * b.width - 112 + 1e-5,
      "small square"
    )
    assert.ok(
      b.x >= -1e-5 &&
        b.y >= -1e-5 &&
        b.x + b.width <= width + 1e-5 &&
        b.y + b.height <= layout.height + 1e-5,
      "canvas bounds"
    )
  }
}
test("production mosaic never reverses growth or escapes size limits at extreme heat", () => {
  for (const n of [1, 2, 8, 24, 120]) {
    const items = itemsFor(n, `extreme-${n}`)
    let previous = heat.heatCanvas(items, {}, 1348, 684)
    for (const count of [1, 4, 20, 1000, 1000000, Number.MAX_SAFE_INTEGER]) {
      const next = heat.heatCanvas(items, { [items[0].url]: count }, 1348, 684)
      bounds(next, 1348)
      assert.equal(next.height, previous.height)
      assert.ok(
        area(next.boxes[0]) >= area(previous.boxes[0]) - 1e-4,
        `reversed at ${n}/${count}`
      )
      previous = next
    }
  }
})
test("a local heat change grows its target, shrinks neighbours and leaves other regions still", () => {
  const items = itemsFor(72, "local")
  const before = heat.heatCanvas(items, {}, 1348, 684)
  const after = heat.heatCanvas(items, { [items[0].url]: 20 }, 1348, 684)
  assert.ok(area(after.boxes[0]) > area(before.boxes[0]) + 1)
  assert.ok(
    after.boxes
      .slice(1, 24)
      .some((b, i) => area(b) < area(before.boxes[i + 1]) - 1)
  )
  assert.deepEqual(after.boxes.slice(24), before.boxes.slice(24))
  assertTiled(after)
  assertMotion(heat, motion, before, after)
})
test("narrow and scaled mosaics keep all bookmarks reachable and small collections compact", () => {
  for (const width of [296, 720, 1348])
    for (const scale of [0.75, 1, 1.5]) {
      const layout = heat.heatCanvas(
        itemsFor(180, `scale-${width}-${scale}`),
        {},
        width,
        360,
        12,
        scale
      )
      assert.equal(layout.boxes.length, 180)
      bounds(layout, width, scale)
    }
  const layout = heat.heatCanvas(itemsFor(1, "single"), {}, 1348, 684)
  assert.ok(area(layout.boxes[0]) < 30000, "single card filled screen")
})

test("local repartition keeps complete coverage and uses safe geometry or staged motion", () => {
  const items = itemsFor(24, "rotate-check")
  let prior = heat.heatCanvas(items, {}, 720, 650),
    changed = 0
  for (let i = 0; i < 24; i++) {
    const next = heat.heatCanvas(items, { [items[i].url]: 1000000 }, 720, 650)
    bounds(next, 720)
    assert.ok(area(next.boxes[i]) >= area(prior.boxes[i]) - 1e-4)
    assertTiled(next)
    assertMotion(heat, motion, prior, next)
    if (
      JSON.stringify(next.snapshot.regions[0].tree) !==
      JSON.stringify(prior.snapshot.regions[0].tree)
    )
      changed++
    prior = next
  }
  assert.ok(changed > 0, "no local adjustment used")
})

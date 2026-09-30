import { test, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "vite"
import { assertMotion, assertTiled } from "./heat-assertions.mjs"
const values = new Map()
globalThis.localStorage = {
  getItem: (k) => values.get(k) ?? null,
  setItem: (k, v) => values.set(k, String(v)),
  removeItem: (k) => values.delete(k),
}
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  logLevel: "error",
})
after(() => server.close())
const recent = await server.ssrLoadModule("/src/lib/recent.ts")
const prefs = await server.ssrLoadModule("/src/lib/preferences.ts")
const search = await server.ssrLoadModule("/src/lib/search.ts")
const backup = await server.ssrLoadModule("/src/lib/backup.ts")
const heat = await server.ssrLoadModule("/src/lib/heat-layout.ts")
const motion = await server.ssrLoadModule("/src/lib/heat-motion.ts")
const book = (id, url = "https://" + id + ".test/") => ({
  id,
  title: "站点",
  url,
})
test("fresh defaults open foreground tabs and legacy missing preferences retain current tabs", async () => {
  values.clear()
  assert.equal((await prefs.loadSettings()).newTab, true)
  assert.equal(prefs.clampSettings({ layout: "heat" }).newTab, false)
  for (const newTab of [true, false])
    assert.equal(prefs.clampSettings({ newTab }).newTab, newTab)
})
test("recent opens canonicalize, deduplicate, exclude invalid and cap at fifty", async () => {
  values.clear()
  const rows = Array.from({ length: 70 }, (_, i) => ({
    url: "https://site" + i + ".test",
    openedAt: i,
  }))
  rows.push(
    { url: "javascript:alert(1)", openedAt: 100 },
    { url: "https://site69.test/", openedAt: 99 }
  )
  const valid = recent.validateRecent(rows)
  assert.equal(valid.length, 50)
  assert.equal(valid[0].openedAt, 99)
  assert.equal(valid.filter((x) => x.url === "https://site69.test/").length, 1)
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      recent.recordRecent("https://same.test", i)
    )
  )
  assert.deepEqual(await recent.loadRecent(), [
    { url: "https://same.test/", openedAt: 9 },
  ])
})
test("recent results resolve surviving bookmarks, skip removed URLs and show at most eight", () => {
  const items = Array.from({ length: 12 }, (_, i) => book(String(i)))
  items.unshift(book("copy", items[0].url))
  const rows = recent.validateRecent(
    items
      .map((item, i) => ({ url: item.url, openedAt: 100 - i }))
      .concat({ url: "https://removed.test/", openedAt: 200 })
  )
  const result = recent.recentBookmarks(items, rows)
  assert.equal(result.length, 8)
  assert.equal(result[0].id, "copy")
  assert.equal(new Set(result.map((x) => x.url)).size, 8)
})
test("search uses relevance then heat, recent and stable order with exact titles first", () => {
  const items = [
    book("a"),
    book("b"),
    book("c"),
    book("d"),
    { ...book("e"), title: "站点 扩展" },
  ]
  const index = search.createSearchIndex(items, [])
  const hits = search.searchBookmarks(
    index,
    "站点",
    { [items[4].url]: 999, [items[1].url]: 5 },
    [{ url: items[2].url, openedAt: 100 }]
  )
  assert.deepEqual(
    hits.map((x) => x.id),
    ["b", "c", "a", "d", "e"]
  )
})
test("full JSON includes optional recents while old backups and plain exports remain compatible", async () => {
  values.clear()
  await recent.recordRecent("https://a.test", 123)
  const data = {
    folders: [{ id: "g", title: "目录", path: "目录" }],
    groups: [
      { id: "g", name: "目录", items: [{ ...book("a"), parentId: "g" }] },
    ],
  }
  const full = await backup.createFullBackup(data)
  assert.equal(full.version, 5)
  assert.equal(full.preferences.recent[0].openedAt, 123)
  assert.equal(
    backup.parseBackup(JSON.stringify(full)).preferences.recent.length,
    1
  )
  delete full.preferences.recent
  assert.ok(backup.parseBackup(JSON.stringify(full)).preferences)
  assert.equal(backup.createBackup(data).preferences, undefined)
})
test("recent storage failure cannot change the independently persisted click count", async () => {
  values.clear()
  const setter = globalThis.localStorage.setItem
  globalThis.localStorage.setItem = (key, value) => {
    if (key === "tabnest:recent:v1") throw Error("quota")
    setter(key, value)
  }
  try {
    await assert.rejects(recent.recordRecent("https://a.test"))
    await prefs.bumpClick("https://a.test")
    assert.equal((await prefs.loadClicks())["https://a.test"], 1)
  } finally {
    globalThis.localStorage.setItem = setter
  }
})
test("edited URLs invalidate heat snapshots without touching click data", () => {
  const items = Array.from({ length: 24 }, (_, i) => book("url-edit" + i))
  const first = heat.heatCanvas(items, {}, 1348, 684)
  const changed = items.map((b, i) =>
    i === 0 ? { ...b, url: "https://changed.test/" } : b
  )
  const next = heat.heatCanvas(
    changed,
    { "https://changed.test/": 10 },
    1348,
    684,
    8,
    1,
    first.snapshot
  )
  assert.notEqual(next.snapshot.key, first.snapshot.key)
  assert.equal(next.snapshot.regions[0].urls[0], changed[0].url)
})
test("cache corruption and unsupported old cache leave valid production layouts usable", async () => {
  values.clear()
  const items = Array.from({ length: 24 }, (_, i) => book("cache" + i))
  const first = heat.heatCanvas(items, {}, 1348, 684)
  const invalid = structuredClone(first.snapshot)
  invalid.scale = NaN
  heat.hydrateHeatTopologies([[invalid.key, invalid]])
  assert.equal(heat.heatCanvas(items, {}, 1348, 684).snapshot.scale, 1)
  values.set(heat.HEAT_CACHE_KEY, "{broken")
  heat.hydrateHeatTopologies()
  await heat.persistHeatTopologies()
  assert.ok(JSON.parse(values.get(heat.HEAT_CACHE_KEY)).length <= 4)
})

test("persisting unchanged heat preserves the accepted snapshot for incremental clicks", async () => {
  values.clear()
  const items = Array.from({ length: 48 }, (_, i) =>
    book("persist-identity" + i)
  )
  const first = heat.heatCanvas(items, {}, 1348, 684)
  await heat.persistHeatTopologies()
  const next = heat.heatCanvas(items, { [items[0].url]: 1 }, 1348, 684)
  await heat.persistHeatTopologies()
  assert.equal(
    heat.savedHeatSnapshot({
      items,
      clicks: {},
      width: 1348,
      available: 684,
      gap: 8,
      scale: 1,
    }),
    next.snapshot
  )
  assert.ok(
    next.boxes[0].width * next.boxes[0].height >=
      first.boxes[0].width * first.boxes[0].height
  )
})
test("duplicate bookmarks change heat together and keep a safe retarget path", () => {
  const items = Array.from({ length: 24 }, (_, i) => book("duplicate" + i))
  items[1].url = items[0].url
  let last = heat.heatCanvas(items, {}, 1348, 684)
  for (const count of [1, 2, 5, 100, 1000000]) {
    const next = heat.heatCanvas(items, { [items[0].url]: count }, 1348, 684)
    for (const i of [0, 1])
      assert.ok(
        next.boxes[i].width * next.boxes[i].height >=
          last.boxes[i].width * last.boxes[i].height - 1e-4
      )
    assertTiled(next)
    assertMotion(heat, motion, last, next)
    last = next
  }
})

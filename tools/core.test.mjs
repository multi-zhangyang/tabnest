import { test, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "vite"

const values = new Map()
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
}
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  logLevel: "error",
})
after(() => server.close())
const repository = await server.ssrLoadModule("/src/lib/bookmarks.ts")
const { heatLayout } = await server.ssrLoadModule("/src/lib/heat-layout.ts")
const { demoGroups, DEMO_CLICKS } =
  await server.ssrLoadModule("/src/lib/demo.ts")

const folderRepository = await server.ssrLoadModule("/src/lib/folders.ts")
const backupRepository = await server.ssrLoadModule("/src/lib/backup.ts")
const storage = await server.ssrLoadModule("/src/lib/storage.ts")
const { indexBookmarkUrls } = await server.ssrLoadModule(
  "/src/lib/bookmark-index.ts"
)

const recovery = await server.ssrLoadModule("/src/lib/recovery.ts")
const batch = await server.ssrLoadModule("/src/lib/batch-bookmarks.ts")
const search = await server.ssrLoadModule("/src/lib/search.ts")
const navigation = await server.ssrLoadModule("/src/lib/navigation.ts")

test("duplicate review recognizes equivalent URLs without merging different pages or fragments", () => {
  const urls = [
    "https://EXAMPLE.com:443",
    "https://example.com/",
    "http://example.com/",
    "https://example.com/#one",
    "https://example.com/#two",
    "https://example.com/?q=one",
    "https://example.com/?q=two",
  ]
  const items = urls.map((url, index) => ({
    id: String(index),
    title: "Same title",
    url,
    parentId: String(index % 2),
  }))
  const index = indexBookmarkUrls(items)
  assert.equal(index.size, 6)
  assert.deepEqual(
    index.get("https://example.com/").map((item) => item.id),
    ["0", "1"]
  )
  assert.equal(index.get("https://example.com/#two").length, 1)
})

test("all bookmark roots and nested folders retain their own IDs and empty targets", () => {
  const data = repository.parseBookmarkTree([
    {
      id: "0",
      title: "",
      children: [
        {
          id: "1",
          title: "书签栏",
          children: [
            {
              id: "10",
              title: "开发",
              children: [
                {
                  id: "11",
                  title: "相同名称",
                  children: [
                    {
                      id: "b1",
                      title: "A",
                      url: "https://a.test",
                      parentId: "11",
                      index: 0,
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: "2",
          title: "其他书签",
          children: [{ id: "20", title: "相同名称", children: [] }],
        },
        {
          id: "3",
          title: "移动设备",
          children: [{ id: "b2", title: "B", url: "https://b.test", index: 0 }],
        },
      ],
    },
  ])
  assert.deepEqual(
    data.groups.flatMap((g) => g.items).map((i) => i.id),
    ["b1", "b2"]
  )
  assert.equal(data.groups.find((g) => g.id === "11").items[0].parentId, "11")
  assert.ok(data.folders.some((f) => f.id === "1"))
  assert.ok(data.folders.some((f) => f.id === "20"))
  assert.equal(
    data.folders.find((f) => f.id === "11").path,
    "书签栏 / 开发 / 相同名称"
  )
})

test("preview create, edit, move, delete and empty-folder writes persist across reads", async () => {
  values.clear()
  const folderId = await repository.createFolder("新文件夹")
  await repository.saveBookmark({
    title: "New",
    url: "example.com",
    parentId: folderId,
  })
  let data = await repository.fetchBookmarkData()
  const item = data.groups.find((g) => g.id === folderId).items[0]
  assert.equal(item.url, "https://example.com/")
  const targetId = data.groups[0].id
  await repository.saveBookmark({
    id: item.id,
    title: "Updated",
    url: "example.org",
    parentId: targetId,
  })
  data = await repository.fetchBookmarkData()
  assert.equal(data.groups.find((g) => g.id === folderId).items.length, 0)
  assert.ok(
    data.groups
      .find((g) => g.id === targetId)
      .items.some((i) => i.title === "Updated")
  )
  await repository.removeBookmark(item.id)
  assert.ok(
    !(await repository.fetchBookmarkData()).groups
      .flatMap((g) => g.items)
      .some((i) => i.id === item.id)
  )
})

test("unsafe URLs and corrupt preferences cannot become executable bookmarks", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///C:/test",
    "",
    "https://hello world",
  ])
    assert.throws(() => repository.normalizeUrl(value))
  assert.equal(repository.normalizeUrl("example.com"), "https://example.com/")
  assert.equal(
    repository.normalizeUrl("http://localhost:3000"),
    "http://localhost:3000/"
  )
  const settings = repository.clampSettings({
    layout: "invalid",
    cardScale: Infinity,
    collapsed: ["id", 3],
    tilt: true,
  })
  assert.equal(settings.layout, "heat")
  assert.equal(settings.cardScale, 1)
  assert.equal("collapsed" in settings, false)
  assert.equal("tilt" in settings, false)
})

test("rapid heat updates do not lose clicks", async () => {
  values.clear()
  await Promise.all(
    Array.from({ length: 25 }, () =>
      repository.bumpClick("https://counter.test")
    )
  )
  assert.equal((await repository.loadClicks())["https://counter.test"], 25)
})

test("responsive heat layouts are deterministic, in bounds and non-overlapping", () => {
  const all = demoGroups().flatMap((g) => g.items)
  for (const [width, height, count] of [
    [340, 580, 6],
    [720, 550, 18],
    [1100, 520, 20],
    [1348, 684, 24],
    [1580, 620, 24],
    [1000, 400, 1],
  ]) {
    for (const gap of [5, 8, 12]) {
      const items = all.slice(0, count)
      const boxes = heatLayout(items, DEMO_CLICKS, width, height, gap)
      assert.equal(boxes.length, items.length)
      assert.deepEqual(
        boxes,
        heatLayout(items, DEMO_CLICKS, width, height, gap)
      )
      for (const box of boxes) {
        assert.ok(
          box.width > 55 && box.height > 45,
          `unusable tile ${box.width} × ${box.height}`
        )
        assert.ok(
          box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= width + 1 &&
            box.y + box.height <= height + 1
        )
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i],
            b = boxes[j]
          const x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
          const y =
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
          assert.ok(
            x <= 0 || y <= 0,
            `${a.item.title} overlaps ${b.item.title}`
          )
        }
    }
  }
  assert.deepEqual(
    heatLayout(all, DEMO_CLICKS, 1300, 600, 12),
    heatLayout(all, DEMO_CLICKS, 1300, 600, 12)
  )
})

test("increased heat allocates more area to the selected bookmark", () => {
  const items = demoGroups().flatMap((g) => g.items)
  const target = items.find((i) => i.title === "Figma")
  const before = heatLayout(items, DEMO_CLICKS, 1348, 684).find(
    (b) => b.item.id === target.id
  )
  const after = heatLayout(
    items,
    { ...DEMO_CLICKS, [target.url]: 80 },
    1348,
    684
  ).find((b) => b.item.id === target.id)
  assert.ok(after.width * after.height > before.width * before.height * 1.5)
})

test("legacy preferences migrate with the original retained and atomic patch merges", async () => {
  values.clear()
  const raw = JSON.stringify({
    layout: "zones",
    newTab: true,
    folderLayout: "heat",
    sort: "recent",
    activeFolderId: "nested",
    collapsed: ["root"],
  })
  values.set(storage.STORAGE_KEYS.settings, raw)
  const preferences = await repository.loadSettings()
  assert.equal(preferences.layout, "zones")
  assert.equal(preferences.folderLayout, "grid")
  assert.equal(preferences.sort, "default")
  assert.equal(preferences.activeFolderId, "nested")
  assert.deepEqual(preferences.collapsedSections, [])
  assert.equal("collapsed" in preferences, false)
  const migrated = JSON.parse(values.get(storage.STORAGE_KEYS.settings))
  assert.equal(migrated.schemaVersion, 1)
  assert.equal(
    JSON.parse(
      values.get(`tabnest:recovery:${storage.STORAGE_KEYS.settings}`)
    )[0].raw,
    raw
  )
  await Promise.all([
    repository.saveSettings({ showDomain: false }),
    repository.saveSettings({ density: "compact" }),
  ])
  const result = await repository.loadSettings()
  assert.equal(result.showDomain, false)
  assert.equal(result.density, "compact")
  assert.equal(result.newTab, true)
})

test("unknown schema versions and corrupt bookmark documents cannot be overwritten", async () => {
  values.clear()
  const future = JSON.stringify({
    schemaVersion: 99,
    revision: 1,
    data: { newTab: true },
  })
  values.set(storage.STORAGE_KEYS.settings, future)
  await assert.rejects(
    repository.saveSettings({ newTab: false }),
    /数据版本不兼容/
  )
  assert.equal(values.get(storage.STORAGE_KEYS.settings), future)
  values.set(storage.STORAGE_KEYS.demo, "{broken")
  await assert.rejects(repository.fetchBookmarkData(), /原始内容已保留/)
  await assert.rejects(repository.createFolder("should fail"), /原始内容已保留/)
  assert.equal(values.get(storage.STORAGE_KEYS.demo), "{broken")
})

test("corrupt auxiliary data recovers only after preserving the original", async () => {
  values.clear()
  values.set(storage.STORAGE_KEYS.clicks, "bad json")
  await repository.loadClicks()
  assert.equal(
    JSON.parse(values.get(`tabnest:recovery:${storage.STORAGE_KEYS.clicks}`))[0]
      .raw,
    "bad json"
  )
  values.clear()
  values.set(storage.STORAGE_KEYS.clicks, "bad json")
  const original = localStorage.setItem
  localStorage.setItem = () => {
    throw new Error("Quota exceeded")
  }
  try {
    await assert.rejects(repository.loadClicks(), /存储写入失败/)
  } finally {
    localStorage.setItem = original
  }
  assert.equal(values.get(storage.STORAGE_KEYS.clicks), "bad json")
})

test("failed storage writes cannot mutate confirmed preferences or bookmark data", async () => {
  values.clear()
  await repository.saveSettings({ newTab: true })
  const saved = values.get(storage.STORAGE_KEYS.settings)
  const original = localStorage.setItem
  localStorage.setItem = () => {
    throw new Error("Quota exceeded")
  }
  try {
    await assert.rejects(repository.saveSettings({ newTab: false }), /写入失败/)
  } finally {
    localStorage.setItem = original
  }
  assert.equal(values.get(storage.STORAGE_KEYS.settings), saved)
  assert.equal((await repository.loadSettings()).newTab, true)
})

test("folder CRUD preserves descendants and rejects cyclic or stale moves and deletions", async () => {
  values.clear()
  const root = await repository.createFolder("Parent")
  const child = await repository.createFolder("Child", root)
  const grandchild = await repository.createFolder("Grandchild", child)
  await repository.saveBookmark({
    parentId: grandchild,
    title: "kept",
    url: "https://example.com",
  })
  let data = await repository.fetchBookmarkData()
  const parent = data.folders.find((folder) => folder.id === root)
  await assert.rejects(
    folderRepository.updateFolder({
      id: root,
      title: "Parent",
      parentId: grandchild,
      expected: parent,
    }),
    /不能移动/
  )
  await folderRepository.updateFolder({
    id: root,
    title: "Renamed",
    parentId: parent.parentId,
    expected: parent,
  })
  data = await repository.fetchBookmarkData()
  assert.equal(
    data.folders.find((folder) => folder.id === grandchild).path,
    "书签栏 / Renamed / Child / Grandchild"
  )
  await assert.rejects(
    folderRepository.updateFolder({
      id: root,
      title: "stale",
      expected: parent,
    }),
    /其他页面修改/
  )
  const snapshot = folderRepository.folderSnapshot(data, root)
  await repository.saveBookmark({
    parentId: child,
    title: "added elsewhere",
    url: "https://example.org",
  })
  await assert.rejects(
    folderRepository.removeFolder(root, snapshot),
    /内容已变化/
  )
  data = await repository.fetchBookmarkData()
  await folderRepository.removeFolder(
    root,
    folderRepository.folderSnapshot(data, root)
  )
  data = await repository.fetchBookmarkData()
  assert.ok(
    !data.folders.some((folder) =>
      [root, child, grandchild].includes(folder.id)
    )
  )
  assert.equal(data.groups.flatMap((group) => group.items).length, 24)
})

test("stale bookmark edits cannot overwrite newer content or resurrect deleted bookmarks", async () => {
  values.clear()
  const data = await repository.fetchBookmarkData()
  const item = data.groups.find((group) => group.items.length).items[0]
  await repository.saveBookmark({ ...item, title: "new", expected: item })
  await assert.rejects(
    repository.saveBookmark({ ...item, title: "stale", expected: item }),
    /其他页面修改/
  )
  await repository.removeBookmark(item.id)
  await assert.rejects(
    repository.saveBookmark({ ...item, expected: item }),
    /已被删除/
  )
})

test("backup import is additive, preserves hierarchy and rejects malicious or invalid structures", async () => {
  values.clear()
  const data = {
    folders: [
      { id: "p", title: "Parent", path: "Parent" },
      { id: "c", title: "Child", path: "Parent / Child", parentId: "p" },
    ],
    groups: [
      { id: "p", name: "Parent", items: [] },
      {
        id: "c",
        name: "Parent / Child",
        items: [
          { id: "b", parentId: "c", title: "safe", url: "https://example.com" },
        ],
      },
    ],
  }
  const backup = backupRepository.createBackup(data)
  const parsed = backupRepository.parseBackup(JSON.stringify(backup))
  const root = await backupRepository.importBackup(parsed)
  const after = await repository.fetchBookmarkData()
  assert.equal(after.groups.flatMap((group) => group.items).length, 25)
  assert.equal(folderRepository.descendants(after.folders, root).size, 3)
  const item = after.groups
    .flatMap((group) => group.items)
    .find((item) => item.title === "safe")
  assert.equal(
    after.folders.find((folder) => folder.id === item.parentId).title,
    "Child"
  )
  const unsafe = structuredClone(backup)
  unsafe.groups[1].items[0].url = "javascript:alert(1)"
  const preserved = backupRepository.parseBackup(JSON.stringify(unsafe))
  assert.equal(preserved.groups[1].items[0].url, "javascript:alert(1)")
  assert.equal(repository.safeUrl(preserved.groups[1].items[0].url), undefined)
  const cyclic = structuredClone(backup)
  cyclic.folders[0].parentId = "c"
  assert.throws(
    () => backupRepository.parseBackup(JSON.stringify(cyclic)),
    /层级无效/
  )
  assert.throws(
    () =>
      backupRepository.parseBackup(JSON.stringify({ ...backup, version: 999 })),
    /版本/
  )
})

test("every higher click count receives strictly more area with no high-count cap", () => {
  const items = Array.from({ length: 180 }, (_, index) => ({
    id: String(index),
    title: String(index),
    url: `https://heat.test/${index}`,
  }))
  const clicks = Object.fromEntries(
    items.map((item, index) => [item.url, index * 100])
  )
  for (const [width, height] of [
    [1400, 700],
    [390, 600],
  ]) {
    const boxes = heatLayout(items, clicks, width, height, 12).sort(
      (a, b) => clicks[a.item.url] - clicks[b.item.url]
    )
    assert.equal(boxes.length, 180)
    for (let i = 1; i < boxes.length; i++)
      assert.ok(
        boxes[i].width * boxes[i].height >
          boxes[i - 1].width * boxes[i - 1].height
      )
    assert.ok(boxes.every((box) => box.width > 0 && box.height > 0))
  }
})

test("backup folder titles containing path separators do not invent a parent relationship", () => {
  const data = {
    folders: [
      { id: "a", title: "A", path: "A" },
      { id: "b", title: "A / B", path: "A / B" },
    ],
    groups: [
      { id: "a", name: "A", items: [] },
      { id: "b", name: "A / B", items: [] },
    ],
  }
  const backup = backupRepository.createBackup(data)
  assert.equal(
    backupRepository.parseBackup(JSON.stringify(backup)).folders[1].parentId,
    undefined
  )
  assert.equal(
    backupRepository.parseBackup(JSON.stringify({ ...backup, version: 2 }))
      .folders[1].parentId,
    "a"
  )
  data.folders[1].parentId = "missing"
  assert.throws(
    () =>
      backupRepository.parseBackup(
        JSON.stringify(backupRepository.createBackup(data))
      ),
    /缺少父文件夹/
  )
})

test("search matches multiple tokens across fields and ranks exact titles before paths", () => {
  const folders = [{ id: "f", path: "开发 GitHub" }]
  const items = [
    { id: "a", title: "Other", url: "https://other.test", parentId: "f" },
    { id: "b", title: "GitHub", url: "https://github.com", parentId: "f" },
    { id: "c", title: "GitHub Docs", url: "https://docs.test", parentId: "f" },
  ]
  const index = search.createSearchIndex(items, folders)
  assert.deepEqual(
    search.searchBookmarks(index, "github").map((i) => i.id),
    ["b", "c", "a"]
  )
  assert.deepEqual(
    search.searchBookmarks(index, "开发 DOCS").map((i) => i.id),
    ["c"]
  )
  assert.equal(search.searchBookmarks(index, "missing keyword").length, 0)
  assert.equal(search.searchBookmarks(index, "ＧｉｔＨｕｂ")[0].id, "b")
})

test("IME and native modifier targets distinguish foreground, background and window", () => {
  assert.ok(navigation.isComposing({ isComposing: true }))
  assert.ok(navigation.isComposing({ keyCode: 229 }))
  assert.equal(navigation.openTarget({}), "current")
  assert.equal(navigation.openTarget({}, true), "foreground")
  assert.equal(navigation.openTarget({ ctrlKey: true }), "background")
  assert.equal(
    navigation.openTarget({ metaKey: true, shiftKey: true }),
    "foreground"
  )
  assert.equal(navigation.openTarget({ shiftKey: true }), "window")
  assert.equal(navigation.openTarget({ button: 1 }), "background")
})

test("heat changes retain pairwise partition direction and legacy shuffle is ignored", () => {
  const items = demoGroups().flatMap((g) => g.items)
  const before = heatLayout(items, DEMO_CLICKS, 1333, 900)
  const after = heatLayout(
    items,
    { ...DEMO_CLICKS, [items[0].url]: 999 },
    1333,
    1500
  )
  for (let i = 0; i < before.length; i++)
    for (let j = i + 1; j < before.length; j++) {
      const a = before[i],
        b = before[j],
        c = after[i],
        d = after[j]
      const relations = [
        a.x + a.width <= b.x + 0.01 && c.x + c.width <= d.x + 0.01,
        b.x + b.width <= a.x + 0.01 && d.x + d.width <= c.x + 0.01,
        a.y + a.height <= b.y + 0.01 && c.y + c.height <= d.y + 0.01,
        b.y + b.height <= a.y + 0.01 && d.y + d.height <= c.y + 0.01,
      ]
      assert.ok(relations.some(Boolean), "bookmarks crossed partitions")
    }
  assert.equal(
    "shuffleSeed" in repository.clampSettings({ shuffleSeed: 999 }),
    false
  )
})

test("batch moves retain order, support same-folder insertion and reject stale selection", async () => {
  values.clear()
  const source = await repository.createFolder("Source")
  const target = await repository.createFolder("Target")
  for (const title of ["A", "B", "C", "D"])
    await repository.saveBookmark({
      title,
      url: `https://${title.toLowerCase()}.test`,
      parentId: source,
    })
  let items = (await repository.fetchBookmarkData()).groups.find(
    (g) => g.id === source
  ).items
  await batch.moveBookmarks([items[3], items[1]], {
    parentId: source,
    anchorId: items[0].id,
  })
  items = (await repository.fetchBookmarkData()).groups.find(
    (g) => g.id === source
  ).items
  assert.deepEqual(
    items.map((i) => i.title),
    ["D", "B", "A", "C"]
  )
  await batch.moveBookmarks(items.slice(0, 2), { parentId: target })
  const data = await repository.fetchBookmarkData()
  assert.deepEqual(
    data.groups.find((g) => g.id === target).items.map((i) => i.title),
    ["D", "B"]
  )
  await assert.rejects(
    batch.moveBookmarks(items.slice(0, 2), { parentId: source }),
    /已变化/
  )
})

test("deletion journal survives reload, restores nested folders and prevents duplicate undo", async () => {
  values.clear()
  const parent = await repository.createFolder("Recover parent")
  const child = await repository.createFolder("Recover child", parent)
  await repository.saveBookmark({
    title: "Nested",
    url: "https://recover.test",
    parentId: child,
  })
  const before = await repository.fetchBookmarkData()
  const entry = await recovery.deleteToRecovery({
    folderId: parent,
    snapshot: folderRepository.folderSnapshot(before, parent),
  })
  assert.equal(
    (await repository.fetchBookmarkData()).folders.some((f) => f.id === parent),
    false
  )
  assert.equal((await recovery.loadRecovery())[0].id, entry.id)
  await recovery.restoreDeleted(entry.id)
  const after = await repository.fetchBookmarkData()
  const item = after.groups
    .flatMap((g) => g.items)
    .find((i) => i.url === "https://recover.test/")
  assert.ok(
    after.folders
      .find((f) => f.id === item.parentId)
      .path.endsWith("Recover parent / Recover child")
  )
  assert.equal((await recovery.loadRecovery()).length, 0)
  await assert.rejects(recovery.restoreDeleted(entry.id), /已恢复/)
})

test("journal write failure prevents deletion; stale deletion cannot remove updated content", async () => {
  values.clear()
  const data = await repository.fetchBookmarkData()
  const item = data.groups.flatMap((g) => g.items)[0]
  const write = localStorage.setItem
  localStorage.setItem = (key, value) => {
    if (key === "tabnest:deleted:v1") throw new Error("quota")
    write(key, value)
  }
  try {
    await assert.rejects(
      recovery.deleteToRecovery({ items: [item] }),
      /写入失败/
    )
  } finally {
    localStorage.setItem = write
  }
  assert.ok(
    (await repository.fetchBookmarkData()).groups
      .flatMap((g) => g.items)
      .some((i) => i.id === item.id)
  )
  await repository.saveBookmark({ ...item, title: "Changed" })
  await assert.rejects(recovery.deleteToRecovery({ items: [item] }), /已变化/)
})

test("complete backup restores remapped folder preferences, normalized heat and theme without double counts", async () => {
  values.clear()
  const folder = await repository.createFolder("Backup target")
  await repository.saveSettings({
    activeFolderId: folder,
    collapsedSections: [folder],
    layout: "zones",
    density: "compact",
  })
  await repository.bumpClick("https://backup.test")
  await repository.bumpClick("https://backup.test")
  localStorage.setItem("theme", "light")
  const exported = await backupRepository.createFullBackup(
    await repository.fetchBookmarkData()
  )
  assert.equal(exported.version, 5)
  const parsed = backupRepository.parseBackup(JSON.stringify(exported))
  await repository.saveSettings({ density: "loose" })
  await backupRepository.importBackup(parsed, undefined, true)
  const settings = await repository.loadSettings()
  assert.equal(settings.density, "compact")
  assert.notEqual(settings.activeFolderId, folder)
  assert.equal(settings.collapsedSections[0], settings.activeFolderId)
  assert.equal((await repository.loadClicks())["https://backup.test/"], 2)
  await backupRepository.importBackup(parsed, undefined, true)
  assert.equal((await repository.loadClicks())["https://backup.test/"], 2)
  assert.equal(localStorage.getItem("theme"), "light")
})

test("restore order follows original indices even when selection was sorted differently", async () => {
  values.clear()
  const folder = await repository.createFolder("Order")
  for (const title of ["C", "B", "A"])
    await repository.saveBookmark({
      title,
      url: `https://${title.toLowerCase()}.test`,
      parentId: folder,
    })
  const items = (await repository.fetchBookmarkData()).groups.find(
    (g) => g.id === folder
  ).items
  const entry = await recovery.deleteToRecovery({ items: [...items].reverse() })
  await recovery.restoreDeleted(entry.id)
  assert.deepEqual(
    (await repository.fetchBookmarkData()).groups
      .find((g) => g.id === folder)
      .items.map((i) => i.title),
    ["C", "B", "A"]
  )
})

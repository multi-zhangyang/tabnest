import { after, test } from "node:test"
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
const backup = await server.ssrLoadModule("/src/lib/backup.ts")
const html = await server.ssrLoadModule("/src/lib/html-bookmarks.ts")
const recovery = await server.ssrLoadModule("/src/lib/recovery.ts")
const heat = await server.ssrLoadModule("/src/lib/heat-layout.ts")
const search = await server.ssrLoadModule("/src/lib/search.ts")
const repository = await server.ssrLoadModule("/src/lib/bookmarks.ts")
const operations = await server.ssrLoadModule("/src/lib/operations.ts")

test("v5 preserves special bookmark URLs and mixed sibling indices without executing scripts", () => {
  const urls = [
    "https://example.test/?a=1#x",
    "file:///C:/docs/guide.pdf",
    "mailto:hello@example.test",
    "javascript:alert(1)",
  ]
  const data = {
    folders: [
      { id: "root", title: "Root", path: "Root" },
      {
        id: "child",
        title: "Child",
        path: "Root / Child",
        parentId: "root",
        index: 1,
      },
    ],
    groups: [
      {
        id: "root",
        name: "Root",
        items: urls.map((url, i) => ({
          id: `b${i}`,
          title: `B${i}`,
          url,
          parentId: "root",
          index: i ? i + 1 : 0,
        })),
      },
      { id: "child", name: "Child", items: [] },
    ],
  }
  const result = backup.planJsonImport(
    JSON.stringify(backup.createBackup(data))
  )
  assert.deepEqual(
    result.data.groups[0].items.map((i) => i.url),
    urls
  )
  assert.equal(result.data.folders[1].index, 1)
  assert.deepEqual(
    result.data.groups[0].items.map((i) => i.index),
    [0, 2, 3, 4]
  )
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0].blocking, false)
  assert.equal(repository.safeUrl(urls[3]), undefined)
})
test("import preflight isolates invalid URLs while rejecting broken structure", () => {
  const data = {
    folders: [{ id: "f", title: "F", path: "F" }],
    groups: [
      {
        id: "f",
        name: "F",
        items: [{ id: "b", title: "Bad", url: "not a url", parentId: "f" }],
      },
    ],
  }
  const plan = backup.planJsonImport(JSON.stringify(backup.createBackup(data)))
  assert.equal(plan.issues[0].blocking, true)
  assert.equal(plan.data.groups[0].items.length, 0)
  data.folders[0].parentId = "missing"
  assert.throws(() =>
    backup.planJsonImport(JSON.stringify(backup.createBackup(data)))
  )
})
test("Netscape HTML preserves escaped titles, nested folders, scripts as data and mixed order", () => {
  const plan = html.planHtmlImport(
    '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><A HREF="https://a.test/?x=1&amp;y=2">A &amp; B</A><DT><H3>Folder</H3><DL><p><DT><A HREF="file:///C:/guide.pdf">PDF</A></DL><p><DT><A HREF="javascript:alert(1)">Saved script</A></DL><p>'
  )
  const root = plan.data.groups.find((g) => g.id === "html-root")
  assert.deepEqual(
    root.items.map((i) => i.title),
    ["A & B", "Saved script"]
  )
  assert.deepEqual(
    root.items.map((i) => i.index),
    [0, 2]
  )
  assert.equal(plan.data.folders[1].index, 1)
  assert.equal(plan.data.groups[1].items[0].url, "file:///C:/guide.pdf")
  const roundtrip = html.planHtmlImport(html.exportHtmlBookmarks(plan.data))
  assert.equal(roundtrip.data.groups.flatMap((g) => g.items).length, 3)
  assert.ok(html.exportHtmlBookmarks(plan.data).includes("A &amp; B"))
})
test("recovery evicts oldest entries by bytes and refuses oversized individual deletion", () => {
  const entry = (id, size, deletedAt = "2026-09-28T00:00:00.000Z") => ({
    id,
    title: id,
    deletedAt,
    nodes: [{ id, title: "x".repeat(size) }],
  })
  const entries = [
    entry("old", 2200000, "2026-09-27T00:00:00.000Z"),
    entry("new", 2200000),
  ]
  assert.deepEqual(
    recovery.trimRecovery(entries).map((e) => e.id),
    ["new"]
  )
  assert.throws(
    () => recovery.trimRecovery([entry("huge", recovery.RECOVERY_LIMIT)]),
    (e) => e.code === "recovery-capacity"
  )
  assert.equal(
    recovery.trimRecovery(
      Array.from({ length: 30 }, (_, i) => entry(String(i), 10))
    ).length,
    20
  )
})
test("constrained cloud redistributes fixed area, keeps minimum hit targets and stable partitions", () => {
  for (const count of [1, 24, 180, 5000])
    for (const width of [296, 1348]) {
      const items = Array.from({ length: count }, (_, i) => ({
        id: `new-${count}-${width}-${i}`,
        title: String(i),
        url: `https://t.test/${i}`,
      }))
      const before = heat.heatCanvas(items, {}, width, 650, 8, 1)
      const after = heat.heatCanvas(
        items,
        { [items[0].url]: 1000000 },
        width,
        650,
        8,
        1
      )
      assert.equal(after.height, before.height)
      assert.equal(after.boxes.length, count)
      assert.ok(
        after.boxes.every(
          (b) =>
            b.width >= 48 - 1e-6 &&
            b.height >= 48 - 1e-6 &&
            b.x >= 0 &&
            b.y >= 0 &&
            b.x + b.width <= width + 1e-5 &&
            b.y + b.height <= after.height + 1e-5
        )
      )
      if (count > 1) {
        assert.ok(
          after.boxes[0].width * after.boxes[0].height >
            before.boxes[0].width * before.boxes[0].height
        )
        assert.ok(
          after.boxes
            .slice(1)
            .some(
              (b, i) =>
                b.width * b.height <
                before.boxes[i + 1].width * before.boxes[i + 1].height
            )
        )
      }
      if (count <= 180)
        for (let i = 0; i < count; i++)
          for (let j = i + 1; j < count; j++) {
            const a = after.boxes[i],
              b = after.boxes[j]
            assert.ok(
              Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) <
                1e-5 ||
                Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) <
                  1e-5
            )
          }
    }
})
test("Chinese search supports full pinyin, initials and exact title precedence", () => {
  const items = [
    { id: "b", title: "哔哩哔哩", url: "https://bilibili.com", parentId: "f" },
    { id: "g", title: "GitHub", url: "https://github.com", parentId: "f" },
  ]
  const index = search.createSearchIndex(items, [
    { id: "f", title: "开发", path: "开发" },
  ])
  assert.deepEqual(
    search.searchBookmarks(index, "blbl").map((i) => i.id),
    ["b"]
  )
  assert.deepEqual(
    search.searchBookmarks(index, "bilibili").map((i) => i.id),
    ["b"]
  )
  assert.deepEqual(
    search.searchBookmarks(index, "开发 github").map((i) => i.id),
    ["g"]
  )
})
test("operation checkpoints survive reopen and prevent replay of interrupted restoration", async () => {
  const op = await operations.beginOperation("restore", "Interrupted", "source")
  op.rootIds = ["created-root"]
  op.completed = 12
  await operations.checkpoint(op)
  assert.equal(
    (await operations.loadOperations()).find((e) => e.id === op.id).completed,
    12
  )
  await assert.rejects(recovery.clearRecovery(), /待处理/)
  await operations.dismissOperation(op.id)
  assert.ok(!(await operations.loadOperations()).some((e) => e.id === op.id))
})
test("complete backup keeps heat for file and mail bookmarks", () => {
  const data = {
    folders: [{ id: "f", title: "F", path: "F" }],
    groups: [
      {
        id: "f",
        name: "F",
        items: [
          {
            id: "a",
            title: "File",
            url: "file:///C:/guide.pdf",
            parentId: "f",
          },
        ],
      },
    ],
    preferences: {
      settings: {},
      clicks: { "file:///C:/guide.pdf": 5, "mailto:a@example.test": 2 },
      theme: "light",
    },
  }
  const result = backup.planJsonImport(
    JSON.stringify(backup.createBackup(data))
  )
  assert.equal(result.data.preferences.clicks["file:///C:/guide.pdf"], 5)
  assert.equal(result.data.preferences.clicks["mailto:a@example.test"], 2)
})
test("legacy v2-v4 imports retain their known bookmark order", () => {
  for (const version of [2, 3, 4]) {
    const raw = {
      format: "tabnest",
      version,
      folders: [{ id: "f", title: "F", path: "F" }],
      groups: [
        {
          id: "f",
          name: "F",
          items: [
            { id: "b", title: "B", url: "https://b.test", index: 1 },
            { id: "a", title: "A", url: "https://a.test", index: 0 },
          ],
        },
      ],
    }
    const plan = backup.planJsonImport(JSON.stringify(raw))
    assert.deepEqual(
      plan.data.groups[0].items.map((item) => item.index),
      [1, 0]
    )
  }
})
test("pending operation inspection reconciles existing roots without changing bookmarks", () => {
  const data = {
    folders: [
      { id: "r", title: "Root", path: "Root" },
      { id: "f", title: "Folder", path: "Root / Folder", parentId: "r" },
    ],
    groups: [
      {
        id: "f",
        name: "Folder",
        items: [{ id: "b", title: "B", url: "https://b.test", parentId: "f" }],
      },
    ],
  }
  const original = JSON.stringify(data)
  const review = operations.inspectOperations(
    [
      {
        id: "op",
        kind: "import",
        title: "Import",
        startedAt: new Date().toISOString(),
        rootIds: ["r", "missing"],
        completed: 0,
      },
    ],
    data
  )[0]
  assert.equal(review.found, 3)
  assert.equal(review.missing, 1)
  assert.equal(review.roots[0].locateId, "r")
  assert.equal(JSON.stringify(data), original)
})
test("cloud composition mixes square, portrait and landscape tiles without synthetic heat", () => {
  const items = Array.from({ length: 24 }, (_, i) => ({
    id: `square-${i}`,
    title: String(i),
    url: `https://shape.test/${i}`,
  }))
  const { boxes } = heat.heatCanvas(items, {}, 1356, 728)
  const ratios = boxes.map((b) => b.width / b.height)
  assert.ok(ratios.filter((r) => r >= 0.8 && r <= 1.25).length >= 4)
  assert.ok(ratios.some((r) => r > 1.35) && ratios.some((r) => r < 0.75))
  const areas = boxes.map((b) => b.width * b.height)
  assert.ok(
    Math.max(...areas) / Math.min(...areas) < 1.3,
    "zero-click areas must remain balanced within hard shape constraints"
  )
})
test("layout snapshots preserve all existing IDs across collection edits", () => {
  const items=Array.from({length:24},(_,i)=>({id:`edit-${i}`,title:String(i),url:`https://edit.test/${i}`}));
  const before=heat.heatCanvas(items,{},1320,720);
  const added=[...items,{id:"new",title:"New",url:"https://new.test/"}];
  const after=heat.heatCanvas(added,{},1320,720);
  assert.deepEqual(after.boxes.map(b=>b.item.id),added.map(i=>i.id));
  assert.equal(before.snapshot.version,8);
  assert.equal(after.snapshot.version,8);
})

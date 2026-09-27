import { after, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "vite"

let nodes,
  failUpdate,
  failRollback,
  failCreateAt,
  creates,
  failMoveAt,
  moves,
  failRemoveAt,
  removes,
  failStorage
const documents = new Map()
function reset() {
  nodes = new Map([
    ["0", { id: "0", title: "" }],
    [
      "1",
      { id: "1", title: "书签栏", parentId: "0", folderType: "bookmarks-bar" },
    ],
    ["2", { id: "2", title: "其他书签", parentId: "0", folderType: "other" }],
    ["10", { id: "10", title: "A", parentId: "1" }],
    ["20", { id: "20", title: "B", parentId: "1" }],
    [
      "30",
      { id: "30", title: "Managed", parentId: "1", unmodifiable: "managed" },
    ],
    [
      "11",
      {
        id: "11",
        title: "Original",
        url: "https://example.com/",
        parentId: "10",
        index: 0,
      },
    ],
  ])
  failUpdate = false
  failRollback = false
  failCreateAt = 0
  creates = 0
  moves = 0
  removes = 0
  failMoveAt = 0
  failRemoveAt = 0
  failStorage = false
  documents.clear()
}
const subtree = (id) => {
  const node = structuredClone(nodes.get(id))
  if (!node.url)
    node.children = [...nodes.values()]
      .filter((child) => child.parentId === id)
      .map((child) => subtree(child.id))
  return node
}
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: structuredClone(documents.get(key)) }),
      set: async (value) => {
        if (failStorage) throw new Error("quota")
        for (const [key, data] of Object.entries(value))
          documents.set(key, structuredClone(data))
      },
    },
    sync: { get: async () => ({}) },
  },
  bookmarks: {
    getTree: async () => [subtree("0")],
    get: async (id) => {
      if (!nodes.has(id)) throw new Error("Missing")
      return [structuredClone(nodes.get(id))]
    },
    getSubTree: async (id) => [subtree(id)],
    getChildren: async (id) =>
      [...nodes.values()]
        .filter((node) => node.parentId === id)
        .map((node) => structuredClone(node)),
    move: async (id, change) => {
      if (++moves === failMoveAt) throw new Error("Move rejected")
      if (failRollback && change.parentId === "10")
        throw new Error("Rollback rejected")
      Object.assign(nodes.get(id), change)
      return structuredClone(nodes.get(id))
    },
    update: async (id, change) => {
      if (failUpdate) throw new Error("Update rejected")
      Object.assign(nodes.get(id), change)
      return structuredClone(nodes.get(id))
    },
    create: async (input) => {
      creates++
      if (creates === failCreateAt) throw new Error("Creation rejected")
      const node = { id: String(100 + creates), ...input }
      nodes.set(node.id, node)
      return structuredClone(node)
    },
    remove: async (id) => {
      if (++removes === failRemoveAt) throw new Error("Remove rejected")
      nodes.delete(id)
    },
    removeTree: async (id) => {
      const remove = (id) => {
        for (const node of [...nodes.values()])
          if (node.parentId === id) remove(node.id)
        nodes.delete(id)
      }
      remove(id)
    },
  },
}
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  logLevel: "error",
})
const repository = await server.ssrLoadModule("/src/lib/bookmarks.ts")
const folders = await server.ssrLoadModule("/src/lib/folders.ts")
const backups = await server.ssrLoadModule("/src/lib/backup.ts")
const recovery = await server.ssrLoadModule("/src/lib/recovery.ts")
const batch = await server.ssrLoadModule("/src/lib/batch-bookmarks.ts")
after(() => server.close())
beforeEach(reset)

test("a failed native update rolls a moved bookmark back to its original folder", async () => {
  failUpdate = true
  const original = structuredClone(nodes.get("11"))
  await assert.rejects(
    repository.saveBookmark({
      ...original,
      title: "Changed",
      parentId: "20",
      expected: original,
    }),
    /原内容已保留/
  )
  assert.deepEqual(nodes.get("11"), original)
})

test("a failed rollback is reported as a partial write without claiming success", async () => {
  failUpdate = true
  failRollback = true
  const original = structuredClone(nodes.get("11"))
  await assert.rejects(
    repository.saveBookmark({
      ...original,
      title: "Changed",
      parentId: "20",
      expected: original,
    }),
    (error) => error.code === "partial-write"
  )
  assert.equal(nodes.get("11").parentId, "20")
  assert.equal(nodes.get("11").title, "Original")
})

test("Chrome system roots and managed folders cannot be moved, renamed or deleted", async () => {
  const data = await repository.fetchBookmarkData()
  for (const id of ["1", "2", "30"]) {
    await assert.rejects(
      folders.updateFolder({
        id,
        title: "forbidden",
        parentId: "20",
        expected: data.folders.find((folder) => folder.id === id),
      }),
      /不可修改/
    )
    await assert.rejects(
      folders.removeFolder(id, folders.folderSnapshot(data, id)),
      /不可修改/
    )
  }
  assert.equal(nodes.size, 7)
})

test("failed imports remove only the newly created import folder", async () => {
  const original = structuredClone([...nodes])
  failCreateAt = 3
  const data = {
    folders: [{ id: "p", title: "Imported", path: "Imported" }],
    groups: [
      {
        id: "p",
        name: "Imported",
        items: [{ id: "b", title: "New", url: "https://example.org" }],
      },
    ],
  }
  await assert.rejects(backups.importBackup(data, "2"), /原有书签未变更/)
  assert.deepEqual([...nodes], original)
})

test("native batch failure rolls back completed moves without modifying untouched items", async () => {
  nodes.set("12", {
    id: "12",
    parentId: "10",
    index: 1,
    title: "Second",
    url: "https://second.test/",
  })
  const original = structuredClone([...nodes])
  const items = (await repository.fetchBookmarkData()).groups.find(
    (g) => g.id === "10"
  ).items
  failMoveAt = 2
  await assert.rejects(
    batch.moveBookmarks(items, { parentId: "20" }),
    /原位置已恢复/
  )
  assert.deepEqual([...nodes], original)
})

test("native deletion is prevented when the recovery journal cannot be stored", async () => {
  const item = (await repository.fetchBookmarkData()).groups.flatMap(
    (g) => g.items
  )[0]
  failStorage = true
  await assert.rejects(recovery.deleteToRecovery({ items: [item] }), /写入失败/)
  assert.ok(nodes.has(item.id))
})

test("partially failed batch deletion restores only removed roots without duplicating survivors", async () => {
  nodes.set("12", {
    id: "12",
    parentId: "10",
    index: 1,
    title: "Second",
    url: "https://second.test/",
  })
  const items = (await repository.fetchBookmarkData()).groups.find(
    (g) => g.id === "10"
  ).items
  failRemoveAt = 2
  await assert.rejects(recovery.deleteToRecovery({ items }), /未全部完成/)
  assert.equal(nodes.has("11"), false)
  assert.equal(nodes.has("12"), true)
  const entries = await recovery.loadRecovery()
  assert.equal(entries[0].nodes.length, 1)
  await recovery.restoreDeleted(entries[0].id)
  assert.equal([...nodes.values()].filter((n) => n.url).length, 2)
  assert.equal((await recovery.loadRecovery()).length, 0)
})

test("failed native tree restoration rolls back only created nodes and remains retryable", async () => {
  const data = await repository.fetchBookmarkData()
  const entry = await recovery.deleteToRecovery({
    folderId: "10",
    snapshot: folders.folderSnapshot(data, "10"),
  })
  failCreateAt = 2
  await assert.rejects(recovery.restoreDeleted(entry.id), /记录已保留/)
  assert.equal([...nodes.values()].filter((n) => n.title === "A").length, 0)
  assert.equal((await recovery.loadRecovery()).length, 1)
  failCreateAt = 0
  await recovery.restoreDeleted(entry.id)
  assert.equal([...nodes.values()].filter((n) => n.title === "A").length, 1)
  assert.equal(
    [...nodes.values()].filter((n) => n.url === "https://example.com/").length,
    1
  )
  await assert.rejects(recovery.restoreDeleted(entry.id), /已恢复/)
})

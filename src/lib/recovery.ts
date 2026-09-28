import {
  DEMO,
  defaultFolderId,
  fetchBookmarkData,
  mutateDemo,
} from "./bookmarks"
import type { BookmarkData } from "./bookmarks"
import type { BookmarkItem } from "./types"
import { descendants, folderSnapshot } from "./folders"
import { readDocument, updateDocument } from "./storage"
import { withLock } from "./platform"
import { AppError } from "./errors"
import {
  beginOperation,
  checkpoint,
  finishOperation,
  loadOperations,
} from "./operations"

const KEY = "tabnest:deleted:v1"
export const RECOVERY_LIMIT = 4 * 1024 * 1024
export const recoveryBytes = (entries: RecoveryEntry[]) =>
  new TextEncoder().encode(JSON.stringify(entries)).length
export function trimRecovery(entries: RecoveryEntry[]) {
  const next = [...entries]
    .sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt))
    .slice(0, 20)
  while (next.length > 1 && recoveryBytes(next) > RECOVERY_LIMIT) next.pop()
  if (recoveryBytes(next) > RECOVERY_LIMIT)
    throw new AppError("recovery-capacity", "所选内容超过恢复容量")
  return next
}
export type DeletedNode = {
  id: string
  title: string
  parentId?: string
  index?: number
  url?: string
  children?: DeletedNode[]
}
export type RecoveryEntry = {
  id: string
  title: string
  deletedAt: string
  nodes: DeletedNode[]
}
function validate(raw: unknown): RecoveryEntry[] {
  if (!Array.isArray(raw)) throw new Error("恢复记录无效")
  let count = 0
  function node(value: DeletedNode, depth = 0) {
    if (
      !value ||
      typeof value.id !== "string" ||
      typeof value.title !== "string" ||
      depth > 100 ||
      ++count > 25000 ||
      (value.url !== undefined && typeof value.url !== "string")
    )
      throw new Error("恢复记录无效")
    if (value.children) {
      if (!Array.isArray(value.children)) throw new Error("恢复记录无效")
      value.children.forEach((child) => node(child, depth + 1))
    }
  }
  for (const entry of raw) {
    count = 0
    if (
      !entry ||
      typeof entry.id !== "string" ||
      typeof entry.title !== "string" ||
      typeof entry.deletedAt !== "string" ||
      !Array.isArray(entry.nodes)
    )
      throw new Error("恢复记录无效")
    entry.nodes.forEach((value: DeletedNode) => node(value))
  }
  if (recoveryBytes(raw) > RECOVERY_LIMIT)
    throw new AppError("storage", "恢复记录超过容量")
  return raw
}
const read = () => readDocument(KEY, () => [], validate, false)
const change = (update: (entries: RecoveryEntry[]) => RecoveryEntry[]) =>
  updateDocument(KEY, () => [], validate, update, false)
export function clearRecovery(id?: string) {
  return withLock("bookmarks", async () => {
    const pending = await loadOperations()
    if (
      pending.some(
        (entry) => entry.kind === "restore" && (!id || entry.sourceId === id)
      )
    )
      throw new AppError("conflict", "请先检查待处理操作")
    return change((entries) =>
      id ? entries.filter((entry) => entry.id !== id) : []
    )
  })
}
const identities = (data: BookmarkData) =>
  new Set([
    ...data.folders.map((f) => f.id),
    ...data.groups.flatMap((g) => g.items.map((i) => i.id)),
  ])

export async function loadRecovery() {
  const [entries, data] = await Promise.all([read(), fetchBookmarkData()])
  const existing = identities(data)
  return entries
    .map((entry) => ({
      ...entry,
      nodes: entry.nodes.filter((node) => !existing.has(node.id)),
    }))
    .filter((entry) => entry.nodes.length)
}

function demoNode(data: BookmarkData, id: string): DeletedNode {
  const folder = data.folders.find((folder) => folder.id === id)
  if (!folder)
    return {
      ...data.groups
        .flatMap((group) => group.items)
        .find((item) => item.id === id)!,
    }
  return {
    id,
    title: folder.title,
    parentId: folder.parentId,
    index: folder.index,
    children: [
      ...data.folders
        .filter((child) => child.parentId === id)
        .map((child) => demoNode(data, child.id)),
      ...(data.groups.find((group) => group.id === id)?.items || []).map(
        (item) => ({ ...item })
      ),
    ].sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity)),
  }
}
function nativeNode(node: chrome.bookmarks.BookmarkTreeNode): DeletedNode {
  return {
    id: node.id,
    title: node.title,
    parentId: node.parentId,
    index: node.index,
    url: node.url,
    children: node.children?.map(nativeNode),
  }
}

export function deleteToRecovery(
  request: { items: BookmarkItem[] } | { folderId: string; snapshot: string },
  permanent = false
) {
  return withLock("bookmarks", async () => {
    const data = await fetchBookmarkData()
    let ids: string[]
    if ("items" in request) {
      if (!request.items.length)
        throw new AppError("invalid-data", "请选择书签")
      const current = new Map(
        data.groups
          .flatMap((group) => group.items)
          .map((item) => [item.id, item])
      )
      ids = [...new Set(request.items.map((item) => item.id))]
      for (const expected of request.items) {
        const item = current.get(expected.id)
        if (
          !item ||
          item.readOnly ||
          item.title !== expected.title ||
          item.url !== expected.url ||
          item.parentId !== expected.parentId
        )
          throw new AppError("conflict", "书签已变化，请重新选择")
      }
    } else {
      const folder = data.folders.find(
        (folder) => folder.id === request.folderId
      )
      if (!folder || folder.root || folder.readOnly)
        throw new AppError("operation", "此文件夹不可删除")
      const children = descendants(data.folders, folder.id)
      if (
        data.folders.some((f) => children.has(f.id) && f.readOnly) ||
        data.groups.some(
          (g) => children.has(g.id) && g.items.some((i) => i.readOnly)
        )
      )
        throw new AppError("operation", "文件夹包含只读内容")
      if (folderSnapshot(data, folder.id) !== request.snapshot)
        throw new AppError("conflict", "文件夹内容已变化，请重新确认删除")
      ids = [folder.id]
    }
    const nodes: DeletedNode[] = []
    for (const id of ids)
      nodes.push(
        DEMO
          ? demoNode(data, id)
          : nativeNode((await chrome.bookmarks.getSubTree(id))[0])
      )
    const entry: RecoveryEntry = {
      id: crypto.randomUUID(),
      title: nodes.length === 1 ? nodes[0].title : `${nodes.length} 个书签`,
      deletedAt: new Date().toISOString(),
      nodes,
    }
    const existing = identities(data)
    if (!permanent)
      await change((entries) => {
        const next = trimRecovery([
          entry,
          ...entries
            .map((previous) => ({
              ...previous,
              nodes: previous.nodes.filter((node) => !existing.has(node.id)),
            }))
            .filter((previous) => previous.nodes.length),
        ])
        if (!next.some((record) => record.id === entry.id))
          throw new AppError("storage", "无法保留本次恢复记录")
        return next
      })
    try {
      if (DEMO)
        await mutateDemo((current) => {
          const removing = new Set<string>()
          nodes.forEach((node) =>
            descendants(current.folders, node.id).forEach((id) =>
              removing.add(id)
            )
          )
          current.folders = current.folders.filter((f) => !removing.has(f.id))
          current.groups = current.groups
            .filter((g) => !removing.has(g.id))
            .map((g) => ({
              ...g,
              items: g.items.filter((i) => !removing.has(i.id)),
            }))
        })
      else
        for (const node of nodes) {
          if (node.url !== undefined) await chrome.bookmarks.remove(node.id)
          else await chrome.bookmarks.removeTree(node.id)
        }
    } catch (cause) {
      throw new AppError(
        "partial-write",
        permanent
          ? "部分内容已永久删除，请检查书签"
          : "删除未全部完成，已删除内容可从最近删除中恢复",
        { cause }
      )
    }
    return entry
  })
}

export function restoreDeleted(id: string) {
  return withLock("bookmarks", async () => {
    const entry = (await read()).find((entry) => entry.id === id)
    if (!entry) throw new AppError("conflict", "记录已恢复或已过期")
    if ((await loadOperations()).some((operation) => operation.sourceId === id))
      throw new AppError("conflict", "请先检查未完成的恢复")
    const ordered = [...entry.nodes].sort(
      (a, b) =>
        (a.parentId || "").localeCompare(b.parentId || "") ||
        (a.index || 0) - (b.index || 0)
    )
    for (const node of ordered) {
      const data = await fetchBookmarkData()
      if (identities(data).has(node.id)) continue
      const parentId =
        data.folders.find((f) => f.id === node.parentId && !f.readOnly)?.id ||
        defaultFolderId(data.folders)
      if (!parentId) throw new AppError("operation", "没有可写的恢复位置")
      if (DEMO) {
        const created = new Set<string>()
        await mutateDemo((current) => {
          function create(node: DeletedNode, parentId: string) {
            const id = crypto.randomUUID()
            created.add(id)
            if (node.url !== undefined) {
              const group = current.groups.find((g) => g.id === parentId)!
              group.items.splice(
                Math.min(node.index ?? group.items.length, group.items.length),
                0,
                {
                  id,
                  title: node.title,
                  url: node.url,
                  parentId,
                  dateAdded: Date.now(),
                }
              )
            } else {
              const path = `${current.folders.find((f) => f.id === parentId)!.path} / ${node.title}`
              current.folders.push({
                id,
                title: node.title,
                path,
                parentId,
                index: node.index,
              })
              current.groups.push({ id, name: path, items: [] })
              node.children?.forEach((child) => create(child, id))
            }
          }
          create(node, parentId)
        })
        try {
          await change((entries) =>
            entries
              .map((e) =>
                e.id === id
                  ? { ...e, nodes: e.nodes.filter((n) => n.id !== node.id) }
                  : e
              )
              .filter((e) => e.nodes.length)
          )
        } catch (cause) {
          await mutateDemo((current) => {
            current.folders = current.folders.filter((f) => !created.has(f.id))
            current.groups = current.groups
              .filter((g) => !created.has(g.id))
              .map((g) => ({
                ...g,
                items: g.items.filter((i) => !created.has(i.id)),
              }))
          })
          throw cause
        }
      } else {
        const operation = await beginOperation("restore", node.title, id)
        const created = new Set<string>()
        let rootId = ""
        try {
          async function create(
            node: DeletedNode,
            parentId: string,
            root = false
          ) {
            const siblings = root
              ? await chrome.bookmarks.getChildren(parentId)
              : []
            const result = await chrome.bookmarks.create({
              parentId,
              title: node.title,
              ...(node.url !== undefined ? { url: node.url } : {}),
              ...(root && node.index !== undefined
                ? { index: Math.min(node.index, siblings.length) }
                : {}),
            })
            created.add(result.id)
            if (root) {
              rootId = result.id
              operation.rootIds.push(rootId)
              await checkpoint(operation)
            }
            operation.completed++
            if (operation.completed % 32 === 0) await checkpoint(operation)
            for (const child of node.children || [])
              await create(child, result.id)
          }
          await create(node, parentId, true)
          await change((entries) =>
            entries
              .map((e) =>
                e.id === id
                  ? { ...e, nodes: e.nodes.filter((n) => n.id !== node.id) }
                  : e
              )
              .filter((e) => e.nodes.length)
          )
          await finishOperation(operation.id).catch(() => {})
        } catch (cause) {
          if (rootId) {
            try {
              const tree = await chrome.bookmarks.getSubTree(rootId)
              const owned = (n: chrome.bookmarks.BookmarkTreeNode): boolean =>
                created.has(n.id) && (n.children || []).every(owned)
              if (!tree.every(owned))
                throw new Error("恢复目录已被修改", { cause })
              if (node.url !== undefined) await chrome.bookmarks.remove(rootId)
              else await chrome.bookmarks.removeTree(rootId)
            } catch {
              throw new AppError(
                "partial-write",
                "恢复未完成，部分内容已写入，请检查书签后再操作",
                { cause }
              )
            }
          }
          await finishOperation(operation.id)
          throw new AppError("operation", "恢复失败，删除记录已保留", { cause })
        }
      }
    }
    await change((entries) => entries.filter((entry) => entry.id !== id))
  })
}

import { DEMO, fetchBookmarkData, mutateDemo } from "./bookmarks"
import type { BookmarkData } from "./bookmarks"
import type { BookmarkFolder } from "./types"
import { AppError } from "./errors"
import { withLock } from "./platform"

export function rootFolder(folders: BookmarkFolder[], id: string) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  let current = byId.get(id)
  const visited = new Set<string>()
  while (current?.parentId && byId.has(current.parentId)) {
    if (visited.has(current.id)) return undefined
    visited.add(current.id)
    current = byId.get(current.parentId)
  }
  return current
}

export function descendants(
  folders: BookmarkFolder[],
  id: string
): Set<string> {
  const result = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders)
      if (
        folder.parentId &&
        result.has(folder.parentId) &&
        !result.has(folder.id)
      ) {
        result.add(folder.id)
        changed = true
      }
  }
  return result
}

export function folderSnapshot(data: BookmarkData, id: string) {
  const ids = descendants(data.folders, id)
  return JSON.stringify({
    folders: data.folders
      .filter((folder) => ids.has(folder.id))
      .map((folder) => [folder.id, folder.parentId, folder.title])
      .sort(),
    items: data.groups
      .filter((group) => ids.has(group.id))
      .flatMap((group) =>
        group.items.map((item) => [item.id, item.title, item.url, group.id])
      )
      .sort(),
  })
}

function writable(data: BookmarkData, id: string) {
  const folder = data.folders.find((folder) => folder.id === id)
  if (!folder) throw new AppError("conflict", "文件夹已被删除")
  if (folder.readOnly || folder.root)
    throw new AppError("operation", "此文件夹不可修改")
  return folder
}

function destination(
  data: BookmarkData,
  id: string | undefined,
  movingId: string
) {
  if (!id) throw new AppError("invalid-data", "请选择目标文件夹")
  const folder = data.folders.find((folder) => folder.id === id)
  if (!folder || folder.readOnly)
    throw new AppError("conflict", "目标文件夹不可用")
  if (descendants(data.folders, movingId).has(id))
    throw new AppError("invalid-data", "不能移动到自身或子文件夹")
}

function rebuildPaths(data: BookmarkData) {
  const byId = new Map(data.folders.map((folder) => [folder.id, folder]))
  const path = (folder: BookmarkFolder): string => {
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined
    return parent ? `${path(parent)} / ${folder.title}` : folder.title
  }
  for (const folder of data.folders) folder.path = path(folder)
  for (const group of data.groups)
    group.name = byId.get(group.id)?.path ?? group.name
}

export function updateFolder(input: {
  id: string
  title: string
  parentId?: string
  expected: BookmarkFolder
}) {
  return withLock("bookmarks", async () => {
    const title = input.title.trim()
    if (!title || title.length > 1024)
      throw new AppError("invalid-data", "请输入有效的文件夹名称")
    const check = (data: BookmarkData) => {
      const folder = writable(data, input.id)
      if (
        folder.title !== input.expected.title ||
        folder.parentId !== input.expected.parentId
      )
        throw new AppError("conflict", "文件夹已在其他页面修改，请重新打开编辑")
      destination(data, input.parentId, input.id)
      return folder
    }
    if (DEMO) {
      await mutateDemo((data) => {
        const folder = check(data)
        folder.title = title
        folder.parentId = input.parentId
        rebuildPaths(data)
      })
      return
    }
    const data = await fetchBookmarkData()
    const folder = check(data)
    const [original] = await chrome.bookmarks.get(folder.id)
    const moving = folder.parentId !== input.parentId
    if (moving)
      await chrome.bookmarks.move(folder.id, { parentId: input.parentId })
    try {
      await chrome.bookmarks.update(folder.id, { title })
    } catch (cause) {
      if (moving && original.parentId) {
        try {
          const [latest] = await chrome.bookmarks.get(folder.id)
          if (
            latest.title !== original.title ||
            latest.parentId !== input.parentId
          )
            throw new Error("Concurrent edit", { cause })
          await chrome.bookmarks.move(folder.id, {
            parentId: original.parentId,
            index: original.index,
          })
        } catch {
          throw new AppError(
            "partial-write",
            "名称未保存，文件夹位置已变化，请检查",
            { cause }
          )
        }
      }
      throw new AppError("operation", "文件夹保存失败，原内容已保留", { cause })
    }
  })
}

export function removeFolder(id: string, expectedSnapshot: string) {
  return withLock("bookmarks", async () => {
    const check = (data: BookmarkData) => {
      writable(data, id)
      if (folderSnapshot(data, id) !== expectedSnapshot)
        throw new AppError("conflict", "文件夹内容已变化，请重新确认删除")
    }
    if (!DEMO) {
      const data = await fetchBookmarkData()
      check(data)
      await chrome.bookmarks.removeTree(id)
      return
    }
    await mutateDemo((data) => {
      check(data)
      const ids = descendants(data.folders, id)
      data.folders = data.folders.filter((folder) => !ids.has(folder.id))
      data.groups = data.groups.filter((group) => !ids.has(group.id))
    })
  })
}

import type {
  AppSettings,
  BookmarkFolder,
  BookmarkGroup,
  BookmarkItem,
} from "./types"
import { demoGroups } from "./demo"
import { isExtension, withLock } from "./platform"
import {
  readDocument,
  updateDocument,
  subscribeStorage,
  STORAGE_KEYS,
} from "./storage"
import { AppError } from "./errors"
import { domainOf, normalizeUrl } from "./urls"

export type * from "./types"
export const DEMO = !isExtension
export {
  DEFAULT_SETTINGS,
  clampSettings,
  loadSettings,
  saveSettings,
  loadClicks,
  bumpClick,
} from "./preferences"
export { domainOf, normalizeUrl, safeUrl } from "./urls"
export type BookmarkData = {
  groups: BookmarkGroup[]
  folders: BookmarkFolder[]
}
const DATA_KEY = STORAGE_KEYS.demo

export function parseBookmarkTree(
  tree: chrome.bookmarks.BookmarkTreeNode[]
): BookmarkData {
  const groups: BookmarkGroup[] = []
  const folders: BookmarkFolder[] = []
  function visit(
    node: chrome.bookmarks.BookmarkTreeNode,
    path: string,
    parentId?: string,
    inheritedReadOnly = false
  ) {
    if (node.url || !node.children) return
    const title = node.title || (node.id === "1" ? "书签栏" : "未命名文件夹")
    const nextPath =
      node.id === "0" ? "" : [path, title].filter(Boolean).join(" / ")
    if (node.id !== "0") {
      folders.push({
        id: node.id,
        title,
        path: nextPath,
        parentId: node.parentId ?? parentId,
        readOnly: inheritedReadOnly || node.unmodifiable === "managed",
        root: Boolean(node.folderType) || (node.parentId ?? parentId) === "0",
        folderType: node.folderType,
        index: node.index,
      })
      groups.push({
        id: node.id,
        name: nextPath,
        items: node.children
          .filter((n) => n.url)
          .map((n) => ({
            id: n.id,
            title: n.title || domainOf(n.url!),
            url: n.url!,
            dateAdded: n.dateAdded,
            parentId: node.id,
            index: n.index,
            readOnly:
              inheritedReadOnly ||
              n.unmodifiable === "managed" ||
              node.unmodifiable === "managed",
          })),
      })
    }
    node.children.forEach((child) =>
      visit(
        child,
        nextPath,
        node.id,
        inheritedReadOnly || node.unmodifiable === "managed"
      )
    )
  }
  tree.forEach((node) => visit(node, ""))
  return { groups, folders }
}

function initialDemo(): BookmarkData {
  const groups = demoGroups()
  return {
    groups: [
      { id: "demo-bar", name: "书签栏", items: [] },
      ...groups.map((group) => ({ ...group, name: `书签栏 / ${group.name}` })),
      { id: "demo-other", name: "其他书签", items: [] },
    ],
    folders: [
      {
        id: "demo-bar",
        title: "书签栏",
        path: "书签栏",
        parentId: "0",
        root: true,
        folderType: "bookmarks-bar",
      },
      ...groups.map((group) => ({
        id: group.id,
        title: group.name,
        path: `书签栏 / ${group.name}`,
        parentId: "demo-bar",
      })),
      {
        id: "demo-other",
        title: "其他书签",
        path: "其他书签",
        parentId: "0",
        root: true,
        folderType: "other",
      },
    ],
  }
}

export function defaultFolderId(folders: BookmarkFolder[]) {
  return (
    folders.find(
      (folder) => folder.folderType === "bookmarks-bar" && !folder.readOnly
    )?.id ||
    folders.find((folder) => folder.id === "1" && !folder.readOnly)?.id ||
    folders.find((folder) => !folder.readOnly)?.id ||
    ""
  )
}

export function validateBookmarkData(raw: unknown): BookmarkData {
  if (!raw || typeof raw !== "object")
    throw new AppError("invalid-data", "书签数据无效")
  const data = raw as BookmarkData
  if (!Array.isArray(data.groups) || !Array.isArray(data.folders))
    throw new AppError("invalid-data", "书签数据无效")
  const ids = new Set<string>()
  for (const folder of data.folders) {
    if (
      !folder ||
      typeof folder.id !== "string" ||
      typeof folder.title !== "string" ||
      typeof folder.path !== "string" ||
      ids.has(folder.id)
    )
      throw new AppError("invalid-data", "文件夹数据无效")
    if (folder.parentId !== undefined && typeof folder.parentId !== "string")
      throw new AppError("invalid-data", "文件夹层级无效")
    ids.add(folder.id)
  }
  const byId = new Map(data.folders.map((folder) => [folder.id, folder]))
  for (const folder of data.folders) {
    const seen = new Set<string>()
    let current: BookmarkFolder | undefined = folder
    while (current) {
      if (seen.has(current.id) || seen.size >= 100)
        throw new AppError("invalid-data", "文件夹层级无效或超过 100 层")
      seen.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }
  const items = new Set<string>()
  const groups = new Set<string>()
  for (const group of data.groups) {
    if (
      !group ||
      typeof group.id !== "string" ||
      typeof group.name !== "string" ||
      !Array.isArray(group.items) ||
      groups.has(group.id) ||
      !ids.has(group.id)
    )
      throw new AppError("invalid-data", "文件夹数据无效")
    groups.add(group.id)
    for (const item of group.items) {
      if (
        !item ||
        typeof item.id !== "string" ||
        typeof item.title !== "string" ||
        typeof item.url !== "string" ||
        items.has(item.id) ||
        ids.has(item.id) ||
        (item.parentId !== undefined && item.parentId !== group.id)
      )
        throw new AppError("invalid-data", "书签数据无效")
      items.add(item.id)
    }
  }
  return data
}

export async function fetchBookmarkData(): Promise<BookmarkData> {
  if (!DEMO) return parseBookmarkTree(await chrome.bookmarks.getTree())
  return readDocument(DATA_KEY, initialDemo, validateBookmarkData, false)
}

export async function mutateDemo(mutate: (data: BookmarkData) => void) {
  await updateDocument(
    DATA_KEY,
    initialDemo,
    validateBookmarkData,
    (data) => {
      mutate(data)
      for (const group of data.groups) {
        const children = data.folders.filter(
          (folder) => folder.parentId === group.id
        )
        let tail =
          Math.max(
            -1,
            ...group.items.map((item) => item.index ?? -1),
            ...children.map((folder) => folder.index ?? -1)
          ) + 1
        for (const folder of children)
          if (folder.index === undefined) folder.index = tail++
        const occupied = new Set(children.map((folder) => folder.index))
        let index = 0
        group.items.forEach((item) => {
          while (occupied.has(index)) index++
          item.index = index
          item.parentId = group.id
          index++
        })
      }
      return data
    },
    false
  )
}

export type BookmarkWrite = {
  id?: string
  title: string
  url: string
  parentId: string
  expected?: Pick<BookmarkItem, "title" | "url" | "parentId">
}

export function saveBookmark(input: BookmarkWrite) {
  return withLock("bookmarks", () => saveBookmarkUnlocked(input))
}

function assertUnchanged(
  current: { title: string; url?: string; parentId?: string },
  expected?: BookmarkWrite["expected"]
) {
  if (
    expected &&
    (current.title !== expected.title ||
      current.url !== expected.url ||
      current.parentId !== expected.parentId)
  )
    throw new AppError("conflict", "书签已在其他页面修改，请重新打开编辑")
}

async function saveBookmarkUnlocked(input: BookmarkWrite) {
  const url = normalizeUrl(input.url)
  const title = input.title.trim() || domainOf(url)
  if (!input.parentId) throw new AppError("invalid-data", "请选择文件夹")
  if (title.length > 1024)
    throw new AppError("invalid-data", "名称不能超过 1024 个字符")
  if (!DEMO) {
    const [destination] = await chrome.bookmarks.get(input.parentId)
    if (!destination || destination.url || destination.unmodifiable)
      throw new AppError("operation", "此文件夹无法写入")
    if (input.id) {
      const [current] = await chrome.bookmarks.get(input.id)
      if (current.unmodifiable) throw new AppError("operation", "此书签为只读")
      assertUnchanged(current, input.expected)
      const moved = current.parentId !== input.parentId
      if (moved)
        await chrome.bookmarks.move(input.id, { parentId: input.parentId })
      try {
        await chrome.bookmarks.update(input.id, { title, url })
      } catch (cause) {
        if (moved && current.parentId) {
          try {
            const [latest] = await chrome.bookmarks.get(input.id)
            assertUnchanged(latest, {
              title: current.title,
              url: current.url!,
              parentId: input.parentId,
            })
            await chrome.bookmarks.move(input.id, {
              parentId: current.parentId,
              index: current.index,
            })
          } catch {
            throw new AppError(
              "partial-write",
              "名称和网址未保存，书签位置已变化，请检查文件夹",
              { cause }
            )
          }
        }
        throw new AppError("operation", "书签保存失败，原内容已保留", { cause })
      }
    } else
      await chrome.bookmarks.create({ title, url, parentId: input.parentId })
    return
  }
  await mutateDemo((data) => {
    const target = data.groups.find((g) => g.id === input.parentId)
    if (!target) throw new AppError("conflict", "文件夹不存在")
    if (data.folders.find((folder) => folder.id === target.id)?.readOnly)
      throw new AppError("operation", "此文件夹不可写入")
    const previous = data.groups
      .flatMap((g) => g.items)
      .find((i) => i.id === input.id)
    if (input.id && !previous) throw new AppError("conflict", "书签已被删除")
    if (previous?.readOnly) throw new AppError("operation", "此书签为只读")
    if (previous) assertUnchanged(previous, input.expected)
    const item: BookmarkItem = {
      ...previous,
      id: input.id || crypto.randomUUID(),
      title,
      url,
      parentId: target.id,
      dateAdded: previous?.dateAdded ?? Date.now(),
    }
    const inPlace = target.items.findIndex((i) => i.id === item.id)
    if (inPlace >= 0) target.items[inPlace] = item
    else {
      data.groups.forEach((g) => {
        g.items = g.items.filter((i) => i.id !== item.id)
      })
      target.items.push(item)
    }
  })
}

export function removeBookmark(id: string) {
  return withLock("bookmarks", () => removeBookmarkUnlocked(id))
}

async function removeBookmarkUnlocked(id: string) {
  if (!DEMO) return chrome.bookmarks.remove(id)
  await mutateDemo((data) => {
    data.groups.forEach((g) => {
      g.items = g.items.filter((i) => i.id !== id)
    })
  })
}

export function moveBookmark(item: BookmarkItem, direction: -1 | 1) {
  return withLock("bookmarks", () => moveBookmarkUnlocked(item, direction))
}

async function moveBookmarkUnlocked(item: BookmarkItem, direction: -1 | 1) {
  if (!item.parentId) return
  if (!DEMO) {
    const siblings = await chrome.bookmarks.getChildren(item.parentId)
    const position = siblings.findIndex((n) => n.id === item.id)
    if (position < 0) throw new AppError("conflict", "书签已被删除")
    const next = position + direction
    if (next < 0 || next >= siblings.length) return
    await chrome.bookmarks.move(item.id, {
      parentId: item.parentId,
      index: next + (direction > 0 ? 1 : 0),
    })
    return
  }
  await mutateDemo((data) => {
    const group = data.groups.find((g) => g.id === item.parentId)
    if (!group) return
    const index = group.items.findIndex((i) => i.id === item.id)
    const next = index + direction
    if (index < 0 || next < 0 || next >= group.items.length) return
    ;[group.items[index], group.items[next]] = [
      group.items[next],
      group.items[index],
    ]
  })
}

export function createFolder(title: string, parentId?: string) {
  return withLock("bookmarks", () => createFolderUnlocked(title, parentId))
}

async function createFolderUnlocked(title: string, parentId?: string) {
  if (!title.trim()) throw new AppError("invalid-data", "请输入文件夹名称")
  if (title.length > 1024) throw new AppError("invalid-data", "文件夹名称过长")
  const data = await fetchBookmarkData()
  parentId = parentId || defaultFolderId(data.folders)
  if (
    !parentId ||
    !data.folders.some((folder) => folder.id === parentId && !folder.readOnly)
  )
    throw new AppError("invalid-data", "请选择可写的文件夹")
  if (!DEMO) {
    const node = await chrome.bookmarks.create({
      title: title.trim(),
      ...(parentId ? { parentId } : {}),
    })
    return node.id
  }
  const id = crypto.randomUUID()
  await mutateDemo((data) => {
    const parent = parentId
      ? data.folders.find((folder) => folder.id === parentId)
      : undefined
    if (parentId && (!parent || parent.readOnly))
      throw new AppError("conflict", "目标文件夹不可用")
    const path = [parent?.path, title.trim()].filter(Boolean).join(" / ")
    data.folders.push({ id, title: title.trim(), path, parentId })
    data.groups.push({ id, name: path, items: [] })
  })
  return id
}

export function subscribeBookmarks(callback: () => void) {
  if (DEMO)
    return subscribeStorage((keys) => {
      if (keys.includes(DATA_KEY)) callback()
    })
  const events = [
    chrome.bookmarks.onCreated,
    chrome.bookmarks.onRemoved,
    chrome.bookmarks.onChanged,
    chrome.bookmarks.onMoved,
    chrome.bookmarks.onChildrenReordered,
    chrome.bookmarks.onImportEnded,
  ]
  let importing = false
  let timer: ReturnType<typeof setTimeout>
  const listener = () => {
    clearTimeout(timer)
    if (!importing) timer = setTimeout(callback, 80)
  }
  const startImport = () => { importing = true; clearTimeout(timer) }
  const endImport = () => { importing = false; listener() }
  chrome.bookmarks.onImportBegan.addListener(startImport)
  chrome.bookmarks.onImportEnded.addListener(endImport)
  events.forEach((event) => event.addListener(listener))
  return () => {
    clearTimeout(timer)
    events.forEach((event) => event.removeListener(listener))
    chrome.bookmarks.onImportBegan.removeListener(startImport)
    chrome.bookmarks.onImportEnded.removeListener(endImport)
  }
}

export function sortItems(items: BookmarkItem[], sort: AppSettings["sort"]) {
  return [...items].sort((a, b) =>
    sort === "name" ? a.title.localeCompare(b.title, "zh-CN") : 0
  )
}

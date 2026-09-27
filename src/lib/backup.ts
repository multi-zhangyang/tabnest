import {
  DEMO,
  defaultFolderId,
  fetchBookmarkData,
  mutateDemo,
  validateBookmarkData,
} from "./bookmarks"
import type { BookmarkData } from "./bookmarks"
import { AppError } from "./errors"
import { normalizeUrl } from "./urls"
import { withLock } from "./platform"
import {
  clampSettings,
  loadClicks,
  loadSettings,
  mergeClicks,
  saveSettings,
  validateClicks,
} from "./preferences"
import type { AppSettings } from "./types"

export type BackupPreferences = {
  settings: AppSettings
  clicks: Record<string, number>
  theme: "light" | "dark" | "system"
}
export type BackupData = BookmarkData & { preferences?: BackupPreferences }

export type BookmarkBackup = {
  format: "tabnest"
  version: 4
  exportedAt: string
  folders: BookmarkData["folders"]
  groups: BookmarkData["groups"]
  preferences?: BackupPreferences
}
export function createBackup(data: BackupData): BookmarkBackup {
  return {
    format: "tabnest",
    version: 4,
    exportedAt: new Date().toISOString(),
    ...data,
  }
}

export async function createFullBackup(data: BookmarkData) {
  const [settings, clicks] = await Promise.all([loadSettings(), loadClicks()])
  const storedTheme = localStorage.getItem("theme")
  const theme =
    storedTheme === "light" || storedTheme === "system" ? storedTheme : "dark"
  return createBackup({ ...data, preferences: { settings, clicks, theme } })
}

export function parseBackup(text: string): BackupData {
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024)
    throw new AppError("invalid-data", "文件不能超过 10 MB")
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (cause) {
    throw new AppError("invalid-data", "无法读取 JSON 文件", { cause })
  }
  if (!raw || typeof raw !== "object")
    throw new AppError("invalid-data", "备份格式无效")
  const record = raw as Partial<BookmarkBackup>
  if (
    typeof record.version !== "number" ||
    ![2, 3, 4].includes(record.version) ||
    (Number(record.version) >= 3 && record.format !== "tabnest")
  )
    throw new AppError("invalid-data", "不支持此备份版本")
  const input = validateBookmarkData(raw)
  if (
    input.folders.length > 2000 ||
    input.groups.reduce((sum, group) => sum + group.items.length, 0) > 20000
  )
    throw new AppError(
      "invalid-data",
      "备份最多包含 2000 个文件夹、20000 个书签"
    )
  const ids = new Set(input.folders.map((folder) => folder.id))
  const data: BackupData = {
    folders: input.folders.map((folder) => {
      const parentPath = folder.path.split(" / ").slice(0, -1).join(" / ")
      const inferred = input.folders.filter(
        (candidate) => candidate.path === parentPath
      )
      if (!folder.title.trim() || folder.title.length > 1024)
        throw new AppError("invalid-data", "文件夹名称无效")
      if (
        folder.parentId &&
        folder.parentId !== "0" &&
        !ids.has(folder.parentId)
      )
        throw new AppError("invalid-data", "备份缺少父文件夹")
      return {
        id: folder.id,
        title: folder.title,
        path: folder.path,
        parentId:
          folder.parentId && ids.has(folder.parentId)
            ? folder.parentId
            : Number(record.version) === 2 &&
                !folder.parentId &&
                inferred.length === 1
              ? inferred[0].id
              : undefined,
      }
    }),
    groups: input.groups.map((group) => ({
      id: group.id,
      name: group.name,
      items: group.items.map((item) => {
        if (item.title.length > 1024)
          throw new AppError("invalid-data", "书签名称过长")
        return {
          id: item.id,
          title: item.title,
          url: normalizeUrl(item.url),
          parentId: group.id,
          dateAdded: Number.isFinite(item.dateAdded)
            ? item.dateAdded
            : undefined,
        }
      }),
    })),
  }
  const byId = new Map(data.folders.map((folder) => [folder.id, folder]))
  for (const folder of data.folders) {
    const seen = new Set<string>()
    let current: typeof folder | undefined = folder
    while (current) {
      if (seen.has(current.id) || seen.size >= 100)
        throw new AppError("invalid-data", "文件夹层级无效或超过 100 层")
      seen.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }
  if (record.version === 4 && record.preferences !== undefined) {
    const prefs = record.preferences
    if (
      !prefs ||
      !prefs.settings ||
      typeof prefs.settings !== "object" ||
      !["light", "dark", "system"].includes(prefs.theme)
    )
      throw new AppError("invalid-data", "备份设置无效")
    const clicks: Record<string, number> = {}
    for (const [url, count] of Object.entries(validateClicks(prefs.clicks))) {
      const key = normalizeUrl(url)
      clicks[key] = Math.max(clicks[key] || 0, count)
    }
    data.preferences = {
      settings: clampSettings(prefs.settings),
      clicks,
      theme: prefs.theme,
    }
  }
  return data
}

async function restorePreferences(
  data: BackupData,
  ids: Map<string, string>,
  enabled: boolean
) {
  if (!enabled || !data.preferences) return
  try {
    const { settings, clicks, theme } = data.preferences
    await mergeClicks(clicks)
    await saveSettings({
      ...settings,
      activeFolderId: ids.get(settings.activeFolderId) || "",
      collapsedSections: settings.collapsedSections.flatMap((id) =>
        ids.has(id) ? [ids.get(id)!] : []
      ),
    })
    localStorage.setItem("theme", theme)
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("tabnest:theme"))
  } catch (cause) {
    throw new AppError("partial-write", "书签已导入，热度或设置未全部恢复", {
      cause,
    })
  }
}

export function importBackup(
  source: BackupData,
  parentId?: string,
  restore = false
) {
  return withLock("bookmarks", async () => {
    const data = parseBackup(JSON.stringify(createBackup(source)))
    const title = `TabNest · ${new Date().toLocaleDateString("sv-SE")}`
    const before = await fetchBookmarkData()
    parentId = parentId || defaultFolderId(before.folders)
    if (
      parentId &&
      !before.folders.some(
        (folder) => folder.id === parentId && !folder.readOnly
      )
    )
      throw new AppError("conflict", "目标文件夹不可用")
    if (DEMO) {
      let rootId = ""
      const ids = new Map(
        data.folders.map((folder) => [folder.id, crypto.randomUUID()])
      )
      await mutateDemo((current) => {
        if (
          parentId &&
          !current.folders.some(
            (folder) => folder.id === parentId && !folder.readOnly
          )
        )
          throw new AppError("conflict", "目标文件夹不可用")
        rootId = crypto.randomUUID()
        const rootPath = [
          current.folders.find((folder) => folder.id === parentId)?.path,
          title,
        ]
          .filter(Boolean)
          .join(" / ")
        current.folders.push({ id: rootId, title, path: rootPath, parentId })
        current.groups.push({ id: rootId, name: rootPath, items: [] })
        const pathFor = (id: string): string => {
          const folder = data.folders.find((folder) => folder.id === id)!
          return `${folder.parentId ? pathFor(folder.parentId) : rootPath} / ${folder.title}`
        }
        for (const folder of data.folders) {
          const id = ids.get(folder.id)!,
            path = pathFor(folder.id)
          current.folders.push({
            id,
            title: folder.title,
            path,
            parentId: folder.parentId ? ids.get(folder.parentId) : rootId,
          })
          current.groups.push({
            id,
            name: path,
            items: (
              data.groups.find((group) => group.id === folder.id)?.items || []
            ).map((item) => ({
              ...item,
              id: crypto.randomUUID(),
              parentId: id,
            })),
          })
        }
      })
      await restorePreferences(data, ids, restore)
      return rootId
    }
    const created = new Set<string>()
    const root = await chrome.bookmarks.create({
      title,
      ...(parentId ? { parentId } : {}),
    })
    created.add(root.id)
    const ids = new Map<string, string>()
    try {
      const create = async (id: string): Promise<string> => {
        if (ids.has(id)) return ids.get(id)!
        const folder = data.folders.find((folder) => folder.id === id)!
        const parent = folder.parentId ? await create(folder.parentId) : root.id
        const result = await chrome.bookmarks.create({
          parentId: parent,
          title: folder.title,
        })
        created.add(result.id)
        ids.set(id, result.id)
        return result.id
      }
      for (const folder of data.folders) await create(folder.id)
      for (const group of data.groups)
        for (const item of group.items) {
          const bookmark = await chrome.bookmarks.create({
            parentId: ids.get(group.id)!,
            title: item.title,
            url: item.url,
          })
          created.add(bookmark.id)
        }
    } catch (cause) {
      try {
        const tree = await chrome.bookmarks.getSubTree(root.id)
        const owned = (node: chrome.bookmarks.BookmarkTreeNode): boolean =>
          created.has(node.id) && (node.children || []).every(owned)
        if (!tree.every(owned))
          throw new Error("Import folder was changed", { cause })
        await chrome.bookmarks.removeTree(root.id)
      } catch {
        throw new AppError(
          "partial-write",
          `导入未完成，请检查「${title}」文件夹`,
          { cause }
        )
      }
      throw new AppError("operation", "导入失败，原有书签未变更", { cause })
    }
    await restorePreferences(data, ids, restore)
    return root.id
  })
}

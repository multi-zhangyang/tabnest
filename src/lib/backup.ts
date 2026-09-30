import {
  DEMO,
  defaultFolderId,
  fetchBookmarkData,
  mutateDemo,
  validateBookmarkData,
} from "./bookmarks"
import type { BookmarkData } from "./bookmarks"
import { AppError } from "./errors"
import { storedUrl, safeUrl } from "./urls"
import { beginOperation, checkpoint, finishOperation } from "./operations"
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
import { loadRecent, mergeRecent, validateRecent } from "./recent"
import type { RecentOpen } from "./recent"
import { readTheme, saveTheme } from "./theme-storage"
import { parseRecoveryFile } from "./recovery-file"

export type BackupPreferences = {
  settings: AppSettings
  clicks: Record<string, number>
  theme: "light" | "dark" | "system"
  recent?: RecentOpen[]
}
export type BackupData = BookmarkData & { preferences?: BackupPreferences }

export type BookmarkBackup = {
  format: "tabnest"
  version: 5
  exportedAt: string
  folders: BookmarkData["folders"]
  groups: BookmarkData["groups"]
  preferences?: BackupPreferences
}
export function createBackup(data: BackupData): BookmarkBackup {
  return {
    format: "tabnest",
    version: 5,
    exportedAt: new Date().toISOString(),
    ...data,
  }
}

export async function createFullBackup(data: BookmarkData) {
  const [settings, clicks, recent] = await Promise.all([
    loadSettings(),
    loadClicks(),
    loadRecent().catch(() => []),
  ])
  const storedTheme = readTheme()
  const theme =
    storedTheme === "light" || storedTheme === "system" ? storedTheme : "dark"
  return createBackup({
    ...data,
    preferences: { settings, clicks, recent, theme },
  })
}

export type ImportIssue = {
  id: string
  title: string
  url: string
  reason: string
  blocking: boolean
}
export type ImportPlan = {
  data: BackupData
  issues: ImportIssue[]
  format: "json" | "html" | "recovery"
  recoveryPreferences?: Partial<BackupPreferences>
  recoveryFailures?: string[]
}

export function parseBackup(text: string, issues?: ImportIssue[]): BackupData {
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
    ![2, 3, 4, 5].includes(record.version) ||
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
        index:
          Number.isInteger(folder.index) && Number(folder.index) >= 0
            ? folder.index
            : undefined,
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
      items: group.items.flatMap((item) => {
        if (item.title.length > 1024)
          throw new AppError("invalid-data", "书签名称过长")
        let url: string
        try {
          url = storedUrl(item.url)
        } catch (cause) {
          if (!issues) throw cause
          issues.push({
            id: item.id,
            title: item.title,
            url: item.url,
            reason: "网址无效",
            blocking: true,
          })
          return []
        }
        if (issues && !safeUrl(url))
          issues.push({
            id: item.id,
            title: item.title,
            url,
            reason: "仅保存",
            blocking: false,
          })
        return [
          {
            id: item.id,
            title: item.title,
            url,
            index:
              Number.isInteger(item.index) && Number(item.index) >= 0
                ? item.index
                : undefined,
            parentId: group.id,
            dateAdded: Number.isFinite(item.dateAdded)
              ? item.dateAdded
              : undefined,
          },
        ]
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
  if (Number(record.version) >= 4 && record.preferences !== undefined) {
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
      const key = safeUrl(url) || url
      clicks[key] = Math.max(clicks[key] || 0, count)
    }
    data.preferences = {
      settings: clampSettings(prefs.settings),
      clicks,
      theme: prefs.theme,
      ...(prefs.recent === undefined
        ? {}
        : { recent: validateRecent(prefs.recent) }),
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
    const { settings, clicks, theme, recent } = data.preferences
    await mergeClicks(clicks)
    if (recent) await mergeRecent(recent)
    await saveSettings({
      ...settings,
      activeFolderId: ids.get(settings.activeFolderId) || "",
      collapsedSections: settings.collapsedSections.flatMap((id) =>
        ids.has(id) ? [ids.get(id)!] : []
      ),
    })
    saveTheme(theme)
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
  restore = false,
  progress?: (completed: number, total: number) => void
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
            index: folder.index,
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
    const operation = await beginOperation("import", title)
    const created = new Set<string>()
    let root: chrome.bookmarks.BookmarkTreeNode | undefined
    const ids = new Map<string, string>()
    try {
      root = await chrome.bookmarks.create({
        title,
        ...(parentId ? { parentId } : {}),
      })
      created.add(root.id)
      operation.rootIds.push(root.id)
      await checkpoint(operation)
      const children = new Map<
        string,
        (
          | { kind: "folder"; value: BookmarkData["folders"][number] }
          | {
              kind: "bookmark"
              value: BookmarkData["groups"][number]["items"][number]
            }
        )[]
      >()
      const push = (
        parent: string,
        child: NonNullable<ReturnType<typeof children.get>>[number]
      ) => {
        const list = children.get(parent) || []
        list.push(child)
        children.set(parent, list)
      }
      for (const folder of data.folders)
        push(folder.parentId || "", { kind: "folder", value: folder })
      for (const group of data.groups)
        for (const item of group.items)
          push(group.id, { kind: "bookmark", value: item })
      const total =
        data.folders.length +
        data.groups.reduce((n, group) => n + group.items.length, 0)
      const createChildren = async (sourceId: string, targetId: string) => {
        const siblings = (children.get(sourceId) || []).sort(
          (a, b) =>
            (a.value.index ?? Number.MAX_SAFE_INTEGER) -
            (b.value.index ?? Number.MAX_SAFE_INTEGER)
        )
        for (const child of siblings) {
          const node = await chrome.bookmarks.create({
            parentId: targetId,
            title: child.value.title,
            ...(child.kind === "bookmark" ? { url: child.value.url } : {}),
          })
          created.add(node.id)
          operation.completed++
          if (operation.completed % 32 === 0) await checkpoint(operation)
          progress?.(operation.completed, total)
          if (child.kind === "folder") {
            ids.set(child.value.id, node.id)
            await createChildren(child.value.id, node.id)
          }
        }
      }
      await createChildren("", root.id)
    } catch (cause) {
      try {
        const tree = root ? await chrome.bookmarks.getSubTree(root.id) : []
        const owned = (node: chrome.bookmarks.BookmarkTreeNode): boolean =>
          created.has(node.id) && (node.children || []).every(owned)
        if (!tree.every(owned))
          throw new Error("Import folder was changed", { cause })
        if (root) await chrome.bookmarks.removeTree(root.id)
        await finishOperation(operation.id)
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
    try {
      await finishOperation(operation.id)
    } catch (cause) {
      throw new AppError("partial-write", "书签已导入，操作记录待检查", {
        cause,
      })
    }
    return root!.id
  })
}

export function planJsonImport(text: string): ImportPlan {
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024) throw new Error("文件不能超过 10 MB")
  const raw = JSON.parse(text)
  if (raw?.format === "tabnest-recovery") {
    const recovery = parseRecoveryFile(raw)
    const issues: ImportIssue[] = []
    const data = recovery.data.folders.length ? parseBackup(JSON.stringify(createBackup(recovery.data)), issues) : recovery.data
    return { data, issues, format: "recovery", recoveryPreferences: recovery.preferences, recoveryFailures: recovery.failures }
  }
  const issues: ImportIssue[] = []
  return { data: parseBackup(text, issues), issues, format: "json" }
}

export function executeImportPlan(
  plan: ImportPlan,
  parentId?: string,
  restore = false,
  skipped: string[] = [],
  progress?: (completed: number, total: number) => void
) {
  if (plan.format === "recovery") return executeRecoveryPlan(plan, parentId, restore, progress)
  const omit = new Set(skipped)
  return importBackup(
    {
      ...plan.data,
      groups: plan.data.groups.map((group) => ({
        ...group,
        items: group.items.filter((item) => !omit.has(item.id)),
      })),
    },
    parentId,
    restore,
    progress
  )
}
async function executeRecoveryPlan(plan: ImportPlan, parentId: string | undefined, restore: boolean, progress?: (completed: number, total: number) => void) {
  let root: string | undefined
  if (plan.data.folders.length) root = await importBackup(plan.data, parentId, false, progress)
  if (restore && plan.recoveryPreferences) {
    const { clicks, recent, settings, theme } = plan.recoveryPreferences
    try {
      if (clicks) await mergeClicks(clicks)
      if (recent) await mergeRecent(recent)
      if (settings) await saveSettings({ ...settings, activeFolderId: "", collapsedSections: [] })
      if (theme) { saveTheme(theme); window.dispatchEvent(new Event("tabnest:theme")) }
    } catch (cause) { throw new AppError("partial-write", "恢复未全部完成", { cause }) }
  }
  return root
}

import { isExtension } from "./platform"
import { parseBookmarkTree, validateBookmarkData } from "./bookmarks"
import type { BookmarkData } from "./bookmarks"
import { STORAGE_KEYS, SCHEMA_VERSION } from "./storage"
import { clampSettings, validateClicks } from "./preferences"
import { validateRecent } from "./recent"
import type { BackupPreferences } from "./backup"
export type RecoverySection = { status: "ok"; raw: unknown } | { status: "error"; error: string }
export type RecoveryFile = { format: "tabnest-recovery"; version: 1; exportedAt: string; sections: Record<string, RecoverySection> }
async function section(read: () => unknown | Promise<unknown>): Promise<RecoverySection> {
  try { return { status: "ok", raw: await read() } }
  catch { return { status: "error", error: "读取失败" } }
}
export async function createRecoveryFile(): Promise<RecoveryFile> {
  const entries = await Promise.all([
    section(() => isExtension ? chrome.bookmarks.getTree() : localStorage.getItem(STORAGE_KEYS.demo)),
    section(() => isExtension ? chrome.storage.local.get(null) : Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith("tabnest:")).map(k => [k, localStorage.getItem(k)]))),
    section(() => isExtension ? chrome.storage.sync.get(null) : {}),
    section(() => localStorage.getItem("theme")),
    section(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith("tabnest:")).map(k => [k, localStorage.getItem(k)]))),
  ])
  const sections = Object.fromEntries(["bookmarks", "local", "legacySync", "theme", "pageStorage"].map((key, i) => [key, entries[i]]))
  if (!entries.slice(0, 4).some(entry => entry.status === "ok" && entry.raw !== null)) throw new Error("恢复文件导出失败")
  return { format: "tabnest-recovery", version: 1, exportedAt: new Date().toISOString(), sections }
}
export function downloadRecoveryFile(file: RecoveryFile) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }))
  try {
    const link = document.createElement("a")
    link.href = url
    link.download = `TabNest-recovery-${new Date().toLocaleDateString("sv-SE")}.json`
    link.click()
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
export function parseRecoveryFile(raw: unknown): { data: BookmarkData; preferences: Partial<BackupPreferences>; failures: string[] } {
  const file = raw as RecoveryFile
  if (!file || file.format !== "tabnest-recovery" || file.version !== 1 || !file.sections || typeof file.sections !== "object") throw new Error("恢复文件无效")
  const failures: string[] = []
  const get = (key: string) => file.sections[key]?.status === "ok" ? (file.sections[key] as { raw: unknown }).raw : undefined
  const parse = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value
  const unwrap = (value: unknown) => {
    const doc = parse(value)
    if (doc && typeof doc === "object" && "schemaVersion" in doc) {
      if (doc.schemaVersion !== SCHEMA_VERSION || !Number.isSafeInteger(doc.revision) || doc.revision < 1 || !("data" in doc)) throw new Error("数据版本不兼容")
      return doc.data
    }
    return doc
  }
  let data: BookmarkData = { folders: [], groups: [] }
  try {
    const tree = parse(get("bookmarks"))
    if (Array.isArray(tree)) {
      const queue = tree.map(node => ({ node, depth: 0 }))
      const ids = new Set<string>()
      while (queue.length) {
        const { node, depth } = queue.pop()!
        if (!node || typeof node.id !== "string" || ids.has(node.id) || depth > 100 || ids.size > 25000 ||
            (node.children !== undefined && !Array.isArray(node.children))) throw new Error("书签树无效")
        ids.add(node.id)
        node.children?.forEach((child: unknown) => queue.push({ node: child, depth: depth + 1 }))
      }
      data = validateBookmarkData(parseBookmarkTree(tree))
    } else data = validateBookmarkData(unwrap(tree))
  } catch { failures.push("书签") }
  const local = get("local") as Record<string, unknown> | undefined
  const legacy = get("legacySync") as Record<string, unknown> | undefined
  const preferences: Partial<BackupPreferences> = {}
  const readPreference = (key: keyof typeof STORAGE_KEYS, apply: (value: unknown) => void) => {
    const stored = local?.[STORAGE_KEYS[key]] ?? legacy?.[STORAGE_KEYS[key]]
    if (stored === undefined) return
    try { apply(unwrap(stored)) } catch { failures.push(key === "settings" ? "设置" : key === "clicks" ? "热度" : "最近打开") }
  }
  readPreference("settings", value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("设置无效")
    preferences.settings = clampSettings(value)
  })
  readPreference("clicks", value => { preferences.clicks = validateClicks(value) })
  readPreference("recent", value => { preferences.recent = validateRecent(value) })
  const theme = get("theme")
  if (theme === "light" || theme === "dark" || theme === "system") preferences.theme = theme
  if (!data.folders.length && !Object.keys(preferences).length) throw new Error("没有可恢复的数据")
  return { data, preferences, failures }
}

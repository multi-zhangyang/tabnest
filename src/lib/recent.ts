import { readDocument, updateDocument, STORAGE_KEYS } from "./storage"
import { safeUrl } from "./urls"
import type { BookmarkItem } from "./types"

export type RecentOpen = { url: string; openedAt: number }
export function validateRecent(raw: unknown): RecentOpen[] {
  if (!Array.isArray(raw)) throw new Error("最近打开数据无效")
  const byUrl = new Map<string, RecentOpen>()
  for (const row of raw) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.url !== "string" ||
      !safeUrl(row.url) ||
      !Number.isSafeInteger(row.openedAt) ||
      row.openedAt < 0
    )
      continue
    const url = safeUrl(row.url)!
    if (!byUrl.has(url) || byUrl.get(url)!.openedAt < row.openedAt)
      byUrl.set(url, { url, openedAt: row.openedAt })
  }
  return [...byUrl.values()]
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, 50)
}
export const loadRecent = () =>
  readDocument(STORAGE_KEYS.recent, () => [], validateRecent)
export function recordRecent(url: string, openedAt = Date.now()) {
  return updateDocument(
    STORAGE_KEYS.recent,
    () => [],
    validateRecent,
    (current) => validateRecent([...current, { url, openedAt }])
  )
}
export function mergeRecent(incoming: RecentOpen[]) {
  const records = validateRecent(incoming)
  return updateDocument(
    STORAGE_KEYS.recent,
    () => [],
    validateRecent,
    (current) => validateRecent([...current, ...records])
  )
}
const bookmarkUrls = new WeakMap<BookmarkItem[], Map<string, BookmarkItem>>()
export function recentBookmarks(
  items: BookmarkItem[],
  recent: RecentOpen[],
  limit = 8
) {
  let byUrl = bookmarkUrls.get(items)
  if (!byUrl) {
    byUrl = new Map<string, BookmarkItem>()
    for (const item of items) {
      const key = safeUrl(item.url)
      if (key && !byUrl.has(key)) byUrl.set(key, item)
    }
    bookmarkUrls.set(items, byUrl)
  }
  return recent
    .flatMap((row) => (byUrl!.has(row.url) ? [byUrl!.get(row.url)!] : []))
    .slice(0, limit)
}

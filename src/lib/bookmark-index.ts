import type { BookmarkItem } from "./types"
import { safeUrl } from "./urls"

export const bookmarkUrlKey = (url: string) => safeUrl(url) ?? url

export function indexBookmarkUrls(items: BookmarkItem[]) {
  const index = new Map<string, BookmarkItem[]>()
  for (const item of items) {
    const key = bookmarkUrlKey(item.url)
    const matches = index.get(key)
    if (matches) matches.push(item)
    else index.set(key, [item])
  }
  return index
}

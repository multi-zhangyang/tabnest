import type { BookmarkFolder, BookmarkItem } from "./types"
import { pinyin } from "pinyin-pro"
import { normalizeSearch as normalize, queryTokens } from "./search-tokens"
export { queryTokens } from "./search-tokens"

const transliteration = (text: string) => {
  if (!/[\u3400-\u9fff]/.test(text)) return ""
  const words = pinyin(text, { toneType: "none", type: "array" })
  return normalize(`${words.join("")} ${words.map((word) => word[0]).join("")}`)
}

export function createSearchIndex(
  items: BookmarkItem[],
  folders: BookmarkFolder[]
) {
  const paths = new Map(
    folders.map((folder) => [folder.id, normalize(folder.path)])
  )
  const pathLatin = new Map(
    folders.map((folder) => [folder.id, transliteration(folder.path)])
  )
  return items.map((item) => ({
    item,
    title: normalize(item.title),
    latin: `${transliteration(item.title)} ${pathLatin.get(item.parentId || "") || ""}`,
    url: normalize(item.url),
    path: paths.get(item.parentId || "") || "",
  }))
}

export function createFolderSearchIndex(folders: BookmarkFolder[]) {
  return createSearchIndex(
    folders.map((folder) => ({
      id: folder.id,
      title: folder.title,
      parentId: folder.id,
      url: "",
    })),
    folders
  )
}

export function searchBookmarks(
  index: ReturnType<typeof createSearchIndex>,
  query: string
) {
  const tokens = queryTokens(query)
  if (!tokens.length) return index.map((entry) => entry.item)
  const phrase = tokens.join(" ")
  return index
    .flatMap((entry) => {
      let score =
        entry.title === phrase ? 100 : entry.title.startsWith(phrase) ? 40 : 0
      for (const token of tokens) {
        if (entry.title.includes(token)) score += 12
        else if (entry.url.includes(token)) score += 6
        else if (entry.path.includes(token)) score += 2
        else if (entry.latin.includes(token)) score += 4
        else return []
      }
      return [{ item: entry.item, score }]
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}

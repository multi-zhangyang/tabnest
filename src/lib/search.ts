import type { BookmarkFolder, BookmarkItem } from "./types"

const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase()
export const queryTokens = (query: string) =>
  normalize(query).trim().split(/\s+/).filter(Boolean)

export function createSearchIndex(
  items: BookmarkItem[],
  folders: BookmarkFolder[]
) {
  const paths = new Map(
    folders.map((folder) => [folder.id, normalize(folder.path)])
  )
  return items.map((item) => ({
    item,
    title: normalize(item.title),
    url: normalize(item.url),
    path: paths.get(item.parentId || "") || "",
  }))
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
        else return []
      }
      return [{ item: entry.item, score }]
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}

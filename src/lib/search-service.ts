import type { BookmarkFolder, BookmarkItem } from "./types"
import { compute } from "./compute-client"

type Matches = { items: BookmarkItem[]; folders: BookmarkFolder[] }
let revision = 0
let cached:
  | {
      items: BookmarkItem[]
      folders: BookmarkFolder[]
      search: (query: string) => Promise<Matches>
      ready: Promise<unknown>
    }
  | undefined
function prepare(items: BookmarkItem[], folders: BookmarkFolder[]) {
  if (cached?.items === items && cached.folders === folders) return cached
  const version = ++revision
  const byFolder = new Map(folders.map((folder) => [folder.id, folder]))
  if (items.length >= 1000 && typeof Worker !== "undefined") {
    const ready = compute<number>("search-index", {
      items,
      folders,
      revision: version,
    })
    const byId = new Map(items.map((item) => [item.id, item]))
    cached = {
      items,
      folders,
      ready,
      search: async (query) => {
        await ready
        const result = await compute<{
          revision: number
          ids: string[]
          folderIds: string[]
        }>("search", { query })
        if (result.revision !== version) return { items: [], folders: [] }
        return {
          items: result.ids.flatMap((id) =>
            byId.has(id) ? [byId.get(id)!] : []
          ),
          folders: result.folderIds.flatMap((id) =>
            byFolder.has(id) ? [byFolder.get(id)!] : []
          ),
        }
      },
    }
  } else {
    const ready = import("./search").then((module) => ({
      index: module.createSearchIndex(items, folders),
      folderIndex: module.createFolderSearchIndex(folders),
      run: module.searchBookmarks,
    }))
    cached = {
      items,
      folders,
      ready,
      search: async (query) => {
        const { index, folderIndex, run } = await ready
        return {
          items: run(index, query),
          folders: run(folderIndex, query).map((item) =>
            byFolder.get(item.id)!
          ),
        }
      },
    }
  }
  // A rejected preparation can be retried after a worker/storage failure.
  void cached.ready.catch(() => {
    if (revision === version) cached = undefined
  })
  return cached
}
export function warmSearch(items: BookmarkItem[], folders: BookmarkFolder[]) {
  return prepare(items, folders).ready
}
export function searchLibrary(
  items: BookmarkItem[],
  folders: BookmarkFolder[],
  query: string
): Promise<Matches> {
  if (!query.trim()) return Promise.resolve({ items, folders: [] })
  return prepare(items, folders).search(query)
}

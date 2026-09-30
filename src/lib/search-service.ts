import type { BookmarkFolder, BookmarkItem } from "./types"
import { compute, onComputeDispose, computeRetained } from "./compute-client"
import type { RecentOpen } from "./recent"

type Matches = { items: BookmarkItem[]; folders: BookmarkFolder[] }
let revision = 0
let idleTimer: ReturnType<typeof setTimeout> | undefined
let cached:
  | {
      items: BookmarkItem[]
      folders: BookmarkFolder[]
      search: (
        query: string,
        clicks?: Record<string, number>,
        recent?: RecentOpen[]
      ) => Promise<Matches>
      ready: Promise<unknown>
    }
  | undefined
onComputeDispose(() => {
  clearTimeout(idleTimer)
  cached = undefined
})
function releaseWhenIdle() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (computeRetained()) releaseWhenIdle()
    else cached = undefined
  }, 30000)
}
function prepare(items: BookmarkItem[], folders: BookmarkFolder[]) {
  if (cached?.items === items && cached.folders === folders) return cached
  const version = ++revision
  const byFolder = new Map(folders.map((folder) => [folder.id, folder]))
  if (items.length >= 1000 && typeof Worker !== "undefined") {
    const fallback = () =>
      import("./search").then((module) => ({
        index: module.createSearchIndex(items, folders),
        folderIndex: module.createFolderSearchIndex(folders),
        run: module.searchBookmarks,
      }))
    let local: ReturnType<typeof fallback> | undefined
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
      search: async (query, clicks, recent) => {
        try {
          await ready
          const result = await compute<{
            revision: number
            ids: string[]
            folderIds: string[]
          }>("search", { query, clicks, recent })
          if (result.revision !== version) return { items: [], folders: [] }
          return {
            items: result.ids.flatMap((id) =>
              byId.has(id) ? [byId.get(id)!] : []
            ),
            folders: result.folderIds.flatMap((id) =>
              byFolder.has(id) ? [byFolder.get(id)!] : []
            ),
          }
        } catch {
          local ??= fallback()
          const { index, folderIndex, run } = await local
          return {
            items: run(index, query, clicks, recent),
            folders: run(folderIndex, query).map((item) =>
              byFolder.get(item.id)!
            ),
          }
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
      search: async (query, clicks, recent) => {
        const { index, folderIndex, run } = await ready
        return {
          items: run(index, query, clicks, recent),
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
  return prepare(items, folders).ready.finally(releaseWhenIdle)
}
export function searchLibrary(
  items: BookmarkItem[],
  folders: BookmarkFolder[],
  query: string,
  clicks?: Record<string, number>,
  recent?: RecentOpen[]
): Promise<Matches> {
  if (!query.trim()) return Promise.resolve({ items, folders: [] })
  return prepare(items, folders)
    .search(query, clicks, recent)
    .finally(releaseWhenIdle)
}

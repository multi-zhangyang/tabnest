import type { BookmarkFolder, BookmarkGroup, BookmarkItem } from "./types"
export function createLibraryIndex(
  folders: BookmarkFolder[],
  groups: BookmarkGroup[]
) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const byGroup = new Map(groups.map((group) => [group.id, group]))
  const children = new Map<string, string[]>()
  for (const folder of folders) {
    const parent = folder.parentId || "",
      list = children.get(parent) || []
    list.push(folder.id)
    children.set(parent, list)
  }
  const counts = new Map<string, number>()
  const count = (id: string): number => {
    if (counts.has(id)) return counts.get(id)!
    counts.set(id, 0)
    const value =
      (byGroup.get(id)?.items.length || 0) +
      (children.get(id) || []).reduce((sum, child) => sum + count(child), 0)
    counts.set(id, value)
    return value
  }
  folders.forEach((folder) => count(folder.id))
  const subtree = (id: string) => {
    const ids = new Set<string>(),
      stack = [id]
    while (stack.length) {
      const current = stack.pop()!
      if (ids.has(current)) continue
      ids.add(current)
      stack.push(...(children.get(current) || []))
    }
    return ids
  }
  const collect = (id: string): BookmarkItem[] =>
    [...subtree(id)].flatMap((key) => byGroup.get(key)?.items || [])
  return { byId, byGroup, children, counts, subtree, collect }
}

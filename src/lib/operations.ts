import { readDocument, updateDocument } from "./storage"
import { withLock } from "./platform"
import type { BookmarkData } from "./bookmarks"
import { createLibraryIndex } from "./library-index"

export const OPERATIONS_KEY = "tabnest:operations:v1"
export type LocalOperation = {
  id: string
  kind: "import" | "restore"
  title: string
  startedAt: string
  rootIds: string[]
  sourceId?: string
  completed: number
}
function validate(raw: unknown): LocalOperation[] {
  if (
    !Array.isArray(raw) ||
    raw.some(
      (v) =>
        !v ||
        typeof v.id !== "string" ||
        !v.id ||
        !["import", "restore"].includes(v.kind) ||
        !Array.isArray(v.rootIds) ||
        typeof v.title !== "string" ||
        typeof v.startedAt !== "string" ||
        !Number.isFinite(Date.parse(v.startedAt)) ||
        !Number.isSafeInteger(v.completed) ||
        v.completed < 0 ||
        (v.sourceId !== undefined && typeof v.sourceId !== "string") ||
        v.rootIds.some((id: unknown) => typeof id !== "string" || !id)
    )
  )
    throw new Error("操作记录无效")
  if (new Set(raw.map((entry) => entry.id)).size !== raw.length)
    throw new Error("操作记录无效")
  return raw
}
export const loadOperations = () =>
  readDocument(OPERATIONS_KEY, () => [], validate, false)
export const loadPendingOperations = () => withLock("bookmarks", loadOperations)

export function inspectOperations(
  records: LocalOperation[],
  data: BookmarkData
) {
  const index = createLibraryIndex(data.folders, data.groups)
  const items = new Map(
    data.groups.flatMap((group) => group.items).map((item) => [item.id, item])
  )
  return records.map((record) => {
    const roots = record.rootIds.flatMap((id) => {
      const folder = index.byId.get(id),
        item = items.get(id)
      if (folder)
        return [
          {
            id,
            title: folder.path,
            locateId: id,
            count: index.subtree(id).size + index.collect(id).length,
          },
        ]
      if (item)
        return [
          { id, title: item.title, locateId: item.parentId || "", count: 1 },
        ]
      return []
    })
    return {
      record,
      roots,
      found: roots.reduce((sum, root) => sum + root.count, 0),
      missing: record.rootIds.length - roots.length,
    }
  })
}
export async function beginOperation(
  kind: LocalOperation["kind"],
  title: string,
  sourceId?: string
) {
  const operation: LocalOperation = {
    id: crypto.randomUUID(),
    kind,
    title,
    sourceId,
    startedAt: new Date().toISOString(),
    rootIds: [],
    completed: 0,
  }
  await updateDocument(
    OPERATIONS_KEY,
    () => [],
    validate,
    (entries) => [...entries, operation],
    false
  )
  return operation
}
export async function checkpoint(operation: LocalOperation) {
  await updateDocument(
    OPERATIONS_KEY,
    () => [],
    validate,
    (entries) =>
      entries.map((entry) => (entry.id === operation.id ? operation : entry)),
    false
  )
}
export async function finishOperation(id: string) {
  await updateDocument(
    OPERATIONS_KEY,
    () => [],
    validate,
    (entries) => entries.filter((entry) => entry.id !== id),
    false
  )
}
export function dismissOperation(id: string) {
  return withLock("bookmarks", () => finishOperation(id))
}

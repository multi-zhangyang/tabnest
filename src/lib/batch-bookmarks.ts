import { DEMO, fetchBookmarkData, mutateDemo } from "./bookmarks"
import type { BookmarkItem } from "./types"
import { withLock } from "./platform"
import { AppError } from "./errors"

export type MoveTarget = {
  parentId: string
  anchorId?: string
  after?: boolean
}
export function moveBookmarks(items: BookmarkItem[], target: MoveTarget) {
  return withLock("bookmarks", async () => {
    const data = await fetchBookmarkData()
    if (!data.folders.some((f) => f.id === target.parentId && !f.readOnly))
      throw new AppError("conflict", "目标文件夹不可写入")
    const byId = new Map(
      data.groups.flatMap((g) => g.items).map((item) => [item.id, item])
    )
    const ids = new Set(items.map((item) => item.id))
    if (!ids.size) return
    const originals = items.map((expected) => {
      const item = byId.get(expected.id)
      if (
        !item ||
        item.readOnly ||
        item.url !== expected.url ||
        item.title !== expected.title ||
        item.parentId !== expected.parentId
      )
        throw new AppError("conflict", "书签已变化，请重新选择")
      return item
    })
    if (target.anchorId && ids.has(target.anchorId)) return
    if (
      target.anchorId &&
      byId.get(target.anchorId)?.parentId !== target.parentId
    )
      throw new AppError("conflict", "目标书签已移动")
    if (DEMO) {
      await mutateDemo((current) => {
        const destination = current.groups.find(
          (g) => g.id === target.parentId
        )!
        current.groups.forEach((g) => {
          g.items = g.items.filter((item) => !ids.has(item.id))
        })
        let index = target.anchorId
          ? destination.items.findIndex((i) => i.id === target.anchorId) +
            (target.after ? 1 : 0)
          : destination.items.length
        index = Math.max(0, index)
        destination.items.splice(
          index,
          0,
          ...originals.map((item) => ({ ...item, parentId: target.parentId }))
        )
      })
      return
    }
    const moved: BookmarkItem[] = []
    let anchorId = target.anchorId
    let after = target.after
    try {
      for (const item of originals) {
        const siblings = await chrome.bookmarks.getChildren(target.parentId)
        const anchorIndex = anchorId
          ? siblings.findIndex((n) => n.id === anchorId)
          : siblings.length
        if (anchorIndex < 0) throw new AppError("conflict", "目标位置已变化")
        // Chrome uses the insertion boundary before removing a same-parent node.
        const index = anchorId ? anchorIndex + (after ? 1 : 0) : siblings.length
        await chrome.bookmarks.move(item.id, {
          parentId: target.parentId,
          index,
        })
        moved.push(item)
        anchorId = item.id
        after = true
      }
    } catch (cause) {
      try {
        for (const item of moved.sort(
          (a, b) => (a.index || 0) - (b.index || 0)
        )) {
          const [latest] = await chrome.bookmarks.get(item.id)
          if (
            latest.parentId !== target.parentId ||
            latest.title !== item.title ||
            latest.url !== item.url
          )
            throw new Error("Concurrent change", { cause })
          const siblings = await chrome.bookmarks.getChildren(item.parentId!)
          const currentIndex = siblings.findIndex((n) => n.id === item.id)
          const originalIndex = Math.min(item.index || 0, siblings.length)
          await chrome.bookmarks.move(item.id, {
            parentId: item.parentId,
            index:
              originalIndex +
              (currentIndex >= 0 && currentIndex < originalIndex ? 1 : 0),
          })
        }
      } catch {
        throw new AppError("partial-write", "部分书签已移动，请检查文件夹", {
          cause,
        })
      }
      throw new AppError("operation", "移动失败，原位置已恢复", { cause })
    }
  })
}

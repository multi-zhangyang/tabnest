import { useState } from "react"
import { toast } from "sonner"
import type { BookmarkActions } from "@/components/bookmark-card"
import type { FolderEditorState } from "@/components/folder-editor"
import type { AppSettings, BookmarkFolder, BookmarkItem } from "@/lib/types"
import { DEMO, moveBookmark, safeUrl } from "@/lib/bookmarks"
import type { BookmarkData } from "@/lib/bookmarks"
import { createBackup, createFullBackup } from "@/lib/backup"
import { descendants, folderSnapshot } from "@/lib/folders"
import { deleteToRecovery, restoreDeleted } from "@/lib/recovery"
import type { OpenTarget } from "@/lib/navigation"

type Overlay =
  | { type: "bookmark"; item?: BookmarkItem; parentId?: string }
  | ({ type: "folder" } & FolderEditorState)
  | { type: "delete-bookmark"; item: BookmarkItem }
  | { type: "delete-many"; items: BookmarkItem[] }
  | {
      type: "delete-folder"
      folder: BookmarkFolder
      snapshot: string
      count: number
    }
  | { type: "open-group"; items: BookmarkItem[] }
  | { type: "import" }
  | null

export function useLibraryActions({
  data,
  settings,
  patchSettings,
  recordClick,
  reload,
}: {
  data: BookmarkData
  settings: AppSettings
  patchSettings: (patch: Partial<AppSettings>) => void
  recordClick: (url: string) => Promise<void>
  reload: () => Promise<void>
}) {
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [busy, setBusy] = useState(false)
  function open(
    item: BookmarkItem,
    target: OpenTarget = settings.newTab ? "foreground" : "current"
  ) {
    const url = safeUrl(item.url)
    if (!url) {
      toast.error("无法打开此网址")
      return
    }
    if (target !== "current") {
      const record = () =>
        recordClick(item.url).catch(() => toast.error("热度保存失败"))
      if (!DEMO) {
        const opening =
          target === "window"
            ? chrome.windows.create({ url, focused: true })
            : chrome.tabs.create({ url, active: target === "foreground" })
        void opening.then(record, () => toast.error("无法打开此网址"))
      } else {
        window.open(
          url,
          "_blank",
          target === "window"
            ? "noopener,noreferrer,popup"
            : "noopener,noreferrer"
        )
        void record()
      }
    } else {
      void recordClick(item.url)
        .catch(() => {})
        .finally(() => window.location.assign(url))
    }
  }
  const actions: BookmarkActions = {
    open,
    edit: (item) => setOverlay({ type: "bookmark", item }),
    remove: (item) => setOverlay({ type: "delete-bookmark", item }),
    copy: (url) => {
      void navigator.clipboard.writeText(url).then(
        () => toast.success("网址已复制"),
        () => toast.error("复制失败")
      )
    },
    move: (item, direction) => {
      void moveBookmark(item, direction)
        .then(async () => {
          patchSettings({ sort: "default" })
          await reload()
        })
        .catch((cause) =>
          toast.error(cause instanceof Error ? cause.message : "操作失败")
        )
    },
  }
  function deleteFolder(folder: BookmarkFolder) {
    const ids = descendants(data.folders, folder.id)
    setOverlay({
      type: "delete-folder",
      folder,
      snapshot: folderSnapshot(data, folder.id),
      count: data.groups
        .filter((group) => ids.has(group.id))
        .reduce((sum, group) => sum + group.items.length, 0),
    })
  }
  async function confirmDelete() {
    if (
      busy ||
      (overlay?.type !== "delete-bookmark" &&
        overlay?.type !== "delete-folder" &&
        overlay?.type !== "delete-many")
    )
      return
    setBusy(true)
    try {
      const entry = await deleteToRecovery(
        overlay.type === "delete-folder"
          ? { folderId: overlay.folder.id, snapshot: overlay.snapshot }
          : {
              items:
                overlay.type === "delete-many" ? overlay.items : [overlay.item],
            }
      )
      await reload()
      toast.success(
        overlay.type === "delete-folder" ? "文件夹已删除" : "书签已删除",
        {
          duration: 8000,
          action: {
            label: "撤销",
            onClick: () => {
              void restoreDeleted(entry.id)
                .then(reload)
                .then(
                  () => toast.success("已恢复"),
                  (cause) =>
                    toast.error(
                      cause instanceof Error ? cause.message : "恢复失败"
                    )
                )
            },
          },
        }
      )
      setOverlay(null)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "删除失败")
      if (overlay.type === "delete-folder") setOverlay(null)
    } finally {
      setBusy(false)
    }
  }
  async function exportBookmarks(full = false) {
    try {
      const backup = full ? await createFullBackup(data) : createBackup(data)
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: "application/json",
        })
      )
      const link = document.createElement("a")
      link.href = url
      link.download = `TabNest-${new Date().toLocaleDateString("sv-SE")}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success(full ? "完整备份已导出" : "书签已导出")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "导出失败")
    }
  }
  return {
    actions,
    overlay,
    busy,
    confirmDelete,
    deleteFolder,
    deleteMany: (items: BookmarkItem[]) =>
      setOverlay({ type: "delete-many", items }),
    exportBookmarks: () => {
      void exportBookmarks()
    },
    exportFullBackup: () => {
      void exportBookmarks(true)
    },
    add: (parentId?: string) => setOverlay({ type: "bookmark", parentId }),
    editFolder: (state: FolderEditorState) =>
      setOverlay({ type: "folder", ...state }),
    importBookmarks: () => setOverlay({ type: "import" }),
    close: () => {
      if (!busy) setOverlay(null)
    },
    openGroup: (items: BookmarkItem[]) => {
      if (items.length > 8) setOverlay({ type: "open-group", items })
      else items.forEach((item) => open(item, "background"))
    },
    confirmOpen: () => {
      if (overlay?.type === "open-group") {
        overlay.items.forEach((item) => open(item, "background"))
        setOverlay(null)
      }
    },
  }
}

export type LibraryActions = ReturnType<typeof useLibraryActions>

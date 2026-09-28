import { lazy, Suspense } from "react"
import { LoaderCircle } from "lucide-react"
import type { LibraryActions } from "@/hooks/use-library-actions"
import type { BookmarkFolder } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const BookmarkEditor = lazy(() =>
  import("./bookmark-editor").then((module) => ({
    default: module.BookmarkEditor,
  }))
)
const FolderEditor = lazy(() =>
  import("./folder-editor").then((module) => ({ default: module.FolderEditor }))
)
const ImportDialog = lazy(() =>
  import("./import-dialog").then((module) => ({ default: module.ImportDialog }))
)

export function LibraryDialogs({
  library,
  folders,
  reload,
}: {
  library: LibraryActions
  folders: BookmarkFolder[]
  reload: () => Promise<void>
}) {
  const { overlay, busy, close } = library
  if (!overlay) return null
  if (
    overlay.type === "delete-bookmark" ||
    overlay.type === "delete-folder" ||
    overlay.type === "delete-many"
  )
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {library.permanentConfirm
                ? "永久删除？此操作无法撤销"
                : library.capacityExceeded
                  ? "所选内容超过恢复容量"
                  : overlay.type === "delete-folder"
                    ? "删除文件夹？"
                    : "删除书签？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {overlay.type === "delete-folder"
                ? `${overlay.folder.title} · ${overlay.count} 个书签（包含子文件夹）`
                : overlay.type === "delete-many"
                  ? `${overlay.items.length} 个书签`
                  : overlay.item.title}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            {library.capacityExceeded && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={library.exportSelection}
              >
                导出所选
              </Button>
            )}
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (library.capacityExceeded && !library.permanentConfirm)
                  library.setPermanentConfirm(true)
                else void library.confirmDelete(library.permanentConfirm)
              }}
            >
              {busy && (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
              )}
              {library.capacityExceeded ? "永久删除" : "删除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  if (overlay.type === "open-group")
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              打开 {overlay.items.length} 个标签页？
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={library.confirmOpen}>
              全部打开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  return (
    <Suspense fallback={null}>
      {overlay.type === "bookmark" && (
        <BookmarkEditor
          item={overlay.item}
          initialParentId={overlay.parentId}
          folders={folders}
          onClose={close}
          onSaved={reload}
        />
      )}
      {overlay.type === "folder" && (
        <FolderEditor
          {...overlay}
          folders={folders}
          onClose={close}
          onSaved={reload}
        />
      )}
      {overlay.type === "import" && (
        <ImportDialog folders={folders} onClose={close} onSaved={reload} />
      )}
    </Suspense>
  )
}

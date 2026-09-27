import { useState } from "react"
import { toast } from "sonner"
import { EditorDialog } from "./editor-dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { FolderPicker } from "./folder-picker"
import { createFolder, defaultFolderId } from "@/lib/bookmarks"
import { descendants, updateFolder } from "@/lib/folders"
import { errorMessage } from "@/lib/errors"
import type { BookmarkFolder } from "@/lib/types"

export type FolderEditorState = {
  folder?: BookmarkFolder
  parentId?: string
  moving?: boolean
}
export function FolderEditor({
  folder,
  parentId: initialParent,
  moving,
  folders,
  onClose,
  onSaved,
}: FolderEditorState & {
  folders: BookmarkFolder[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [title, setTitle] = useState(folder?.title || "")
  const [parentId, setParentId] = useState(
    folder?.parentId || initialParent || defaultFolderId(folders)
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const excluded = folder ? descendants(folders, folder.id) : new Set<string>()
  async function submit() {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      if (folder)
        await updateFolder({
          id: folder.id,
          title,
          parentId: parentId || undefined,
          expected: folder,
        })
      else await createFolder(title, parentId || undefined)
      await onSaved()
      toast.success(folder ? "文件夹已更新" : "文件夹已创建")
      onClose()
    } catch (cause) {
      setError(errorMessage(cause, "保存失败"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <EditorDialog
      title={folder ? (moving ? "移动文件夹" : "编辑文件夹") : "新建文件夹"}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
    >
      <FieldGroup>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="folder-title">名称</FieldLabel>
          <Input
            id="folder-title"
            autoFocus={!moving}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
            required
            maxLength={1024}
            aria-invalid={!!error}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="folder-parent">位置</FieldLabel>
          <FolderPicker
            id="folder-parent"
            folders={folders.filter((item) => !excluded.has(item.id))}
            value={parentId}
            onChange={setParentId}
            disabled={busy}
          />
        </Field>
        {error && <FieldError role="alert">{error}</FieldError>}
      </FieldGroup>
    </EditorDialog>
  )
}

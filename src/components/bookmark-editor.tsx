import { useState } from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { EditorDialog } from "./editor-dialog"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { FolderPicker } from "./folder-picker"
import {
  createFolder,
  defaultFolderId,
  normalizeUrl,
  saveBookmark,
} from "@/lib/bookmarks"
import type { BookmarkFolder, BookmarkItem } from "@/lib/types"
import { errorMessage } from "@/lib/errors"

export function BookmarkEditor({
  item,
  folders,
  onClose,
  onSaved,
  initialParentId,
}: {
  item?: BookmarkItem
  folders: BookmarkFolder[]
  onClose: () => void
  onSaved: () => Promise<void>
  initialParentId?: string
}) {
  const [title, setTitle] = useState(item?.title || "")
  const [url, setUrl] = useState(item?.url || "")
  const [parentId, setParentId] = useState(
    item?.parentId || initialParentId || defaultFolderId(folders)
  )
  const [newFolder, setNewFolder] = useState(false)
  const [folderName, setFolderName] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const normalized = normalizeUrl(url)
      let target = parentId
      if (newFolder) {
        target = await createFolder(folderName, parentId)
        setParentId(target)
        setNewFolder(false)
        await onSaved()
      }
      await saveBookmark({
        id: item?.id,
        title,
        url: normalized,
        parentId: target,
        expected: item,
      })
      await onSaved()
      toast.success(item ? "书签已更新" : "书签已添加")
      onClose()
    } catch (cause) {
      setError(errorMessage(cause, "保存失败，请重试"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <EditorDialog
      title={item ? "编辑书签" : "新建书签"}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
    >
      <FieldGroup>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="bookmark-url">网址</FieldLabel>
          <Input
            id="bookmark-url"
            placeholder="https://"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            autoFocus
            autoComplete="off"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={error ? "bookmark-error" : undefined}
            disabled={busy}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="bookmark-title">名称</FieldLabel>
          <Input
            id="bookmark-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
            autoComplete="off"
            maxLength={1024}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="bookmark-folder">文件夹</FieldLabel>
          <ButtonGroup className="folder-picker-group" aria-label="书签文件夹">
            <FolderPicker
              id="bookmark-folder"
              folders={folders}
              value={parentId}
              onChange={setParentId}
              disabled={busy}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="新建子文件夹"
              aria-pressed={newFolder}
              aria-expanded={newFolder}
              aria-controls={newFolder ? "new-folder-field" : undefined}
              onClick={() => setNewFolder(!newFolder)}
              disabled={busy}
            >
              <Plus />
            </Button>
          </ButtonGroup>
        </Field>
        {newFolder && (
          <Field id="new-folder-field">
            <FieldLabel htmlFor="folder-name">子文件夹名称</FieldLabel>
            <Input
              id="folder-name"
              autoFocus
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              disabled={busy}
              required
              maxLength={1024}
            />
          </Field>
        )}
        {error && (
          <FieldError id="bookmark-error" role="alert">
            {error}
          </FieldError>
        )}
      </FieldGroup>
    </EditorDialog>
  )
}

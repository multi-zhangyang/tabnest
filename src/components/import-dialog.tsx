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
import { Badge } from "@/components/ui/badge"
import { FolderPicker } from "./folder-picker"
import { defaultFolderId } from "@/lib/bookmarks"
import type { BackupData } from "@/lib/backup"
import { Switch } from "@/components/ui/switch"
import type { BookmarkFolder } from "@/lib/types"
import { importBackup, parseBackup } from "@/lib/backup"
import { errorMessage } from "@/lib/errors"

export function ImportDialog({
  folders,
  onClose,
  onSaved,
}: {
  folders: BookmarkFolder[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [data, setData] = useState<BackupData | null>(null)
  const [restore, setRestore] = useState(false)
  const [parentId, setParentId] = useState(defaultFolderId(folders))
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState("")
  async function load(file?: File) {
    setData(null)
    setRestore(false)
    setError("")
    if (!file) return
    setReading(true)
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("文件不能超过 10 MB")
      setData(parseBackup(await file.text()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文件读取失败")
    } finally {
      setReading(false)
    }
  }
  async function submit() {
    if (!data || busy) return
    setBusy(true)
    setError("")
    try {
      await importBackup(data, parentId || undefined, restore)
      await onSaved()
      toast.success("书签已导入")
      onClose()
    } catch (cause) {
      if (
        cause instanceof Error &&
        "code" in cause &&
        cause.code === "partial-write"
      ) {
        await onSaved()
        toast.error(cause.message)
        onClose()
        return
      }
      setError(errorMessage(cause, "导入失败"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <EditorDialog
      title="导入书签"
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="导入为新文件夹"
      submitDisabled={reading || !data}
    >
      <FieldGroup>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="backup-file">TabNest 备份</FieldLabel>
          <Input
            id="backup-file"
            type="file"
            accept=".json,application/json"
            onChange={(event) => void load(event.target.files?.[0])}
            disabled={busy || reading}
            aria-invalid={!!error}
          />
        </Field>
        {data && (
          <div className="flex gap-2">
            <Badge variant="secondary">{data.folders.length} 个文件夹</Badge>
            <Badge variant="secondary">
              {data.groups.reduce((sum, group) => sum + group.items.length, 0)}{" "}
              个书签
            </Badge>
          </div>
        )}
        <Field>
          <FieldLabel htmlFor="import-parent">导入位置</FieldLabel>
          <FolderPicker
            id="import-parent"
            folders={folders}
            value={parentId}
            onChange={setParentId}
            disabled={busy}
          />
        </Field>
        {error && <FieldError role="alert">{error}</FieldError>}
        {data?.preferences && (
          <Field orientation="horizontal">
            <FieldLabel htmlFor="restore-preferences">
              同时恢复热度与设置
            </FieldLabel>
            <Switch
              id="restore-preferences"
              checked={restore}
              onCheckedChange={setRestore}
              disabled={busy}
            />
          </Field>
        )}
      </FieldGroup>
    </EditorDialog>
  )
}

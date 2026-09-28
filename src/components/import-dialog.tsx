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
import type { ImportPlan } from "@/lib/backup"
import { Switch } from "@/components/ui/switch"
import type { BookmarkFolder } from "@/lib/types"
import { executeImportPlan, planJsonImport } from "@/lib/backup"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
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
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const data = plan?.data
  const [skipped, setSkipped] = useState<string[]>([])
  const [progress, setProgress] = useState(0)
  const [restore, setRestore] = useState(false)
  const [parentId, setParentId] = useState(defaultFolderId(folders))
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState("")
  async function load(file?: File) {
    setPlan(null)
    setSkipped([])
    setRestore(false)
    setError("")
    if (!file) return
    setReading(true)
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("文件不能超过 10 MB")
      const source = await file.text()
      const next =
        /\.html?$/i.test(file.name) || /^\s*</.test(source)
          ? (await import("@/lib/html-bookmarks")).planHtmlImport(source)
          : planJsonImport(source)
      setPlan(next)
      setSkipped(
        next.issues.filter((issue) => issue.blocking).map((issue) => issue.id)
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文件读取失败")
    } finally {
      setReading(false)
    }
  }
  async function submit() {
    if (!plan || busy) return
    setBusy(true)
    setError("")
    try {
      await executeImportPlan(
        plan,
        parentId || undefined,
        restore,
        skipped,
        (done, total) => {
          if (done % 16 === 0 || done === total)
            setProgress(total ? (done / total) * 100 : 100)
        }
      )
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
          <FieldLabel htmlFor="backup-file">书签文件</FieldLabel>
          <Input
            id="backup-file"
            type="file"
            accept=".json,.html,.htm,application/json,text/html"
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
        {!!plan?.issues.length && (
          <div className="import-issues">
            {plan.issues.map((issue) => (
              <label className="import-issue" key={issue.id}>
                <Checkbox
                  checked={skipped.includes(issue.id)}
                  disabled={busy || issue.blocking}
                  aria-label={`跳过 ${issue.title}`}
                  onCheckedChange={(checked) =>
                    setSkipped((current) =>
                      checked
                        ? [...current, issue.id]
                        : current.filter((id) => id !== issue.id)
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{issue.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {issue.url}
                  </span>
                </span>
                <Badge variant="secondary">
                  {skipped.includes(issue.id) ? "跳过" : issue.reason}
                </Badge>
              </label>
            ))}
          </div>
        )}
        {busy && <Progress value={progress} aria-label="导入进度" />}
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

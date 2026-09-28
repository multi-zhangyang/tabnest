import { useEffect, useState } from "react"
import { ArrowUpRight, Check, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  clearRecovery,
  loadRecovery,
  restoreDeleted,
  recoveryBytes,
  RECOVERY_LIMIT,
} from "@/lib/recovery"
import type { RecoveryEntry } from "@/lib/recovery"
import {
  dismissOperation,
  inspectOperations,
  loadOperations,
  OPERATIONS_KEY,
} from "@/lib/operations"
import { fetchBookmarkData } from "@/lib/bookmarks"
import type { LocalOperation } from "@/lib/operations"
import { subscribeStorage } from "@/lib/storage"

export default function RecoveryDialog({
  onClose,
  onRestored,
  onLocate,
}: {
  onClose: () => void
  onRestored: () => Promise<void>
  onLocate?: (id: string) => void
}) {
  const [entries, setEntries] = useState<RecoveryEntry[] | null>(null)
  const [operations, setOperations] = useState<LocalOperation[]>([])
  const [reviews, setReviews] = useState<ReturnType<typeof inspectOperations>>(
    []
  )
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [removing, setRemoving] = useState<string | null>(null)
  useEffect(() => {
    let alive = true,
      request = 0
    const refresh = () => {
      const version = ++request
      void Promise.all([
        loadRecovery(),
        loadOperations(),
        fetchBookmarkData(),
      ]).then(
        ([records, operations, data]) => {
          if (alive && version === request) {
            setEntries(records)
            setOperations(operations)
            setReviews(inspectOperations(operations, data))
            setError("")
          }
        },
        (cause) => {
          if (alive && version === request)
            setError(cause instanceof Error ? cause.message : "读取失败")
        }
      )
    }
    refresh()
    const unsubscribe = subscribeStorage((keys) => {
      if (
        keys.some((key) => ["tabnest:deleted:v1", OPERATIONS_KEY].includes(key))
      )
        refresh()
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  async function run(id: string, action: () => Promise<unknown>) {
    setBusy(id)
    try {
      await action()
      await onRestored()
      setEntries(await loadRecovery())
      const pending = await loadOperations()
      setOperations(pending)
      setReviews(inspectOperations(pending, await fetchBookmarkData()))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败")
    } finally {
      setBusy("")
      setRemoving(null)
    }
  }
  const bytes = recoveryBytes(entries || [])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="recovery-dialog"
        aria-describedby={undefined}
        closeDisabled={!!busy}
      >
        <DialogHeader>
          <DialogTitle>最近删除</DialogTitle>
        </DialogHeader>
        <div className="recovery-capacity">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {entries?.length || 0} / 20 · {(bytes / 1024 / 1024).toFixed(2)} /
              4 MB
            </span>
            <Button
              size="xs"
              variant="ghost"
              disabled={!!busy || !entries?.length}
              onClick={() => setRemoving("all")}
            >
              清空
            </Button>
          </div>
          <Progress
            value={(bytes / RECOVERY_LIMIT) * 100}
            aria-label="恢复空间"
          />
        </div>
        <div className="recovery-list">
          {reviews.map(({ record, roots, found, missing }) => (
            <div className="recovery-row" key={record.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate">{record.title}</p>
                <Badge variant="secondary">
                  待检查 · 已找到 {found} 项
                  {missing ? ` · ${missing} 项缺失` : ""}
                </Badge>
                {roots.map((root) => (
                  <p
                    key={root.id}
                    className="truncate text-xs text-muted-foreground"
                    title={root.title}
                  >
                    {root.title}
                  </p>
                ))}
              </div>
              {roots[0]?.locateId && onLocate && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="定位操作结果"
                  onClick={() => onLocate(roots[0].locateId)}
                >
                  <ArrowUpRight />
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() =>
                  void run(record.id, () => dismissOperation(record.id))
                }
              >
                <Check data-icon="inline-start" />
                已检查
              </Button>
            </div>
          ))}
          {error ? (
            <p role="alert">{error}</p>
          ) : !entries ? (
            <Skeleton className="h-20" />
          ) : !entries.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>没有待恢复的内容</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            entries.map((entry) => (
              <div className="recovery-row" key={entry.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate" title={entry.title}>
                    {entry.title}
                  </p>
                  <time dateTime={entry.deletedAt}>
                    {new Date(entry.deletedAt).toLocaleString()}
                  </time>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !!busy ||
                    operations.some(
                      (operation) => operation.sourceId === entry.id
                    )
                  }
                  onClick={() =>
                    void run(entry.id, async () => {
                      await restoreDeleted(entry.id)
                      toast.success("已恢复")
                    })
                  }
                >
                  <RotateCcw data-icon="inline-start" />
                  {busy === entry.id ? "恢复中" : "恢复"}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={!!busy}
                  aria-label={`移除恢复记录 ${entry.title}`}
                  onClick={() => setRemoving(entry.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null)
        }}
      >
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removing === "all" ? "清空恢复记录？" : "移除恢复记录？"}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!!busy}
              onClick={() =>
                void run("clear", () =>
                  clearRecovery(removing === "all" ? undefined : removing!)
                )
              }
            >
              确认移除
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

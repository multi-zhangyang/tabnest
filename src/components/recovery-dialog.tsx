import { useEffect, useState } from "react"
import { RotateCcw } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { loadRecovery, restoreDeleted } from "@/lib/recovery"
import type { RecoveryEntry } from "@/lib/recovery"
import { subscribeStorage } from "@/lib/storage"

export default function RecoveryDialog({
  onClose,
  onRestored,
}: {
  onClose: () => void
  onRestored: () => Promise<void>
}) {
  const [entries, setEntries] = useState<RecoveryEntry[] | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  useEffect(() => {
    let alive = true
    let request = 0
    const refresh = () => {
      const version = ++request
      void loadRecovery().then(
        (value) => {
          if (alive && version === request) {
            setEntries(value)
            setError("")
          }
        },
        (cause) => {
          if (alive)
            setError(cause instanceof Error ? cause.message : "读取失败")
        }
      )
    }
    refresh()
    const unsubscribe = subscribeStorage((keys) => {
      if (keys.includes("tabnest:deleted:v1")) refresh()
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
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
        <div className="recovery-list">
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
                <div className="min-w-0">
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
                  disabled={!!busy}
                  onClick={() => {
                    setBusy(entry.id)
                    void restoreDeleted(entry.id)
                      .then(async () => {
                        await onRestored()
                        setEntries(await loadRecovery())
                        toast.success("已恢复")
                      })
                      .catch((cause) =>
                        toast.error(
                          cause instanceof Error ? cause.message : "恢复失败"
                        )
                      )
                      .finally(() => setBusy(""))
                  }}
                >
                  <RotateCcw data-icon="inline-start" />
                  {busy === entry.id ? "恢复中" : "恢复"}
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

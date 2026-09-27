import type { ReactNode } from "react"
import { LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function EditorDialog({
  title,
  children,
  busy,
  onClose,
  onSubmit,
  submitLabel = "保存",
  submitDisabled = false,
}: {
  title: string
  children: ReactNode
  busy: boolean
  onClose: () => void
  onSubmit: () => Promise<void>
  submitLabel?: string
  submitDisabled?: boolean
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="editor-dialog"
        closeDisabled={busy}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="editor-form"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy && !submitDisabled) void onSubmit()
          }}
        >
          <div className="editor-body">{children}</div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy || submitDisabled}>
              {busy && (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
              )}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

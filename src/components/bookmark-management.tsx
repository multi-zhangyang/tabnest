/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { DragEvent, ReactNode } from "react"
import { CheckCheck, FolderInput, ListChecks, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Toaster } from "@/components/ui/sonner"
import { EditorDialog } from "./editor-dialog"
import { FolderPicker } from "./folder-picker"
import type { BookmarkFolder, BookmarkItem } from "@/lib/types"
import type { MoveTarget } from "@/lib/batch-bookmarks"
import { moveBookmarks } from "@/lib/batch-bookmarks"

function useManagementState(
  items: BookmarkItem[],
  folders: BookmarkFolder[],
  onMoved: () => Promise<void>,
  onDelete: (items: BookmarkItem[]) => void
) {
  const [active, setActive] = useState(false)
  const [ids, setIds] = useState<Set<string>>(() => new Set())
  const [moving, setMoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState("")
  const [error, setError] = useState("")
  const [drop, setDrop] = useState("")
  const dragging = useRef<BookmarkItem[]>([])
  const operation = useRef(false)
  const selected = useMemo(
    () => items.filter((i) => ids.has(i.id) && !i.readOnly),
    [items, ids]
  )
  const selectedIds = useMemo(
    () => new Set(selected.map((i) => i.id)),
    [selected]
  )
  const clear = () => {
    setActive(false)
    setIds(new Set())
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"]'
        )
      ) {
        setActive(false)
        setIds(new Set())
      }
    }
    window.addEventListener("keydown", escape)
    return () => window.removeEventListener("keydown", escape)
  }, [])
  function toggle(item: BookmarkItem) {
    if (item.readOnly || busy) return
    setActive(true)
    setIds((previous) => {
      const next = new Set(previous)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
  }
  async function move(items: BookmarkItem[], target: MoveTarget) {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    try {
      await moveBookmarks(items, target)
      await onMoved()
      clear()
      setMoving(false)
      toast.success("书签已移动")
    } finally {
      operation.current = false
      setBusy(false)
    }
  }
  function dragStart(event: DragEvent, item: BookmarkItem) {
    if (item.readOnly || busy) {
      event.preventDefault()
      return
    }
    dragging.current = selectedIds.has(item.id) ? selected : [item]
    event.dataTransfer.setData(
      "application/x-tabnest-bookmarks",
      dragging.current.map((i) => i.id).join(",")
    )
    event.dataTransfer.effectAllowed = "move"
  }
  function dragOver(event: DragEvent, key: string, readOnly = false) {
    if (readOnly || busy || !dragging.current.length) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = "move"
    setDrop(key)
  }
  function dropOn(event: DragEvent, target: MoveTarget, readOnly = false) {
    if (readOnly || !dragging.current.length) return
    event.preventDefault()
    event.stopPropagation()
    const items = dragging.current
    dragging.current = []
    setDrop("")
    void move(items, target).catch((cause) =>
      toast.error(cause instanceof Error ? cause.message : "移动失败")
    )
  }
  return {
    active,
    selected,
    selectedIds,
    toggle,
    clear,
    busy,
    moving,
    setMoving,
    target,
    setTarget,
    error,
    setError,
    move,
    drop,
    dragStart,
    dragOver,
    dropOn,
    dragEnd: () => {
      dragging.current = []
      setDrop("")
    },
    start: () => setActive(true),
    selectAll: () =>
      setIds(new Set(items.filter((i) => !i.readOnly).map((i) => i.id))),
    remove: () => onDelete(selected),
    folders,
  }
}
type Management = ReturnType<typeof useManagementState>
const Context = createContext<Management | null>(null)
export const useBookmarkManagement = () => useContext(Context)

export function BookmarkManagement({
  items,
  folders,
  onMoved,
  onDelete,
  children,
}: {
  items: BookmarkItem[]
  folders: BookmarkFolder[]
  onMoved: () => Promise<void>
  onDelete: (items: BookmarkItem[]) => void
  children: ReactNode
}) {
  const value = useManagementState(items, folders, onMoved, onDelete)
  return (
    <Context.Provider value={value}>
      {children}
      {value.active && (
        <section className="management-bar" aria-label="书签选择">
          <div
            className="flex flex-wrap items-center gap-2"
            role="toolbar"
            aria-label="批量书签操作"
          >
            <span aria-live="polite">已选 {value.selected.length}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={value.selectAll}
              disabled={value.busy}
            >
              <CheckCheck data-icon="inline-start" />
              全选
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!value.selected.length || value.busy}
              onClick={() => {
                value.setTarget("")
                value.setError("")
                value.setMoving(true)
              }}
            >
              <FolderInput data-icon="inline-start" />
              移动
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!value.selected.length || value.busy}
              onClick={value.remove}
            >
              <Trash2 data-icon="inline-start" />
              删除
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="退出多选"
              disabled={value.busy}
              onClick={value.clear}
            >
              <X />
            </Button>
          </div>
        </section>
      )}
      {value.moving && (
        <EditorDialog
          title={`移动 ${value.selected.length} 个书签`}
          busy={value.busy}
          onClose={() => value.setMoving(false)}
          submitLabel="移动"
          submitDisabled={!value.target || !value.selected.length}
          onSubmit={async () => {
            value.setError("")
            try {
              await value.move(value.selected, { parentId: value.target })
            } catch (cause) {
              value.setError(
                cause instanceof Error ? cause.message : "移动失败"
              )
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="batch-parent">目标文件夹</FieldLabel>
              <FolderPicker
                id="batch-parent"
                folders={folders}
                value={value.target}
                onChange={value.setTarget}
                disabled={value.busy}
              />
            </Field>
            {value.error && <FieldError role="alert">{value.error}</FieldError>}
          </FieldGroup>
        </EditorDialog>
      )}
      <Toaster
        position="bottom-center"
        offset={value.active ? 104 : 24}
        mobileOffset={value.active ? 144 : 24}
      />
    </Context.Provider>
  )
}
export function SelectionTrigger() {
  const management = useBookmarkManagement()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="选择书签"
      aria-pressed={management?.active}
      onClick={management?.start}
    >
      <ListChecks />
    </Button>
  )
}
export function BookmarkCheckbox({ item }: { item: BookmarkItem }) {
  const management = useBookmarkManagement()
  if (!management?.active) return null
  return (
    <Checkbox
      className="bookmark-checkbox"
      aria-label={`选择 ${item.title}`}
      checked={management.selectedIds.has(item.id)}
      disabled={item.readOnly || management.busy}
      onCheckedChange={() => management.toggle(item)}
    />
  )
}

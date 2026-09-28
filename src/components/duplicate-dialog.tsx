import { useMemo, useState } from "react"
import { Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { indexBookmarkUrls } from "@/lib/bookmark-index"
import type { BookmarkItem, BookmarkFolder } from "@/lib/types"

export default function DuplicateDialog({
  items,
  folders,
  onDelete,
  onClose,
}: {
  items: BookmarkItem[]
  folders: BookmarkFolder[]
  onDelete: (items: BookmarkItem[]) => void
  onClose: () => void
}) {
  const groups = useMemo(
    () =>
      [...indexBookmarkUrls(items)].filter(([, matches]) => matches.length > 1),
    [items]
  )
  const [keep, setKeep] = useState<Record<string, string[]>>({})
  const paths = new Map(folders.map((folder) => [folder.id, folder.path]))
  const retained = (url: string, matches: BookmarkItem[]) =>
    keep[url] ||
    matches
      .filter((item, index) => !index || item.readOnly)
      .map((item) => item.id)
  const removing = groups.flatMap(([url, matches]) =>
    matches.filter(
      (item) => !item.readOnly && !retained(url, matches).includes(item.id)
    )
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="duplicates-dialog" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            重复书签 <Badge variant="secondary">{groups.length}</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="duplicates-list">
          {!groups.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>没有重复书签</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            groups.map(([url, matches]) => (
              <Card key={url} size="sm">
                <CardHeader>
                  <CardTitle className="truncate" title={url}>
                    {url}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1">
                  {matches.map((item) => (
                    <label className="duplicate-row" key={item.id}>
                      <Checkbox
                        aria-label={`保留 ${item.title} ${paths.get(item.parentId || "")}`}
                        checked={retained(url, matches).includes(item.id)}
                        disabled={item.readOnly}
                        onCheckedChange={(checked) =>
                          setKeep((current) => {
                            const previous = retained(url, matches)
                            const next = checked
                              ? [...previous, item.id]
                              : previous.filter((id) => id !== item.id)
                            return next.length
                              ? { ...current, [url]: next }
                              : current
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.title}</span>
                        <span className="command-item-path">
                          {paths.get(item.parentId || "")}
                        </span>
                      </span>
                      <Badge
                        variant={
                          retained(url, matches).includes(item.id)
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {retained(url, matches).includes(item.id)
                          ? "保留"
                          : "删除"}
                      </Badge>
                    </label>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </div>
        <div className="flex justify-end">
          <Button
            variant="destructive"
            disabled={!removing.length}
            onClick={() => {
              onClose()
              onDelete(removing)
            }}
          >
            <Trash2 data-icon="inline-start" />
            删除 {removing.length} 项
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { Bookmark, Copy, Globe, MousePointer2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Favicon } from "./favicon"
import { bookmarkUrlKey, indexBookmarkUrls } from "@/lib/bookmark-index"
import type { BookmarkGroup, BookmarkItem } from "@/lib/types"

export default function StatsDialog({
  groups,
  clicks,
  onOpen,
  onDuplicates,
  onClose,
}: {
  groups: BookmarkGroup[]
  clicks: Record<string, number>
  onOpen: (item: BookmarkItem) => void
  onDuplicates: () => void
  onClose: () => void
}) {
  const items = groups.flatMap((group) => group.items)
  const unique = indexBookmarkUrls(items)
  const counts = new Map<string, number>()
  for (const [url, count] of Object.entries(clicks)) {
    const key = bookmarkUrlKey(url)
    counts.set(key, (counts.get(key) || 0) + count)
  }
  const duplicateCount = items.length - unique.size
  const topClicks = [...unique.entries()]
    .map(([url, matches]) => ({
      item: matches[0],
      count: counts.get(url) || 0,
    }))
    .filter((entry) => entry.count)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
  const metrics = [
    { title: "书签", value: items.length, icon: Bookmark },
    { title: "网址", value: unique.size, icon: Globe },
    {
      title: "打开次数",
      value: [...unique.keys()].reduce(
        (sum, url) => sum + (counts.get(url) || 0),
        0
      ),
      icon: MousePointer2,
    },
    { title: "重复书签", value: duplicateCount, icon: Copy },
  ]
  const distribution = groups
    .filter((group) => group.items.length)
    .sort((a, b) => b.items.length - a.items.length)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent aria-describedby={undefined} className="stats-dialog">
        <DialogHeader>
          <DialogTitle>书签统计</DialogTitle>
        </DialogHeader>
        <div className="stats-view">
          <div className="metric-grid">
            {metrics.map((metric) => (
              <Card size="sm" key={metric.title}>
                <CardHeader>
                  <CardTitle>
                    <span className="metric-label">
                      <metric.icon />
                      {metric.title}
                    </span>
                  </CardTitle>
                  {metric.title === "重复书签" && (
                    <CardAction>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={!duplicateCount}
                        onClick={onDuplicates}
                      >
                        查看
                      </Button>
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="metric-value">
                    {metric.value.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="stats-grid">
            <Card>
              <CardHeader>
                <CardTitle>文件夹分布</CardTitle>
              </CardHeader>
              <CardContent>
                {distribution.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>文件夹</TableHead>
                        <TableHead className="distribution-share">
                          占比
                        </TableHead>
                        <TableHead className="text-right">书签</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {distribution.map((group) => (
                        <TableRow key={group.id}>
                          <TableCell
                            className="max-w-48 truncate"
                            title={group.name}
                          >
                            {group.name}
                          </TableCell>
                          <TableCell className="distribution-share">
                            <Progress
                              value={(group.items.length / items.length) * 100}
                              aria-label={group.name}
                            />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {group.items.length}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <StatsEmpty />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>常用网站</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="ranking-list">
                  {topClicks.map(({ item, count }, index) => (
                    <Button
                      variant="ghost"
                      key={item.id}
                      onClick={() => onOpen(item)}
                      className="w-full justify-start gap-3"
                    >
                      <span className="rank-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Favicon url={item.url} label={item.title} />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {item.title}
                      </span>
                      <Badge variant="secondary">{count}</Badge>
                    </Button>
                  ))}
                </div>
                {!topClicks.length && <StatsEmpty />}
              </CardContent>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatsEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>暂无记录</EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}

import { useEffect, useRef, useState } from "react"
import type { CSSProperties, MouseEvent } from "react"
import {
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  MousePointer2,
  Pencil,
  Trash2,
} from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Badge } from "@/components/ui/badge"
import { Favicon } from "@/components/favicon"
import { domainOf, safeUrl } from "@/lib/urls"
import { brandOf } from "@/lib/brands"
import { cn } from "@/lib/utils"
import { openTarget } from "@/lib/navigation"
import type { OpenTarget } from "@/lib/navigation"
import { BookmarkCheckbox, useBookmarkManagement } from "./bookmark-management"
import type { AppSettings, BookmarkItem } from "@/lib/types"

export type BookmarkActions = {
  open: (item: BookmarkItem, target?: OpenTarget) => void
  edit: (item: BookmarkItem) => void
  remove: (item: BookmarkItem) => void
  copy: (url: string) => void
  move: (item: BookmarkItem, direction: -1 | 1) => void
}

function Highlight({ text, query }: { text: string; query: string }) {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  if (!query || index < 0) return text
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  )
}

export function BookmarkCard({
  item,
  settings,
  actions,
  style,
  heat = false,
  vertical = false,
  query = "",
  selected = false,
  compact = false,
  tiny = false,
  count = 0,
}: {
  item: BookmarkItem
  settings: AppSettings
  actions: BookmarkActions
  style?: CSSProperties
  heat?: boolean
  vertical?: boolean
  query?: string
  selected?: boolean
  compact?: boolean
  tiny?: boolean
  count?: number
}) {
  const anchor = useRef<HTMLAnchorElement>(null)
  const management = useBookmarkManagement()
  const [previewOpen, setPreviewOpen] = useState(false)
  const previous = useRef(count)
  useEffect(() => {
    if (
      count > previous.current &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      anchor.current?.animate(
        [
          { boxShadow: "0 0 0 2px var(--ring)" },
          { boxShadow: "0 0 0 0 transparent" },
        ],
        { duration: 360, easing: "ease-out" }
      )
    }
    previous.current = count
  }, [count])
  function activate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    if (management?.active) {
      management.toggle(item)
      return
    }
    actions.open(item, openTarget(event, settings.newTab))
  }
  return (
    <div
      className={cn("bookmark-cell", heat && "heat-cell")}
      data-item-id={item.id}
      style={style}
      data-checked={management?.selectedIds.has(item.id) || undefined}
      data-drop={management?.drop === item.id || undefined}
    >
      <ContextMenu onOpenChange={() => setPreviewOpen(false)}>
        <HoverCard
          open={previewOpen}
          onOpenChange={(open) => {
            // Delayed hover/focus must not put a preview above an active action.
            if (
              !open ||
              (!management?.active &&
                !management?.drop &&
                !document.querySelector(
                  '[role="menu"], [role="dialog"], [role="alertdialog"]'
                ))
            )
              setPreviewOpen(open)
          }}
          openDelay={350}
          closeDelay={100}
        >
          <ContextMenuTrigger asChild>
            <HoverCardTrigger asChild>
              <a
                ref={anchor}
                href={safeUrl(item.url)}
                onClick={activate}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault()
                    if (!management?.active)
                      actions.open(item, openTarget(event, settings.newTab))
                  }
                }}
                target={settings.newTab ? "_blank" : undefined}
                tabIndex={management?.active ? -1 : undefined}
                rel="noopener noreferrer"
                data-bookmark-id={item.id}
                data-clicks={count}
                data-tone={brandOf(item.url).tone}
                data-selected={selected || undefined}
                data-compact={compact || undefined}
                data-tiny={tiny || undefined}
                className={cn(
                  "bookmark-card",
                  heat && "heat-card",
                  vertical && "vertical-card"
                )}
                draggable={!heat && !item.readOnly}
                onDragStart={(event) => {
                  setPreviewOpen(false)
                  management?.dragStart(event, item)
                }}
                onDragEnd={() => management?.dragEnd()}
                onDragOver={(event) => {
                  if (!heat) management?.dragOver(event, item.id, item.readOnly)
                }}
                onDrop={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect()
                  const list =
                    event.currentTarget.closest<HTMLElement>(".section-board")
                      ?.dataset.layout === "list"
                  if (!heat && item.parentId)
                    management?.dropOn(
                      event,
                      {
                        parentId: item.parentId,
                        anchorId: item.id,
                        after: list
                          ? event.clientY > bounds.top + bounds.height / 2
                          : event.clientX > bounds.left + bounds.width / 2,
                      },
                      item.readOnly
                    )
                }}
                aria-label={`${item.title} · ${domainOf(item.url)}`}
              >
                <Card className="bookmark-surface">
                  {settings.iconMode === "favicon" && (
                    <CardContent className="bookmark-icon">
                      <Favicon
                        url={item.url}
                        label={item.title}
                        online={settings.onlineIcons}
                      />
                    </CardContent>
                  )}
                  <CardHeader className="bookmark-copy">
                    <CardTitle className="bookmark-title">
                      <Highlight text={item.title} query={query} />
                    </CardTitle>
                    {settings.showDomain && (
                      <CardDescription className="bookmark-domain">
                        <Highlight text={domainOf(item.url)} query={query} />
                      </CardDescription>
                    )}
                  </CardHeader>
                </Card>
              </a>
            </HoverCardTrigger>
          </ContextMenuTrigger>
          <HoverCardContent side="top" className="w-72">
            <div className="flex items-center gap-3 p-1">
              <Favicon
                url={item.url}
                label={item.title}
                online={settings.onlineIcons}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="line-clamp-2 font-medium break-words">
                  {item.title}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {domainOf(item.url)}
                </span>
              </div>
              <Badge variant="secondary">
                <MousePointer2 />
                {count.toLocaleString()}
              </Badge>
            </div>
          </HoverCardContent>
        </HoverCard>
        <ContextMenuContent className="w-48">
          <ContextMenuGroup>
            <ContextMenuItem onSelect={() => actions.open(item, "foreground")}>
              <ExternalLink />
              在新标签页打开
            </ContextMenuItem>
            <ContextMenuItem
              disabled={item.readOnly}
              onSelect={() => actions.edit(item)}
            >
              <Pencil />
              编辑书签
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => actions.copy(item.url)}>
              <Copy />
              复制网址
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem
              disabled={item.readOnly}
              onSelect={() => actions.move(item, -1)}
            >
              <ArrowUp />
              上移
            </ContextMenuItem>
            <ContextMenuItem
              disabled={item.readOnly}
              onSelect={() => actions.move(item, 1)}
            >
              <ArrowDown />
              下移
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem
              disabled={item.readOnly}
              variant="destructive"
              onSelect={() => actions.remove(item)}
            >
              <Trash2 />
              删除书签
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      <BookmarkCheckbox item={item} />
    </div>
  )
}

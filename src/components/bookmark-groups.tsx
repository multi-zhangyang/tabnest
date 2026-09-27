import { useLayoutEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  ChevronDown,
  Copy,
  ExternalLink,
  Folder,
  FolderInput,
  FolderPlus,
  Grid2X2,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { BookmarkCard } from "./bookmark-card"
import { BookmarkGrid } from "./bookmark-grid"
import { SortMenu } from "./sort-menu"
import type { BookmarkActions } from "./bookmark-card"
import type { FolderEditorState } from "./folder-editor"
import type {
  AppSettings,
  BookmarkFolder,
  BookmarkGroup,
  BookmarkItem,
} from "@/lib/types"
import { defaultFolderId, sortItems } from "@/lib/bookmarks"
import { descendants, rootFolder } from "@/lib/folders"
import { SelectionTrigger, useBookmarkManagement } from "./bookmark-management"

export function BookmarkGroups({
  groups,
  folders,
  clicks,
  settings,
  onSettings,
  actions,
  onFolderEdit,
  onFolderDelete,
  onAdd,
  onOpenGroup,
}: {
  groups: BookmarkGroup[]
  folders: BookmarkFolder[]
  clicks: Record<string, number>
  settings: AppSettings
  onSettings: (patch: Partial<AppSettings>) => void
  actions: BookmarkActions
  onFolderEdit: (state: FolderEditorState) => void
  onFolderDelete: (folder: BookmarkFolder) => void
  onAdd: (parentId?: string) => void
  onOpenGroup: (items: BookmarkItem[]) => void
}) {
  const management = useBookmarkManagement()
  const virtualize =
    groups.reduce((sum, group) => sum + group.items.length, 0) > 250
  const byId = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders]
  )
  const byGroup = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups]
  )
  const roots = folders.filter(
    (folder) => !folder.parentId || !byId.has(folder.parentId)
  )
  const active =
    rootFolder(folders, settings.activeFolderId) ||
    rootFolder(folders, defaultFolderId(folders)) ||
    roots[0]
  const ids = active ? descendants(folders, active.id) : new Set<string>()
  const blocks = folders.filter(
    (folder) =>
      ids.has(folder.id) &&
      (folder.id !== active?.id || !!byGroup.get(folder.id)?.items.length)
  )
  const collect = (id: string) => {
    const children = descendants(folders, id)
    return groups
      .filter((group) => children.has(group.id))
      .flatMap((group) => group.items)
  }
  function menu(folder: BookmarkFolder, rootMenu = false) {
    const items = collect(folder.id)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${folder.title}${rootMenu ? "根目录" : "文件夹"}操作`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={folder.readOnly}
              onSelect={() => onAdd(folder.id)}
            >
              <Plus />
              添加书签
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={folder.readOnly}
              onSelect={() => onFolderEdit({ parentId: folder.id })}
            >
              <FolderPlus />
              新建子文件夹
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={folder.readOnly || folder.root}
              onSelect={() => onFolderEdit({ folder })}
            >
              <Pencil />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={folder.readOnly || folder.root}
              onSelect={() => onFolderEdit({ folder, moving: true })}
            >
              <FolderInput />
              移动文件夹
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={!items.length}
              onSelect={() => onOpenGroup(items)}
            >
              <ExternalLink />
              全部打开
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!items.length}
              onSelect={() =>
                actions.copy(items.map((item) => item.url).join("\n"))
              }
            >
              <Copy />
              复制全部网址
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              disabled={folder.readOnly || folder.root}
              onSelect={() => onFolderDelete(folder)}
            >
              <Trash2 />
              删除文件夹
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  return (
    <Tabs
      value={active?.id || ""}
      onValueChange={(activeFolderId) => onSettings({ activeFolderId })}
      className="section-workspace"
    >
      <div className="section-toolbar">
        <TabsList variant="line" aria-label="书签根目录">
          {roots.map((root) => (
            <TabsTrigger value={root.id} key={root.id}>
              <Folder data-icon="inline-start" />
              {root.title}
              <Badge variant="secondary">{collect(root.id).length}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="section-tools">
          <SelectionTrigger />
          <SortMenu
            value={settings.sort}
            onChange={(sort) => onSettings({ sort })}
          />
          <ToggleGroup
            type="single"
            size="sm"
            value={settings.folderLayout === "list" ? "list" : "grid"}
            aria-label="分区排列"
            onValueChange={(value) => {
              if (value) onSettings({ folderLayout: value as "grid" | "list" })
            }}
          >
            <ToggleGroupItem value="grid" aria-label="分区网格">
              <Grid2X2 />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="分区列表">
              <List />
            </ToggleGroupItem>
          </ToggleGroup>
          {active && menu(active, true)}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onFolderEdit({ parentId: active?.id })}
            disabled={!active || active.readOnly}
          >
            <FolderPlus data-icon="inline-start" />
            <span>新建文件夹</span>
          </Button>
        </div>
      </div>
      <TabsContent value={active?.id || ""}>
        {blocks.length ? (
          <div
            className="section-board"
            data-layout={settings.folderLayout === "list" ? "list" : "grid"}
          >
            {blocks.map((folder) => {
              const items = sortItems(
                byGroup.get(folder.id)?.items || [],
                settings.sort
              )
              const collapsed = settings.collapsedSections.includes(folder.id)
              const parent = folder.parentId
                ? byId.get(folder.parentId)
                : undefined
              const parentPath =
                parent && parent.id !== active?.id ? parent.path : undefined
              return (
                <SectionBlock key={folder.id} folder={folder}>
                  <Collapsible
                    open={!collapsed}
                    onOpenChange={(open) =>
                      onSettings({
                        collapsedSections: open
                          ? settings.collapsedSections.filter(
                              (id) => id !== folder.id
                            )
                          : [...settings.collapsedSections, folder.id],
                      })
                    }
                  >
                    <Card
                      className="section-card"
                      data-drop={management?.drop === folder.id || undefined}
                      onDragOver={(event) =>
                        management?.dragOver(event, folder.id, folder.readOnly)
                      }
                      onDrop={(event) =>
                        management?.dropOn(
                          event,
                          { parentId: folder.id },
                          folder.readOnly
                        )
                      }
                    >
                      <CardHeader>
                        <CardTitle>
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="ghost"
                              className="section-title"
                              aria-label={`${collapsed ? "展开" : "收起"}分区 ${folder.title}`}
                            >
                              <Folder data-icon="inline-start" />
                              <span className="truncate">{folder.title}</span>
                              <Badge variant="secondary">{items.length}</Badge>
                              <ChevronDown
                                data-icon="inline-end"
                                className={collapsed ? "-rotate-90" : undefined}
                              />
                            </Button>
                          </CollapsibleTrigger>
                        </CardTitle>
                        {parentPath && (
                          <CardDescription
                            className="section-path truncate"
                            title={parentPath}
                          >
                            {parentPath}
                          </CardDescription>
                        )}
                        <CardAction>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`向${folder.title}添加书签`}
                            disabled={folder.readOnly}
                            onClick={() => onAdd(folder.id)}
                          >
                            <Plus />
                          </Button>
                          {menu(folder)}
                        </CardAction>
                      </CardHeader>
                      <CollapsibleContent>
                        <CardContent>
                          {items.length ? (
                            <BookmarkGrid
                              className="section-bookmarks"
                              items={items}
                              virtualize={virtualize}
                            >
                              {(item) => (
                                <BookmarkCard
                                  key={item.id}
                                  item={item}
                                  settings={settings}
                                  actions={actions}
                                  count={clicks[item.url] || 0}
                                />
                              )}
                            </BookmarkGrid>
                          ) : (
                            <Button
                              variant="ghost"
                              className="section-add"
                              onClick={() => onAdd(folder.id)}
                              disabled={folder.readOnly}
                            >
                              <Plus data-icon="inline-start" />
                              添加书签
                            </Button>
                          )}
                        </CardContent>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                </SectionBlock>
              )
            })}
          </div>
        ) : (
          <Empty className="section-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Folder />
              </EmptyMedia>
              <EmptyTitle>还没有书签</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => onAdd(active?.id)}
                disabled={!active || active.readOnly}
              >
                <Plus data-icon="inline-start" />
                添加书签
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </TabsContent>
    </Tabs>
  )
}

function SectionBlock({
  folder,
  children,
}: {
  folder: BookmarkFolder
  children: ReactNode
}) {
  const content = useRef<HTMLDivElement>(null)
  const [span, setSpan] = useState(1)
  useLayoutEffect(() => {
    const element = content.current
    if (!element) return
    const update = () =>
      setSpan(Math.ceil((element.getBoundingClientRect().height + 16) / 8))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <section
      className="section-slot"
      data-folder-id={folder.id}
      aria-label={`${folder.path}分区`}
      tabIndex={-1}
      style={{ gridRowEnd: `span ${span}` }}
    >
      <div ref={content}>{children}</div>
    </section>
  )
}

import { memo, useMemo } from "react"
import {
  ChevronDown,
  Copy,
  ExternalLink,
  Folder,
  FolderInput,
  Grid2X2,
  List,
  MoreHorizontal,
  Pencil,
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
import { rootFolder } from "@/lib/folders"
import { createLibraryIndex } from "@/lib/library-index"
import { SectionBoard } from "./section-board"
import { SelectionTrigger, useBookmarkManagement } from "./bookmark-management"

export const BookmarkGroups = memo(function BookmarkGroups({
  groups,
  folders,
  clicks,
  settings,
  onSettings,
  actions,
  onFolderEdit,
  onFolderDelete,
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
  onOpenGroup: (items: BookmarkItem[]) => void
}) {
  const management = useBookmarkManagement()
  const virtualize =
    groups.reduce((sum, group) => sum + group.items.length, 0) > 250
  const index = useMemo(
    () => createLibraryIndex(folders, groups),
    [folders, groups]
  )
  const { byId, byGroup, collect } = index
  const roots = folders.filter(
    (folder) => !folder.parentId || !byId.has(folder.parentId)
  )
  const active =
    rootFolder(folders, settings.activeFolderId) ||
    rootFolder(folders, defaultFolderId(folders)) ||
    roots[0]
  const ids = active ? index.subtree(active.id) : new Set<string>()
  const blocks = folders.filter(
    (folder) =>
      ids.has(folder.id) &&
      (folder.id !== active?.id || !!byGroup.get(folder.id)?.items.length)
  )
  function menu(folder: BookmarkFolder) {
    const items = collect(folder.id)
    const editable = !folder.readOnly && !folder.root
    if (!editable && !items.length) return null
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${folder.title}${folder.root ? "根目录" : "文件夹"}操作`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {editable && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => onFolderEdit({ folder })}>
                  <Pencil />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onFolderEdit({ folder, moving: true })}
                >
                  <FolderInput />
                  移动文件夹
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
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
          {editable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onFolderDelete(folder)}
                >
                  <Trash2 />
                  删除文件夹
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
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
              <Badge variant="secondary">
                {index.counts.get(root.id) || 0}
              </Badge>
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
            aria-label="文件夹排列"
            onValueChange={(value) => {
              if (value) onSettings({ folderLayout: value as "grid" | "list" })
            }}
          >
            <ToggleGroupItem value="grid" aria-label="文件夹网格">
              <Grid2X2 />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="文件夹列表">
              <List />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      <TabsContent value={active?.id || ""}>
        {blocks.length ? (
          <SectionBoard blocks={blocks} groups={byGroup} settings={settings}>
            {(folder) => {
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
                            aria-label={`${collapsed ? "展开" : "收起"}文件夹 ${folder.title}`}
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
                      <CardAction>{menu(folder)}</CardAction>
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
                          <div className="section-blank" />
                        )}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              )
            }}
          </SectionBoard>
        ) : (
          <Empty className="section-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Folder />
              </EmptyMedia>
              <EmptyTitle>还没有书签</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </TabsContent>
    </Tabs>
  )
})

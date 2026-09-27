import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import { Bookmark, Folder, Search, X } from "lucide-react"
import {
  BookmarkManagement,
  SelectionTrigger,
} from "@/components/bookmark-management"
import { AppHeader } from "@/components/app-header"
import { BookmarkGroups } from "@/components/bookmark-groups"
import { BookmarkResults } from "@/components/bookmark-results"
import { HeatMap } from "@/components/heat-map"
import { LibraryDialogs } from "@/components/library-dialogs"
import { SortMenu } from "@/components/sort-menu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useBookmarks } from "@/hooks/use-bookmarks"
import { useBookmarkSearch } from "@/hooks/use-bookmark-search"
import { useLibraryActions } from "@/hooks/use-library-actions"
import { defaultFolderId } from "@/lib/bookmarks"
import { descendants, rootFolder } from "@/lib/folders"
import type { LayoutMode } from "@/lib/types"

const SettingsDialog = lazy(() =>
  import("@/components/settings-dialog").then((module) => ({
    default: module.SettingsDialog,
  }))
)
const StatsDialog = lazy(() => import("@/components/stats-dialog"))
const RecoveryDialog = lazy(() => import("@/components/recovery-dialog"))

export default function App() {
  const {
    groups,
    folders,
    settings,
    patchSettings,
    clicks,
    recordClick,
    loading,
    error,
    reload,
    retry,
  } = useBookmarks()
  const [utility, setUtility] = useState<
    "settings" | "stats" | "recovery" | null
  >(null)
  const library = useLibraryActions({
    data: { groups, folders },
    settings,
    patchSettings,
    recordClick,
    reload,
  })
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups])
  const search = useBookmarkSearch(
    items,
    folders,
    settings.sort,
    library.actions.open
  )
  const defaultRoot = rootFolder(folders, defaultFolderId(folders))
  const activeRoot =
    settings.layout === "zones"
      ? rootFolder(folders, settings.activeFolderId) || defaultRoot
      : defaultRoot
  const showGroups =
    !search.active && settings.layout === "zones" && !!folders.length
  const [located, setLocated] = useState("")
  useEffect(() => {
    if (!located || !showGroups) return
    const frame = requestAnimationFrame(() => {
      const element = [
        ...document.querySelectorAll<HTMLElement>("[data-folder-id]"),
      ].find((element) => element.dataset.folderId === located)
      element?.scrollIntoView({ block: "nearest" })
      element?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [located, showGroups, settings.activeFolderId])
  const manageableItems = useMemo(() => {
    if (search.active) return search.results
    if (!showGroups || !activeRoot) return items
    const ids = descendants(folders, activeRoot.id)
    return items.filter((item) => ids.has(item.parentId || ""))
  }, [search.active, search.results, showGroups, activeRoot, folders, items])
  const canvasStyle = { "--card-scale": settings.cardScale } as CSSProperties

  return (
    <TooltipProvider delayDuration={350}>
      <BookmarkManagement
        items={manageableItems}
        folders={folders}
        onDelete={library.deleteMany}
        onMoved={async () => {
          patchSettings({ sort: "default" })
          await reload()
        }}
      >
        <Tabs
          value={settings.layout}
          onValueChange={(layout) => {
            patchSettings({ layout: layout as LayoutMode })
            search.clear()
          }}
          className="app-shell"
          data-font-scale={settings.fontScale}
          data-density={settings.density}
          style={canvasStyle}
        >
          <AppHeader
            search={search}
            onAdd={() => library.add(activeRoot?.id)}
            onNewFolder={() => library.editFolder({ parentId: activeRoot?.id })}
            onStats={() => setUtility("stats")}
            onSettings={() => setUtility("settings")}
            writable={
              !!activeRoot && !activeRoot.readOnly && !loading && !error
            }
          />
          <main className="view-panel">
            <TabsContent value={settings.layout} className="main-content">
              <h1 className="sr-only">
                {search.active
                  ? "搜索书签"
                  : settings.layout === "heat"
                    ? "热度云图"
                    : "书签分区"}
              </h1>
              {!showGroups && (
                <div className="collection-toolbar">
                  <div className="collection-summary">
                    {search.active ? (
                      <>
                        <span>
                          {search.duplicatesOnly ? "重复书签" : "搜索结果"}
                        </span>
                        <Badge variant="secondary">
                          {search.results.length}
                        </Badge>
                      </>
                    ) : (
                      <span>{items.length} 个书签</span>
                    )}
                  </div>
                  <div className="collection-actions">
                    <SelectionTrigger />
                    {search.active ? (
                      <>
                        <SortMenu
                          value={settings.sort}
                          onChange={(sort) => patchSettings({ sort })}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={search.clear}
                        >
                          <X data-icon="inline-start" />
                          返回书签
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              )}
              {loading ? (
                <LoadingGrid />
              ) : error ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Bookmark />
                    </EmptyMedia>
                    <EmptyTitle>书签读取失败</EmptyTitle>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button variant="outline" onClick={() => void retry()}>
                      重新加载
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : showGroups ? (
                <BookmarkGroups
                  groups={groups}
                  folders={folders}
                  settings={settings}
                  clicks={clicks}
                  onSettings={patchSettings}
                  actions={library.actions}
                  onFolderEdit={library.editFolder}
                  onFolderDelete={library.deleteFolder}
                  onAdd={library.add}
                  onOpenGroup={library.openGroup}
                />
              ) : !search.results.length && !search.folderResults.length ? (
                <Empty className="empty-bookmarks">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      {search.active ? <Search /> : <Bookmark />}
                    </EmptyMedia>
                    <EmptyTitle>
                      {search.duplicatesOnly
                        ? "没有重复书签"
                        : search.active
                          ? "没有匹配的书签"
                          : "还没有书签"}
                    </EmptyTitle>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      variant="outline"
                      onClick={() =>
                        search.active
                          ? search.clear()
                          : library.add(activeRoot?.id)
                      }
                    >
                      {search.active ? "返回书签" : "添加书签"}
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : search.active ? (
                <>
                  {!!search.folderResults.length && (
                    <div className="folder-results" aria-label="匹配的文件夹">
                      {search.folderResults.map((folder) => (
                        <Button
                          key={folder.id}
                          variant="outline"
                          size="sm"
                          title={folder.path}
                          onClick={() => {
                            patchSettings({
                              layout: "zones",
                              activeFolderId: folder.id,
                              collapsedSections:
                                settings.collapsedSections.filter(
                                  (id) => id !== folder.id
                                ),
                            })
                            setLocated(folder.id)
                            search.clear()
                          }}
                        >
                          <Folder data-icon="inline-start" />
                          <span className="truncate">{folder.path}</span>
                        </Button>
                      ))}
                    </div>
                  )}
                  <BookmarkResults
                    items={search.results}
                    folders={folders}
                    settings={settings}
                    clicks={clicks}
                    actions={library.actions}
                    query={search.query.trim()}
                    selected={search.selected}
                  />
                </>
              ) : (
                <HeatMap
                  items={items}
                  clicks={clicks}
                  settings={settings}
                  actions={library.actions}
                />
              )}
            </TabsContent>
          </main>
          <Suspense fallback={null}>
            {utility === "settings" && (
              <SettingsDialog
                open
                onOpenChange={(open) => {
                  if (!open) setUtility(null)
                }}
                settings={settings}
                onChange={patchSettings}
                onImport={() => {
                  setUtility(null)
                  library.importBookmarks()
                }}
                onExport={library.exportBookmarks}
                onFullExport={library.exportFullBackup}
                onRecovery={() => setUtility("recovery")}
              />
            )}
            {utility === "stats" && (
              <StatsDialog
                groups={groups}
                clicks={clicks}
                onOpen={library.actions.open}
                onClose={() => setUtility(null)}
                onDuplicates={() => {
                  setUtility(null)
                  search.showDuplicates()
                }}
              />
            )}
            {utility === "recovery" && (
              <RecoveryDialog
                onClose={() => setUtility(null)}
                onRestored={reload}
              />
            )}
          </Suspense>
          <LibraryDialogs library={library} folders={folders} reload={reload} />
        </Tabs>
      </BookmarkManagement>
    </TooltipProvider>
  )
}

function LoadingGrid() {
  return (
    <div className="loading-grid">
      {Array.from({ length: 12 }, (_, index) => (
        <Skeleton key={index} className="h-28 rounded-2xl" />
      ))}
    </div>
  )
}

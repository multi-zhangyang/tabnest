import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import type { CSSProperties } from "react"
import {
  Bookmark,
  Folder,
  Search,
  X,
  Plus,
  FolderPlus,
  Upload,
  Download,
  BarChart3,
  Settings2,
  RotateCcw,
  Copy,
} from "lucide-react"
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
import { useStartupReveal } from "@/hooks/use-startup-reveal"
import { useViewTransition } from "@/hooks/use-view-transition"
import { defaultFolderId } from "@/lib/bookmarks"
import { descendants, rootFolder } from "@/lib/folders"
import type { LayoutMode } from "@/lib/types"
import { loadPendingOperations } from "@/lib/operations"
import { toast } from "sonner"

const SettingsDialog = lazy(() =>
  import("@/components/settings-dialog").then((module) => ({
    default: module.SettingsDialog,
  }))
)
const StatsDialog = lazy(() => import("@/components/stats-dialog"))
const RecoveryDialog = lazy(() => import("@/components/recovery-dialog"))
const SearchDialog = lazy(() => import("@/components/search-dialog"))
const DuplicateDialog = lazy(() => import("@/components/duplicate-dialog"))

export default function App() {
  const {
    groups,
    folders,
    settings,
    settingsReady,
    patchSettings,
    clicks,
    recent,
    recordClick,
    loading,
    error,
    reload,
    retry,
  } = useBookmarks()
  useStartupReveal(!loading && settingsReady)
  const displayedLayout = useViewTransition(settings.layout, settingsReady)
  const [utility, setUtility] = useState<
    "settings" | "stats" | "recovery" | "duplicates" | null
  >(null)
  useEffect(() => {
    let alive = true
    void loadPendingOperations()
      .then((records) => {
        if (alive && records.length)
          toast("有待检查的导入或恢复", {
            duration: Infinity,
            action: { label: "查看", onClick: () => setUtility("recovery") },
          })
      })
      .catch(() => {
        if (alive) toast.error("操作记录读取失败")
      })
    return () => {
      alive = false
    }
  }, [])
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
    library.actions.open,
    clicks,
    recent
  )
  const defaultRoot = rootFolder(folders, defaultFolderId(folders))
  const activeRoot =
    displayedLayout === "zones"
      ? rootFolder(folders, settings.activeFolderId) || defaultRoot
      : defaultRoot
  const showGroups =
    !search.active && displayedLayout === "zones" && !!folders.length
  const [located, setLocated] = useState("")
  function locateFolder(id: string) {
    setUtility(null)
    patchSettings({
      layout: "zones",
      activeFolderId: id,
      collapsedSections: settings.collapsedSections.filter(
        (value) => value !== id
      ),
    })
    setLocated(id)
    search.clear()
  }
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
    if (search.active) return search.pageResults
    if (!showGroups || !activeRoot) return items
    const ids = descendants(folders, activeRoot.id)
    return items.filter((item) => ids.has(item.parentId || ""))
  }, [
    search.active,
    search.pageResults,
    showGroups,
    activeRoot,
    folders,
    items,
  ])
  const canvasStyle = { "--card-scale": settings.cardScale } as CSSProperties
  const onMoved = useCallback(async () => {
    patchSettings({ sort: "default" })
    await reload()
  }, [patchSettings, reload])

  return (
    <TooltipProvider delayDuration={350}>
      <BookmarkManagement
        items={manageableItems}
        folders={folders}
        onDelete={library.deleteMany}
        onMoved={onMoved}
      >
        <Tabs
          value={settingsReady ? settings.layout : ""}
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
            ready={settingsReady}
            layout={settings.layout}
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
            <TabsContent
              key={displayedLayout}
              forceMount
              value={settingsReady ? displayedLayout : ""}
              className="main-content"
            >
              <h1 className="sr-only">
                {search.active
                  ? "搜索书签"
                  : displayedLayout === "heat"
                    ? "书签拼图"
                    : "书签文件夹"}
              </h1>
              {!loading && !showGroups && (
                <div className="collection-toolbar">
                  <div className="collection-summary">
                    {search.active ? (
                      <>
                        <span>
                          {search.duplicatesOnly ? "重复书签" : "搜索结果"}
                        </span>
                        <Badge variant="secondary">
                          {search.pageResults.length}
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
                          aria-label="清空搜索"
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
                  onOpenGroup={library.openGroup}
                />
              ) : search.active ? (
                !search.pageResults.length && !search.pageFolders.length ? (
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
                  </Empty>
                ) : (
                  <>
                    {!!search.pageFolders.length && (
                      <div className="folder-results" aria-label="匹配的文件夹">
                        {search.pageFolders.map((folder) => (
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
                      items={search.pageResults}
                      folders={folders}
                      settings={settings}
                      clicks={clicks}
                      actions={library.actions}
                      query={search.pageQuery.trim()}
                      selected={search.selected}
                    />
                  </>
                )
              ) : !items.length ? (
                <Empty className="empty-bookmarks">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Bookmark />
                    </EmptyMedia>
                    <EmptyTitle>还没有书签</EmptyTitle>
                  </EmptyHeader>
                </Empty>
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
            {search.paletteOpen && (
              <SearchDialog
                search={search}
                folders={folders}
                onOpen={library.actions.open}
                onLocate={locateFolder}
                actions={[
                  {
                    id: "new",
                    label: "新建书签",
                    icon: Plus,
                    run: () => library.add(activeRoot?.id),
                    disabled: !activeRoot || activeRoot.readOnly,
                  },
                  {
                    id: "folder",
                    label: "新建文件夹",
                    icon: FolderPlus,
                    run: () => library.editFolder({ parentId: activeRoot?.id }),
                    disabled: !activeRoot || activeRoot.readOnly,
                  },
                  {
                    id: "import",
                    label: "导入书签",
                    icon: Upload,
                    run: library.importBookmarks,
                  },
                  {
                    id: "export",
                    label: "导出书签",
                    icon: Download,
                    run: library.exportBookmarks,
                  },
                  {
                    id: "duplicates",
                    label: "重复书签",
                    icon: Copy,
                    run: () => setUtility("duplicates"),
                  },
                  {
                    id: "stats",
                    label: "统计",
                    icon: BarChart3,
                    run: () => setUtility("stats"),
                  },
                  {
                    id: "settings",
                    label: "设置",
                    icon: Settings2,
                    run: () => setUtility("settings"),
                  },
                  {
                    id: "recovery",
                    label: "最近删除",
                    icon: RotateCcw,
                    run: () => setUtility("recovery"),
                  },
                ]}
              />
            )}
            {utility === "duplicates" && (
              <DuplicateDialog
                items={items}
                folders={folders}
                onClose={() => setUtility(null)}
                onDelete={library.deleteMany}
              />
            )}
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
                onHtmlExport={library.exportHtml}
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
                  setUtility("duplicates")
                }}
              />
            )}
            {utility === "recovery" && (
              <RecoveryDialog
                onClose={() => setUtility(null)}
                onRestored={reload}
                onLocate={locateFolder}
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

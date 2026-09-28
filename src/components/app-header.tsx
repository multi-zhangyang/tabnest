import {
  BarChart3,
  FolderPlus,
  Folders,
  PanelsTopLeft,
  Plus,
  Search,
  Settings2,
} from "lucide-react"
import type { BookmarkSearch } from "@/hooks/use-bookmark-search"
import { Button } from "@/components/ui/button"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Kbd } from "@/components/ui/kbd"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function AppHeader({
  ready,
  search,
  onAdd,
  onNewFolder,
  onStats,
  onSettings,
  writable,
}: {
  ready: boolean
  search: BookmarkSearch
  onAdd: () => void
  onNewFolder: () => void
  onStats: () => void
  onSettings: () => void
  writable: boolean
}) {
  const { clear } = search
  return (
    <header className="app-header">
      <a
        className="brand"
        href="#"
        onClick={(event) => {
          event.preventDefault()
          clear()
        }}
        aria-label="TabNest 首页"
      >
        <img
          className="brand-icon"
          src="./icons/icon.svg"
          alt=""
          width="36"
          height="36"
        />
        <span>TabNest</span>
      </a>
      <nav
        className="main-tabs"
        aria-label="书签视图"
        aria-busy={!ready}
        data-ready={ready}
      >
        <TabsList key={ready ? "ready" : "pending"} aria-label="主导航">
          <TabsTrigger value="heat" aria-label="书签拼图">
            <PanelsTopLeft data-icon="inline-start" />
            书签拼图
          </TabsTrigger>
          <TabsTrigger value="zones" aria-label="文件夹视图">
            <Folders data-icon="inline-start" />
            文件夹
          </TabsTrigger>
        </TabsList>
      </nav>
      <Button
        variant="outline"
        className="search-field search-trigger"
        aria-label="打开搜索"
        onClick={search.openPalette}
      >
        <Search data-icon="inline-start" />
        <span className="flex-1 truncate text-left">
          {search.pageQuery || "搜索书签…"}
        </span>
        <Kbd>
          {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K"}
        </Kbd>
      </Button>
      <div className="header-tools">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-label="新建"
              disabled={!writable}
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onAdd}>
                <Plus />
                新建书签
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewFolder}>
                <FolderPlus />
                新建文件夹
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-label="统计"
              onClick={onStats}
            >
              <BarChart3 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>统计</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-label="外观与偏好"
              onClick={onSettings}
            >
              <Settings2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>设置</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

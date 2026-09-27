import {
  BarChart3,
  FolderPlus,
  Grid2X2,
  PanelsTopLeft,
  Plus,
  Search,
  Settings2,
  X,
} from "lucide-react"
import type { BookmarkSearch } from "@/hooks/use-bookmark-search"
import { Button } from "@/components/ui/button"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
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
  search,
  onAdd,
  onNewFolder,
  onStats,
  onSettings,
  writable,
}: {
  search: BookmarkSearch
  onAdd: () => void
  onNewFolder: () => void
  onStats: () => void
  onSettings: () => void
  writable: boolean
}) {
  const { inputRef, query, active, onKeyDown, clear, change } = search
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
      <nav className="main-tabs" aria-label="书签视图">
        <TabsList aria-label="主导航">
          <TabsTrigger value="heat" aria-label="热度云图">
            <PanelsTopLeft data-icon="inline-start" />
            热度云图
          </TabsTrigger>
          <TabsTrigger value="zones" aria-label="分区视图">
            <Grid2X2 data-icon="inline-start" />
            分区
          </TabsTrigger>
        </TabsList>
      </nav>
      <InputGroup className="search-field">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          ref={inputRef}
          value={query}
          placeholder="搜索书签…"
          aria-label="搜索书签"
          onChange={(event) => change(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <InputGroupAddon align="inline-end">
          {active ? (
            <InputGroupButton
              size="icon-xs"
              aria-label="清空搜索"
              onClick={() => {
                clear()
                inputRef.current?.focus()
              }}
            >
              <X />
            </InputGroupButton>
          ) : (
            <Kbd>
              {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K"}
            </Kbd>
          )}
        </InputGroupAddon>
      </InputGroup>
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

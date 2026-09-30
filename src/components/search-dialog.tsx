import { useRef } from "react"
import { ArrowDownLeft, ArrowUpRight, Folder, Search } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
  CommandSeparator,
} from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Favicon } from "./favicon"
import { Highlight } from "./bookmark-card"
import type { BookmarkSearch } from "@/hooks/use-bookmark-search"
import type { BookmarkItem, BookmarkFolder } from "@/lib/types"
import { isComposing, openTarget } from "@/lib/navigation"
import type { OpenTarget } from "@/lib/navigation"
import { queryTokens } from "@/lib/search-tokens"

export type SearchAction = {
  id: string
  label: string
  icon: LucideIcon
  run: () => void
  disabled?: boolean
}
export type SearchResult =
  | { type: "bookmark"; item: BookmarkItem }
  | { type: "folder"; folder: BookmarkFolder }
  | { type: "action"; action: SearchAction }
export default function SearchDialog({
  search,
  folders,
  actions,
  onOpen,
  onLocate,
}: {
  search: BookmarkSearch
  folders: BookmarkFolder[]
  actions: SearchAction[]
  onOpen: (item: BookmarkItem, target?: OpenTarget) => void
  onLocate: (id: string) => void
}) {
  const target = useRef<OpenTarget | undefined>(undefined)
  const composing = useRef(false)
  const previousFocus = useRef(document.activeElement as HTMLElement | null)
  const navigating = useRef(false)
  const byId = new Map(folders.map((folder) => [folder.id, folder.path]))
  const tokens = queryTokens(search.query)
  const commands = actions.filter((action) =>
    tokens.every((token) => action.label.toLocaleLowerCase().includes(token))
  )
  function choose(action: () => void) {
    navigating.current = true
    search.closePalette()
    requestAnimationFrame(action)
  }
  const bookmarks = search.pending ? [] : search.query.trim() ? search.results.slice(0, 50) : search.recentResults
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) search.closePalette()
      }}
    >
      <DialogContent
        className="search-dialog translate-x-0 translate-y-0"
        aria-describedby={undefined}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (navigating.current) return
          const target = previousFocus.current?.isConnected
            ? previousFocus.current
            : document.querySelector<HTMLButtonElement>(
                '[aria-label="打开搜索"]'
              )
          target?.focus({ preventScroll: true })
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>搜索与操作</DialogTitle>
        </DialogHeader>
        <Command
          shouldFilter={false}
          loop
          onKeyDownCapture={(event) => {
            if (event.key === "Enter") {
              if (
                composing.current ||
                isComposing(event.nativeEvent) ||
                search.pending
              ) {
                event.preventDefault()
                event.stopPropagation()
                return
              }
              target.current =
                event.ctrlKey || event.metaKey || event.shiftKey
                  ? openTarget(event)
                  : undefined
            }
          }}
        >
          <CommandInput
            value={search.query}
            onValueChange={search.change}
            placeholder="搜索书签、文件夹或操作…"
            aria-label="搜索书签"
            autoFocus
            onCompositionStart={() => {
              composing.current = true
            }}
            onCompositionEnd={() => {
              composing.current = false
            }}
          />
          <CommandList
            className="search-command-list"
            aria-busy={search.pending}
          >
            {search.pending && (
              <div className="p-3">
                <Skeleton className="h-10" />
              </div>
            )}
            {!search.pending && <CommandEmpty>没有匹配结果</CommandEmpty>}
            {!!bookmarks.length && (
              <CommandGroup heading={search.query.trim() ? "书签" : "最近打开"}>
                {bookmarks.map((item) => (
                  <CommandItem
                    value={`bookmark:${item.id}`}
                    key={item.id}
                    className="search-command-item"
                    onSelect={() => choose(() => onOpen(item, target.current))}
                  >
                    <Favicon url={item.url} label={item.title} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        <Highlight text={item.title} query={search.query} />
                      </span>
                      <span className="command-item-path">
                        <Highlight
                          text={byId.get(item.parentId || "") || item.url}
                          query={search.query}
                        />
                      </span>
                    </span>
                    <ArrowUpRight />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!search.pending && !!search.query.trim() && !!search.results.length && (
              <CommandGroup>
                <CommandItem value="all-results" onSelect={search.showAll}>
                  <Search />
                  <span className="flex-1">全部结果</span>
                  <Badge variant="secondary">{search.results.length}</Badge>
                  <ArrowDownLeft />
                </CommandItem>
              </CommandGroup>
            )}
            {!search.pending && !!search.folderResults.length && (
              <>
                <CommandSeparator />
                <CommandGroup heading="文件夹">
                  {search.folderResults.slice(0, 20).map((folder) => (
                    <CommandItem
                      value={`folder:${folder.id}`}
                      key={folder.id}
                      onSelect={() => choose(() => onLocate(folder.id))}
                    >
                      <Folder />
                      <span className="truncate">{folder.path}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {!!commands.length && (
              <>
                <CommandSeparator />
                <CommandGroup heading="操作">
                  {commands.map((action) => (
                    <CommandItem
                      value={`action:${action.id}`}
                      key={action.id}
                      disabled={action.disabled}
                      onSelect={() => choose(action.run)}
                    >
                      <action.icon />
                      <span>{action.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

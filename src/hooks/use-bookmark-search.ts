import { useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { sortItems } from "@/lib/bookmarks"
import { indexBookmarkUrls } from "@/lib/bookmark-index"
import { searchLibrary, warmSearch } from "@/lib/search-service"
import { isComposing, openTarget } from "@/lib/navigation"
import type { OpenTarget } from "@/lib/navigation"
import type { BookmarkFolder, BookmarkItem, SortKey } from "@/lib/types"
import { recentBookmarks } from "@/lib/recent"
import type { RecentOpen } from "@/lib/recent"
import { retainCompute } from "@/lib/compute-client"

export function useBookmarkSearch(
  items: BookmarkItem[],
  folders: BookmarkFolder[],
  sort: SortKey,
  onOpen: (item: BookmarkItem, target?: OpenTarget) => void,
  clicks: Record<string, number> = {},
  recent: RecentOpen[] = []
) {
  const [query, setQuery] = useState("")
  const [pageQuery, setPageQuery] = useState("")
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [matches, setMatches] = useState(items)
  const [folderResults, setFolderResults] = useState<BookmarkFolder[]>([])
  const [pending, setPending] = useState(false)
  const [pageResults, setPageResults] = useState(items)
  const [pageFolders, setPageFolders] = useState<BookmarkFolder[]>([])
  const [duplicatesOnly, setDuplicatesOnly] = useState(false)
  const [selection, setSelection] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const queryActive = !!query.trim()
  const rankedClicks = queryActive ? clicks : undefined
  const rankedRecent = queryActive ? recent : undefined
  const previousScroll = useRef(0)
  useEffect(() => { if (paletteOpen) return retainCompute() }, [paletteOpen])
  useEffect(() => {
    if (!paletteOpen || (!items.length && !folders.length)) return
    void warmSearch(items, folders).catch(() => {})
  }, [items, folders, paletteOpen])
  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => {
      if (current) setPending(!!query.trim())
    })
    void searchLibrary(items, folders, query, rankedClicks, rankedRecent)
      .then((results) => {
        if (current) {
          setMatches(results.items)
          setFolderResults(results.folders)
          setPending(false)
        }
      })
      .catch(() => {
        if (current) {
          setMatches([])
          setPending(false)
        }
      })
    return () => {
      current = false
    }
  }, [items, folders, query, rankedClicks, rankedRecent])
  const results = useMemo(() => {
    const duplicateIds = duplicatesOnly
      ? new Set(
          [...indexBookmarkUrls(items).values()]
            .filter((matches) => matches.length > 1)
            .flatMap((matches) => matches.map((item) => item.id))
        )
      : null
    const source = query.trim() ? matches : items
    const found = duplicateIds
      ? source.filter((item) => duplicateIds.has(item.id))
      : source
    return sort === "name" || !query.trim() ? sortItems(found, sort) : found
  }, [items, matches, sort, query, duplicatesOnly])
  const recentResults = useMemo(
    () => recentBookmarks(items, recent),
    [items, recent]
  )
  const selected = Math.min(selection, results.length - 1)
  useEffect(() => {
    if (paletteOpen || pending || query !== pageQuery) return
    void Promise.resolve().then(() => {
      setPageResults(results)
      setPageFolders(folderResults)
    })
  }, [paletteOpen, pending, results, folderResults, query, pageQuery])
  const active = !!pageQuery.trim() || duplicatesOnly
  function clear() {
    if (pageQuery) {
      const top = previousScroll.current
      let attempts = 0
      const restore = () => {
        if (
          document.documentElement.scrollHeight - innerHeight < top &&
          ++attempts < 30
        )
          requestAnimationFrame(restore)
        else window.scrollTo({ top, behavior: "instant" })
      }
      requestAnimationFrame(restore)
    }
    setQuery("")
    setPageQuery("")
    setDuplicatesOnly(false)
    setSelection(-1)
  }
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  }, [])
  useEffect(() => {
    if (active && selected >= 0)
      document
        .querySelector('[data-selected="true"]')
        ?.scrollIntoView({ block: "nearest" })
  }, [active, selected])
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (isComposing(event.nativeEvent)) return
    if (event.key === "Escape") {
      clear()
      inputRef.current?.blur()
      return
    }
    if (!active || !results.length) return
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault()
      setSelection(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? results.length - 1
            : event.key === "ArrowDown"
              ? (selected + 1) % results.length
              : selected <= 0
                ? results.length - 1
                : selected - 1
      )
    }
    if (event.key === "Enter") {
      event.preventDefault()
      onOpen(
        results[Math.max(0, selected)],
        event.ctrlKey || event.metaKey || event.shiftKey
          ? openTarget(event)
          : undefined
      )
    }
  }
  return {
    query,
    pageQuery,
    paletteOpen,
    pending,
    openPalette: () => {
      setQuery(pageQuery)
      setPaletteOpen(true)
    },
    closePalette: () => {
      setQuery(pageQuery)
      setPaletteOpen(false)
    },
    showAll: () => {
      if (!pageQuery) previousScroll.current = scrollY
      setPageQuery(query)
      setPageResults(results)
      setPageFolders(folderResults)
      setPaletteOpen(false)
      setSelection(-1)
      requestAnimationFrame(() =>
        window.scrollTo({ top: 0, behavior: "instant" })
      )
    },
    pageResults,
    pageFolders,
    active,
    duplicatesOnly,
    results,
    recentResults,
    folderResults,
    selected,
    inputRef,
    clear,
    onKeyDown,
    change: (value: string) => {
      setQuery(value)
      setPending(!!value.trim())
      setSelection(-1)
    },
    showDuplicates: () => {
      setQuery("")
      setDuplicatesOnly(true)
      setSelection(-1)
    },
  }
}

export type BookmarkSearch = ReturnType<typeof useBookmarkSearch>

import { useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { sortItems } from "@/lib/bookmarks"
import { indexBookmarkUrls } from "@/lib/bookmark-index"
import { createSearchIndex, searchBookmarks, queryTokens } from "@/lib/search"
import { isComposing, openTarget } from "@/lib/navigation"
import type { OpenTarget } from "@/lib/navigation"
import type { BookmarkFolder, BookmarkItem, SortKey } from "@/lib/types"

export function useBookmarkSearch(
  items: BookmarkItem[],
  folders: BookmarkFolder[],
  sort: SortKey,
  onOpen: (item: BookmarkItem, target?: OpenTarget) => void
) {
  const [query, setQuery] = useState("")
  const [duplicatesOnly, setDuplicatesOnly] = useState(false)
  const [selection, setSelection] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const index = useMemo(
    () => createSearchIndex(items, folders),
    [items, folders]
  )
  const folderResults = useMemo(() => {
    const tokens = queryTokens(query)
    return !tokens.length || duplicatesOnly
      ? []
      : folders.filter((folder) =>
          tokens.every((token) =>
            folder.path.normalize("NFKC").toLocaleLowerCase().includes(token)
          )
        )
  }, [folders, query, duplicatesOnly])
  const results = useMemo(() => {
    const duplicateIds = duplicatesOnly
      ? new Set(
          [...indexBookmarkUrls(items).values()]
            .filter((matches) => matches.length > 1)
            .flatMap((matches) => matches.map((item) => item.id))
        )
      : null
    const matches = searchBookmarks(index, query).filter(
      (item) => !duplicateIds || duplicateIds.has(item.id)
    )
    return sort === "name" || !query.trim() ? sortItems(matches, sort) : matches
  }, [items, index, sort, query, duplicatesOnly])
  const selected = Math.min(selection, results.length - 1)
  const active = !!query.trim() || duplicatesOnly
  function clear() {
    setQuery("")
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
        inputRef.current?.focus()
        inputRef.current?.select()
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
    active,
    duplicatesOnly,
    results,
    folderResults,
    selected,
    inputRef,
    clear,
    onKeyDown,
    change: (value: string) => {
      setQuery(value)
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

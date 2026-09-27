import { BookmarkCard } from "./bookmark-card"
import { BookmarkGrid } from "./bookmark-grid"
import type { BookmarkActions } from "./bookmark-card"
import type { AppSettings, BookmarkFolder, BookmarkItem } from "@/lib/types"

export function BookmarkResults({
  items,
  folders,
  settings,
  clicks,
  actions,
  query,
  selected,
}: {
  items: BookmarkItem[]
  folders: BookmarkFolder[]
  settings: AppSettings
  clicks: Record<string, number>
  actions: BookmarkActions
  query: string
  selected: number
}) {
  const paths = new Map(folders.map((folder) => [folder.id, folder.path]))
  return (
    <BookmarkGrid className="search-results" items={items} selected={selected}>
      {(item, index) => (
        <div className="search-result" key={item.id}>
          <BookmarkCard
            item={item}
            settings={settings}
            count={clicks[item.url] || 0}
            actions={actions}
            query={query}
            selected={selected === index}
          />
          <span
            className="result-folder truncate"
            title={paths.get(item.parentId || "")}
          >
            {paths.get(item.parentId || "")}
          </span>
        </div>
      )}
    </BookmarkGrid>
  )
}

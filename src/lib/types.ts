export type BookmarkItem = {
  id: string
  title: string
  url: string
  dateAdded?: number
  parentId?: string
  index?: number
  readOnly?: boolean
}

export type BookmarkGroup = {
  id: string
  name: string
  items: BookmarkItem[]
}

export type BookmarkFolder = {
  id: string
  title: string
  path: string
  parentId?: string
  readOnly?: boolean
  root?: boolean
  folderType?: string
  index?: number
}

export type SortKey = "default" | "name"
export type Density = "compact" | "standard" | "loose"
export type IconMode = "favicon" | "none"
export type LayoutMode = "zones" | "heat"
export type FontScale = "s" | "m" | "l"

export type AppSettings = {
  sort: SortKey
  density: Density
  iconMode: IconMode
  showDomain: boolean
  collapsedSections: string[]
  layout: LayoutMode
  fontScale: FontScale
  cardScale: number
  newTab: boolean
  onlineIcons: boolean
  activeFolderId: string
  folderLayout: "grid" | "list"
}

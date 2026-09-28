import {
  heatCanvas,
  heatTopologySnapshot,
  hydrateHeatTopologies,
} from "../lib/heat-layout"
import {
  createSearchIndex,
  createFolderSearchIndex,
  searchBookmarks,
} from "../lib/search"
let searchIndex: ReturnType<typeof createSearchIndex> = []
let folderIndex: ReturnType<typeof createSearchIndex> = []
let searchRevision = -1
self.onmessage = async (event) => {
  const { id, task, payload } = event.data
  try {
    if (task === "heat") {
      hydrateHeatTopologies(payload.topologies)
      const result = heatCanvas(
        payload.items,
        payload.clicks,
        payload.width,
        payload.available,
        payload.gap,
        payload.scale
      )
      self.postMessage({
        id,
        value: {
          height: result.height,
          boxes: result.boxes.map(({ item, ...box }) => ({
            ...box,
            id: item.id,
          })),
          topologies: heatTopologySnapshot(),
        },
      })
    } else if (task === "search-index") {
      searchIndex = createSearchIndex(payload.items, payload.folders)
      folderIndex = createFolderSearchIndex(payload.folders)
      searchRevision = payload.revision
      self.postMessage({ id, value: searchRevision })
    } else if (task === "search") {
      self.postMessage({
        id,
        value: {
          revision: searchRevision,
          ids: searchBookmarks(searchIndex, payload.query).map(
            (item) => item.id
          ),
          folderIds: searchBookmarks(folderIndex, payload.query).map(
            (item) => item.id
          ),
        },
      })
    }
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "计算失败",
    })
  }
}

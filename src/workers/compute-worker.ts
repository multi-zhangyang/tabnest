import { COMPUTE_VERSION } from "../lib/compute-client"
import type { HeatInput } from "../lib/heat-layout"
import { calculateHeat } from "../lib/heat-layout"
import { solveRegionTasks } from "../lib/heat-session"
const cancelled = new Set<number>()
import type * as SearchModule from "../lib/search"
let searchModule: typeof SearchModule | undefined
let searchIndex: ReturnType<typeof SearchModule.createSearchIndex> = []
let folderIndex: ReturnType<typeof SearchModule.createSearchIndex> = []
let searchRevision = -1
self.onmessage = async (event) => {
  const { version, id, task, payload, session, dataRevision, requestRevision } = event.data
  if (task === "cancel") { cancelled.add(id); if (cancelled.size > 128) cancelled.delete(cancelled.values().next().value!); return }
  const respond = (result: object) => {
    if (!cancelled.delete(id)) self.postMessage({ version: COMPUTE_VERSION, id, session, dataRevision, requestRevision, ...result })
  }
  try {
    if (version !== COMPUTE_VERSION) throw new Error("计算版本不兼容")
    if (["heat-regions", "heat-init", "heat-delta", "heat-viewport"].includes(task)) {
      const results = []
      for (const regionTask of payload.tasks) {
        await new Promise(resolve => setTimeout(resolve, 0))
        if (cancelled.delete(id)) return
        results.push(...solveRegionTasks([regionTask], payload.gap, payload.scale))
      }
      respond({ value: results })
    } else if (task === "heat") {
      self.postMessage({
        version: COMPUTE_VERSION,
        id,
        value: calculateHeat(payload as HeatInput),
      })
    } else if (task === "search-index") {
      searchModule ??= await import("../lib/search")
      searchIndex = searchModule.createSearchIndex(payload.items, payload.folders)
      folderIndex = searchModule.createFolderSearchIndex(payload.folders)
      searchRevision = payload.revision
      self.postMessage({ version: COMPUTE_VERSION, id, value: searchRevision })
    } else if (task === "search") {
      self.postMessage({
        version: COMPUTE_VERSION,
        id,
        value: {
          revision: searchRevision,
          ids: searchModule!.searchBookmarks(
            searchIndex,
            payload.query,
            payload.clicks,
            payload.recent
          ).map((item) => item.id),
          folderIds: searchModule!.searchBookmarks(folderIndex, payload.query).map(
            (item) => item.id
          ),
        },
      })
    }
  } catch (error) {
    self.postMessage({
      version: COMPUTE_VERSION,
      id,
      error: error instanceof Error ? error.message : "计算失败",
    })
  }
}

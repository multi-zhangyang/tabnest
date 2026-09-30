import { useEffect, useLayoutEffect, useState, useRef, useMemo } from "react"
import { savedHeatSnapshot, persistHeatTopologies, clearHeatWorkingCaches } from "@/lib/heat-layout"
import type { HeatLayout } from "@/lib/heat-layout"
import { createHeatSession } from "@/lib/heat-session"
import type { RegionResult } from "@/lib/heat-session"
import type { BookmarkItem } from "@/lib/types"
import { compute, onComputeDispose } from "@/lib/compute-client"
import { changedClickUrls } from "@/lib/preferences"
onComputeDispose(clearHeatWorkingCaches)
let serial = 0
export function useHeatCanvas(
  items: BookmarkItem[], clicks: Record<string, number>, width: number,
  available: number, gap: number, scale: number, frozen: boolean,
  visible: { top: number; bottom: number }, focusedId: string
) {
  const [revision, setRevision] = useState(0)
  const request = useRef(0)
  const identity = useRef({ session: 0 })
  const [layout, setLayout] = useState<HeatLayout>({ boxes: [], height: available, affectedIds: [] })
  const session = useMemo(() => {
    const input = { items, clicks: {}, width, available, gap, scale }
    return { id: ++serial, value: createHeatSession({ ...input, clicks, previous: savedHeatSnapshot(input) }) }
    // Clicks are applied as deltas below, without rebuilding collection indexes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, width, available, gap, scale])
  useEffect(() => {
    const resume = () => { if (!document.hidden) setRevision(n => n + 1) }
    document.addEventListener("visibilitychange", resume)
    return () => { document.removeEventListener("visibilitychange", resume) }
  }, [])
  useLayoutEffect(() => {
    const value = session.value
    if (!value) return
    const id = ++request.current
    value.update(clicks, changedClickUrls(clicks))
    if (frozen && identity.current.session !== 0) return
    identity.current.session = session.id
    const top = items.length <= 250 ? -Infinity : visible.top
    const bottom = items.length <= 250 ? Infinity : visible.bottom
    value.solve(value.visibleIndices(top, bottom, focusedId))
    const publish = () => setLayout({
      height: value.snapshot.height, snapshot: value.snapshot, affectedIds: [],
      boxes: value.visible(top, bottom, focusedId),
    })
    publish()
    let timer: ReturnType<typeof setTimeout>
    const abort = new AbortController()
    const run = async () => {
      if (abort.signal.aborted || document.hidden || !value.pending.size) return
      const tasks = value.tasks([...value.pending].slice(0, 4))
      try {
        const task = tasks.some(t => t.initial) ? "heat-init" : "heat-delta"
        const results = await compute<RegionResult[]>(task, { tasks, gap, scale }, {
          signal: abort.signal, session: session.id, dataRevision: session.id, requestRevision: id,
        })
        if (abort.signal.aborted || request.current !== id) return
        value.accept(results)
      } catch {
        if (abort.signal.aborted || request.current !== id) return
        value.solve(tasks.map(t => t.index))
      }
      if (!value.pending.size) {
        publish()
        timer = setTimeout(() => { void persistHeatTopologies() }, 280)
      } else timer = setTimeout(() => { void run() }, 16)
    }
    if (!value.pending.size) timer = setTimeout(() => { void persistHeatTopologies() }, 280)
    else timer = setTimeout(() => { void run() }, 50)
    return () => { clearTimeout(timer); abort.abort() }
  }, [session, items.length, clicks, frozen, visible.top, visible.bottom, focusedId, gap, scale, revision])
  return { ...layout, ready: !!session.value && layout.snapshot?.key === session.value.snapshot.key, getBox: (id: string) => session.value?.box(id) }
}

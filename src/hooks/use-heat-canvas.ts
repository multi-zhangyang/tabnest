import { useEffect, useMemo, useState } from "react"
import {
  heatCanvas,
  heatTopologySnapshot,
  hydrateHeatTopologies,
  persistHeatTopologies,
} from "@/lib/heat-layout"
import type { HeatBox } from "@/lib/heat-layout"
import type { BookmarkItem } from "@/lib/types"
import { compute } from "@/lib/compute-client"

export function useHeatCanvas(
  items: BookmarkItem[],
  clicks: Record<string, number>,
  width: number,
  available: number,
  gap: number,
  scale: number,
  frozen: boolean
) {
  const [settled, setSettled] = useState(clicks)
  useEffect(() => {
    if (frozen) return
    const timer = setTimeout(() => setSettled(clicks), 48)
    return () => clearTimeout(timer)
  }, [clicks, frozen])
  const large = items.length >= 1000
  const sync = useMemo(
    () =>
      large || frozen
        ? null
        : heatCanvas(items, settled, width, available, gap, scale),
    [items, settled, width, available, gap, scale, large, frozen]
  )
  const [asyncLayout, setAsyncLayout] = useState<{
    boxes: HeatBox[]
    height: number
  }>({ boxes: [], height: available })
  const nextLayout = sync || asyncLayout
  const [displayed, setDisplayed] = useState(nextLayout)
  if (!frozen && displayed !== nextLayout) setDisplayed(nextLayout)
  useEffect(() => {
    if (!large || !width || frozen) return
    let current = true
    const input = {
      items,
      clicks: settled,
      width,
      available,
      gap,
      scale,
      topologies: heatTopologySnapshot(),
    }
    void compute<{
      height: number
      boxes: {
        id: string
        x: number
        y: number
        width: number
        height: number
      }[]
      topologies: unknown
    }>("heat", input)
      .then((result) => {
        if (!current) return
        const byId = new Map(items.map((item) => [item.id, item]))
        setAsyncLayout({
          height: result.height,
          boxes: result.boxes.map(({ id, ...box }) => ({
            ...box,
            item: byId.get(id)!,
          })),
        })
        hydrateHeatTopologies(result.topologies)
        persistHeatTopologies()
      })
      .catch(() => {
        if (current)
          setAsyncLayout(
            heatCanvas(items, settled, width, available, gap, scale)
          )
      })
    return () => {
      current = false
    }
  }, [items, settled, width, available, gap, scale, large, frozen])
  useEffect(() => {
    if (sync) persistHeatTopologies()
  }, [sync])
  return displayed
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { BookmarkCard } from "./bookmark-card"
import type { BookmarkActions } from "./bookmark-card"
import type { AppSettings, BookmarkItem } from "@/lib/types"
import {
  heatLayout,
  heatWeight,
  hydrateHeatTopologies,
  persistHeatTopologies,
} from "@/lib/heat-layout"
import { useVisibleCanvas } from "@/hooks/use-visible-canvas"
hydrateHeatTopologies()

export function HeatMap({
  items,
  clicks,
  settings,
  actions,
}: {
  items: BookmarkItem[]
  clicks: Record<string, number>
  settings: AppSettings
  actions: BookmarkActions
}) {
  const container = useRef<HTMLDivElement>(null)
  const visible = useVisibleCanvas(container, items.length > 250)
  const [focusedId, setFocusedId] = useState("")
  const pendingFocus = useRef("")
  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    const cell = [
      ...(container.current?.querySelectorAll<HTMLElement>("[data-item-id]") ||
        []),
    ].find((element) => element.dataset.itemId === pendingFocus.current)
    const element =
      cell?.querySelector<HTMLElement>(".bookmark-checkbox:not(:disabled)") ||
      cell?.querySelector<HTMLElement>("a[data-bookmark-id]")
    if (element) {
      element.focus({ preventScroll: true })
      pendingFocus.current = ""
    }
  }, [focusedId, visible])
  const [size, setSize] = useState({ width: 0, available: 600 })
  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const update = () => {
      const rect = element.getBoundingClientRect()
      setSize((current) => {
        const width = Math.round(rect.width),
          available = Math.max(
            360,
            innerHeight - (rect.top + window.scrollY) - 32
          )
        return current.width === width && current.available === available
          ? current
          : { width, available }
      })
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener("resize", update)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [])
  const gap =
    settings.density === "compact" ? 5 : settings.density === "loose" ? 12 : 8
  const height = useMemo(() => {
    if (!size.width || !items.length) return size.available
    const weights = items.map((item) => heatWeight(clicks[item.url] || 0))
    const minimumArea =
      Math.min(17500, size.width * 0.34 * 105) * settings.cardScale ** 2
    return Math.max(
      size.available,
      Math.ceil(
        ((weights.reduce((a, b) => a + b, 0) / Math.min(...weights)) *
          minimumArea) /
          size.width
      )
    )
  }, [items, clicks, size, settings.cardScale])
  const boxes = useMemo(
    () => heatLayout(items, clicks, size.width, height, gap),
    [items, size.width, height, clicks, gap]
  )
  useEffect(() => {
    persistHeatTopologies()
  }, [boxes])
  return (
    <div className="heat-view">
      <div
        ref={container}
        className="heat-canvas"
        style={{ height }}
        data-testid="heat-canvas"
        onFocusCapture={(event) =>
          setFocusedId(
            (event.target as HTMLElement).closest<HTMLElement>("[data-item-id]")
              ?.dataset.itemId || ""
          )
        }
        onKeyDown={(event) => {
          if (
            items.length <= 250 ||
            event.key !== "Tab" ||
            !(event.target as HTMLElement).matches(
              "a[data-bookmark-id], .bookmark-checkbox"
            )
          )
            return
          const id = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-item-id]"
          )?.dataset.itemId
          const index = boxes.findIndex((box) => box.item.id === id)
          const next = boxes[index + (event.shiftKey ? -1 : 1)]
          if (!next) return
          event.preventDefault()
          pendingFocus.current = next.item.id
          setFocusedId(next.item.id)
          const canvasTop =
            (container.current?.getBoundingClientRect().top || 0) + scrollY
          const top = canvasTop + next.y
          if (top < scrollY + 90 || top + next.height > scrollY + innerHeight)
            window.scrollTo({
              top: Math.max(0, top - 100),
              behavior: "instant",
            })
        }}
      >
        {boxes
          .filter(
            (box) =>
              items.length <= 250 ||
              box.item.id === focusedId ||
              (box.y + box.height >= visible.top && box.y <= visible.bottom)
          )
          .map((box) => {
            const vertical = box.width / box.height < 1.1
            const compact = box.width < 115 || box.height < 74
            const tiny = box.width < 64 || box.height < 42
            const unit = Math.sqrt(box.width * box.height)
            const padding = Math.max(
              2,
              Math.min(30, Math.min(box.width, box.height) * 0.12)
            )
            const icon = Math.max(
              4,
              Math.min(
                84,
                unit * 0.27 * settings.cardScale,
                box.width * (vertical ? 0.48 : 0.28),
                box.height * (vertical ? 0.42 : 0.6)
              )
            )
            const gap = Math.min(26, Math.min(box.width, box.height) * 0.1)
            const fontScale =
              settings.fontScale === "s"
                ? 0.9
                : settings.fontScale === "l"
                  ? 1.1
                  : 1
            const font =
              (unit < 120
                ? 12
                : unit < 180
                  ? 14
                  : unit < 260
                    ? 16
                    : unit < 350
                      ? 20
                      : 24) * fontScale
            const style = {
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
              "--tile-font": `${font}px`,
              "--tile-icon": `${icon}px`,
              "--tile-gap": `${gap}px`,
              "--tile-radius": `${Math.min(22, Math.min(box.width, box.height) * 0.14)}px`,
              "--tile-pad": `${padding}px`,
            } as CSSProperties
            return (
              <BookmarkCard
                key={box.item.id}
                item={box.item}
                actions={actions}
                settings={settings}
                heat
                vertical={vertical}
                compact={compact}
                tiny={tiny}
                style={style}
                count={clicks[box.item.url] || 0}
              />
            )
          })}
      </div>
    </div>
  )
}

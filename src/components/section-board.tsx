import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import type { AppSettings, BookmarkFolder, BookmarkGroup } from "@/lib/types"
import { useVisibleCanvas } from "@/hooks/use-visible-canvas"

export function SectionBoard({
  blocks,
  groups,
  settings,
  children,
}: {
  blocks: BookmarkFolder[]
  groups: Map<string, BookmarkGroup>
  settings: AppSettings
  children: (folder: BookmarkFolder) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const virtual = blocks.length > 30
  const range = useVisibleCanvas(ref, virtual)
  const [width, setWidth] = useState(0)
  const [sizes, setSizes] = useState<Map<string, number>>(new Map())
  const [focused, setFocused] = useState("")
  const pendingFocus = useRef<{ id: string; last: boolean } | null>(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    const update = () =>
      setWidth(Math.round(ref.current!.getBoundingClientRect().width))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const columns = Math.max(1, Math.min(3, Math.floor((width + 16) / 336)))
  const columnWidth = (width - (columns - 1) * 16) / columns
  const signature = `${columnWidth}:${settings.cardScale}:${settings.fontScale}:${settings.density}:${settings.folderLayout}:${settings.showDomain}`
  const measured = useCallback(
    (key: string, height: number) =>
      setSizes((previous) => {
        if (Math.abs((previous.get(key) || 0) - height) < 1) return previous
        const next = new Map(previous)
        next.set(key, height)
        return next
      }),
    []
  )
  const layout = useMemo(() => {
    const bottoms = Array<number>(columns).fill(0)
    const rows = blocks.map((folder) => {
      const count = groups.get(folder.id)?.items.length || 0
      const collapsed = settings.collapsedSections.includes(folder.id)
      const key = `${signature}:${folder.id}:${count}:${collapsed}`
      const innerColumns =
        settings.folderLayout === "list"
          ? 1
          : width <= 580
            ? 2
            : Math.max(
                1,
                Math.floor(
                  (columnWidth - 28 + 6) / (160 * settings.cardScale + 6)
                )
              )
      const stride =
        (settings.density === "compact"
          ? 56
          : settings.density === "loose"
            ? 78
            : settings.folderLayout === "list"
              ? 52
              : 60) *
          settings.cardScale +
        (settings.density === "loose" ? 10 : 6)
      const estimate = collapsed
        ? 64
        : 76 + Math.max(28, Math.ceil(count / innerColumns) * stride)
      const height = sizes.get(key) || estimate
      const column = bottoms.indexOf(Math.min(...bottoms))
      const top = bottoms[column]
      bottoms[column] += height + 16
      return { folder, key, height, top, left: column * (columnWidth + 16) }
    })
    return { rows, height: Math.max(0, ...bottoms) }
  }, [blocks, groups, settings, signature, width, columnWidth, columns, sizes])
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    const section = [
      ...ref.current!.querySelectorAll<HTMLElement>("[data-folder-id]"),
    ].find((element) => element.dataset.folderId === pending.id)
    const anchors = section?.querySelectorAll<HTMLElement>(
      "a[data-bookmark-id], .section-title"
    )
    const target = pending.last ? anchors?.[anchors.length - 1] : anchors?.[0]
    if (target) {
      target.focus({ preventScroll: true })
      pendingFocus.current = null
    }
  }, [focused, range])
  return (
    <div
      ref={ref}
      className="section-board"
      data-virtual={virtual || undefined}
      data-layout={settings.folderLayout}
      style={
        virtual
          ? { display: "block", position: "relative", height: layout.height }
          : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
      }
      onFocusCapture={(event) =>
        setFocused(
          (event.target as HTMLElement).closest<HTMLElement>("[data-folder-id]")
            ?.dataset.folderId || ""
        )
      }
      onKeyDownCapture={(event) => {
        if (!virtual || event.key !== "Tab") return
        const element = event.target as HTMLElement
        const section = element.closest<HTMLElement>("[data-folder-id]")
        if (!section) return
        const controls = [
          ...section.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[data-bookmark-id], .bookmark-checkbox:not(:disabled)"
          ),
        ].filter((node) => node.tabIndex >= 0)
        if (element !== (event.shiftKey ? controls[0] : controls.at(-1))) return
        const index = blocks.findIndex(
          (folder) => folder.id === section.dataset.folderId
        )
        const next = blocks[index + (event.shiftKey ? -1 : 1)]
        if (!next) return
        event.preventDefault()
        pendingFocus.current = { id: next.id, last: event.shiftKey }
        setFocused(next.id)
        const target = [
          ...ref.current!.querySelectorAll<HTMLElement>("[data-folder-id]"),
        ].find((node) => node.dataset.folderId === next.id)
        target?.scrollIntoView({ block: "nearest" })
      }}
    >
      {layout.rows.map(({ folder, key, top, left, height }) => {
        const visible =
          !virtual ||
          folder.id === focused ||
          (top + height >= range.top && top <= range.bottom)
        return (
          <section
            key={folder.id}
            className="section-slot"
            data-folder-id={folder.id}
            aria-label={`${folder.path}文件夹`}
            tabIndex={-1}
            style={
              virtual
                ? {
                    position: "absolute",
                    top,
                    left,
                    width: columnWidth,
                    height,
                  }
                : { gridRowEnd: `span ${Math.ceil((height + 16) / 8)}` }
            }
          >
            {visible && (
              <MeasuredSection measureKey={key} onMeasure={measured}>
                {children(folder)}
              </MeasuredSection>
            )}
          </section>
        )
      })}
    </div>
  )
}
function MeasuredSection({
  children,
  measureKey,
  onMeasure,
}: {
  children: ReactNode
  measureKey: string
  onMeasure: (key: string, height: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const update = () =>
      onMeasure(measureKey, ref.current!.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(ref.current!)
    return () => observer.disconnect()
  }, [measureKey, onMeasure])
  return <div ref={ref}>{children}</div>
}

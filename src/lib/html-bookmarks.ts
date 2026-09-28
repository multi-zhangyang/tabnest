import { parse, type DefaultTreeAdapterMap } from "parse5"
import { createBackup, planJsonImport } from "./backup"
import type { ImportPlan } from "./backup"
import type { BookmarkData } from "./bookmarks"
import { AppError } from "./errors"

type Node = DefaultTreeAdapterMap["node"]
const children = (node: Node): Node[] =>
  "childNodes" in node ? node.childNodes : []
const tag = (node: Node) => ("tagName" in node ? node.tagName : "")
const text = (node: Node): string =>
  "value" in node ? node.value : children(node).map(text).join("")
const attribute = (node: Node, key: string) =>
  "attrs" in node ? node.attrs.find((a) => a.name === key)?.value : undefined
function within(node: Node, name: string): Node | undefined {
  for (const child of children(node)) {
    if (tag(child) === name) return child
    if (!["dl", "dt"].includes(tag(child))) {
      const match = within(child, name)
      if (match) return match
    }
  }
}

export function planHtmlImport(source: string): ImportPlan {
  if (new TextEncoder().encode(source).length > 10 * 1024 * 1024)
    throw new AppError("invalid-data", "文件不能超过 10 MB")
  if (!/<(?:dl|a)\b/i.test(source))
    throw new AppError("invalid-data", "书签文件无效")
  const data: BookmarkData = {
    folders: [{ id: "html-root", title: "书签", path: "书签" }],
    groups: [{ id: "html-root", name: "书签", items: [] }],
  }
  const groups = new Map(data.groups.map((group) => [group.id, group]))
  const paths = new Map([["html-root", "书签"]])
  const positions = new Map<string, number>()
  let serial = 0,
    bookmarks = 0
  function position(parentId: string) {
    const index = positions.get(parentId) || 0
    positions.set(parentId, index + 1)
    return index
  }
  function walk(node: Node, parentId: string, depth: number) {
    if (depth > 100) throw new AppError("invalid-data", "文件夹超过 100 层")
    let pending = parentId
    for (const child of children(node)) {
      const name = tag(child)
      if (name === "dt") {
        pending = parentId
        const heading = within(child, "h3"),
          link = within(child, "a")
        if (heading) {
          if (data.folders.length >= 2000)
            throw new AppError("invalid-data", "文件夹超过 2000 个")
          const id = `html-${++serial}`,
            title = text(heading).trim() || "未命名文件夹"
          const path = `${paths.get(parentId)} / ${title}`
          data.folders.push({
            id,
            title,
            path,
            parentId,
            index: position(parentId),
          })
          const group = { id, name: path, items: [] }
          data.groups.push(group)
          groups.set(id, group)
          paths.set(id, path)
          pending = id
        } else if (link) {
          if (++bookmarks > 20000)
            throw new AppError("invalid-data", "书签超过 20000 个")
          const url = attribute(link, "href") || ""
          groups
            .get(parentId)!
            .items.push({
              id: `html-${++serial}`,
              title: text(link).trim() || url,
              url,
              parentId,
              index: position(parentId),
              dateAdded:
                Number(attribute(link, "add_date")) * 1000 || undefined,
            })
        }
        // Only descend into child lists: the heading/link was already consumed.
        const nested = (entry: Node) => {
          for (const n of children(entry)) {
            if (tag(n) === "dl") walk(n, pending, depth + (heading ? 1 : 0))
            else if (!["h3", "a", "dt"].includes(tag(n))) nested(n)
          }
        }
        nested(child)
      } else if (name === "dl") {
        walk(child, pending, depth + (pending !== parentId ? 1 : 0))
        pending = parentId
      } else if (!["script", "style", "template"].includes(name))
        walk(child, parentId, depth)
    }
  }
  walk(parse(source), "html-root", 0)
  const plan = planJsonImport(JSON.stringify(createBackup(data)))
  return { ...plan, format: "html" }
}

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
export function exportHtmlBookmarks(data: BookmarkData): string {
  const ids = new Set(data.folders.map((folder) => folder.id))
  const folders = new Map<string, typeof data.folders>()
  const groups = new Map(data.groups.map((group) => [group.id, group.items]))
  for (const folder of data.folders) {
    const parent =
      folder.parentId && ids.has(folder.parentId) ? folder.parentId : ""
    const list = folders.get(parent) || []
    list.push(folder)
    folders.set(parent, list)
  }
  function render(parent: string): string {
    const nodes = [
      ...(folders.get(parent) || []).map((folder) => ({
        index: folder.index,
        render: () =>
          `<DT><H3>${escape(folder.title)}</H3>\n<DL><p>\n${render(folder.id)}</DL><p>\n`,
      })),
      ...(groups.get(parent) || []).map((item) => ({
        index: item.index,
        render: () =>
          `<DT><A HREF="${escape(item.url)}"${item.dateAdded ? ` ADD_DATE="${Math.floor(item.dateAdded / 1000)}"` : ""}>${escape(item.title)}</A>\n`,
      })),
    ]
    return nodes
      .sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity))
      .map((node) => node.render())
      .join("")
  }
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>TabNest</TITLE>\n<H1>TabNest</H1>\n<DL><p>\n${render("")}</DL><p>\n`
}

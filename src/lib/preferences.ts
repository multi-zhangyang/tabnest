import type { AppSettings } from "./types"
import { readDocument, updateDocument, STORAGE_KEYS } from "./storage"
import { isExtension } from "./platform"
import { safeUrl } from "./urls"
import { AppError } from "./errors"
import { DEMO_CLICKS } from "./demo"

export const DEFAULT_SETTINGS: AppSettings = {
  sort: "default",
  density: "standard",
  iconMode: "favicon",
  showDomain: true,
  collapsedSections: [],
  layout: "heat",
  fontScale: "m",
  cardScale: 1,
  newTab: false,
  onlineIcons: false,
  activeFolderId: "",
  folderLayout: "grid",
}

export function clampSettings(raw: unknown): AppSettings {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const result = { ...DEFAULT_SETTINGS }
  const enums = {
    sort: ["default", "name"],
    density: ["compact", "standard", "loose"],
    iconMode: ["favicon", "none"],
    layout: ["heat", "zones"],
    fontScale: ["s", "m", "l"],
    folderLayout: ["grid", "list"],
  } as const
  for (const key of Object.keys(enums) as (keyof typeof enums)[]) {
    if ((enums[key] as readonly unknown[]).includes(value[key]))
      Object.assign(result, { [key]: value[key] })
  }
  for (const key of ["showDomain", "newTab", "onlineIcons"] as const)
    if (typeof value[key] === "boolean") result[key] = value[key]
  if (typeof value.activeFolderId === "string")
    result.activeFolderId = value.activeFolderId
  if (Array.isArray(value.collapsedSections))
    result.collapsedSections = value.collapsedSections.filter(
      (x): x is string => typeof x === "string"
    )
  if (typeof value.cardScale === "number" && Number.isFinite(value.cardScale))
    result.cardScale = Math.min(1.5, Math.max(0.75, value.cardScale))
  return result
}

export function loadSettings() {
  return readDocument(
    STORAGE_KEYS.settings,
    () => ({ ...DEFAULT_SETTINGS, collapsedSections: [] }),
    clampSettings
  )
}
export function saveSettings(patch: Partial<AppSettings>) {
  return updateDocument(
    STORAGE_KEYS.settings,
    () => ({ ...DEFAULT_SETTINGS, collapsedSections: [] }),
    clampSettings,
    (current) => clampSettings({ ...current, ...patch })
  )
}
export function validateClicks(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid clicks")
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) =>
        Boolean(safeUrl(key)) &&
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0
    )
  )
}
const initialClicks = () => (isExtension ? {} : { ...DEMO_CLICKS })
export function loadClicks() {
  return readDocument(STORAGE_KEYS.clicks, initialClicks, validateClicks)
}
export function bumpClick(url: string) {
  if (!safeUrl(url)) throw new AppError("invalid-data", "网址无效")
  return updateDocument(
    STORAGE_KEYS.clicks,
    initialClicks,
    validateClicks,
    (current) => ({
      ...current,
      [url]: Math.min(Number.MAX_SAFE_INTEGER, (current[url] || 0) + 1),
    })
  )
}

export function mergeClicks(incoming: Record<string, number>) {
  const validated = validateClicks(incoming)
  return updateDocument(
    STORAGE_KEYS.clicks,
    initialClicks,
    validateClicks,
    (current) => {
      const next = { ...current }
      for (const [url, count] of Object.entries(validated))
        next[url] = Math.max(next[url] || 0, count)
      return next
    }
  )
}

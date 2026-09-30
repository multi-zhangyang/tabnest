import { AppError } from "./errors"
import { isExtension, withLock } from "./platform"

export const STORAGE_KEYS = {
  settings: "tabnest:settings",
  clicks: "tabnest:clicks",
  recent: "tabnest:recent:v1",
  demo: "tabnest:demo-bookmarks:v2",
} as const
export const SCHEMA_VERSION = 1
export type StoredDocument<T> = {
  schemaVersion: 1
  revision: number
  updatedAt: string
  data: T
}
type Recovery = {
  savedAt: string
  reason: "migration" | "invalid-data"
  raw: unknown
}
const hasOwn = (object: object, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key)

async function readRaw(key: string, legacy = true): Promise<unknown> {
  try {
    if (!isExtension) return localStorage.getItem(key) ?? undefined
    const local = (await chrome.storage.local.get(key))[key]
    return local === undefined && legacy
      ? (await chrome.storage.sync.get(key))[key]
      : local
  } catch (cause) {
    throw new AppError("storage", "无法读取本地数据", { cause })
  }
}

async function writeRaw(key: string, value: unknown) {
  try {
    if (isExtension) await chrome.storage.local.set({ [key]: value })
    else {
      localStorage.setItem(key, JSON.stringify(value))
      if (typeof window !== "undefined")
        window.dispatchEvent(
          new CustomEvent("tabnest:storage", { detail: key })
        )
    }
  } catch (cause) {
    throw new AppError("storage", "本地存储写入失败", { cause })
  }
}

function parse(raw: unknown) {
  return typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw
}

async function preserve(key: string, raw: unknown, reason: Recovery["reason"]) {
  const recoveryKey = `tabnest:recovery:${key}`
  let entries: Recovery[] = []
  try {
    const previous = parse(await readRaw(recoveryKey, false))
    if (Array.isArray(previous)) entries = previous as Recovery[]
  } catch {
    /* The original active value is still preserved below. */
  }
  const next = [
    ...entries.slice(-2),
    { savedAt: new Date().toISOString(), reason, raw },
  ]
  await writeRaw(recoveryKey, next)
}

async function readUnlocked<T>(
  key: string,
  fallback: () => T,
  validate: (value: unknown) => T,
  recover: boolean
): Promise<{ data: T; revision: number }> {
  const raw = await readRaw(key)
  if (raw === undefined) return { data: fallback(), revision: 0 }
  let parsed: unknown
  try {
    parsed = parse(raw)
  } catch (cause) {
    if (!recover)
      throw new AppError("invalid-data", "数据无法读取，原始内容已保留", {
        cause,
      })
    await preserve(key, raw, "invalid-data")
    const data = fallback()
    await writeDocument(key, data, 1)
    return { data, revision: 1 }
  }
  if (parsed && typeof parsed === "object" && hasOwn(parsed, "schemaVersion")) {
    const document = parsed as Partial<StoredDocument<unknown>>
    if (document.schemaVersion !== SCHEMA_VERSION)
      throw new AppError("future-version", "数据版本不兼容，请更新扩展")
    try {
      if (
        !Number.isSafeInteger(document.revision) ||
        Number(document.revision) < 1 ||
        !hasOwn(document, "data")
      )
        throw new Error("Invalid document")
      return { data: validate(document.data), revision: document.revision! }
    } catch (cause) {
      if (!recover)
        throw new AppError("invalid-data", "数据无法读取，原始内容已保留", {
          cause,
        })
      await preserve(key, raw, "invalid-data")
      const data = fallback()
      await writeDocument(key, data, 1)
      return { data, revision: 1 }
    }
  }
  let data: T
  try {
    data = validate(parsed)
  } catch (cause) {
    if (!recover)
      throw new AppError("invalid-data", "数据无法读取，原始内容已保留", {
        cause,
      })
    data = fallback()
    await preserve(key, raw, "invalid-data")
    await writeDocument(key, data, 1)
    return { data, revision: 1 }
  }
  await preserve(key, raw, "migration")
  await writeDocument(key, data, 1)
  return { data, revision: 1 }
}

async function writeDocument<T>(key: string, data: T, revision: number) {
  const document: StoredDocument<T> = {
    schemaVersion: SCHEMA_VERSION,
    revision,
    updatedAt: new Date().toISOString(),
    data,
  }
  await writeRaw(key, document)
}

export function readDocument<T>(
  key: string,
  fallback: () => T,
  validate: (value: unknown) => T,
  recover = true
) {
  return withLock(
    `store:${key}`,
    async () => (await readUnlocked(key, fallback, validate, recover)).data
  )
}

export function updateDocument<T>(
  key: string,
  fallback: () => T,
  validate: (value: unknown) => T,
  update: (current: T) => T | Promise<T>,
  recover = true
): Promise<T> {
  return withLock(`store:${key}`, async () => {
    const current = await readUnlocked(key, fallback, validate, recover)
    const next = validate(await update(current.data))
    await writeDocument(key, next, current.revision + 1)
    return next
  })
}

export function subscribeStorage(callback: (keys: string[]) => void) {
  if (isExtension) {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area === "local") callback(Object.keys(changes))
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }
  const listener = (event: StorageEvent) => {
    if (event.storageArea === localStorage && event.key) callback([event.key])
  }
  window.addEventListener("storage", listener)
  const local = (event: Event) =>
    callback([(event as CustomEvent<string>).detail])
  window.addEventListener("tabnest:storage", local)
  return () => {
    window.removeEventListener("storage", listener)
    window.removeEventListener("tabnest:storage", local)
  }
}

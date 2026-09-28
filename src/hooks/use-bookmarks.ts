import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  DEFAULT_SETTINGS,
  bumpClick,
  fetchBookmarkData,
  loadClicks,
  loadSettings,
  saveSettings,
  subscribeBookmarks,
} from "@/lib/bookmarks"
import type { AppSettings, BookmarkData } from "@/lib/bookmarks"
import { errorMessage } from "@/lib/errors"
import { STORAGE_KEYS, subscribeStorage } from "@/lib/storage"

export function useBookmarks() {
  const [data, setData] = useState<BookmarkData>({ groups: [], folders: [] })
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [settingsReady, setSettingsReady] = useState(false)
  const [clicks, setClicks] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const state = useRef({
    alive: false,
    dataRequest: 0,
    preferencesRequest: 0,
    clickRequest: 0,
    writeRequest: 0,
    pending: 0,
    confirmed: DEFAULT_SETTINGS,
    settings: DEFAULT_SETTINGS,
  })

  const reload = useCallback(async () => {
    const request = ++state.current.dataRequest
    const next = await fetchBookmarkData()
    if (state.current.alive && request === state.current.dataRequest) {
      setData(next)
      setError(false)
    }
  }, [])
  const refreshSettings = useCallback(async () => {
    const request = ++state.current.preferencesRequest
    try {
      const next = await loadSettings()
      if (
        !state.current.alive ||
        request !== state.current.preferencesRequest ||
        state.current.pending
      )
        return
      state.current.confirmed = next
      state.current.settings = next
      setSettings(next)
    } finally {
      if (
        state.current.alive &&
        request === state.current.preferencesRequest &&
        !state.current.pending
      )
        setSettingsReady(true)
    }
  }, [])
  const refreshClicks = useCallback(async () => {
    const request = ++state.current.clickRequest
    const next = await loadClicks()
    if (state.current.alive && request === state.current.clickRequest)
      setClicks(next)
  }, [])
  const initialize = useCallback(async () => {
    const results = await Promise.allSettled([
      reload(),
      refreshSettings(),
      refreshClicks(),
    ])
    if (!state.current.alive) return
    setError(results[0].status === "rejected")
    for (const result of results.slice(1))
      if (result.status === "rejected")
        toast.error(errorMessage(result.reason, "偏好读取失败"))
    setLoading(false)
  }, [reload, refreshSettings, refreshClicks])
  useEffect(() => {
    const current = state.current
    current.alive = true
    void initialize()
    const unsubscribeBookmarks = subscribeBookmarks(() => {
      void reload().catch(() => toast.error("书签读取失败"))
    })
    const unsubscribeStorage = subscribeStorage((keys) => {
      if (keys.includes(STORAGE_KEYS.settings))
        void refreshSettings().catch(() => {})
      if (keys.includes(STORAGE_KEYS.clicks))
        void refreshClicks().catch(() => {})
    })
    return () => {
      current.alive = false
      current.dataRequest++
      current.preferencesRequest++
      current.clickRequest++
      unsubscribeBookmarks()
      unsubscribeStorage()
    }
  }, [initialize, reload, refreshSettings, refreshClicks])

  const patchSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      const request = ++state.current.writeRequest
      state.current.pending++
      state.current.settings = { ...state.current.settings, ...patch }
      setSettings(state.current.settings)
      void saveSettings(patch)
        .then((next) => {
          state.current.confirmed = next
          if (state.current.alive && request === state.current.writeRequest) {
            state.current.settings = next
            setSettings(next)
          }
        })
        .catch((cause) => {
          if (!state.current.alive) return
          if (request === state.current.writeRequest) {
            state.current.settings = state.current.confirmed
            setSettings(state.current.confirmed)
          }
          toast.error(errorMessage(cause, "设置保存失败"))
        })
        .finally(() => {
          state.current.pending--
          if (!state.current.pending && state.current.alive)
            void refreshSettings().catch(() => {})
        })
    },
    [refreshSettings]
  )
  const recordClick = useCallback(async (url: string) => {
    const request = ++state.current.clickRequest
    const next = await bumpClick(url)
    if (state.current.alive && request === state.current.clickRequest)
      setClicks(next)
  }, [])
  return {
    ...data,
    settings,
    settingsReady,
    patchSettings,
    clicks,
    recordClick,
    loading,
    error,
    reload,
    retry: initialize,
  }
}

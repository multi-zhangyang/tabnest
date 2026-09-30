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
import { loadRecent, recordRecent } from "@/lib/recent"
import type { RecentOpen } from "@/lib/recent"
import { markClickUrls } from "@/lib/preferences"

export function useBookmarks() {
  const [data, setData] = useState<BookmarkData>({ groups: [], folders: [] })
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [settingsReady, setSettingsReady] = useState(false)
  const [clicks, setClicks] = useState<Record<string, number>>({})
  const [recent, setRecent] = useState<RecentOpen[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const lastData = useRef<BookmarkData | undefined>(undefined)
  const state = useRef({
    alive: false,
    dataRequest: 0,
    preferencesRequest: 0,
    clickRequest: 0,
    recentRequest: 0,
    writeRequest: 0,
    pending: 0,
    clickPending: 0,
    recentPending: 0,
    changedUrls: new Set<string>(),
    confirmed: DEFAULT_SETTINGS,
    settings: DEFAULT_SETTINGS,
  })

  const reload = useCallback(async () => {
    const request = ++state.current.dataRequest
    const next = await fetchBookmarkData()
    if (state.current.alive && request === state.current.dataRequest) {
      if (!lastData.current || JSON.stringify(next) !== JSON.stringify(lastData.current)) {
        lastData.current = next
        setData(next)
      }
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
  const refreshRecent = useCallback(async () => {
    const request = ++state.current.recentRequest
    const next = await loadRecent()
    if (state.current.alive && request === state.current.recentRequest)
      setRecent(next)
  }, [])
  const initialize = useCallback(async () => {
    const results = await Promise.allSettled([
      reload(),
      refreshSettings(),
      refreshClicks(),
      refreshRecent(),
    ])
    if (!state.current.alive) return
    setError(results[0].status === "rejected")
    for (const result of results.slice(1))
      if (result.status === "rejected")
        toast.error(errorMessage(result.reason, "偏好读取失败"))
    setLoading(false)
  }, [reload, refreshSettings, refreshClicks, refreshRecent])
  useEffect(() => {
    const current = state.current
    current.alive = true
    void initialize()
    const unsubscribeBookmarks = subscribeBookmarks(() => {
      if (!document.hidden) void reload().catch(() => toast.error("书签读取失败"))
    })
    const unsubscribeStorage = subscribeStorage((keys) => {
      if (document.hidden) return
      if (keys.includes(STORAGE_KEYS.settings) && !state.current.pending)
        void refreshSettings().catch(() => {})
      if (keys.includes(STORAGE_KEYS.clicks) && !state.current.clickPending)
        void refreshClicks().catch(() => {})
      if (keys.includes(STORAGE_KEYS.recent) && !state.current.recentPending) {
        const request = ++state.current.recentRequest
        void loadRecent()
          .then((next) => {
            if (state.current.alive && request === state.current.recentRequest)
              setRecent(next)
          })
          .catch(() => {})
      }
    })
    const resume = () => {
      if (!document.hidden) void Promise.allSettled([reload(), refreshSettings(), refreshClicks(), refreshRecent()])
    }
    document.addEventListener("visibilitychange", resume)
    window.addEventListener("pageshow", resume)
    return () => {
      current.alive = false
      current.dataRequest++
      current.preferencesRequest++
      current.clickRequest++
      current.recentRequest++
      unsubscribeBookmarks()
      unsubscribeStorage()
      document.removeEventListener("visibilitychange", resume)
      window.removeEventListener("pageshow", resume)
    }
  }, [initialize, reload, refreshSettings, refreshClicks, refreshRecent])

  const patchSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      const request = ++state.current.writeRequest
      state.current.pending++
      state.current.settings = { ...state.current.settings, ...patch }
      setSettings(state.current.settings)
      return saveSettings(patch)
        .then((next) => {
          state.current.confirmed = next
          if (state.current.alive && request === state.current.writeRequest) {
            state.current.settings = next
            setSettings(next)
          }
          return true
        })
        .catch((cause) => {
          if (!state.current.alive) return false
          if (request === state.current.writeRequest) {
            state.current.settings = state.current.confirmed
            setSettings(state.current.confirmed)
          }
          toast.error(errorMessage(cause, "设置保存失败"))
          return false
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
    const recentRequest = ++state.current.recentRequest
    state.current.clickPending++
    state.current.recentPending++
    state.current.changedUrls.add(url)
    void recordRecent(url)
      .then((next) => {
        if (
          state.current.alive &&
          recentRequest === state.current.recentRequest
        )
          setRecent(next)
      })
      .catch(() => {})
      .finally(() => { state.current.recentPending-- })
    try {
      const next = await bumpClick(url)
      if (state.current.alive && request === state.current.clickRequest) {
        markClickUrls(next, [...state.current.changedUrls])
        state.current.changedUrls.clear()
        setClicks(next)
      }
    } finally { state.current.clickPending-- }
  }, [])
  return {
    ...data,
    settings,
    settingsReady,
    patchSettings,
    clicks,
    recent,
    recordClick,
    loading,
    error,
    reload,
    retry: initialize,
  }
}

export type Theme = "dark" | "light" | "system"
export function readTheme(key = "theme", fallback: Theme = "dark"): Theme {
  try {
    const value = localStorage.getItem(key)
    return value === "dark" || value === "light" || value === "system" ? value : fallback
  } catch { return fallback }
}
export function saveTheme(theme: Theme, key = "theme") {
  try { localStorage.setItem(key, theme) }
  catch { throw new Error("主题保存失败") }
}

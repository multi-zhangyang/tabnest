try {
  const preference = localStorage.getItem("theme") || "dark"
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.className = dark ? "dark" : "light"
} catch {
  /* Keep the default theme if storage is unavailable. */
}

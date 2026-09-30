;(() => {
  const root = document.documentElement
  let dark = true
  try {
    const preference = localStorage.getItem("theme") || "dark"
    dark =
      preference === "dark" ||
      (preference === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches)
  } catch {}
  root.className = dark ? "dark" : "light"
  root.style.colorScheme = dark ? "dark" : "light"
  root.style.backgroundColor = dark ? "#111111" : "#f5f5f5"
  root.dataset.startup = "pending"
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#111111" : "#f5f5f5")
  setTimeout(() => {
    if (root.dataset.startup === "pending") root.dataset.startup = "ready"
  }, 3000)
})()

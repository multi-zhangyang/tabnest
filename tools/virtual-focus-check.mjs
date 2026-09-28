import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { launchBrowser, openPreview, servePreview } from "./runtime.mjs"
import { showSearchResults } from "./search-helpers.mjs"

const preview = await servePreview(),
  browser = await launchBrowser()
const checks = [],
  errors = []
try {
  const page = await browser.newPage()
  page.on("pageerror", (e) => errors.push(e.message))
  await openPreview(page, preview.url)
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem(
      "tabnest:demo-bookmarks:v2",
      JSON.stringify({
        folders: [
          {
            id: "root",
            title: "书签栏",
            path: "书签栏",
            root: true,
            parentId: "0",
          },
        ],
        groups: [
          {
            id: "root",
            name: "书签栏",
            items: Array.from({ length: 500 }, (_, i) => ({
              id: `b${i}`,
              title: `站点 ${i}`,
              parentId: "root",
              url: `https://site${i}.test/`,
              index: i,
            })),
          },
        ],
      })
    )
  })
  await page.reload()
  await page.waitForSelector(".heat-card")
  await showSearchResults(page, "站点")
  const reveal = async (id) =>
    page.waitForFunction(
      (id) => {
        const el = document.activeElement,
          rect = el.getBoundingClientRect()
        return (
          el.dataset.bookmarkId === id &&
          rect.top >= 75 &&
          rect.bottom <= innerHeight + 1
        )
      },
      { timeout: 4000 },
      id
    )
  await page.$eval('.search-results [data-bookmark-id="b0"]', (e) => e.focus())
  await page.keyboard.press("End")
  await reveal("b499")
  // Simulate the row-height change caused by a late fallback font on CI.
  await page.addStyleTag({ content: ".result-folder { line-height: 36px; }" })
  await new Promise((r) => setTimeout(r, 200))
  await reveal("b499")
  checks.push("end-focus-survives-late-row-measurement")
  await page.keyboard.press("Home")
  await reveal("b0")
  checks.push("home-reveals-first-result")
  await page.evaluate(() => scrollTo(0, 3000))
  await new Promise((r) => setTimeout(r, 200))
  assert.ok(
    await page.evaluate(() => scrollY >= 2999),
    "Manual scrolling must not snap back to keyboard focus"
  )
  checks.push("manual-scroll-does-not-follow-focus")
  assert.deepEqual(errors, [])
  await writeFile(
    "artifacts/virtual-focus-check.json",
    JSON.stringify({ checks, errors }, null, 2)
  )
  console.log(JSON.stringify({ checks, errors }))
} finally {
  await browser.close()
  await preview.close()
}

import assert from "node:assert/strict"
import { writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import {
  launchBrowser,
  openPreview,
  servePreview,
  chromePath,
} from "./runtime.mjs"
import { showSearchResults, clearSearch } from "./search-helpers.mjs"

const preview = await servePreview(),
  browser = await launchBrowser()
const results = [],
  errors = [],
  delay = (ms) => new Promise((r) => setTimeout(r, ms))
const percentile = (values) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
const scenarios = [
  { count: 500, folders: 50 },
  { count: 5000, folders: 50 },
  { count: 5000, folders: 1000 },
  { count: 20000, folders: 1000 },
  { count: 20000, folders: 2000 },
]
try {
  for (const scenario of scenarios) {
    const samples = []
    for (let run = 0; run < 5; run++) {
      const page = await browser.newPage()
      page.setDefaultTimeout(15000)
      page.on("pageerror", (e) => errors.push(e.message))
      await openPreview(page, preview.url)
      await page.evaluate(({ count, folders: folderCount }) => {
        localStorage.clear()
        const folders = [
          {
            id: "root",
            title: "书签栏",
            path: "书签栏",
            parentId: "0",
            root: true,
            folderType: "bookmarks-bar",
          },
        ]
        const groups = [{ id: "root", name: "书签栏", items: [] }]
        for (let i = 0; i < folderCount; i++) {
          const id = `f${i}`
          folders.push({
            id,
            title: `文件夹 ${i}`,
            path: `书签栏 / 文件夹 ${i}`,
            parentId: "root",
            index: i,
          })
          groups.push({ id, name: `文件夹 ${i}`, items: [] })
        }
        for (let i = 0; i < count; i++) {
          const group = groups[1 + Math.floor((i * folderCount) / count)]
          group.items.push({
            id: `b${i}`,
            title: `站点 ${i}`,
            url: `https://site${i}.test/`,
            parentId: group.id,
            index: group.items.length,
          })
        }
        const save = (key, data) =>
          localStorage.setItem(
            key,
            JSON.stringify({
              schemaVersion: 1,
              revision: 1,
              updatedAt: new Date().toISOString(),
              data,
            })
          )
        save("tabnest:demo-bookmarks:v2", { folders, groups })
        save("tabnest:settings", { layout: "heat", iconMode: "favicon" })
        save("tabnest:clicks", {})
        localStorage.setItem("theme", "light")
      }, scenario)
      const start = performance.now()
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForSelector(".heat-card")
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r))
          )
      )
      const firstCanvasMs = Math.round(performance.now() - start)
      const heatDOM = await page.$$eval(".heat-card", (els) => els.length)
      const heatUpdateMs = await page.evaluate(async () => {
        window.open = () => null
        const card = document.querySelector(".heat-card"),
          id = card.dataset.bookmarkId,
          count = Number(card.dataset.clicks),
          start = performance.now()
        card.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
          })
        )
        while (
          Number(
            document.querySelector(`[data-bookmark-id="${id}"]`)?.dataset.clicks
          ) !==
          count + 1
        ) {
          if (performance.now() - start > 5000) throw Error("heat timeout")
          await new Promise((r) => requestAnimationFrame(r))
        }
        return Math.round(performance.now() - start)
      })
      await page.locator('[aria-label="打开搜索"]').click()
      await page.waitForSelector('[aria-label="搜索书签"]')
      const searchMs = await page.evaluate(async (count) => {
        const input = document.querySelector('[aria-label="搜索书签"]'),
          start = performance.now()
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        ).set.call(input, `site${count - 1}.test`)
        input.dispatchEvent(new Event("input", { bubbles: true }))
        while (
          !document.querySelector(`[data-value="bookmark:b${count - 1}"]`) ||
          document
            .querySelector(".search-command-list")
            .getAttribute("aria-busy") === "true"
        ) {
          if (performance.now() - start > 10000) throw Error("search timeout")
          await new Promise((r) => requestAnimationFrame(r))
        }
        return Math.round(performance.now() - start)
      }, scenario.count)
      await page.keyboard.press("Escape")
      await showSearchResults(page, "站点")
      await delay(120)
      const searchDOM = await page.$$eval(
        ".search-results .bookmark-card",
        (els) => els.length
      )
      const target = await page.evaluate(() => {
        const last = [
          ...document.querySelectorAll(".search-results .bookmark-card"),
        ].at(-1)
        last.focus({ preventScroll: true })
        return `b${Number(last.dataset.bookmarkId.slice(1)) + 1}`
      })
      await page.keyboard.press("Tab")
      await page.waitForFunction(
        (id) => document.activeElement?.dataset.bookmarkId === id,
        {},
        target
      )
      await page.keyboard.press("End")
      await page.waitForFunction(
        (count) => {
          const el = document.activeElement,
            b = el?.getBoundingClientRect()
          return (
            el?.dataset.bookmarkId === `b${count - 1}` &&
            b.top >= 75 &&
            b.bottom <= innerHeight + 1
          )
        },
        {},
        scenario.count
      )
      await clearSearch(page)
      const zoneStart = performance.now()
      await page.locator('[aria-label="文件夹视图"]').click()
      await page.waitForSelector(".section-bookmarks .bookmark-card")
      await delay(120)
      const zonesMs = Math.round(performance.now() - zoneStart)
      const sectionDOM = await page.$$eval(
        ".section-bookmarks .bookmark-card",
        (els) => els.length
      )
      await page.evaluate(() =>
        scrollTo(0, document.documentElement.scrollHeight)
      )
      await delay(200)
      // Estimated folder heights converge as the final sections are measured.
      await page.evaluate(() =>
        scrollTo(0, document.documentElement.scrollHeight)
      )
      await page.waitForFunction(() =>
        [
          ...document.querySelectorAll(".section-bookmarks .bookmark-card"),
        ].some((el) => {
          const b = el.getBoundingClientRect()
          return b.top >= 75 && b.bottom <= innerHeight + 1
        })
      )
      const bottomDOM = await page.$$eval(
        ".section-bookmarks .bookmark-card",
        (els) => els.length
      )
      assert.ok(
        Math.max(heatDOM, searchDOM, sectionDOM, bottomDOM) <= 250,
        `mounted bookmark budget: ${[heatDOM, searchDOM, sectionDOM, bottomDOM]}`
      )
      samples.push({
        run: run + 1,
        firstCanvasMs,
        searchMs,
        heatUpdateMs,
        zonesMs,
        heatDOM,
        searchDOM,
        sectionDOM,
        bottomDOM,
        lastReachable: true,
      })
      console.log(JSON.stringify({ ...scenario, ...samples.at(-1) }))
      await page.close()
    }
    const p95 = Object.fromEntries(
      ["firstCanvasMs", "searchMs", "heatUpdateMs", "zonesMs"].map((key) => [
        key,
        percentile(samples.map((s) => s[key])),
      ])
    )
    results.push({ ...scenario, samples, p95 })
  }
  const report = {
    recordedAt: new Date().toISOString(),
    device: {
      os: `${os.platform()} ${os.release()}`,
      cpu: os.cpus()[0]?.model,
      cores: os.cpus().length,
      memoryGB: Math.round(os.totalmem() / 1024 ** 3),
      browser: await browser.version(),
      executable: chromePath(),
      viewport: "1440×900",
      gpu: "disabled by test harness",
    },
    method:
      "Five fresh pages per scenario; uncached layout; startup until two rendered frames; first query after search opens; actual storage-backed click update; no CPU/network throttling.",
    targets: {
      firstCanvasMs: 1500,
      searchMs: 100,
      heatUpdateMs: 100,
      mountedBookmarks: 250,
    },
    results,
    errors,
  }
  await mkdir("artifacts", { recursive: true })
  await writeFile(
    "artifacts/performance-check.json",
    JSON.stringify(report, null, 2)
  )
  await writeFile(
    "artifacts/performance-report.md",
    `# TabNest performance\n\n${report.device.os} · ${report.device.cpu} · ${report.device.browser}\n\n${report.method}\n\n| Bookmarks | Folders | Canvas P95 | Search P95 | Click P95 |\n|---|---|---|---|---|\n${results.map((r) => `| ${r.count} | ${r.folders} | ${r.p95.firstCanvasMs} ms | ${r.p95.searchMs} ms | ${r.p95.heatUpdateMs} ms |`).join("\n")}\n`
  )
  assert.deepEqual(errors, [])
  for (const result of results.filter((r) => r.count === 5000)) {
    assert.ok(
      result.p95.firstCanvasMs <= 1500,
      `startup P95 ${result.p95.firstCanvasMs}`
    )
    assert.ok(result.p95.searchMs <= 100, `search P95 ${result.p95.searchMs}`)
    assert.ok(
      result.p95.heatUpdateMs <= 100,
      `click P95 ${result.p95.heatUpdateMs}`
    )
  }
} finally {
  await browser.close()
  await preview.close()
}

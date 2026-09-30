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
import {installCanvasClock,canvasFrameTime} from './performance-clock.mjs'

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
  { count: 500, folders: 50, historicalHeat: true },
  { count: 5000, folders: 1000, historicalHeat: true },
  { count: 20000, folders: 2000, historicalHeat: true },
]
const runs = Number(process.env.PERF_SAMPLES || 20)
const only = process.env.PERF_COUNT && Number(process.env.PERF_COUNT)
if (only) scenarios.splice(0, scenarios.length, ...scenarios.filter(s => s.count === only))
if(process.env.PERF_HEAT)scenarios.splice(0,scenarios.length,...scenarios.filter(s=>!!s.historicalHeat===(process.env.PERF_HEAT==='historical')))
let currentPage, currentSample, stage
try {
  for (const scenario of scenarios) {
    const samples = []
    for (let run = 0; run < runs; run++) {
      const page = await browser.newPage()
      await installCanvasClock(page)
      const cpuRate = Number(process.env.PERF_CPU || 1)
      if (cpuRate > 1) { const cdp = await page.createCDPSession(); await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate }) }
      currentPage = page
      currentSample = { ...scenario, run: run + 1 }
      stage = "startup"
      page.setDefaultTimeout(15000)
      page.on("pageerror", (e) => errors.push(e.message))
      await openPreview(page, preview.url)
      await page.evaluate(({ count, folders: folderCount, historicalHeat }) => {
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
        save(
          "tabnest:clicks",
          historicalHeat
            ? Object.fromEntries(
                Array.from({ length: count }, (_, i) => [
                  `https://site${i}.test/`,
                  i % 5 === 0 ? 0 : ((i * 2654435761) >>> 0) % 4096,
                ])
              )
            : {}
        )
        localStorage.setItem("theme", "light")
      }, scenario)
      const start = performance.now()
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForSelector(".heat-card")
      await page.waitForFunction(
        () =>
          Number(getComputedStyle(document.getElementById("root")).opacity) ===
          1
      )
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r))
          )
      )
      const firstCanvasMs = await canvasFrameTime(page)
      const automationStartupMs=Math.round(performance.now()-start)
      const heatDOM = await page.$$eval(".heat-card", (els) => els.length)
      stage = "heat-update"
      const clickTiming = await page.evaluate(async () => {
        window.open = () => null
        const card = document.querySelector(".heat-card"),
          id = card.dataset.bookmarkId,
          count = Number(card.dataset.clicks),
          start = performance.now(),
          initial = card.parentElement.getBoundingClientRect()
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
        const heatUpdateMs = Math.round(performance.now() - start)
        while (true) {
          const next = document
            .querySelector(`[data-bookmark-id="${id}"]`)
            ?.parentElement.getBoundingClientRect()
          if (
            next &&
            Math.abs(
              next.width * next.height - initial.width * initial.height
            ) > 0.1
          )
            break
          if (performance.now() - start > 5000)
            throw Error("first area change timeout")
          await new Promise((r) => requestAnimationFrame(r))
        }
        return {
          heatUpdateMs,
          firstAreaChangeMs: Math.round(performance.now() - start),
        }
      })
      const { heatUpdateMs, firstAreaChangeMs } = clickTiming
      await page.locator('[aria-label="打开搜索"]').click()
      stage = "search"
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
      const searchOrder = await page.evaluate(() => {
        return JSON.parse(localStorage.getItem("tabnest:clicks")).data
      })
      const orderedIds = Array.from({ length: scenario.count }, (_, i) => i)
        .sort(
          (a, b) =>
            (searchOrder[`https://site${b}.test/`] || 0) -
              (searchOrder[`https://site${a}.test/`] || 0) || a - b
        )
        .map((i) => `b${i}`)
      const focusedId = await page.evaluate(() => {
        const last = [
          ...document.querySelectorAll(".search-results .bookmark-card"),
        ].at(-1)
        last.focus({ preventScroll: true })
        return last.dataset.bookmarkId
      })
      const target = orderedIds[orderedIds.indexOf(focusedId) + 1]
      await page.keyboard.press("Tab")
      stage = "search-tab"
      await page.waitForFunction(
        (id) => document.activeElement?.dataset.bookmarkId === id,
        {},
        target
      )
      await page.keyboard.press("End")
      stage = "search-end"
      await page.waitForFunction(
        (id) => {
          const el = document.activeElement,
            b = el?.getBoundingClientRect()
          return (
            el?.dataset.bookmarkId === id &&
            b.top >= 75 &&
            b.bottom <= innerHeight + 1
          )
        },
        {},
        orderedIds.at(-1)
      )
      await clearSearch(page)
      stage = "folders"
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
        automationStartupMs,
        searchMs,
        heatUpdateMs,
        firstAreaChangeMs,
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
      [
        "firstCanvasMs",
        "searchMs",
        "heatUpdateMs",
        "firstAreaChangeMs",
        "zonesMs",
      ].map((key) => [key, percentile(samples.map((s) => s[key]))])
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
      gpu: process.env.TEST_GPU === "enabled" ? "enabled" : "disabled by test harness",
      cpuRate: Number(process.env.PERF_CPU || 1),
    },
    method:
      `${runs} fresh pages per scenario; uncached layout; zero heat and deterministic mixed historical heat (80% nonzero, 0–4095 clicks); startup measured in the browser from navigation start through two frames after a valid visible canvas, automation wall time also recorded; first query after search opens; actual storage-backed click update; CPU rate ${Number(process.env.PERF_CPU || 1)}; no network throttling.`,
    targets: {
      firstCanvasMs: Number(process.env.PERF_CPU || 1)===4 ? 3000 : 1500,
      searchMs: Number(process.env.PERF_CPU || 1)===4 ? 200 : 100,
      heatUpdateMs: Number(process.env.PERF_CPU || 1)===4 ? 200 : 100,
      firstAreaChangeMs: Number(process.env.PERF_CPU || 1)===4 ? 300 : 150,
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
    `# TabNest performance\n\n${report.device.os} · ${report.device.cpu} · ${report.device.browser}\n\n${report.method}\n\n| Heat | Bookmarks | Folders | Canvas P95 | Search P95 | Click P95 | First area P95 |\n|---|---|---|---|---|---|---|\n${results.map((r) => `| ${r.historicalHeat ? "historical" : "zero"} | ${r.count} | ${r.folders} | ${r.p95.firstCanvasMs} ms | ${r.p95.searchMs} ms | ${r.p95.heatUpdateMs} ms | ${r.p95.firstAreaChangeMs} ms |`).join("\n")}\n`
  )
  assert.deepEqual(errors, [])
  for (const result of results) {
    assert.ok(
      result.p95.firstCanvasMs <= report.targets.firstCanvasMs,
      `startup P95 ${result.p95.firstCanvasMs}`
    )
    assert.ok(
      result.p95.firstAreaChangeMs <= report.targets.firstAreaChangeMs,
      `first area change P95 ${result.p95.firstAreaChangeMs}`
    )
    assert.ok(result.p95.searchMs <= report.targets.searchMs, `search P95 ${result.p95.searchMs}`)
    assert.ok(
      result.p95.heatUpdateMs <= report.targets.heatUpdateMs,
      `click P95 ${result.p95.heatUpdateMs}`
    )
  }
} catch (error) {
  const geometry = await currentPage
    ?.evaluate(() => {
      const active = document.activeElement
      const grid = document.querySelector(".search-results")
      return {
        focus: active?.outerHTML.slice(0, 600),
        bounds: active?.getBoundingClientRect().toJSON(),
        scrollY,
        height: innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        grid: grid && {
          bounds: grid.getBoundingClientRect().toJSON(),
          style: grid.getAttribute("style"),
          columns: getComputedStyle(grid).gridTemplateColumns,
        },
        mounted: [
          ...document.querySelectorAll(".search-results .bookmark-card"),
        ].map((el) => ({
          id: el.dataset.bookmarkId,
          bounds: el.getBoundingClientRect().toJSON(),
        })),
      }
    })
    .catch(() => null)
  await writeFile(
    "artifacts/performance-failure.json",
    JSON.stringify(
      {
        sample: currentSample,
        stage,
        error: error.stack,
        geometry,
        results,
        errors,
      },
      null,
      2
    )
  )
  await currentPage
    ?.screenshot({ path: "artifacts/performance-failure.png" })
    .catch(() => {})
  throw error
} finally {
  await browser.close()
  await preview.close()
}

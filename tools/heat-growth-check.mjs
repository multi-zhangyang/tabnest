import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { launchBrowser, servePreview, openPreview } from "./runtime.mjs"
import { createServer } from "vite"
import { assertRenderedHeatFrame } from "./heat-assertions.mjs"
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  logLevel: "error",
})
const heat = await server.ssrLoadModule("/src/lib/heat-layout.ts")
await server.close()
const preview = await servePreview()

const browser = await launchBrowser({ pipe: true, enableExtensions: true })
const errors = [],
  checks = [],
  samples = []
try {
  const extensionId = await browser.installExtension(resolve("dist"))
  const page = await browser.newPage()
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(`chrome-extension://${extensionId}/index.html`)
  await page.waitForSelector(".brand")
  const items = await page.evaluate(async () => {
    const folder = await chrome.bookmarks.create({
      parentId: "1",
      title: "动态面积验收",
    })
    const items = []
    for (let i = 0; i < 48; i++)
      items.push(
        await chrome.bookmarks.create({
          parentId: folder.id,
          title: `站点 ${i}`,
          url: `https://tabnest-growth.test/${i}`,
        })
      )
    return items
  })
  await page.waitForFunction(
    () => document.querySelectorAll(".heat-card").length === 48
  )
  await page.waitForFunction(
    () => document.documentElement.dataset.startup === "ready"
  )
  const rectangles = () =>
    page.$$eval(".heat-cell", (nodes) =>
      nodes.map((e) => ({
        id: e.dataset.itemId,
        opacity: Number(getComputedStyle(e).opacity),
        ...e.getBoundingClientRect().toJSON(),
      }))
    )
  const initial = await rectangles()
  const height = await page.$eval(".heat-canvas", (e) => e.offsetHeight)
  await page.waitForFunction(() =>
    localStorage.getItem("tabnest:heat-layouts:v8")
  )
  const initialSnapshot = await page.evaluate(
    () => JSON.parse(localStorage.getItem("tabnest:heat-layouts:v8")).at(-1)[1]
  )
  const canvas = await page.$eval(".heat-canvas", (e) =>
    e.getBoundingClientRect().toJSON()
  )
  await page.evaluate(() => {
    window.__growthFrames = []
    const sample = () => {
      window.__growthFrames.push(
        [...document.querySelectorAll(".heat-cell")].map((e) => ({
          id: e.dataset.itemId,
          opacity: Number(getComputedStyle(e).opacity),
          ...e.getBoundingClientRect().toJSON(),
        }))
      )
      window.__growthFrame = requestAnimationFrame(sample)
    }
    window.__growthFrame = requestAnimationFrame(sample)
  })
  const click = async (item) => {
    const count = await page.$eval(`[data-bookmark-id="${item.id}"]`, (e) =>
      Number(e.dataset.clicks)
    )
    await page.evaluate(
      (id) =>
        document.querySelector(`[data-bookmark-id="${id}"]`).dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
          })
        ),
      item.id
    )
    await page.waitForFunction(
      (id, expected) =>
        Number(
          document.querySelector(`[data-bookmark-id="${id}"]`).dataset.clicks
        ) === expected,
      {},
      item.id,
      count + 1
    )
    await new Promise((r) => setTimeout(r, 290))
    for (const target of browser.targets())
      if (
        target.type() === "page" &&
        target.url().includes("tabnest-growth.test")
      )
        await (await target.page())?.close()
    return count + 1
  }
  for (const index of [4, 13, 0]) {
    for (let step = 0; step < 16; step++) {
      const before = await rectangles()
      const count = await click(items[index])
      const after = await rectangles()
      const a = before.find((b) => b.id === items[index].id),
        b = after.find((b) => b.id === items[index].id)
      assert.ok(
        b.width * b.height > a.width * a.height + 1,
        `native click did not grow ${index}/${count}`
      )
      assert.ok(
        after.some(
          (b, i) =>
            b.id !== items[index].id &&
            b.width * b.height < before[i].width * before[i].height - 1
        ),
        "neighbours did not shrink"
      )
      assert.deepEqual(
        after.slice(24),
        initial.slice(24),
        "remote region moved"
      )
      assert.equal(
        await page.$eval(".heat-canvas", (e) => e.offsetHeight),
        height
      )
      samples.push({
        index,
        count,
        beforeArea: a.width * a.height,
        afterArea: b.width * b.height,
      })
    }
  }
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.__growthFrame)
    return window.__growthFrames
  })
  for (const frame of frames)
    assertRenderedHeatFrame(frame, initialSnapshot, canvas)
  checks.push({
    name: "native-sequential-clicks-multiple-hotspots",
    clicks: samples.length,
    frames: frames.length,
  })
  const final = await rectangles()
  await page.screenshot({ path: "artifacts/heat-growth-native.png" })
  await page.reload()
  await page.waitForFunction(
    () => document.querySelectorAll(".heat-card").length === 48
  )
  await new Promise((r) => setTimeout(r, 320))
  for (const [i, box] of (await rectangles()).entries())
    for (const key of ["x", "y", "width", "height"])
      assert.ok(
        Math.abs(box[key] - final[i][key]) < 0.1,
        "refresh lost grown layout"
      )
  checks.push({ name: "native-growth-refresh-memory" })
  const oldItems = Array.from({ length: 24 }, (_, i) => ({
    id: `old-micro${i}`,
    url: `https://old-micro.test/${i}`,
    title: `站点 ${i}`,
    parentId: "root",
    index: i,
  }))
  heat.heatCanvas(oldItems, {}, 1356, 728)
  const squeezed = heat.heatCanvas(
    oldItems,
    { [oldItems[0].url]: 10000 },
    1356,
    728
  )
  const target = squeezed.boxes.findIndex(
    (box, i) => i !== 0 && box.width * box.height < 6200
  )
  assert.ok(target >= 0)
  const snapshot = structuredClone(squeezed.snapshot)
  const clicks = { [oldItems[0].url]: 74, [oldItems[target].url]: 96 }
  snapshot.regions[0].counts = oldItems.map((item) => clicks[item.url] || 0)
  const recovery = await browser.newPage()
  recovery.on("pageerror", (e) => errors.push(e.message))
  await openPreview(recovery, preview.url)
  await recovery.evaluate(
    ({ oldItems, snapshot, clicks }) => {
      localStorage.clear()
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
      save("tabnest:demo-bookmarks:v2", {
        groups: [{ id: "root", name: "书签栏", items: oldItems }],
        folders: [{ id: "root", title: "书签栏", path: "书签栏", root: true }],
      })
      save("tabnest:settings", { layout: "heat", newTab: true })
      save("tabnest:clicks", clicks)
      localStorage.setItem(
        "tabnest:heat-layouts:v8",
        JSON.stringify([[snapshot.key, snapshot]])
      )
      localStorage.setItem("theme", "dark")
    },
    { oldItems, snapshot, clicks }
  )
  await recovery.reload()
  await recovery.waitForSelector(".heat-card")
  await new Promise((r) => setTimeout(r, 320))
  const before = await recovery.$eval(
    `[data-bookmark-id="${oldItems[target].id}"]`,
    (e) => ({
      presentation: e.dataset.presentation,
      ...e.parentElement.getBoundingClientRect().toJSON(),
    })
  )
  assert.equal(before.presentation, "icon")
  await recovery.screenshot({ path: "artifacts/heat-reclaim-before.png" })
  await recovery.evaluate((id) => {
    window.open = () => null
    document.querySelector(`[data-bookmark-id="${id}"]`).dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      })
    )
  }, oldItems[target].id)
  await recovery.waitForFunction(
    (id) =>
      Number(
        document.querySelector(`[data-bookmark-id="${id}"]`).dataset.clicks
      ) === 97,
    {},
    oldItems[target].id
  )
  await new Promise((r) => setTimeout(r, 320))
  const after = await recovery.$eval(
    `[data-bookmark-id="${oldItems[target].id}"]`,
    (e) => e.parentElement.getBoundingClientRect().toJSON()
  )
  assert.ok(
    after.width * after.height > before.width * before.height + 10000,
    "old cached logo did not reclaim heat in the actual page"
  )
  await recovery.screenshot({ path: "artifacts/heat-reclaim-after.png" })
  checks.push({
    name: "old-cache-logo-reclaims-cumulative-heat",
    beforeArea: before.width * before.height,
    afterArea: after.width * after.height,
  })
  const legacy = structuredClone(snapshot)
  delete legacy.allocationVersion
  await recovery.evaluate(
    ({ legacy, clicks }) => {
      const document = JSON.parse(localStorage.getItem("tabnest:clicks"))
      document.data = clicks
      localStorage.setItem("tabnest:clicks", JSON.stringify(document))
      localStorage.setItem(
        "tabnest:heat-layouts:v8",
        JSON.stringify([[legacy.key, legacy]])
      )
    },
    { legacy, clicks }
  )
  await recovery.reload()
  await recovery.waitForSelector(".heat-card")
  await recovery.waitForFunction(
    () => document.documentElement.dataset.startup === "ready"
  )
  const migratedArea = await recovery.$eval(
    `[data-bookmark-id="${oldItems[target].id}"]`,
    (e) => {
      const b = e.parentElement.getBoundingClientRect()
      return b.width * b.height
    }
  )
  assert.ok(migratedArea > before.width * before.height + 10000)
  await recovery.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("tabnest:heat-layouts:v8")).at(-1)[1]
        .allocationVersion === 1
  )
  const retainedCount = await recovery.evaluate(
    (url) => JSON.parse(localStorage.getItem("tabnest:clicks")).data[url],
    oldItems[target].url
  )
  assert.equal(retainedCount, 96)
  checks.push({
    name: "old-allocation-corrects-on-open-without-new-click",
    migratedArea,
    retainedCount,
  })
  assert.deepEqual(errors, [])
  await writeFile(
    "artifacts/heat-growth-check.json",
    JSON.stringify(
      { recordedAt: new Date().toISOString(), checks, samples, errors },
      null,
      2
    )
  )
  console.log(JSON.stringify({ checks, errors }))
} finally {
  await browser.close()
  await preview.close()
}

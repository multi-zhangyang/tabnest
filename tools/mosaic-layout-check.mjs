import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { launchBrowser, servePreview, openPreview } from "./runtime.mjs"
import { assertTiled, assertRenderedHeatFrame } from "./heat-assertions.mjs"
import { createServer } from "vite"

const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  logLevel: "error",
})
const { demoGroups } = await server.ssrLoadModule("/src/lib/demo.ts")
await server.close()

const preview = await servePreview(),
  browser = await launchBrowser(),
  errors = [],
  checks = []
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1906, height: 871 })
  page.on("pageerror", (e) => errors.push(e.message))
  await openPreview(page, preview.url)
  await page.evaluate((groups) => {
    const doc = {
      schemaVersion: 1,
      revision: 1,
      updatedAt: new Date().toISOString(),
      data: {
        groups,
        folders: groups.map((g) => ({
          id: g.id,
          title: g.name,
          path: g.name,
          parentId: "1",
        })),
      },
    }
    const group = groups[0]
    const source = groups.flatMap((g) => g.items)
    for (let i = 0; i < 13; i++)
      group.items.push({
        ...source[i],
        id: `copy-${i}`,
        parentId: group.id,
        index: group.items.length,
      })
    localStorage.setItem("tabnest:demo-bookmarks:v2", JSON.stringify(doc))
    for (const key of Object.keys(localStorage))
      if (key.startsWith("tabnest:heat-layouts:")) localStorage.removeItem(key)
    localStorage.setItem("theme", "dark")
    localStorage.setItem(
      "tabnest:clicks",
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        updatedAt: new Date().toISOString(),
        data: {},
      })
    )
  }, demoGroups())
  await page.reload()
  await page.waitForFunction(
    () => document.querySelectorAll(".heat-cell").length === 37
  )
  await new Promise((r) => setTimeout(r, 400))
  const initial = await page.$$eval(".heat-cell", (nodes) =>
    nodes.map((e) => ({
      id: e.dataset.itemId,
      ...e.getBoundingClientRect().toJSON(),
    }))
  )
  const frames = await page.evaluate(async () => {
    window.open = () => null
    const frames = [],
      start = performance.now()
    const sample = () => {
      frames.push(
        [...document.querySelectorAll(".heat-cell")].map((e) => ({
          id: e.dataset.itemId,
          opacity: Number(getComputedStyle(e).opacity),
          ...e.getBoundingClientRect().toJSON(),
        }))
      )
      if (performance.now() - start < 1500) requestAnimationFrame(sample)
    }
    sample()
    const key = "tabnest:clicks",
      doc = JSON.parse(localStorage.getItem(key))
    doc.data["https://github.com"] = 10000
    localStorage.setItem(key, JSON.stringify(doc))
    window.dispatchEvent(new CustomEvent("tabnest:storage", { detail: key }))
    await new Promise((r) => setTimeout(r, 80))
    for (let i = 0; i < 12; i++) {
      document.querySelector('[data-bookmark-id="b1"]').dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        })
      )
      await new Promise((r) => setTimeout(r, 20))
    }
    await new Promise((r) => setTimeout(r, 1300))
    return frames
  })
  const snapshot = await page.evaluate(
    () => JSON.parse(localStorage.getItem("tabnest:heat-layouts:v8")).at(-1)[1]
  )
  assertTiled({ snapshot })
  const final = await page.$$eval(".heat-cell", (nodes) =>
    nodes.map((e) => ({
      id: e.dataset.itemId,
      opacity: Number(getComputedStyle(e).opacity),
      ...e.getBoundingClientRect().toJSON(),
    }))
  )
  const canvas = await page.$eval(".heat-canvas", (e) =>
    e.getBoundingClientRect().toJSON()
  )
  for (const frame of frames) assertRenderedHeatFrame(frame, snapshot, canvas)
  for (const region of snapshot.regions)
    region.boxes.forEach((b, i) => {
      const shown = final.find((e) => e.id === region.ids[i])
      assert.ok(
        Math.abs(shown.width - b.width) < 0.1 &&
          Math.abs(shown.height - b.height) < 0.1,
        "valid target was never painted"
      )
      assert.ok(
        Math.abs(shown.x - canvas.x - region.x - b.x) < 0.1 &&
          Math.abs(shown.y - canvas.y - region.y - b.y) < 0.1
      )
      assert.equal(shown.opacity, 1, "retarget left a dimmed tile")
    })
  assert.ok(
    final.find((e) => e.id === "b1").width *
      final.find((e) => e.id === "b1").height >
      initial.find((e) => e.id === "b1").width *
        initial.find((e) => e.id === "b1").height
  )
  assert.equal(snapshot.height, canvas.height)
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollbarWidth
    ),
    "none"
  )
  await page.screenshot({ path: "artifacts/mosaic-37-dark.png" })
  await page.reload()
  await page.waitForFunction(
    () => document.querySelectorAll(".heat-cell").length === 37
  )
  const reopened = await page.$$eval(".heat-cell", (nodes) =>
    nodes.map((e) => ({
      id: e.dataset.itemId,
      ...e.getBoundingClientRect().toJSON(),
    }))
  )
  for (const b of reopened) {
    const old = final.find((e) => e.id === b.id)
    assert.ok(
      Math.abs(old.x - b.x) < 0.1 && Math.abs(old.width - b.width) < 0.1
    )
  }
  checks.push({
    name: "37-bookmark-continuous-fill-topology-retarget-refresh",
    frames: frames.length,
    bookmarks: final.length,
  })
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ])
  await page.evaluate(() => {
    const key = "tabnest:clicks",
      doc = JSON.parse(localStorage.getItem(key))
    doc.data["https://www.jd.com"] = 10000
    localStorage.setItem(key, JSON.stringify(doc))
    window.dispatchEvent(new CustomEvent("tabnest:storage", { detail: key }))
  })
  await new Promise((r) => setTimeout(r, 350))
  assert.ok(
    await page.$$eval(".heat-cell", (nodes) =>
      nodes.every((e) => !e.style.opacity || e.style.opacity === "1")
    )
  )
  checks.push({ name: "reduced-motion-valid-direct-result" })
  assert.deepEqual(errors, [])
  await writeFile(
    "artifacts/mosaic-layout-check.json",
    JSON.stringify(
      { recordedAt: new Date().toISOString(), checks, errors },
      null,
      2
    )
  )
  console.log(JSON.stringify({ checks, errors }))
} finally {
  await browser.close()
  await preview.close()
}

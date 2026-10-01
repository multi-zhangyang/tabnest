import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { launchBrowser } from "./runtime.mjs"
import { assertRenderedHeatFrame } from "./heat-assertions.mjs"

const fixture = JSON.parse(await readFile(new URL("./fixtures/heat-37.json", import.meta.url), "utf8"))
const browser = await launchBrowser({ pipe: true, enableExtensions: true, defaultViewport: { width: 1536, height: 730, deviceScaleFactor: 1 } })
const errors = [], samples = []
try {
  const extensionId = await browser.installExtension(resolve("dist"))
  const extensionUrl = `chrome-extension://${extensionId}/index.html`
  let page = await browser.newPage()
  page.on("pageerror", e => errors.push(e.message))
  await page.goto(extensionUrl)
  const { items, snapshot } = await page.evaluate(async fixture => {
    const folder = await chrome.bookmarks.create({ parentId: "1", title: "37-card regression" })
    const items = []
    for (const region of fixture.regions) for (const [i, url] of region.urls.entries()) {
      items.push(await chrome.bookmarks.create({ parentId: folder.id, title: items.length === 4 ? "X" : `Site ${items.length}`, url }))
      region.ids[i] = items.at(-1).id
    }
    fixture.key = JSON.stringify([fixture.width, fixture.gap, fixture.scale, fixture.regions.flatMap(r => r.ids), fixture.regions.flatMap(r => r.urls), JSON.parse(fixture.key)[5]])
    const doc = data => ({ schemaVersion: 1, revision: 1, updatedAt: new Date().toISOString(), data })
    await chrome.storage.local.set({
      "tabnest:settings": doc({ layout: "heat", newTab: false, cardScale: 0.75, fontScale: "l", showDomain: false }),
      "tabnest:clicks": doc(Object.fromEntries(fixture.regions.flatMap(r => r.urls.map((url,i) => [url,r.counts[i]])))),
    })
    localStorage.setItem("tabnest:heat-layouts:v8", JSON.stringify([[fixture.key,fixture]]))
    return { items, snapshot: fixture }
  }, structuredClone(fixture))
  const target = items[4], selector = `[data-bookmark-id="${target.id}"]`
  const ready = async () => {
    await page.waitForFunction(() => document.documentElement.dataset.startup === "ready" && document.querySelectorAll(".heat-cell").length === 37)
    await new Promise(r => setTimeout(r, 300))
  }
  const boxes = () => page.$$eval(".heat-cell", nodes => nodes.map(e => ({ id:e.dataset.itemId, opacity:Number(getComputedStyle(e).opacity), ...e.getBoundingClientRect().toJSON() })))
  const area = b => b.width * b.height
  await page.reload()
  await ready()
  const initial = await boxes()
  const canvas = await page.$eval(".heat-canvas", e => e.getBoundingClientRect().toJSON())
  assert.equal(canvas.width, snapshot.width)
  assert.equal(canvas.height, snapshot.height)
  assert.ok(Math.abs(area(initial[4]) - area(snapshot.regions[0].boxes[4])) < 10, "remembered geometry changed before clicking")
  await page.evaluate(() => {
    window.__heatFrames = []
    const sample = () => {
      window.__heatFrames.push([...document.querySelectorAll(".heat-cell")].map(e => ({ id:e.dataset.itemId, opacity:Number(getComputedStyle(e).opacity), ...e.getBoundingClientRect().toJSON() })))
      window.__heatFrame = requestAnimationFrame(sample)
    }
    window.__heatFrame = requestAnimationFrame(sample)
  })
  let previous = initial
  for (let click = 0; click < 3; click++) {
    const count = await page.$eval(selector, e => Number(e.dataset.clicks))
    await page.evaluate(selector => document.querySelector(selector).dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true, ctrlKey:true })), selector)
    await page.waitForFunction((selector,count) => Number(document.querySelector(selector).dataset.clicks) === count+1, {}, selector, count)
    await new Promise(r => setTimeout(r, 300))
    const after = await boxes()
    assert.ok(Math.sqrt(area(after[4])) - Math.sqrt(area(previous[4])) >= 3, "background click growth not visible")
    assert.ok(after.some((b,i) => i !== 4 && area(b) < area(previous[i]) - 1))
    assert.deepEqual(after.filter(b => snapshot.regions[1].ids.includes(b.id)), initial.filter(b => snapshot.regions[1].ids.includes(b.id)))
    samples.push({ mode:"background", beforeArea:area(previous[4]), afterArea:area(after[4]) })
    previous = after
    for (const t of browser.targets()) if (t.type() === "page" && t.url().startsWith(target.url)) await (await t.page())?.close()
  }
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.__heatFrame); return window.__heatFrames })
  for (const frame of frames) assertRenderedHeatFrame(frame, snapshot, canvas)
  await page.setRequestInterception(true)
  page.on("request", request => request.url() === target.url ? request.respond({ status:200,contentType:"text/html",body:"<!doctype html><title>Target</title>" }) : request.continue())
  await page.click(selector)
  await page.waitForFunction(() => document.title === "Target")
  page = await browser.newPage()
  page.on("pageerror", e => errors.push(e.message))
  await page.goto(extensionUrl)
  await ready()
  const reopened = await boxes()
  assert.equal(await page.$eval(selector,e => Number(e.dataset.clicks)), snapshot.regions[0].counts[4]+4)
  assert.ok(Math.sqrt(area(reopened[4])) - Math.sqrt(area(previous[4])) >= 3, "current navigation lost visible growth on reopen")
  samples.push({ mode:"current-reopen", beforeArea:area(previous[4]), afterArea:area(reopened[4]) })
  assert.equal(await page.$eval(".heat-canvas",e => e.offsetHeight), canvas.height)
  assert.deepEqual(errors, [])
  await page.screenshot({ path:"artifacts/heat-37-after.png" })
  await writeFile("artifacts/heat-37-check.json",JSON.stringify({version:JSON.parse(await readFile("dist/build-info.json","utf8")),samples,frames:frames.length,errors},null,2))
  console.log(JSON.stringify({samples,frames:frames.length,errors}))
} finally { await browser.close() }

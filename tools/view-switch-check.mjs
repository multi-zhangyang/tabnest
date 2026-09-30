import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { launchBrowser, servePreview, openPreview } from "./runtime.mjs"

const preview = await servePreview(),
  browser = await launchBrowser(
    process.env.VIEW_SWITCH_GPU === "1" ? { args: [] } : {}
  ),
  checks = [],
  errors = []
try {
  for (const apiAbsent of [false, true]) {
    const page = await browser.newPage()
    await page.evaluateOnNewDocument(
      (theme) => localStorage.setItem("theme", theme),
      apiAbsent ? "light" : "dark"
    )
    await page.evaluateOnNewDocument(() => {
      window.__viewSnapshots = 0
      window.__viewCancellations = []
      const cancel = Animation.prototype.cancel
      Animation.prototype.cancel = function () {
        const panel = this.effect?.target
        if (!panel?.matches?.(".view-panel")) return cancel.call(this)
        const before = Number(getComputedStyle(panel).opacity)
        cancel.call(this)
        window.__viewCancellations.push({
          before,
          after: Number(getComputedStyle(panel).opacity),
        })
      }
      const native = document.startViewTransition?.bind(document)
      if (native)
        document.startViewTransition = (...args) => {
          window.__viewSnapshots++
          return native(...args)
        }
    })
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text())
    })
    if (apiAbsent)
      await page.evaluateOnNewDocument(() => {
        document.startViewTransition = undefined
      })
    await openPreview(page, preview.url)
    await page.waitForSelector(".heat-card")
    await page.waitForFunction(
      () => document.documentElement.dataset.startup === "ready"
    )
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((a) => a.effect?.pseudoElement?.includes("view-transition"))
            .length
      ),
      0,
      "startup replayed a view transition"
    )
    const sample = await page.evaluate(async () => {
      const frames = [],
        start = performance.now(),
        panel = document.querySelector(".view-panel"),
        header = document.querySelector(".app-header")
      const measure = () => {
        frames.push({
          t: performance.now() - start,
          header: header.getBoundingClientRect().toJSON(),
          panel: panel.getBoundingClientRect().toJSON(),
          switching: panel.dataset.switching,
          opacity: Number(getComputedStyle(panel).opacity),
          content: panel.querySelector(".heat-card") ? "heat" : "zones",
          trees: panel.querySelectorAll(".main-content").length,
          animations: document.getAnimations().map((a) => ({
            pseudo: a.effect?.pseudoElement,
            name: a.animationName,
            progress: a.effect?.getComputedTiming().progress,
            playState: a.playState,
          })),
        })
        if (performance.now() - start < 550) requestAnimationFrame(measure)
      }
      measure()
      document
        .querySelector('[aria-label="文件夹视图"]')
        .dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, button: 0 })
        )
      await new Promise((r) => setTimeout(r, 600))
      return frames
    })
    assert.ok(sample.some((f) => f.switching === "true"))
    assert.ok(
      sample
        .filter((f) => f.switching)
        .every(
          (f) =>
            Math.abs(f.panel.top - sample[0].panel.top) < 0.1 &&
            Math.abs(f.panel.height - sample[0].panel.height) < 0.1 &&
            Math.abs(f.header.height - sample[0].header.height) < 0.1
        )
    )
    assert.ok(
      sample.some((f) => f.opacity > 0 && f.opacity < 1),
      "content switched abruptly"
    )
    assert.ok(
      sample.every((f) => f.trees === 1),
      "overlaid content trees"
    )
    for (let i = 1; i < sample.length; i++)
      if (sample[i].content !== sample[i - 1].content)
        assert.ok(
          sample[i - 1].opacity < 0.08 || sample[i].opacity < 0.08,
          "content changed while visible"
        )
    assert.equal(
      await page.evaluate(() => window.__viewSnapshots),
      0,
      "GPU snapshot transition remains"
    )
    await page.waitForSelector(".section-board")
    await page.locator('[aria-label="选择书签"]').click()
    await page.locator('[aria-label="书签拼图"]').click()
    await page.waitForFunction(
      () =>
        !document.querySelector(".view-panel").inert &&
        !!document.querySelector(".heat-card")
    )
    await page.keyboard.press("Escape")
    await page.locator('[aria-label="文件夹视图"]').click()
    await page.waitForFunction(
      () => !document.querySelector(".view-panel").inert
    )
    const retarget = await page.evaluate(async () => {
      const panel = document.querySelector(".view-panel"),
        frames = [],
        initial = panel.getBoundingClientRect(),
        start = performance.now()
      let running = true
      const measure = () => {
        const rect = panel.getBoundingClientRect()
        frames.push({
          t: performance.now() - start,
          opacity: Number(getComputedStyle(panel).opacity),
          content: panel.querySelector(".heat-card") ? "heat" : "zones",
          trees: panel.querySelectorAll(".main-content").length,
          shift: Math.max(
            Math.abs(rect.top - initial.top),
            Math.abs(rect.height - initial.height)
          ),
        })
        if (running) requestAnimationFrame(measure)
      }
      measure()
      for (const [target, pause] of [
        ["书签拼图", 35],
        ["文件夹视图", 130],
        ["书签拼图", 195],
        ["文件夹视图", 135],
        ["书签拼图", 350],
      ]) {
        document
          .querySelector(`[aria-label="${target}"]`)
          .dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true, button: 0 })
          )
        await new Promise((r) => setTimeout(r, pause))
      }
      running = false
      return frames
    })
    await writeFile(
      "artifacts/view-switch-retarget.json",
      JSON.stringify(retarget, null, 2)
    )
    assert.ok(retarget.every((f) => f.trees === 1 && f.shift < 0.1))
    for (let i = 1; i < retarget.length; i++) {
      if (retarget[i].content !== retarget[i - 1].content)
        assert.ok(
          retarget[i - 1].opacity < 0.08 || retarget[i].opacity < 0.08,
          "rapid switch replaced visible content"
        )
    }
    const cancellations = await page.evaluate(() => window.__viewCancellations)
    assert.ok(cancellations.length > 4)
    assert.ok(
      cancellations.every((f) => Math.abs(f.before - f.after) < 0.001),
      "interrupted transition reset its displayed opacity"
    )
    await page.waitForSelector(".heat-card")
    await page.waitForFunction(
      () => !document.querySelector(".view-panel").dataset.switching
    )
    assert.equal(
      await page.evaluate(
        () => document.querySelector(".view-panel").style.opacity
      ),
      ""
    )
    assert.ok(
      await page.$eval(".view-panel", (e) => !e.inert && !e.style.height),
      "transition left content locked"
    )
    assert.equal(
      await page.$$eval(".main-content", (nodes) => nodes.length),
      1,
      "retained inactive trees"
    )
    assert.equal(
      await page.$eval('[aria-label="书签拼图"]', (e) =>
        e.getAttribute("aria-selected")
      ),
      "true"
    )
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ])
    await page.locator('[aria-label="文件夹视图"]').click()
    await page.waitForSelector(".section-board")
    assert.ok(
      await page.evaluate(
        () => !document.querySelector(".view-panel").dataset.switching
      )
    )
    await page.emulateMediaFeatures([])
    await page.focus('[aria-label="文件夹视图"]')
    await page.keyboard.press("ArrowLeft")
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="书签拼图"]')
          .getAttribute("aria-selected") === "true"
    )
    checks.push({
      environment: apiAbsent ? "api-absent" : "api-present",
      theme: apiAbsent ? "light" : "dark",
      frames: sample.length,
      retargetFrames: retarget.length,
      rapidRetarget: true,
      reducedMotion: true,
      keyboard: true,
    })
    if (!apiAbsent)
      await writeFile(
        "artifacts/view-switch-frames.json",
        JSON.stringify(sample, null, 2)
      )
    await page.close()
  }
  const page = await browser.newPage()
  page.on("pageerror", (e) => errors.push(e.message))
  await page.evaluateOnNewDocument(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      addEventListener(type, listener, options) {
        return super.addEventListener(
          type,
          type === "message"
            ? (event) => setTimeout(() => listener.call(this, event), 400)
            : listener,
          options
        )
      }
      set onmessage(listener) {
        super.onmessage = (event) =>
          setTimeout(() => listener.call(this, event), 400)
      }
    }
  })
  await openPreview(page, preview.url)
  await page.evaluate(() => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: `slow-${i}`,
      parentId: "root",
      index: i,
      title: `书签 ${i}`,
      url: `https://site${i}.test/`,
    }))
    localStorage.clear()
    localStorage.setItem(
      "tabnest:demo-bookmarks:v2",
      JSON.stringify({
        groups: [{ id: "root", name: "书签栏", items }],
        folders: [{ id: "root", title: "书签栏", path: "书签栏", root: true }],
      })
    )
    localStorage.setItem(
      "tabnest:settings",
      JSON.stringify({ layout: "zones", iconMode: "favicon" })
    )
  })
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForSelector(".section-board")
  await page.waitForFunction(
    () => document.documentElement.dataset.startup === "ready"
  )
  const preparation = await page.evaluate(async () => {
    const frames = [],
      panel = document.querySelector(".view-panel")
    let running = true
    const measure = () => {
      const canvas = panel.querySelector(".heat-canvas")
      frames.push({
        opacity: Number(getComputedStyle(panel).opacity),
        preparing: canvas?.dataset.layoutReady === "false",
        cards: canvas?.querySelectorAll(".heat-card").length || 0,
        trees: panel.querySelectorAll(".main-content").length,
      })
      if (running) requestAnimationFrame(measure)
    }
    measure()
    document
      .querySelector('[aria-label="书签拼图"]')
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    await new Promise((r) => setTimeout(r, 140))
    document
      .querySelector('[aria-label="文件夹视图"]')
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    await new Promise((r) => setTimeout(r, 5))
    document
      .querySelector('[aria-label="书签拼图"]')
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    const deadline = performance.now() + 8000
    while (
      panel.querySelector('.heat-canvas[data-layout-ready="false"]') ||
      !panel.querySelector(".heat-card") ||
      panel.inert ||
      Number(getComputedStyle(panel).opacity) < 1
    ) {
      if (performance.now() > deadline)
        throw Error("slow Worker did not reveal")
      await new Promise((r) => requestAnimationFrame(r))
    }
    measure()
    running = false
    return frames
  })
  // Visible regions now use the common local solver, so a delayed worker must
  // never block the reveal. The injected worker still exercises background work.
  assert.ok(preparation.some((f) => f.cards > 0), "mosaic was not revealed")
  assert.ok(
    preparation.every((f) => !f.preparing || f.opacity === 0),
    "unfinished mosaic appeared during mode reveal"
  )
  assert.ok(preparation.every((f) => f.trees === 1))
  assert.ok(preparation.some((f) => f.cards > 0 && f.opacity === 1))
  checks.push({ name: "slow-worker-reveal", frames: preparation.length })
  await page.close()
  assert.deepEqual(errors, [])
  await writeFile(
    "artifacts/view-switch-check.json",
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        gpu: process.env.VIEW_SWITCH_GPU === "1" ? "enabled" : "disabled",
        checks,
        errors,
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ checks, errors }))
} finally {
  await browser.close()
  await preview.close()
}

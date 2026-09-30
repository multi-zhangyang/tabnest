import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { launchBrowser, servePreview, openPreview } from "./runtime.mjs"
import {
  openSearch,
  showSearchResults,
  clearSearch,
} from "./search-helpers.mjs"
const preview = await servePreview(),
  browser = await launchBrowser(),
  checks = [],
  errors = []
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  page.on("pageerror", (e) => errors.push(e.message))
  await openPreview(page, preview.url)
  await page.waitForSelector(".heat-card")
  const rectangles = () =>
    page.$$eval(".heat-cell", (nodes) =>
      nodes.map((e) => ({
        id: e.dataset.itemId,
        ...e.getBoundingClientRect().toJSON(),
      }))
    )
  const initial = await rectangles()
  assert.ok(
    initial.filter(
      (r) => r.width / r.height >= 0.8 && r.width / r.height <= 1.25
    ).length >= 4,
    "mosaic needs square tiles"
  )
  assert.ok(
    initial.some((r) => r.width / r.height > 1.4) &&
      initial.some((r) => r.width / r.height < 0.72),
    "mixed orientations"
  )
  const canvasHeight = await page.$eval(".heat-canvas", (e) => e.offsetHeight)
  const canvasWidth = await page.$eval(".heat-canvas", (e) => e.offsetWidth)
  const frames = await page.evaluate(async () => {
    window.open = () => null
    const frames = [],
      start = performance.now()
    const sample = () =>
      [...document.querySelectorAll(".heat-cell")].map((e) => ({
        id: e.dataset.itemId,
        ...e.getBoundingClientRect().toJSON(),
      }))
    const tick = () => {
      frames.push(sample())
      if (performance.now() - start < 700) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    for (let i = 0; i < 20; i++)
      document.querySelector('[data-bookmark-id="l2"]').dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        })
      )
    await new Promise((r) => setTimeout(r, 750))
    return frames
  })
  await writeFile("artifacts/animation-frames.json", JSON.stringify(frames))
  for (const [f, frame] of frames.entries())
    for (let i = 0; i < frame.length; i++) {
      const a = frame[i]
      assert.ok(a.width >= 55.9 && a.height >= 55.9, `minimum on frame ${f}`)
      assert.ok(
        a.width * a.height <=
          Math.max(
            360 ** 2,
            Math.min(520 ** 2, canvasWidth * canvasHeight * 0.3)
          ) +
            1,
        `max area on frame ${f}`
      )
      assert.ok(Math.max(a.width, a.height) <= 700.1, `max edge on frame ${f}`)
      assert.ok(
        Math.max(a.width / a.height, a.height / a.width) <= 2.01,
        `aspect on frame ${f}`
      )
      for (let j = i + 1; j < frame.length; j++) {
        const b = frame[j]
        assert.ok(
          Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 0.1 ||
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 0.1,
          `overlap on frame ${f}`
        )
      }
    }
  const grown = await rectangles(),
    target = (xs) => xs.find((r) => r.id === "l2")
  assert.equal(
    await page.$eval(".heat-canvas", (e) => e.offsetHeight),
    canvasHeight
  )
  assert.ok(
    target(grown).width * target(grown).height >
      target(initial).width * target(initial).height
  )
  assert.ok(
    grown.some((r) => {
      const old = initial.find((v) => v.id === r.id)
      return r.width * r.height < old.width * old.height - 1
    })
  )
  checks.push({
    name: "shared-boundary-animation-growth-shrink",
    frames: frames.length,
    fixedHeight: canvasHeight,
  })
  await page.reload()
  await page.waitForSelector(".heat-card")
  await delay(300)
  const reopened = await rectangles()
  for (const r of reopened) {
    const before = grown.find((b) => b.id === r.id)
    assert.ok(
      Math.abs(before.x - r.x) < 1 && Math.abs(before.y - r.y) < 1,
      "reopen changed topology"
    )
  }
  await openSearch(page, "blbl")
  assert.equal(
    await page.$$eval('[data-value^="bookmark:"]', (es) => es.length),
    1
  )
  const beforeDialog = await rectangles()
  await page.evaluate(() => {
    const key = "tabnest:clicks",
      doc = JSON.parse(localStorage.getItem(key))
    doc.data["https://www.youtube.com"] = 100000
    localStorage.setItem(key, JSON.stringify(doc))
    window.dispatchEvent(new CustomEvent("tabnest:storage", { detail: key }))
  })
  await delay(300)
  assert.deepEqual(await rectangles(), beforeDialog, "modal geometry changed")
  await page.evaluate(() => {
    const key = "tabnest:settings",
      doc = JSON.parse(localStorage.getItem(key)) || {
        schemaVersion: 1,
        revision: 1,
        updatedAt: new Date().toISOString(),
        data: {},
      }
    doc.data.cardScale = 1.1
    localStorage.setItem(key, JSON.stringify(doc))
    window.dispatchEvent(new CustomEvent("tabnest:storage", { detail: key }))
  })
  await delay(200)
  assert.deepEqual(
    await rectangles(),
    beforeDialog,
    "settings must not move geometry under dialogs"
  )
  await page.keyboard.press("Escape")
  await delay(350)
  checks.push({ name: "layout-memory-and-modal-freeze" })
  await page.evaluate(async () => {
    const key = "tabnest:clicks",
      doc = JSON.parse(localStorage.getItem(key))
    doc.data["https://github.com"] = 1000000
    localStorage.setItem(key, JSON.stringify(doc))
    window.dispatchEvent(new CustomEvent("tabnest:storage", { detail: key }))
    await new Promise((resolve) => setTimeout(resolve, 110))
    document.querySelector('[aria-label="打开搜索"]').click()
  })
  await page.waitForSelector(".search-dialog")
  await delay(70)
  const paused = await rectangles()
  await delay(200)
  assert.deepEqual(
    await rectangles(),
    paused,
    "in-flight geometry must pause under dialogs"
  )
  await page.keyboard.press("Escape")
  await delay(350)
  checks.push({ name: "in-flight-animation-pause-resume" })
  for (const theme of ["light", "dark"])
    for (const [width, height] of [
      [320, 400],
      [390, 844],
      [1280, 720],
      [1920, 1080],
    ]) {
      await page.setViewport({ width, height })
      await page.evaluate((theme) => {
        localStorage.setItem("theme", theme)
        window.dispatchEvent(new Event("tabnest:theme"))
      }, theme)
      await delay(280)
      const rs = await rectangles()
      assert.ok(rs.every((r) => r.width >= 55.9 && r.height >= 55.9))
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      await page.screenshot({
        path: `artifacts/upgrade-heat-${theme}-${width}.png`,
      })
      await openSearch(page, "blbl")
      await delay(200)
      const dialog = await page.$eval(".search-dialog", (e) => ({
        rect: e.getBoundingClientRect().toJSON(),
        scrollbar: getComputedStyle(
          document.querySelector(".search-command-list")
        ).scrollbarWidth,
      }))
      assert.ok(
        Math.abs(dialog.rect.x + dialog.rect.width / 2 - width / 2) < 1,
        "search must be centered"
      )
      assert.ok(
        dialog.rect.y >= 0 && dialog.rect.bottom <= height,
        "search outside viewport"
      )
      assert.equal(dialog.scrollbar, "none")
      if (width === 1280)
        await page.screenshot({ path: `artifacts/upgrade-search-${theme}.png` })
      await page.keyboard.press("Escape")
      await page.locator('[aria-label="文件夹视图"]').click()
      await delay(300)
      if (width >= 1280) {
        const cols = await page.$eval(
          ".section-board",
          (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length
        )
        assert.equal(cols, 3, "desktop sections require three columns")
      }
      await page.screenshot({
        path: `artifacts/upgrade-zones-${theme}-${width}.png`,
      })
      await page.locator('[aria-label="书签拼图"]').click()
      checks.push({ name: "responsive-materials", theme, width, height })
    }
  await page.setViewport({ width: 1440, height: 900 })
  await page.waitForSelector(".heat-cell")
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ])
  assert.ok(
    await page.$eval(
      ".heat-cell",
      (e) => parseFloat(getComputedStyle(e).transitionDuration) < 0.001
    )
  )
  await page.emulateMediaFeatures([])
  await page.setViewport({ width: 390, height: 500 })
  await delay(350)
  await page.evaluate(() => scrollTo(0, 100))
  const scroll = await page.evaluate(() => scrollY)
  assert.equal(scroll, 100)
  await showSearchResults(page, "github")
  await clearSearch(page)
  await delay(200)
  assert.equal(await page.evaluate(() => scrollY), scroll)
  checks.push({ name: "reduced-motion-and-search-return" })
  await page.setViewport({ width: 1440, height: 900 })
  await page.locator('[aria-label="外观与偏好"]').click()
  await page.waitForSelector(".settings-dialog")
  await delay(280)
  const settingsFrames = []
  for (const name of ["书签", "数据", "外观"]) {
    const button = await page.evaluateHandle(
      (name) =>
        [
          ...document.querySelectorAll('.settings-navigation [role="tab"]'),
        ].find((el) => el.textContent.trim() === name),
      name
    )
    await button.asElement().click()
    for (let frame = 0; frame < 12; frame++) {
      settingsFrames.push(
        await page.$eval(".settings-dialog", (el) =>
          el.getBoundingClientRect().toJSON()
        )
      )
      await delay(20)
    }
  }
  assert.ok(
    settingsFrames.every(
      (r) =>
        Math.abs(r.height - settingsFrames[0].height) < 0.1 &&
        Math.abs(r.top - settingsFrames[0].top) < 0.1
    ),
    "settings categories changed dialog height"
  )
  await page.screenshot({ path: "artifacts/settings-final.png" })
  await page.keyboard.press("Escape")
  checks.push({
    name: "settings-fixed-height-category-transitions",
    frames: settingsFrames.length,
  })
  assert.deepEqual(errors, [])
  await writeFile(
    "artifacts/upgrade-ui-check.json",
    JSON.stringify({ checks, errors }, null, 2)
  )
  console.log(JSON.stringify({ checks, errors }))
} finally {
  await browser.close()
  await preview.close()
}

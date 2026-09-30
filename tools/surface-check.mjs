import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import axe from "axe-core"
import { AxePuppeteer } from "@axe-core/puppeteer"
import { launchBrowser, openPreview, servePreview } from "./runtime.mjs"

const preview = await servePreview(),
  browser = await launchBrowser()
const checks = [],
  errors = []
try {
  const page = await browser.newPage()
  page.on("pageerror", (e) => errors.push(e.message))
  for (const theme of ["light", "dark"]) {
    await openPreview(page, preview.url)
    await page.evaluate((theme) => {
      localStorage.setItem("theme", theme)
      localStorage.removeItem("tabnest:clicks")
      const settings = JSON.parse(
        localStorage.getItem("tabnest:settings") || "null"
      )
      localStorage.setItem(
        "tabnest:settings",
        JSON.stringify({
          schemaVersion: 1,
          revision: (settings?.revision || 0) + 1,
          updatedAt: new Date().toISOString(),
          data: { ...settings?.data, layout: "heat", newTab: true },
        })
      )
    }, theme)
    await page.reload({ waitUntil: "networkidle0" })
    await page.waitForSelector(".heat-card")
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.startup === "ready" &&
        Number(getComputedStyle(document.querySelector("#root")).opacity) === 1
    )
    const initial = await page.$$eval(".heat-card", (nodes) =>
      nodes.map((el) => ({
        url: el.href,
        background: getComputedStyle(el.querySelector(".bookmark-surface"))
          .backgroundImage,
        color: getComputedStyle(el.querySelector(".bookmark-surface"))
          .backgroundColor,
        decoration: getComputedStyle(
          el.querySelector(".bookmark-surface"),
          "::after"
        ).content,
      }))
    )
    assert.ok(
      initial.every((x) => x.background === "none" && x.decoration === "none"),
      "Discarded backgrounds or decorations remain"
    )
    assert.ok(
      initial.every((x) => {
        const rgb = x.color.match(/[\d.]+/g).map(Number)
        return rgb[0] === rgb[1] && rgb[1] === rgb[2]
      }),
      "Mosaic surfaces must follow the neutral theme"
    )
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `artifacts/palette-${theme}.png` })
    const accessibility = await new AxePuppeteer(page, axe.source)
      .withTags(["wcag2a", "wcag2aa"])
      .analyze()
    assert.deepEqual(
      accessibility.violations,
      [],
      JSON.stringify(accessibility.violations)
    )
    await page.evaluate(() => {
      window.open = () => null
      window.__pointerFrames = []
      window.__watchingPointer = true
      const sample = () => {
        const card = document.querySelector(".heat-card")
        window.__pointerFrames.push({
          clicks: Number(card.dataset.clicks),
          shadow: getComputedStyle(card).boxShadow,
          outline: getComputedStyle(card).outlineWidth,
          outlineStyle: getComputedStyle(card).outlineStyle,
          focusVisible: card.matches(":focus-visible"),
          animations: card.getAnimations().length,
        })
        if (window.__watchingPointer) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await page.click(".heat-card")
    await page.keyboard.down("Control")
    await page.click(".heat-card")
    await page.keyboard.up("Control")
    await new Promise((r) => setTimeout(r, 400))
    const frames = await page.evaluate(() => {
      window.__watchingPointer = false
      return window.__pointerFrames
    })
    await writeFile(
      `artifacts/pointer-${theme}.json`,
      JSON.stringify(frames, null, 2)
    )
    assert.ok(frames.length >= 10)
    assert.ok(
      frames.every(
        (f) =>
          f.shadow === "none" &&
          (f.outlineStyle === "none" || f.outline === "0px") &&
          f.animations === 0 &&
          !f.focusVisible
      ),
      "Pointer activation painted an external ring"
    )
    assert.ok(
      frames.at(-1).clicks > frames[0].clicks,
      "Click was not persisted"
    )
    await page.mouse.move(0, 0)
    await page.evaluate(() => document.activeElement.blur())
    await page.keyboard.press("Tab")
    await page.evaluate(() => document.querySelector(".heat-card").focus())
    assert.ok(
      await page.$eval(
        ".heat-card",
        (el) =>
          el.matches(":focus-visible") &&
          getComputedStyle(el).boxShadow !== "none"
      ),
      "Keyboard focus must remain visible"
    )
    await page.reload({ waitUntil: "networkidle0" })
    const restored = await page.$$eval(".heat-card", (nodes) =>
      nodes.map((el) => ({
        url: el.href,
        background: getComputedStyle(el.querySelector(".bookmark-surface"))
          .backgroundImage,
        color: getComputedStyle(el.querySelector(".bookmark-surface"))
          .backgroundColor,
        decoration: getComputedStyle(
          el.querySelector(".bookmark-surface"),
          "::after"
        ).content,
      }))
    )
    assert.deepEqual(
      restored,
      initial,
      "Surface identity changed after heat or refresh"
    )
    await page.locator('[aria-label="文件夹视图"]').click()
    const neutral = await page.$$eval(
      ".section-bookmarks .bookmark-card",
      (nodes) =>
        nodes.every(
          (el) =>
            getComputedStyle(el.querySelector(".bookmark-surface"))
              .backgroundImage === "none"
        )
    )
    assert.ok(neutral, "Mosaic colors leaked into folder view")
    checks.push({
      theme,
      frames: frames.length,
      neutralSurfaces: initial.length,
      accessibilityViolations: 0,
    })
  }
  assert.deepEqual(errors, [])
  const report = {
    recordedAt: new Date().toISOString(),
    platform: process.platform,
    browser: await browser.version(),
    checks,
    errors,
  }
  await writeFile(
    "artifacts/surface-check.json",
    JSON.stringify(report, null, 2) + "\n"
  )
  console.log(JSON.stringify({ checks, errors }))
} finally {
  await browser.close()
  await preview.close()
}

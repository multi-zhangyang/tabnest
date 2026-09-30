import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { launchBrowser } from "./runtime.mjs"

const browser = await launchBrowser({ pipe: true, enableExtensions: true })
const checks = [],
  errors = []
let currentPage, currentSample
try {
  const id = await browser.installExtension(resolve("dist"))
  const url = `chrome-extension://${id}/index.html`
  const setup = await browser.newPage()
  await setup.goto(url)
  await setup.waitForSelector('.main-tabs[data-ready="true"]')
  await setup.evaluate(async () => {
    await chrome.bookmarks.create({
      parentId: "1",
      title: "Startup fixture",
      url: "https://example.com/",
    })
  })
  for (const theme of ["light", "dark"]) {
    await setup.evaluate((theme) => localStorage.setItem("theme", theme), theme)
    const page = await browser.newPage()
    page.on("pageerror", (e) => errors.push(e.message))
    await page.evaluateOnNewDocument(() => {
      window.__surfaceFrames = []
      const sample = () => {
        const root = document.getElementById("root")
        const card = document.querySelector(".heat-cell, .section-card")
        window.__surfaceFrames.push({
          background: getComputedStyle(document.documentElement)
            .backgroundColor,
          phase: document.documentElement.dataset.startup,
          opacity: root ? Number(getComputedStyle(root).opacity) : 0,
          loading: !!document.querySelector(".loading-grid"),
          bounds: card?.getBoundingClientRect().toJSON(),
        })
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await page.goto("chrome://newtab")
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.startup === "ready" &&
        Number(getComputedStyle(document.getElementById("root")).opacity) === 1
    )
    const frames = await page.evaluate(() => window.__surfaceFrames)
    assert.ok(
      frames.every(
        (f) =>
          f.background ===
          (theme === "dark" ? "rgb(17, 17, 17)" : "rgb(245, 245, 245)")
      ),
      "Startup painted the wrong background"
    )
    assert.ok(
      frames.filter((f) => f.phase === "pending").every((f) => f.opacity === 0),
      "Unfinished layout was revealed"
    )
    assert.ok(
      frames.every((f) => !f.loading || f.opacity === 0),
      "Loading placeholders flashed"
    )
    for (let i = 1; i < frames.length; i++)
      assert.ok(
        frames[i].opacity >= frames[i - 1].opacity - 0.001,
        "Startup visibility reversed"
      )
    const visible = frames.filter((f) => f.phase === "ready" && f.bounds)
    assert.ok(
      visible.every((f) =>
        ["x", "y", "width", "height"].every(
          (k) => Math.abs(f.bounds[k] - visible[0].bounds[k]) < 0.1
        )
      ),
      "Geometry shifted during startup reveal"
    )
    checks.push({
      name: "steady-background-single-reveal",
      theme,
      frames: frames.length,
    })
    await page.close()
  }
  for (const layout of ["zones", "heat"])
    for (const latency of [0, 300]) {
      await setup.evaluate(async (layout) => {
        await chrome.storage.local.set({
          "tabnest:settings": {
            schemaVersion: 1,
            revision: 1,
            updatedAt: new Date().toISOString(),
            data: { layout },
          },
        })
      }, layout)
      const page = await browser.newPage()
      currentPage = page
      page.on("pageerror", (e) => errors.push(e.message))
      await page.evaluateOnNewDocument((latency) => {
        const get = chrome.storage.local.get.bind(chrome.storage.local)
        chrome.storage.local.get = async (...args) => {
          if (args[0] === "tabnest:settings")
            await new Promise((resolve) => setTimeout(resolve, latency))
          return get(...args)
        }
        window.__navigationFrames = []
        const sample = () => {
          const nav = document.querySelector(".main-tabs")
          if (nav)
            window.__navigationFrames.push({
              ready: nav.dataset.ready === "true",
              active:
                nav
                  .querySelector('[aria-selected="true"]')
                  ?.getAttribute("aria-label") || null,
              transitions: nav.getAnimations({ subtree: true }).length,
              animations: nav
                .getAnimations({ subtree: true })
                .map((animation) => ({
                  type: animation.constructor.name,
                  property: animation.transitionProperty,
                  name: animation.animationName,
                  target: animation.effect?.target?.outerHTML?.slice(0, 700),
                })),
            })
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }, latency)
      const expected = layout === "zones" ? "文件夹视图" : "书签拼图"
      for (const navigation of ["new-tab", "reload"]) {
        currentSample = { layout, latency, navigation }
        if (navigation === "new-tab") await page.goto(url)
        else await page.reload()
        await page.waitForFunction(
          () =>
            window.__navigationFrames?.filter((frame) => frame.ready).length >=
            6
        )
        const frames = await page.evaluate(() => window.__navigationFrames)
        assert.ok(
          frames.every((f) => !f.active || f.active === expected),
          "Wrong initial mode was painted"
        )
        assert.ok(
          frames
            .filter((f) => f.ready)
            .every((f) => f.active === expected && f.transitions === 0),
          "Initial mode must not animate"
        )
        checks.push({ layout, latency, navigation, frames: frames.length })
        const themeAnimations = await page.evaluate(() => {
          document.documentElement.classList.toggle("dark")
          const animations = document
            .querySelector(".main-tabs")
            .getAnimations({ subtree: true }).length
          document.documentElement.classList.toggle("dark")
          return animations
        })
        assert.equal(
          themeAnimations,
          0,
          "Late theme styles must not animate initial navigation"
        )
      }
      await page.close()
    }
  // Storage changes during startup must not let an obsolete read reveal defaults.
  await setup.evaluate(() =>
    chrome.storage.local.set({
      "tabnest:settings": {
        schemaVersion: 1,
        revision: 1,
        updatedAt: new Date().toISOString(),
        data: { layout: "zones" },
      },
    })
  )
  const race = await browser.newPage()
  race.on("pageerror", (e) => errors.push(e.message))
  await race.evaluateOnNewDocument(() => {
    const get = chrome.storage.local.get.bind(chrome.storage.local)
    window.__settingsStarted = 0
    window.__activeModes = []
    chrome.storage.local.get = async (...args) => {
      const value = await get(...args)
      if (args[0] === "tabnest:settings") {
        window.__settingsStarted++
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
      return value
    }
    const sample = () => {
      const active = document.querySelector('.main-tabs [aria-selected="true"]')
      if (active) window.__activeModes.push(active.getAttribute("aria-label"))
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await race.goto(url)
  await race.waitForFunction(() => window.__settingsStarted > 0)
  await setup.evaluate(() =>
    chrome.storage.local.set({
      "tabnest:settings": {
        schemaVersion: 1,
        revision: 2,
        updatedAt: new Date().toISOString(),
        data: { layout: "zones", showDomain: false },
      },
    })
  )
  await race.waitForFunction(
    () => window.__settingsStarted >= 2 && window.__activeModes.length >= 6
  )
  assert.ok(
    await race.evaluate(() =>
      window.__activeModes.every((mode) => mode === "文件夹视图")
    ),
    "Obsolete read revealed the default mode"
  )
  checks.push({ name: "concurrent-startup-preferences" })
  await race.close()
  // A real user switch still works and propagates to other open tabs.
  const peer = await browser.newPage()
  await peer.goto(url)
  await setup.bringToFront()
  await setup.locator('[aria-label="书签拼图"]').click()
  assert.equal(
    await setup.$eval(".main-tabs", (nav) => nav.dataset.interacted),
    "true"
  )
  await peer.bringToFront()
  await peer.waitForSelector('[aria-label="书签拼图"][aria-selected="true"]')
  checks.push({ name: "manual-switch-cross-tab" })
  assert.deepEqual(errors, [])
  await mkdir("artifacts", { recursive: true })
  await writeFile(
    "artifacts/startup-check.json",
    JSON.stringify({ checks, errors }, null, 2)
  )
  console.log(JSON.stringify({ passed: checks.length, errors }))
} catch (error) {
  await mkdir("artifacts", { recursive: true })
  const frames = await currentPage
    ?.evaluate(() => window.__navigationFrames)
    .catch(() => null)
  await writeFile(
    "artifacts/startup-failure.json",
    JSON.stringify(
      {
        sample: currentSample,
        error: error.stack,
        frames,
        checks,
        errors,
      },
      null,
      2
    )
  )
  await currentPage
    ?.screenshot({ path: "artifacts/startup-failure.png" })
    .catch(() => {})
  throw error
} finally {
  await browser.close()
}

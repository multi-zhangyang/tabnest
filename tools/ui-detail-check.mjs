import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import axe from "axe-core"
import { AxePuppeteer } from "@axe-core/puppeteer"
import { launchBrowser, openPreview, servePreview } from "./runtime.mjs"
import { sectionFixture } from "./section-fixture.mjs"

const preview = await servePreview(),
  browser = await launchBrowser()
const checks = [],
  errors = []
const page = await browser.newPage()
const delay = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms))
page.on("pageerror", (error) => errors.push(error.message))
const clickText = async (selector, text) => {
  const el = await page.waitForFunction(
    (selector, text) =>
      [...document.querySelectorAll(selector)].find(
        (el) => el.textContent.trim() === text
      ),
    {},
    selector,
    text
  )
  await el.asElement().click()
  await el.dispose()
  await delay()
}
const close = async () => {
  await page.keyboard.press("Escape")
  await page.waitForSelector('[role="dialog"]', { hidden: true })
  await delay()
}
async function newBookmark() {
  await page.locator('[aria-label="新建"]').click()
  await clickText('[role="menuitem"]', "新建书签")
  await page.waitForSelector("#bookmark-url")
  await delay()
}
async function editorGeometry(name) {
  const result = await page.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect()
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      }
    }
    const dialog = document.querySelector(".editor-dialog")
    const bounds = rect(dialog)
    const body = dialog.querySelector(".editor-body")
    const header = rect(dialog.querySelector('[data-slot="dialog-header"]'))
    const footer = rect(dialog.querySelector('[data-slot="dialog-footer"]'))
    const escapes = [
      ...dialog.querySelectorAll("input, button, [data-slot=field]"),
    ]
      .filter((el) => {
        const r = rect(el)
        return r.left < bounds.left - 1 || r.right > bounds.right + 1
      })
      .map((el) => el.id || el.getAttribute("aria-label") || el.textContent)
    const picker = document.querySelector("#bookmark-folder")
    const add = document.querySelector('[aria-label="新建子文件夹"]')
    return {
      bounds,
      header,
      footer,
      escapes,
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflow: Math.max(
        0,
        document.documentElement.scrollWidth - innerWidth,
        body.scrollWidth - body.clientWidth
      ),
      controlGap: picker && add ? rect(add).left - rect(picker).right : null,
      scrollableBody: body.scrollHeight > body.clientHeight,
    }
  })
  assert.deepEqual(result.escapes, [], name)
  assert.equal(result.horizontalOverflow, 0, name)
  assert.ok(
    result.bounds.top >= 15 &&
      result.bounds.bottom <= result.viewport.height - 15,
    name
  )
  assert.ok(result.header.bottom <= result.footer.top, name)
  assert.ok(result.footer.bottom <= result.bounds.bottom + 1, name)
  if (result.controlGap !== null)
    assert.ok(
      Math.abs(result.controlGap) <= 1,
      `${name}: split control separated or overlaps`
    )
  checks.push({ name, ...result })
}
async function pickerGeometry() {
  await page.waitForSelector('[data-slot="popover-content"]')
  await delay()
  const result = await page.$eval('[data-slot="popover-content"]', (el) => {
    const r = el.getBoundingClientRect()
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: innerWidth,
      height: innerHeight,
      overflow: el.scrollWidth - el.clientWidth,
    }
  })
  assert.ok(
    result.left >= 11 && result.right <= result.width - 11,
    JSON.stringify(result)
  )
  assert.ok(
    result.top >= 11 && result.bottom <= result.height - 11,
    JSON.stringify(result)
  )
  assert.ok(result.overflow <= 1, JSON.stringify(result))
}

try {
  await mkdir("artifacts", { recursive: true })
  await openPreview(page, preview.url, { waitUntil: "networkidle0" })
  const data = sectionFixture()
  const longFolder = data.folders.find((folder) => folder.id === "folder-ai")
  longFolder.title = "长期项目资料_".repeat(35)
  longFolder.path = `书签栏 / ${longFolder.title}`
  data.groups.find((group) => group.id === longFolder.id).name = longFolder.path
  for (const group of data.groups)
    for (const item of group.items)
      item.title = `${item.title} · ${"长期项目资料LongTitle".repeat(8)}`
  await page.evaluate((data) => {
    localStorage.setItem("tabnest:demo-bookmarks:v2", JSON.stringify(data))
    localStorage.setItem(
      "tabnest:settings",
      JSON.stringify({ layout: "zones" })
    )
  }, data)
  await page.reload({ waitUntil: "networkidle0" })
  await page.waitForSelector(".bookmark-card")

  for (const theme of ["浅色", "深色"]) {
    await page.locator('[aria-label="外观与偏好"]').click()
    await page.locator(`[aria-label="${theme}"]`).click()
    await close()
    for (const [width, height] of [
      [1440, 900],
      [1024, 600],
      [720, 450],
      [390, 640],
      [320, 480],
    ]) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 })
      await delay()
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
        "Long folder names must not widen the page"
      )
      await newBookmark()
      await editorGeometry(`${theme}/${width}x${height}/bookmark`)
      await page.locator("#bookmark-folder").click()
      await pickerGeometry()
      await page.locator('[cmdk-item][data-value="folder-ai"]').click()
      await delay()
      await editorGeometry(`${theme}/${width}x${height}/long-folder`)
      await page.locator('[aria-label="新建子文件夹"]').click()
      await page.waitForFunction(
        () => document.activeElement.id === "folder-name"
      )
      await editorGeometry(`${theme}/${width}x${height}/new-child-folder`)
      await page.locator("#folder-name").fill("验收子文件夹")
      if (width === 320) {
        await page.screenshot({
          path: `artifacts/editor-${theme === "浅色" ? "light" : "dark"}-320.png`,
        })
        const a11y = await new AxePuppeteer(page, axe.source)
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
        assert.deepEqual(a11y.violations, [], "Editor accessibility")
      }
      await close()
    }
  }

  // Validation and busy-state dismissal use the same component as every editor.
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await newBookmark()
  await page.locator("#bookmark-url").fill("javascript:alert(1)")
  await clickText(".editor-dialog button", "保存")
  await page.waitForSelector('[data-slot="field-error"]')
  await editorGeometry("invalid-url")
  await page.locator("#bookmark-url").fill("https://example.com/material-check")
  await page.locator("#bookmark-title").fill("Material check")
  await page.locator('[aria-label="新建子文件夹"]').click()
  await page.locator("#folder-name").fill("新建子文件夹验收")
  await page.evaluate(() => {
    window.__requestLock = navigator.locks.request.bind(navigator.locks)
    navigator.locks.request = (...args) =>
      new Promise((resolve, reject) => {
        setTimeout(
          () => window.__requestLock(...args).then(resolve, reject),
          500
        )
      })
  })
  await clickText(".editor-dialog button", "保存")
  assert.ok(await page.$('.editor-dialog [data-slot="dialog-close"][disabled]'))
  await page.keyboard.press("Escape")
  assert.ok(await page.$(".editor-dialog"), "Saving dialog must stay mounted")
  await page.waitForSelector(".editor-dialog", { hidden: true })
  await page.evaluate(() => {
    navigator.locks.request = window.__requestLock
  })
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("tabnest:demo-bookmarks:v2")).data
  )
  assert.equal(
    saved.groups
      .flatMap((group) => group.items)
      .filter((item) => item.title === "Material check").length,
    1
  )
  assert.equal(
    saved.folders.filter((folder) => folder.title === "新建子文件夹验收")
      .length,
    1
  )
  checks.push({ name: "validation-retry-busy-close-and-child-folder-save" })

  for (const entry of ["新建文件夹", "导入书签"]) {
    await page.setViewport({ width: 320, height: 400, deviceScaleFactor: 1 })
    if (entry === "新建文件夹") {
      await page.locator('[aria-label="新建"]').click()
      await clickText('[role="menuitem"]', entry)
      await page.waitForSelector("#folder-title")
    } else {
      await page.locator('[aria-label="外观与偏好"]').click()
      await clickText('.settings-dialog [role="tab"]', "数据")
      await clickText(".settings-dialog button", entry)
      await page.waitForSelector("#backup-file")
    }
    await delay()
    await editorGeometry(`${entry}/320x400`)
    await page
      .locator(entry === "新建文件夹" ? "#folder-parent" : "#import-parent")
      .click()
    await pickerGeometry()
    await page.keyboard.press("Escape")
    await delay()
    await close()
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: checks.length, errors }))
} catch (error) {
  await page.screenshot({ path: "artifacts/ui-detail-failure.png" })
  throw error
} finally {
  await writeFile(
    "artifacts/ui-detail-check.json",
    JSON.stringify({ checks, errors }, null, 2)
  )
  await browser.close()
  await preview.close()
}

import assert from "node:assert/strict"
import { resolve } from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import axe from "axe-core"
import { AxePuppeteer } from "@axe-core/puppeteer"
import { launchBrowser } from "./runtime.mjs"

const browser = await launchBrowser({ pipe: true, enableExtensions: true })
const checks = [],
  errors = []
const delay = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms))
const page = await browser.newPage()
page.on("pageerror", (error) => errors.push(error.message))
const click = async (text, selector = "button") => {
  const element = await page.waitForFunction(
    (text, selector) =>
      [...document.querySelectorAll(selector)].find(
        (el) => el.textContent.trim() === text
      ),
    {},
    text,
    selector
  )
  await element.asElement().click()
  await element.dispose()
  await delay()
}
const titles = async (id) =>
  page.evaluate(
    async (id) =>
      (await chrome.bookmarks.getChildren(id))
        .filter((n) => n.url)
        .map((n) => n.title),
    id
  )
try {
  const extensionId = await browser.installExtension(resolve("dist"))
  const url = `chrome-extension://${extensionId}/index.html`
  await page.goto(url, { waitUntil: "networkidle0" })
  const fixture = await page.evaluate(async () => {
    const root = (await chrome.bookmarks.getTree())[0].children.find(
      (n) => n.folderType === "bookmarks-bar" || n.id === "1"
    )
    const source = await chrome.bookmarks.create({
      parentId: root.id,
      title: "开发工具",
    })
    const target = await chrome.bookmarks.create({
      parentId: root.id,
      title: "目标文件夹",
    })
    const items = []
    for (const title of ["Alpha", "Beta", "Gamma", "Delta"])
      items.push(
        await chrome.bookmarks.create({
          parentId: source.id,
          title,
          url: `https://example.com/${title.toLowerCase()}`,
        })
      )
    await chrome.storage.local.set({
      "tabnest:settings": {
        schemaVersion: 1,
        revision: 1,
        updatedAt: new Date().toISOString(),
        data: { layout: "zones", newTab: true },
      },
    })
    return { source: source.id, target: target.id, root: root.id, items }
  })
  await page.waitForSelector(`[data-bookmark-id="${fixture.items[0].id}"]`)
  assert.equal(
    await page.$$eval("button", (els) =>
      els.some((el) => el.textContent.includes("重排云图"))
    ),
    false
  )
  await page.locator('[aria-label="搜索书签"]').fill("开发 Alpha")
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".search-results .bookmark-card").length === 1
  )
  await page.evaluate(() => {
    window.__openedBefore = 0
    document.querySelector('[aria-label="搜索书签"]').dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        isComposing: true,
        bubbles: true,
      })
    )
  })
  await delay()
  assert.equal(
    await page.evaluate(
      async () =>
        Object.keys(
          (await chrome.storage.local.get("tabnest:clicks"))["tabnest:clicks"]
            ?.data || {}
        ).length
    ),
    0
  )
  checks.push("IME-confirmation-does-not-open-and-multi-token-search")
  await page.keyboard.press("Escape")
  for (const [keys, target] of [
    [["Control"], "background"],
    [["Control", "Shift"], "foreground"],
    [["Shift"], "window"],
  ]) {
    const before = await page.evaluate(async () => ({
      tabs: (await chrome.tabs.query({})).map((t) => t.id),
      windows: (await chrome.windows.getAll()).length,
    }))
    for (const key of keys) await page.keyboard.down(key)
    await page.click(`[data-bookmark-id="${fixture.items[0].id}"]`)
    for (const key of [...keys].reverse()) await page.keyboard.up(key)
    await delay(350)
    const result = await page.evaluate(
      async (before) => ({
        newTabs: (await chrome.tabs.query({}))
          .filter((t) => !before.tabs.includes(t.id))
          .map((t) => ({ id: t.id, active: t.active })),
        windows: (await chrome.windows.getAll()).length,
      }),
      before
    )
    assert.equal(result.newTabs.length, 1, target)
    if (target === "window") assert.equal(result.windows, before.windows + 1)
    if (target === "background") assert.equal(result.newTabs[0].active, false)
    else assert.equal(result.newTabs[0].active, true)
    await page.bringToFront()
    await page.evaluate(
      async (ids) => chrome.tabs.remove(ids),
      result.newTabs.map((t) => t.id)
    )
    checks.push(`native-open-${target}`)
  }
  await page.evaluate(({ items, target }) => {
    const transfer = new DataTransfer()
    const source = document.querySelector(`[data-bookmark-id="${items[0].id}"]`)
    const destination = document.querySelector(
      `[data-folder-id="${target}"] .section-card`
    )
    source.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer })
    )
    destination.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      })
    )
    destination.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      })
    )
    source.dispatchEvent(
      new DragEvent("dragend", { bubbles: true, dataTransfer: transfer })
    )
  }, fixture)
  await page.waitForFunction(
    async ({ target }) =>
      (await chrome.bookmarks.getChildren(target)).some(
        (n) => n.title === "Alpha"
      ),
    {},
    fixture
  )
  assert.deepEqual(await titles(fixture.target), ["Alpha"])
  checks.push("native-cross-folder-drag")
  await page.locator('[aria-label="选择书签"]').click()
  await page.locator('[aria-label="选择 Beta"]').click()
  await page.locator('[aria-label="选择 Gamma"]').click()
  assert.equal(
    await page.$$eval(
      '[data-slot="checkbox"][data-state="checked"]',
      (els) => els.length
    ),
    2
  )
  const a11y = await new AxePuppeteer(page, axe.source).analyze()
  if (a11y.violations.length)
    console.log(
      JSON.stringify(
        a11y.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.html),
        }))
      )
    )
  assert.deepEqual(
    a11y.violations.map((v) => v.id),
    []
  )
  await click("移动", ".management-bar button")
  await page.locator("#batch-parent").click()
  await page.locator('[aria-label="查找文件夹"]').fill("目标文件夹")
  await click("书签栏 / 目标文件夹", "[cmdk-item]")
  await click("移动", '[role="dialog"] button')
  await page.waitForSelector('[role="dialog"]', { hidden: true })
  assert.deepEqual(await titles(fixture.target), ["Alpha", "Beta", "Gamma"])
  checks.push("native-batch-move-and-a11y")
  await page.locator('[aria-label="选择书签"]').click()
  await page.locator('[aria-label="选择 Alpha"]').click()
  await page.locator('[aria-label="选择 Beta"]').click()
  await click("删除", ".management-bar button")
  await click("删除", '[role="alertdialog"] button')
  await page.waitForSelector('[role="alertdialog"]', { hidden: true })
  assert.deepEqual(await titles(fixture.target), ["Gamma"])
  await page.reload({ waitUntil: "networkidle0" })
  await page.locator('[aria-label="外观与偏好"]').click()
  await click("数据", '[role="tab"]')
  await click("最近删除")
  await click("恢复", ".recovery-row button")
  await page.waitForFunction(
    async (target) => (await chrome.bookmarks.getChildren(target)).length === 3,
    {},
    fixture.target
  )
  assert.deepEqual(await titles(fixture.target), ["Alpha", "Beta", "Gamma"])
  assert.equal(await page.$$(".recovery-row").then((rows) => rows.length), 0)
  checks.push("native-batch-delete-reload-restore-preserves-order")
  await page.keyboard.press("Escape")
  await page.locator('[aria-label="搜索书签"]').fill("目标文件夹")
  await click("书签栏 / 目标文件夹", ".folder-results button")
  assert.equal(
    await page.$eval(
      `[data-folder-id="${fixture.target}"]`,
      (el) => el === document.activeElement
    ),
    true
  )
  checks.push("folder-search-locates-section")
  const reorder = async (title, anchorTitle, after) => {
    await page.evaluate(
      ({ title, anchorTitle, after }) => {
        const source = [...document.querySelectorAll(".bookmark-card")].find(
          (el) => el.querySelector(".bookmark-title").textContent === title
        )
        const destination = [
          ...document.querySelectorAll(".bookmark-card"),
        ].find(
          (el) =>
            el.querySelector(".bookmark-title").textContent === anchorTitle
        )
        const bounds = destination.getBoundingClientRect(),
          transfer = new DataTransfer()
        source.dispatchEvent(
          new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer })
        )
        destination.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          })
        )
        destination.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
            clientX: after ? bounds.right - 2 : bounds.left + 2,
          })
        )
        source.dispatchEvent(
          new DragEvent("dragend", { bubbles: true, dataTransfer: transfer })
        )
      },
      { title, anchorTitle, after }
    )
    await delay(350)
  }
  await reorder("Gamma", "Alpha", true)
  assert.deepEqual(await titles(fixture.target), ["Alpha", "Gamma", "Beta"])
  await reorder("Gamma", "Alpha", false)
  assert.deepEqual(await titles(fixture.target), ["Gamma", "Alpha", "Beta"])
  await reorder("Gamma", "Beta", true)
  assert.deepEqual(await titles(fixture.target), ["Alpha", "Beta", "Gamma"])
  checks.push("native-same-folder-drag-before-and-after")
  const alphaId = await page.evaluate(
    async (target) =>
      (await chrome.bookmarks.getChildren(target)).find(
        (n) => n.title === "Alpha"
      ).id,
    fixture.target
  )
  await page.click(`[data-bookmark-id="${alphaId}"]`, { button: "right" })
  await click("下移", '[role="menuitem"]')
  assert.deepEqual(await titles(fixture.target), ["Beta", "Alpha", "Gamma"])
  await page.click(`[data-bookmark-id="${alphaId}"]`, { button: "right" })
  await click("上移", '[role="menuitem"]')
  assert.deepEqual(await titles(fixture.target), ["Alpha", "Beta", "Gamma"])
  checks.push("native-context-menu-ordering")

  await page.evaluate(() => {
    const original = URL.createObjectURL
    URL.createObjectURL = (blob) => {
      void blob.text().then((text) => {
        window.__backup = text
      })
      return original(blob)
    }
    localStorage.setItem("theme", "light")
    window.dispatchEvent(new Event("tabnest:theme"))
  })
  await page.locator('[aria-label="外观与偏好"]').click()
  await click("数据", '[role="tab"]')
  await click("导出完整备份")
  await page.waitForFunction(() => window.__backup)
  const backup = JSON.parse(await page.evaluate(() => window.__backup))
  assert.equal(backup.version, 4)
  assert.equal(backup.preferences.theme, "light")
  assert.equal(backup.preferences.clicks["https://example.com/alpha"], 3)
  await mkdir("artifacts", { recursive: true })
  await writeFile("artifacts/product-full-backup.json", JSON.stringify(backup))
  await click("导入书签")
  await page.waitForSelector("#backup-file")
  await (
    await page.$("#backup-file")
  ).uploadFile(resolve("artifacts/product-full-backup.json"))
  await page.waitForSelector("#restore-preferences")
  assert.equal(
    await page.$eval("#restore-preferences", (el) =>
      el.getAttribute("aria-checked")
    ),
    "false"
  )
  await page.click("#restore-preferences")
  await click("导入为新文件夹")
  await page.waitForSelector('[role="dialog"]', { hidden: true })
  const restored = await page.evaluate(async () => ({
    settings: (await chrome.storage.local.get("tabnest:settings"))[
      "tabnest:settings"
    ].data,
    clicks: (await chrome.storage.local.get("tabnest:clicks"))["tabnest:clicks"]
      .data,
    tree: await chrome.bookmarks.getTree(),
  }))
  assert.notEqual(restored.settings.activeFolderId, fixture.target)
  assert.equal(restored.clicks["https://example.com/alpha"], 3)
  assert.equal(
    await page.$$eval(".section-bookmarks .bookmark-card", (els) => els.length),
    8
  )
  checks.push("complete-backup-native-export-import-remaps-folder-preferences")
  await page.locator('[aria-label="热度云图"]').click()
  await delay(300)
  const positions = () =>
    page.$$eval(".heat-card", (els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return [
          el.dataset.bookmarkId,
          ...[r.x, r.y, r.width, r.height].map(Math.round),
        ]
      })
    )
  const beforeReload = await positions()
  await page.reload({ waitUntil: "networkidle0" })
  await delay(300)
  assert.deepEqual(await positions(), beforeReload)
  checks.push("heat-topology-persists-across-new-page")
  await page.setViewport({ width: 320, height: 640 })
  await delay(300)
  await page.locator('[aria-label="选择书签"]').click()
  await click("全选", ".management-bar button")
  const bar = await page.$eval(".management-bar", (el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, bottom: r.bottom }
  })
  assert.ok(bar.left >= 0 && bar.right <= 320 && bar.bottom <= 640)
  const checkboxSizes = await page.$$eval(".bookmark-checkbox", (els) =>
    els.map((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    }))
  )
  assert.ok(
    checkboxSizes.every(
      (size) =>
        size.width <= 24 &&
        size.height <= 24 &&
        size.width >= 16 &&
        size.height >= 16
    ),
    "checkbox inherited the tile dimensions"
  )
  await page.screenshot({ path: "artifacts/product-selection-320.png" })
  checks.push("narrow-selection-toolbar-bounds")
  await page.setViewport({ width: 1440, height: 900 })
  await page.locator('[aria-label="退出多选"]').click()
  await page.locator('[aria-label="分区视图"]').click()
  await mkdir("artifacts", { recursive: true })
  await page.screenshot({ path: "artifacts/product-sections.png" })
  assert.deepEqual(errors, [])
  await writeFile(
    "artifacts/product-check.json",
    JSON.stringify({ checks, errors }, null, 2)
  )
  console.log(JSON.stringify({ checks, errors }, null, 2))
} catch (error) {
  await mkdir("artifacts", { recursive: true })
  await page
    .screenshot({ path: "artifacts/product-failure.png" })
    .catch(() => {})
  throw error
} finally {
  await browser.close()
}

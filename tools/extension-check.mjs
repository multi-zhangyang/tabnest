import { launchBrowser } from "./runtime.mjs"
import { resolve } from "node:path"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"

const browser = await launchBrowser({ pipe: true, enableExtensions: true })
const errors = [],
  checks = []
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clickText = async (page, selector, text) => {
  await page.waitForFunction(
    (selector, text) =>
      [...document.querySelectorAll(selector)].some(
        (el) => el.textContent.trim() === text
      ),
    {},
    selector,
    text
  )
  const node = await page.evaluateHandle(
    (selector, text) =>
      [...document.querySelectorAll(selector)].find(
        (el) => el.textContent.trim() === text
      ),
    selector,
    text
  )
  await node.asElement().click()
  await node.dispose()
  await delay(100)
}
try {
  const id = await browser.installExtension(resolve("dist"))
  const url = `chrome-extension://${id}/index.html`
  const page = await browser.newPage()
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(url, { waitUntil: "networkidle0" })
  await page.waitForFunction(() =>
    document.body.textContent.includes("还没有书签")
  )
  const fixture = await page.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree()
    const bar = tree[0].children.find(
      (node) => node.folderType === "bookmarks-bar" || node.id === "1"
    )
    const other = tree[0].children.find(
      (node) => node.folderType === "other" || node.id === "2"
    )
    const folder = await chrome.bookmarks.create({
      parentId: bar.id,
      title: "层级验收",
    })
    const nested = await chrome.bookmarks.create({
      parentId: folder.id,
      title: "子文件夹",
    })
    const rootBookmark = await chrome.bookmarks.create({
      parentId: bar.id,
      title: "直属书签",
      url: "https://github.com",
    })
    const childBookmark = await chrome.bookmarks.create({
      parentId: nested.id,
      title: "子级书签",
      url: "https://example.com",
    })
    return {
      bar: bar.id,
      barTitle: bar.title,
      other: other.id,
      otherTitle: other.title,
      folder: folder.id,
      nested: nested.id,
      rootBookmark: rootBookmark.id,
      childBookmark: childBookmark.id,
    }
  })
  await page.waitForFunction(
    () => document.querySelectorAll(".bookmark-card").length === 2
  )
  await page.evaluate(
    (id) => chrome.bookmarks.update(id, { title: "根目录书签" }),
    fixture.rootBookmark
  )
  await page.waitForSelector(`[aria-label^="根目录书签"]`)
  await page.click(`[data-bookmark-id="${fixture.rootBookmark}"]`, {
    button: "right",
  })
  await clickText(page, '[role="menuitem"]', "在新标签页打开")
  await page.waitForFunction(
    async () =>
      (await chrome.storage.local.get("tabnest:clicks"))["tabnest:clicks"]
        ?.data["https://github.com/"] === 1
  )
  const otherPage = await browser.newPage()
  otherPage.on("pageerror", (error) => errors.push(error.message))
  await otherPage.goto(url, { waitUntil: "networkidle0" })
  await otherPage.click(`[data-bookmark-id="${fixture.rootBookmark}"]`, {
    button: "middle",
  })
  await delay(500)
  await page.bringToFront()
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[aria-label^="根目录书签"]').dataset.clicks
      ) === 2
  )
  checks.push("actual-clicks-and-cross-tab-heat")
  await page.click('[aria-label="分区视图"]')
  await page.waitForSelector(".section-board")
  assert.equal(
    await page.$$eval(".section-bookmarks .bookmark-card", (els) => els.length),
    2
  )
  assert.equal(await page.$(".folder-sidebar"), null)
  assert.equal(await page.$(".heat-card"), null)
  assert.equal(
    await page.$eval(
      `[data-bookmark-id="${fixture.rootBookmark}"]`,
      (el) => el.closest(".section-slot").dataset.folderId
    ),
    fixture.bar
  )
  assert.equal(
    await page.$eval(
      `[data-bookmark-id="${fixture.childBookmark}"]`,
      (el) => el.closest(".section-slot").dataset.folderId
    ),
    fixture.nested
  )
  assert.equal(
    await page.$eval(
      `[data-folder-id="${fixture.nested}"] .section-path`,
      (el) => el.textContent
    ),
    `${fixture.barTitle} / 层级验收`
  )
  assert.equal(
    await page.evaluate(() => document.body.textContent.includes("所有分区")),
    false
  )
  await page.click(`[aria-label="${fixture.barTitle}根目录操作"]`)
  for (const action of ["重命名", "移动文件夹", "删除文件夹"]) {
    assert.equal(
      await page.evaluate(
        (action) =>
          [...document.querySelectorAll('[role="menuitem"]')]
            .find((el) => el.textContent === action)
            .getAttribute("aria-disabled"),
        action
      ),
      "true"
    )
  }
  await page.keyboard.press("Escape")
  await page.click('[aria-label="分区列表"]')
  await otherPage.bringToFront()
  await otherPage.waitForSelector('.section-board[data-layout="list"]')
  await otherPage.click('[aria-label="收起分区 子文件夹"]')
  await page.bringToFront()
  await page.waitForSelector('[aria-label="展开分区 子文件夹"]')
  await page.reload({ waitUntil: "networkidle0" })
  assert.equal(
    await page.$(`[data-bookmark-id="${fixture.childBookmark}"]`),
    null
  )
  await page.click('[aria-label="展开分区 子文件夹"]')
  await page.waitForSelector(`[data-bookmark-id="${fixture.childBookmark}"]`)
  checks.push(
    "native-folder-blocks-no-duplicates-root-protection-cross-tab-collapse-and-layout"
  )
  await page.click('[aria-label="子文件夹文件夹操作"]')
  await clickText(page, '[role="menuitem"]', "移动文件夹")
  await page.locator("#folder-parent").click()
  await clickText(page, "[cmdk-item]", fixture.otherTitle)
  await clickText(page, '[role="dialog"] button', "保存")
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
  assert.equal(
    await page.evaluate(
      async (id) => (await chrome.bookmarks.get(id))[0].parentId,
      fixture.nested
    ),
    fixture.other
  )
  await page.waitForFunction(
    (id) => !document.querySelector(`[data-folder-id="${id}"]`),
    {},
    fixture.nested
  )
  await page
    .locator('.section-toolbar [role="tab"][data-state="inactive"]')
    .click()
  await page.waitForSelector(`[data-folder-id="${fixture.nested}"]`)
  assert.equal(
    await page.$$eval(".section-bookmarks .bookmark-card", (els) => els.length),
    1
  )
  await page.click('[aria-label="子文件夹文件夹操作"]')
  await clickText(page, '[role="menuitem"]', "重命名")
  await page.locator("#folder-title").fill("已重命名")
  assert.equal(await page.$eval("#folder-title", (el) => el.value), "已重命名")
  await clickText(page, '[role="dialog"] button', "保存")
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
  assert.equal(
    await page.evaluate(
      async (id) => (await chrome.bookmarks.get(id))[0].title,
      fixture.nested
    ),
    "已重命名"
  )
  await page.click('[aria-label="已重命名文件夹操作"]')
  await clickText(page, '[role="menuitem"]', "删除文件夹")
  await clickText(page, '[role="alertdialog"] button', "删除")
  await page.waitForFunction(
    () => !document.querySelector('[role="alertdialog"]')
  )
  assert.equal(
    await page.evaluate(async (id) => {
      try {
        await chrome.bookmarks.get(id)
        return true
      } catch {
        return false
      }
    }, fixture.childBookmark),
    false
  )
  checks.push("native-folder-move-rename-recursive-delete")
  await page.click('[aria-label="热度云图"]')
  await page.waitForSelector(".heat-card")
  await mkdir("artifacts", { recursive: true })
  await page.screenshot({ path: "artifacts/extension-loaded.png" })
  await page.evaluate((id) => chrome.bookmarks.remove(id), fixture.rootBookmark)
  await page.waitForFunction(
    () => document.querySelectorAll(".bookmark-card").length === 0
  )
  const newtab = await browser.newPage()
  await newtab.goto("chrome://newtab")
  await newtab.waitForSelector(".brand")
  const report = {
    extensionId: id,
    manifestVersion: 3,
    checks: [
      "unpacked-load",
      "native-bookmark-events",
      ...checks,
      "newtab-override",
    ],
    errors,
  }
  await writeFile(
    "artifacts/extension-check.json",
    JSON.stringify(report, null, 2)
  )
  assert.deepEqual(errors, [])
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}

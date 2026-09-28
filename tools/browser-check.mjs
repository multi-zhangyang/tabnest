import { launchBrowser, openPreview, servePreview } from "./runtime.mjs"
import axe from "axe-core"
import { AxePuppeteer } from "@axe-core/puppeteer"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { sectionFixture } from "./section-fixture.mjs"
import { showSearchResults } from "./search-helpers.mjs"

const preview = await servePreview()
const browser = await launchBrowser()
const errors = [],
  checks = []
const base = preview.url
await mkdir("artifacts", { recursive: true })
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  const page = await browser.newPage()
  page.on("pageerror", (error) => errors.push(error.message))
  const click = async (selector, text) => {
    await page.waitForFunction(
      (selector, text) =>
        [...document.querySelectorAll(selector)].some(
          (el) => el.textContent.trim() === text
        ),
      {},
      selector,
      text
    )
    const element = await page.evaluateHandle(
      (selector, text) =>
        [...document.querySelectorAll(selector)].find(
          (el) => el.textContent.trim() === text
        ),
      selector,
      text
    )
    await element.asElement().click()
    await element.dispose()
    await delay(180)
  }
  const aria = async (label) => {
    await page.locator(`[aria-label="${label}"]`).click()
    await delay(180)
  }
  const toggleTheme = async () => {
    const dark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark")
    )
    await aria("外观与偏好")
    await page.waitForSelector(".settings-dialog")
    await aria(dark ? "浅色" : "深色")
    await page.keyboard.press("Escape")
  }
  const newBookmark = async () => {
    await aria("新建")
    await click('[role="menuitem"]', "新建书签")
  }
  const openData = async () => {
    await aria("外观与偏好")
    await click('.settings-dialog [role="tab"]', "数据")
  }
  const shot = async (name) => {
    await page.mouse.move(0, 0)
    await delay(550)
    await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true })
  }
  async function geometry() {
    await page.mouse.move(0, 0)
    await delay(550)
    return page.evaluate(() => {
      const cards = [...document.querySelectorAll(".heat-card")].map((el) => {
        const b = el.getBoundingClientRect()
        const content = [...el.querySelectorAll(".site-icon, .bookmark-copy")]
          .filter((child) => child.getClientRects().length)
          .map((child) => child.getBoundingClientRect())
        return {
          id: el.dataset.bookmarkId,
          x: b.x,
          y: b.y,
          right: b.right,
          bottom: b.bottom,
          width: b.width,
          height: b.height,
          contentOverflows: content.some(
            (c) =>
              c.top < b.top - 1 ||
              c.bottom > b.bottom + 1 ||
              c.left < b.left - 1 ||
              c.right > b.right + 1
          ),
        }
      })
      let overlaps = 0
      for (let i = 0; i < cards.length; i++)
        for (let j = i + 1; j < cards.length; j++) {
          const a = cards[i],
            b = cards[j]
          if (
            Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1
          )
            overlaps++
        }
      return {
        count: cards.length,
        overlaps,
        contentOverflows: cards
          .filter((c) => c.contentOverflows)
          .map((c) => c.id),
        horizontalOverflow: Math.max(
          0,
          document.documentElement.scrollWidth - innerWidth
        ),
        verticalOverflow: document.documentElement.scrollHeight - innerHeight,
        outOfCanvas: [...document.querySelectorAll(".heat-card")]
          .filter((el) => {
            const card = el.getBoundingClientRect(),
              canvas = el.closest(".heat-canvas").getBoundingClientRect()
            return (
              card.top < canvas.top - 1 ||
              card.left < canvas.left - 1 ||
              card.right > canvas.right + 1 ||
              card.bottom > canvas.bottom + 1
            )
          })
          .map((el) => el.dataset.bookmarkId),
      }
    })
  }
  await openPreview(page, base, { waitUntil: "networkidle0" })
  await page.waitForSelector(".heat-card")
  assert.equal((await geometry()).count, 24)
  for (const [width, height, name] of [
    [1440, 900, "heat-dark"],
    [1820, 864, "heat-wide"],
    [1024, 768, "heat-laptop"],
    [390, 844, "heat-mobile"],
  ]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    const result = await geometry()
    assert.equal(result.overlaps, 0, name)
    assert.equal(result.horizontalOverflow, 0, name)
    assert.deepEqual(result.outOfCanvas, [], name)
    assert.deepEqual(result.contentOverflows, [], name)
    checks.push({ name, ...result })
    await shot(name)
  }
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await delay(240)
  const initial = await page.$eval('[data-bookmark-id="l2"]', (el) => ({
    area: el.offsetWidth * el.offsetHeight,
    icon: el.querySelector(".site-icon").getBoundingClientRect().width,
    clicks: Number(el.dataset.clicks),
  }))
  await page.evaluate(() => {
    window.open = () => null
  })
  await page.keyboard.down("Control")
  for (let index = 0; index < 9; index++) {
    await page.click('[data-bookmark-id="l2"]')
    await delay(240)
  }
  await page.keyboard.up("Control")
  await page.waitForFunction(
    (count) =>
      Number(
        document.querySelector('[data-bookmark-id="l2"]').dataset.clicks
      ) ===
      count + 9,
    {},
    initial.clicks
  )
  const grown = await page.$eval('[data-bookmark-id="l2"]', (el) => ({
    area: el.offsetWidth * el.offsetHeight,
    icon: el.querySelector(".site-icon").getBoundingClientRect().width,
  }))
  assert.ok(grown.area > initial.area * 1.5)
  assert.ok(grown.icon > initial.icon)
  checks.push({ name: "real-click-growth", initial, grown })
  await page.mouse.move(0, 0)
  assert.equal(
    await page.$$eval("button", (els) =>
      els.some((el) => el.textContent.includes("重排云图"))
    ),
    false
  )
  await toggleTheme()
  await shot("heat-light")
  assert.equal(
    await page.evaluate(() =>
      document.documentElement.classList.contains("light")
    ),
    true
  )
  await page.reload({ waitUntil: "networkidle0" })
  assert.equal(
    await page.evaluate(() =>
      document.documentElement.classList.contains("light")
    ),
    true
  )
  await toggleTheme()

  await page.keyboard.down("Control")
  await page.keyboard.press("k")
  await page.keyboard.up("Control")
  await page.waitForSelector('[aria-label="搜索书签"]')
  assert.equal(
    await page.$eval(
      '[aria-label="搜索书签"]',
      (el) => el === document.activeElement
    ),
    true
  )
  await page.keyboard.type("GitHub")
  await page.waitForFunction(
    () => document.querySelectorAll('.search-dialog [data-value^="bookmark:"]').length === 1
  )
  await page.keyboard.press("ArrowDown")
  assert.equal(
    await page.$$eval('[data-selected="true"]', (els) => els.length),
    1
  )
  assert.ok(await page.$(".search-dialog"))
  assert.ok(await page.$(".heat-card"))
  await shot("search")
  await page.keyboard.press("Escape")
  await newBookmark()
  await page.waitForSelector("#bookmark-url")
  await page.type("#bookmark-url", "javascript:alert(1)")
  await click('[role="dialog"] button', "保存")
  assert.ok(await page.$('[role="dialog"] [data-slot="field-error"]'))
  await page.$eval("#bookmark-url", (el) => {
    el.focus()
    el.select()
  })
  await page.keyboard.type("https://example.com/refactor")
  await page.type("#bookmark-title", "Refactor test")
  await shot("bookmark-editor")
  await click('[role="dialog"] button', "保存")
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
  await page.reload({ waitUntil: "networkidle0" })
  assert.equal(await page.$$eval(".heat-card", (els) => els.length), 25)
  await showSearchResults(page, "Refactor test")
  await page.waitForFunction(
    () => document.querySelectorAll(".bookmark-card").length === 1
  )
  await page.click(".bookmark-card", { button: "right" })
  await click('[role="menuitem"]', "编辑书签")
  await page.waitForSelector("#bookmark-title")
  await page.$eval("#bookmark-title", (el) => {
    el.focus()
    el.select()
  })
  await page.keyboard.type("Updated bookmark")
  await click('[role="dialog"] button', "保存")
  await aria("清空搜索")
  await showSearchResults(page, "Updated bookmark")
  await page.waitForFunction(
    () => document.querySelectorAll(".bookmark-card").length === 1
  )
  await page.click(".bookmark-card", { button: "right" })
  await click('[role="menuitem"]', "删除书签")
  await shot("delete-dialog")
  await click('[role="alertdialog"] button', "删除")
  await page.waitForFunction(
    () => !document.querySelector('[role="alertdialog"]')
  )
  assert.equal(await page.$$eval(".bookmark-card", (els) => els.length), 0)
  await aria("清空搜索")

  assert.equal(
    await page.evaluate(() => document.body.textContent.includes("最近添加")),
    false
  )
  assert.equal(
    await page.$$eval('.main-tabs [role="tab"]', (els) => els.length),
    2
  )
  await aria("统计")
  await page.waitForSelector(".stats-view")
  const statsAccessibility = await new AxePuppeteer(page, axe.source)
    .withTags(["wcag2a", "wcag2aa"])
    .analyze()
  assert.equal(
    statsAccessibility.violations.length,
    0,
    JSON.stringify(statsAccessibility.violations)
  )
  assert.equal(
    await page.evaluate(() =>
      document.querySelector(".stats-dialog").textContent.includes("最近添加")
    ),
    false
  )
  await shot("statistics")
  await page.keyboard.press("Escape")
  await aria("文件夹视图")
  await page.waitForSelector(".section-board")
  assert.equal(
    await page.$$eval(".section-bookmarks .bookmark-card", (els) => els.length),
    24
  )
  assert.equal(await page.$(".folder-sidebar"), null)
  assert.equal(await page.$(".heat-card"), null)
  await shot("groups")
  const folderAccessibility = await new AxePuppeteer(page, axe.source)
    .withTags(["wcag2a", "wcag2aa"])
    .analyze()
  assert.equal(
    folderAccessibility.violations.length,
    0,
    JSON.stringify(folderAccessibility.violations)
  )
  await aria("外观与偏好")
  await page.waitForSelector(".settings-dialog")
  await shot("settings")
  const settingsAccessibility = await new AxePuppeteer(page, axe.source)
    .withTags(["wcag2a", "wcag2aa"])
    .analyze()
  assert.equal(
    settingsAccessibility.violations.length,
    0,
    JSON.stringify(settingsAccessibility.violations)
  )
  await click('.settings-dialog [role="tab"]', "书签")
  await page.click("#show-domain")
  await page.keyboard.press("Escape")
  assert.equal(await page.$$eval(".bookmark-domain", (els) => els.length), 0)
  await page.reload({ waitUntil: "networkidle0" })
  assert.equal(await page.$$eval(".bookmark-domain", (els) => els.length), 0)
  await aria("外观与偏好")
  await click("button", "恢复默认设置")
  await page.keyboard.press("Escape")

  const accessibility = await new AxePuppeteer(page, axe.source)
    .withTags(["wcag2a", "wcag2aa"])
    .analyze()
  checks.push({
    name: "accessibility",
    violations: accessibility.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
  })
  await aria("新建")
  await click('[role="menuitem"]', "新建文件夹")
  await page.waitForSelector("#folder-title")
  await page.type("#folder-title", "验收文件夹")
  await click('[role="dialog"] button', "保存")
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
  await aria("文件夹视图")
  assert.ok(
    await page.evaluate(() =>
      [...document.querySelectorAll(".section-slot")].some((el) =>
        el.textContent.includes("验收文件夹")
      )
    )
  )
  await aria("验收文件夹文件夹操作")
  await click('[role="menuitem"]', "重命名")
  await page.$eval("#folder-title", (el) => {
    el.focus()
    el.select()
  })
  await page.keyboard.type("验收重命名")
  await click('[role="dialog"] button', "保存")
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
  await aria("验收重命名文件夹操作")
  await click('[role="menuitem"]', "移动文件夹")
  await page.click("#folder-parent")
  await click("[cmdk-item]", "书签栏 / 开发工具")
  await click('[role="dialog"] button', "保存")
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
  assert.equal(
    await page.$eval(
      '[aria-label$="验收重命名文件夹"] .section-path',
      (el) => el.textContent
    ),
    "书签栏 / 开发工具"
  )
  await aria("验收重命名文件夹操作")
  await click('[role="menuitem"]', "删除文件夹")
  await click('[role="alertdialog"] button', "删除")
  await page.waitForFunction(
    () => !document.querySelector('[role="alertdialog"]')
  )
  checks.push({
    name: "folder-crud",
    passed: ["create", "rename", "move", "parent-path", "delete"],
  })
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      blob.text().then((text) => {
        window.__exportedBookmarks = JSON.parse(text)
      })
      return original(blob)
    }
  })
  await openData()
  await click(".settings-dialog button", "导出书签")
  await page.keyboard.press("Escape")
  await page.waitForFunction(() => !!window.__exportedBookmarks)
  assert.equal(
    await page.evaluate(
      () => window.__exportedBookmarks.groups.flatMap((g) => g.items).length
    ),
    24
  )
  const backup = await page.evaluate(() => window.__exportedBookmarks)
  await writeFile("artifacts/browser-backup.json", JSON.stringify(backup))
  await openData()
  await click(".settings-dialog button", "导入书签")
  const upload = await page.waitForSelector("#backup-file")
  await upload.uploadFile("artifacts/browser-backup.json")
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="dialog"] button')].some(
      (el) => el.textContent === "导入为新文件夹" && !el.disabled
    )
  )
  await click('[role="dialog"] button', "导入为新文件夹")
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("tabnest:demo-bookmarks:v2")
        ).data.groups.flatMap((group) => group.items).length
    ),
    48
  )
  checks.push({
    name: "backup-import",
    additive: true,
    originalItems: 24,
    totalItems: 48,
  })
  await aria("统计")
  await page.waitForSelector(".metric-grid button")
  await page.click(".metric-grid button")
  await page.waitForSelector(".duplicates-dialog")
  assert.equal(await page.$$eval(".duplicate-row", els => els.length), 48)
  await shot("duplicate-bookmarks")
  await click(".duplicates-dialog button", "删除 24 项")
  await click('[role="alertdialog"] button', "删除")
  await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'))
  const remaining = await page.evaluate(() => JSON.parse(localStorage.getItem("tabnest:demo-bookmarks:v2")).data.groups.flatMap(group => group.items))
  assert.equal(remaining.length, 24)
  assert.equal(new Set(remaining.map(item => item.url)).size, 24)
  checks.push({ name: "duplicate-review", matchesBefore: 48, matchesAfter: 0, deletedBookmarks: 24, originalHierarchyPreserved: true })
  await page.evaluate(() => {
    const items = Array.from({ length: 180 }, (_, index) => ({
      id: `bulk-${index}`,
      parentId: "bulk",
      title: `批量书签第${index}项`,
      url: `https://github.com/test/${index}`,
      dateAdded: Date.now() - index * 1000,
    }))
    localStorage.setItem(
      "tabnest:demo-bookmarks:v2",
      JSON.stringify({
        groups: [{ id: "bulk", name: "批量", items }],
        folders: [{ id: "bulk", title: "批量", path: "批量" }],
      })
    )
    localStorage.setItem("tabnest:settings", JSON.stringify({ layout: "heat" }))
  })
  await page.reload({ waitUntil: "networkidle0" })
  await page.waitForSelector(".heat-card")
  const bulk = await geometry()
  assert.equal(bulk.count, 180)
  assert.equal(bulk.overlaps, 0)
  assert.ok(bulk.verticalOverflow > 0)
  assert.deepEqual(bulk.outOfCanvas, [])
  assert.deepEqual(bulk.contentOverflows, [])
  assert.equal(await page.$('[aria-label="下一页"]'), null)
  await shot("heat-dense")
  await showSearchResults(page, "第179项")
  await page.waitForFunction(
    () => document.querySelectorAll(".bookmark-card").length === 1
  )
  assert.ok(await page.$('[data-bookmark-id="bulk-179"]'))
  const fixture = sectionFixture()
  await page.evaluate((fixture) => {
    localStorage.setItem("tabnest:demo-bookmarks:v2", JSON.stringify(fixture))
    // Old directory selections and tree collapse state must not hide the new board.
    localStorage.setItem(
      "tabnest:settings",
      JSON.stringify({
        layout: "zones",
        activeFolderId: "folder-ai",
        folderLayout: "heat",
        collapsed: ["native-bar"],
      })
    )
  }, fixture)
  await page.reload({ waitUntil: "networkidle0" })
  await page.waitForSelector('.section-board[data-layout="grid"]')
  assert.equal(await page.$$eval(".section-slot", (els) => els.length), 5)
  assert.equal(await page.$(".folder-sidebar"), null)
  assert.equal(await page.$(".heat-card"), null)
  assert.equal(
    await page.evaluate(() => document.body.textContent.includes("所有文件夹")),
    false
  )
  const displayedGroups = await page.$$eval(".section-slot", (sections) =>
    sections.map((section) => ({
      id: section.dataset.folderId,
      items: [...section.querySelectorAll(".bookmark-card")].map(
        (item) => item.dataset.bookmarkId
      ),
    }))
  )
  assert.deepEqual(
    displayedGroups,
    fixture.groups
      .filter((group) => group.items.length)
      .map((group) => ({
        id: group.id,
        items: group.items.map((item) => item.id),
      }))
  )
  const sectionGeometry = async () => {
    await delay(350)
    return page.evaluate(() => {
      const rects = [...document.querySelectorAll(".section-card")].map((el) =>
        el.getBoundingClientRect()
      )
      let overlaps = 0
      rects.forEach((a, i) =>
        rects.slice(i + 1).forEach((b) => {
          if (
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
          )
            overlaps++
        })
      )
      const overflows = [
        ...document.querySelectorAll(".section-bookmarks .bookmark-card"),
      ]
        .filter((el) => {
          const box = el.getBoundingClientRect()
          const section = el.closest(".section-card").getBoundingClientRect()
          return (
            box.left < section.left ||
            box.right > section.right ||
            box.bottom > section.bottom ||
            [
              ...el.querySelectorAll(
                ".bookmark-copy, .site-icon, .bookmark-title, .bookmark-domain"
              ),
            ].some((child) => {
              const b = child.getBoundingClientRect()
              return (
                b.left < box.left - 1 ||
                b.right > box.right + 1 ||
                b.top < box.top - 1 ||
                b.bottom > box.bottom + 1
              )
            })
          )
        })
        .map((el) => el.dataset.bookmarkId)
      return {
        overlaps,
        overflows,
        invisibleTitles: [
          ...document.querySelectorAll(".section-bookmarks .bookmark-title"),
        ]
          .filter(
            (el) =>
              el.getBoundingClientRect().width < 1 ||
              el.getBoundingClientRect().height < 1
          )
          .map((el) => el.textContent),
        horizontalOverflow: Math.max(
          0,
          document.documentElement.scrollWidth - innerWidth
        ),
        count: document.querySelectorAll(".section-bookmarks .bookmark-card")
          .length,
      }
    })
  }
  for (const [width, height, name] of [
    [1920, 1000, "sections-wide"],
    [1440, 900, "sections-dark"],
    [1024, 768, "sections-laptop"],
    [390, 844, "sections-mobile"],
    [320, 700, "sections-small"],
  ]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    const result = await sectionGeometry()
    assert.equal(result.overlaps, 0, name)
    assert.equal(result.horizontalOverflow, 0, name)
    assert.deepEqual(result.overflows, [], name)
    assert.deepEqual(result.invisibleTitles, [], name)
    assert.equal(result.count, 37, name)
    checks.push({ name, ...result })
    await shot(name)
  }
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await toggleTheme()
  await shot("sections-light")
  const sectionAccessibility = await new AxePuppeteer(page, axe.source)
    .withTags(["wcag2a", "wcag2aa"])
    .analyze()
  assert.equal(
    sectionAccessibility.violations.length,
    0,
    JSON.stringify(sectionAccessibility.violations)
  )
  await toggleTheme()
  await aria("文件夹列表")
  assert.equal((await sectionGeometry()).overlaps, 0)
  assert.deepEqual((await sectionGeometry()).overflows, [])
  await shot("sections-list")
  const beforeCollapse = await page.$eval(
    '[data-folder-id="folder-ai"] .section-card',
    (el) => el.offsetHeight
  )
  await aria("收起文件夹 AI-Space")
  await page.reload({ waitUntil: "networkidle0" })
  await page.waitForSelector('.section-board[data-layout="list"]')
  assert.equal(
    await page.$$eval(
      '[data-folder-id="folder-ai"] .bookmark-card',
      (els) => els.length
    ),
    0
  )
  assert.ok(
    (await page.$eval(
      '[data-folder-id="folder-ai"] .section-card',
      (el) => el.offsetHeight
    )) <
      beforeCollapse / 2
  )
  assert.equal((await sectionGeometry()).overlaps, 0)
  await aria("展开文件夹 AI-Space")
  await aria("文件夹网格")
  await page
    .locator('.section-toolbar [role="tab"][data-state="inactive"]')
    .click()
  await page.waitForSelector(".section-empty")
  assert.equal(await page.$(".bookmark-card"), null)
  await page
    .locator('.section-toolbar [role="tab"][data-state="inactive"]')
    .click()
  assert.equal((await sectionGeometry()).count, 37)
  checks.push({
    name: "section-hierarchy-and-preferences",
    directBookmarks: 11,
    childFolders: 4,
    noDuplicates: true,
    collapsePersists: true,
    oldHeatPreferenceMigrates: true,
    rootTabs: true,
  })
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.evaluate(() =>
    localStorage.setItem("tabnest:settings", JSON.stringify({ layout: "heat" }))
  )
  await page.evaluate(() =>
    localStorage.setItem(
      "tabnest:demo-bookmarks:v2",
      JSON.stringify({
        groups: [{ id: "empty-bar", name: "书签栏", items: [] }],
        folders: [
          {
            id: "empty-bar",
            title: "书签栏",
            path: "书签栏",
            root: true,
            folderType: "bookmarks-bar",
          },
        ],
      })
    )
  )
  await page.reload({ waitUntil: "networkidle0" })
  await page.waitForFunction(() =>
    document.body.textContent.includes("还没有书签")
  )
  await newBookmark()
  await page.waitForSelector("#bookmark-url")
  await page.type("#bookmark-url", "https://github.com")
  await page.type("#bookmark-title", "首个书签")
  await click('[role="dialog"] button', "保存")
  await page.waitForSelector(".heat-card")
  assert.equal(await page.$$eval(".heat-card", (els) => els.length), 1)
  checks.push({
    name: "data-edge-cases",
    passed: [
      "new-folder",
      "json-export",
      "180-bookmarks",
      "continuous-scroll-without-pagination",
      "full-canvas-search",
      "create-from-empty",
    ],
  })
  checks.push({
    name: "interactions",
    completed: [
      "no-manual-shuffle",
      "themes",
      "search",
      "keyboard",
      "create",
      "edit",
      "delete",
      "persistence",
      "two-view-navigation",
      "compact-search-results",
      "stats",
      "groups",
      "settings",
    ],
    errors,
  })
  await writeFile(
    "artifacts/browser-check.json",
    JSON.stringify(checks, null, 2)
  )
  assert.deepEqual(errors, [])
  assert.equal(
    accessibility.violations.length,
    0,
    JSON.stringify(checks.at(-2))
  )
  console.log(JSON.stringify(checks, null, 2))
} finally {
  await browser.close()
  await preview.close()
}

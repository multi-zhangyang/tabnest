import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { launchBrowser, openPreview, servePreview } from "./runtime.mjs"
import { sectionFixture } from "./section-fixture.mjs"
import { openSearch, showSearchResults } from "./search-helpers.mjs"

const preview = await servePreview()
const browser = await launchBrowser({ pipe: true, enableExtensions: true })
const checks = [],
  errors = []
const delay = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms))
const page = await browser.newPage()
page.setDefaultTimeout(10000)
page.on("pageerror", (error) => errors.push(error.message))
const clickLabel = (label) => page.locator(`[aria-label="${label}"]`).click()
const clickText = async (selector, text) => {
  const element = await page.waitForFunction(
    (selector, text) =>
      [...document.querySelectorAll(selector)].find(
        (el) => el.textContent.trim() === text
      ),
    {},
    selector,
    text
  )
  await element.asElement().asLocator().click()
  await element.dispose()
  await delay()
}
const closeOverlay = async () => {
  await delay()
  assert.equal(
    await page.$('[data-slot="hover-card-content"][data-state="open"]'),
    null,
    "Bookmark preview must not cover a menu or dialog and consume Escape"
  )
  await page.keyboard.press("Escape", { delay: 30 })
  await page.waitForSelector("body[data-scroll-locked]", { hidden: true })
  await delay()
}

function fixture(count) {
  const data = sectionFixture()
  const groups = data.groups.filter((group) => group.id !== "native-other")
  for (const group of data.groups) group.items = []
  for (let i = 0; i < count; i++) {
    const group = groups[i % (count === 1 ? 1 : groups.length)]
    group.items.push({
      id: `scroll-${i}`,
      parentId: group.id,
      index: group.items.length,
      title: `滚动验收 ${i}`,
      url: `https://example.com/scroll/${i}`,
    })
  }
  return data
}

async function seedPreview(count) {
  await openPreview(page, preview.url)
  await page.evaluate((data) => {
    localStorage.setItem("tabnest:demo-bookmarks:v2", JSON.stringify(data))
    localStorage.setItem("tabnest:settings", JSON.stringify({ layout: "heat" }))
  }, fixture(count))
  await page.reload({ waitUntil: "networkidle0" })
  await page.waitForSelector(".heat-card")
}

async function startProbe() {
  await page.mouse.move(0, 0)
  await delay()
  await page.evaluate(() => {
    const elements = [
      ...document.querySelectorAll(
        ".app-header, .main-content, .heat-canvas, .section-slot, .bookmark-card"
      ),
    ]
    const bounds = (el) => {
      const rect = el.getBoundingClientRect()
      return [rect.x, rect.y, rect.width, rect.height]
    }
    const initial = elements.map(bounds)
    const top = scrollY,
      height = document.documentElement.scrollHeight
    const probe = (window.__scrollProbe = {
      frames: 0,
      maxShift: 0,
      maxScroll: 0,
      maxHeightChange: 0,
      frame: 0,
    })
    function sample() {
      probe.frames++
      elements.forEach((el, index) => {
        if (!el.isConnected)
          throw new Error("Background content remounted during overlay")
        bounds(el).forEach((value, axis) => {
          probe.maxShift = Math.max(
            probe.maxShift,
            Math.abs(value - initial[index][axis])
          )
        })
      })
      probe.maxScroll = Math.max(probe.maxScroll, Math.abs(scrollY - top))
      probe.maxHeightChange = Math.max(
        probe.maxHeightChange,
        Math.abs(document.documentElement.scrollHeight - height)
      )
      probe.frame = requestAnimationFrame(sample)
    }
    sample()
  })
}

async function finishProbe(name) {
  await delay()
  const result = await page.evaluate(() => {
    const { frame, ...result } = window.__scrollProbe
    cancelAnimationFrame(frame)
    delete window.__scrollProbe
    return result
  })
  checks.push({ name, ...result })
  assert.ok(result.frames > 2, name)
  assert.ok(
    result.maxShift <= 0.5,
    `${name}: layout shifted ${result.maxShift}px`
  )
  assert.equal(result.maxScroll, 0, `${name}: background scroll changed`)
  assert.equal(result.maxHeightChange, 0, `${name}: page height changed`)
}

async function checkOverlay(name, action) {
  await startProbe()
  await action()
  await closeOverlay()
  await finishProbe(name)
}

async function visibleCard() {
  const point = await page.evaluate(() => {
    const headerBottom = document
      .querySelector(".app-header")
      .getBoundingClientRect().bottom
    for (const el of document.querySelectorAll(".bookmark-card")) {
      const rect = el.getBoundingClientRect()
      const x = rect.x + rect.width / 2,
        y = rect.y + rect.height / 2
      if (y > headerBottom + 10 && y < innerHeight - 20) return { x, y }
    }
  })
  assert.ok(point, "A bookmark must be reachable at this scroll position")
  await page.mouse.move(point.x, point.y)
  await page.waitForSelector(
    '[data-slot="hover-card-content"][data-state="open"]'
  )
  await page.mouse.click(point.x, point.y, { button: "right" })
  await page.waitForSelector('[role="menu"]')
  await page.waitForSelector(
    '[data-slot="hover-card-content"][data-state="open"]',
    { hidden: true }
  )
}

async function modalBehavior() {
  await page.waitForSelector('[role="dialog"]')
  await delay()
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab")
    assert.equal(
      await page.evaluate(
        () => !!document.activeElement.closest('[role="dialog"]')
      ),
      true,
      "Dialog must trap focus"
    )
  }
  await page.mouse.move(8, 200)
  await page.mouse.wheel({ deltaY: 480 })
  await page.keyboard.press("PageDown")
  await delay()
}

async function headerOverlays(prefix) {
  await checkOverlay(`${prefix}/new-menu`, async () => {
    await clickLabel("新建")
    await page.waitForSelector('[role="menu"]')
  })
  await checkOverlay(`${prefix}/settings`, async () => {
    await clickLabel("外观与偏好")
    await modalBehavior()
  })
  await checkOverlay(`${prefix}/stats`, async () => {
    await clickLabel("统计")
    await modalBehavior()
  })
}

async function journeys(prefix) {
  await checkOverlay(`${prefix}/context-editor-picker`, async () => {
    await visibleCard()
    await clickText('[role="menuitem"]', "编辑书签")
    await page.locator("#bookmark-folder").click()
    await page.waitForSelector('[data-slot="popover-content"]')
    await delay()
    await page.keyboard.press("Escape")
    await page.waitForSelector('[data-slot="popover-content"]', {
      hidden: true,
    })
    assert.ok(
      await page.$('[role="dialog"]'),
      "Escape only closes the nested picker"
    )
  })
  await checkOverlay(`${prefix}/context-delete-cancel`, async () => {
    await visibleCard()
    await clickText('[role="menuitem"]', "删除书签")
    await page.waitForSelector('[role="alertdialog"]')
  })
  await checkOverlay(`${prefix}/settings-import`, async () => {
    await clickLabel("外观与偏好")
    await clickText('.settings-dialog [role="tab"]', "数据")
    await clickText(".settings-dialog button", "导入书签")
    await page.waitForSelector("#backup-file")
  })
}

async function scrollReachability(prefix, count) {
  assert.equal(await page.$$eval(".bookmark-card", (els) => els.length), count)
  await page.evaluate(() => {
    document.activeElement?.blur()
    scrollTo(0, 0)
  })
  await page.mouse.move(12, 250)
  await page.mouse.wheel({ deltaY: 560 })
  await page.waitForFunction(() => scrollY > 100)
  await delay()
  await page.keyboard.press("End")
  await page.waitForFunction(
    () =>
      Math.abs(scrollY + innerHeight - document.documentElement.scrollHeight) <=
      1
  )
  // Let Chrome finish its native keyboard-scroll animation before reversing it.
  await delay(300)
  assert.ok(
    await page.evaluate(() =>
      [...document.querySelectorAll(".bookmark-card")].some((el) => {
        const rect = el.getBoundingClientRect()
        return rect.bottom > 150 && rect.top < innerHeight
      })
    ),
    "Last screen must contain reachable bookmarks"
  )
  await page.keyboard.press("Home")
  await page.waitForFunction(() => scrollY === 0)
  await delay(300)
  await page.keyboard.press("PageDown")
  await page.waitForFunction(() => scrollY > 100)
  await delay(300)
  checks.push({ name: `${prefix}/wheel-keyboard-end-home`, count })
}

try {
  await mkdir("artifacts", { recursive: true })
  // Verify the harness has not silently hidden native scrollbars.
  await page.setContent(
    '<div style="overflow:scroll;width:100px;height:100px" id="probe"></div>'
  )
  const nativeScrollbar = await page.$eval(
    "#probe",
    (el) => el.offsetWidth - el.clientWidth
  )
  assert.ok(
    nativeScrollbar > 0,
    "Run with classic scrollbars; Puppeteer's --hide-scrollbars masks this regression"
  )
  checks.push({ name: "native-scrollbar-environment", width: nativeScrollbar })

  await seedPreview(1)
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight + 1
    )
  )
  await headerOverlays("single-screen")
  await journeys("single-screen")

  await seedPreview(180)
  for (const layout of ["heat", "zones"]) {
    await clickLabel(layout === "heat" ? "书签拼图" : "文件夹视图")
    await delay(350)
    await page.evaluate(() => scrollTo(0, 0))
    await headerOverlays(`${layout}/top`)
    if (layout === "zones") {
      await checkOverlay("zones/folder-menu", async () => {
        await clickLabel("AI-Space文件夹操作")
        await page.waitForSelector('[role="menu"]')
      })
    }
    await page.evaluate(() => scrollTo(0, 420))
    await headerOverlays(`${layout}/middle`)
    await journeys(`${layout}/middle`)
    await scrollReachability(layout, 180)
  }

  // Keyboard search must reveal results without hiding them behind the sticky header.
  await openSearch(page, "scroll")
  await page.keyboard.press("ArrowDown")
  await delay()
  const selected = await page.$eval('.search-dialog [aria-selected="true"]', el => {
    const bounds = el.getBoundingClientRect(), list = el.closest('[cmdk-list]').getBoundingClientRect()
    return { top: bounds.top, bottom: bounds.bottom, listTop: list.top, listBottom: list.bottom }
  })
  assert.ok(selected.top >= selected.listTop && selected.bottom <= selected.listBottom, "Command selection must stay in the viewport")
  await page.keyboard.press("Escape")
  await showSearchResults(page, "scroll")
  await headerOverlays("search")
  await page.locator('[aria-label="清空搜索"]').click()

  for (const width of [320, 390, 1024, 1920]) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 1 })
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ])
    await delay(350)
    await page.evaluate(() => scrollTo(0, 300))
    await headerOverlays(`width-${width}`)
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width
    )
  }

  // Run the same geometry check against the installed extension and native bookmarks.
  const extensionId = await browser.installExtension(resolve("dist"))
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.emulateMediaFeatures([])
  await page.goto(`chrome-extension://${extensionId}/index.html`, {
    waitUntil: "networkidle0",
  })
  await page.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree()
    const bar = tree[0].children.find(
      (folder) => folder.folderType === "bookmarks-bar" || folder.id === "1"
    )
    const folder = await chrome.bookmarks.create({
      parentId: bar.id,
      title: "滚动验收",
    })
    await Promise.all(
      Array.from({ length: 180 }, (_, index) =>
        chrome.bookmarks.create({
          parentId: folder.id,
          title: `书签 ${index}`,
          url: `https://example.com/${index}`,
        })
      )
    )
  })
  await page.waitForFunction(
    () => document.querySelectorAll(".bookmark-card").length === 180
  )
  for (const layout of ["heat", "zones"]) {
    await clickLabel(layout === "heat" ? "书签拼图" : "文件夹视图")
    await delay(350)
    await page.evaluate(() => scrollTo(0, 420))
    await headerOverlays(`extension/${layout}`)
    await journeys(`extension/${layout}`)
    await scrollReachability(`extension/${layout}`, 180)
  }
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      passed: checks.length,
      maxShift: Math.max(...checks.map((check) => check.maxShift || 0)),
      errors,
    })
  )
} catch (error) {
  checks.push({
    name: "failure-state",
    message: error.message,
    ...(await page.evaluate(() => ({
      scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      focus: document.activeElement?.outerHTML.slice(0, 180),
      lock: document.body.dataset.scrollLocked,
    }))),
  })
  await page.screenshot({ path: "artifacts/scroll-failure.png" })
  throw error
} finally {
  await writeFile(
    "artifacts/scroll-check.json",
    JSON.stringify({ checks, errors }, null, 2)
  )
  await browser.close()
  await preview.close()
}

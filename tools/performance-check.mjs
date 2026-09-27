import assert from "node:assert/strict"
import { writeFile, mkdir } from "node:fs/promises"
import { launchBrowser, servePreview } from "./runtime.mjs"

const preview = await servePreview(),
  browser = await launchBrowser()
const results = [],
  errors = []
try {
  for (const count of [500, 2000, 5000]) {
    const page = await browser.newPage()
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(preview.url)
    await page.evaluate((count) => {
      const folders = [
        {
          id: "root",
          title: "书签栏",
          path: "书签栏",
          parentId: "0",
          root: true,
          folderType: "bookmarks-bar",
        },
      ]
      const groups = [{ id: "root", name: "书签栏", items: [] }]
      for (let start = 0; start < count; start += 100) {
        const id = `folder-${start}`
        folders.push({
          id,
          title: `分区 ${start}`,
          path: `书签栏 / 分区 ${start}`,
          parentId: "root",
        })
        groups.push({
          id,
          name: `分区 ${start}`,
          items: Array.from(
            { length: Math.min(100, count - start) },
            (_, offset) => ({
              id: `b${start + offset}`,
              title: `站点 ${start + offset}`,
              url: `https://site${start + offset}.test/`,
              parentId: id,
              index: offset,
            })
          ),
        })
      }
      localStorage.clear()
      const save = (key, data) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            schemaVersion: 1,
            revision: 1,
            updatedAt: new Date().toISOString(),
            data,
          })
        )
      save("tabnest:demo-bookmarks:v2", { folders, groups })
      save("tabnest:settings", { layout: "heat", iconMode: "favicon" })
      save("tabnest:clicks", {})
      localStorage.setItem("theme", "light")
    }, count)
    console.log(JSON.stringify({ bookmarks: count, stage: "heat" }))
    const start = performance.now()
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.waitForSelector(".heat-card")
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
    const readyMs = Math.round(performance.now() - start)
    const heatDOM = await page.$$eval(".heat-card", (nodes) => nodes.length)
    assert.ok(heatDOM < 250, `heat DOM grew to ${heatDOM}`)
    const heatUpdateMs = await page.evaluate(async () => {
      window.open = () => null
      const card = document.querySelector(".heat-card"),
        id = card.dataset.bookmarkId
      const count = Number(card.dataset.clicks),
        start = performance.now()
      card.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        })
      )
      while (
        Number(
          document.querySelector(`[data-bookmark-id="${id}"]`)?.dataset.clicks
        ) !==
        count + 1
      ) {
        if (performance.now() - start > 5000)
          throw new Error("Heat update timeout")
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      return Math.round(performance.now() - start)
    })
    assert.ok(heatUpdateMs < 500, `heat response ${heatUpdateMs}`)
    const heatTabTarget = await page.evaluate((count) => {
      const cards = [...document.querySelectorAll(".heat-card")]
      const ids = new Set(cards.map((card) => card.dataset.bookmarkId))
      const card =
        cards.find((card) => {
          const next = Number(card.dataset.bookmarkId.slice(1)) + 1
          return next < count && !ids.has(`b${next}`)
        }) || cards[0]
      card.focus({ preventScroll: true })
      return `b${Number(card.dataset.bookmarkId.slice(1)) + 1}`
    }, count)
    await page.keyboard.press("Tab")
    await new Promise((resolve) => setTimeout(resolve, 220))
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset.bookmarkId),
      heatTabTarget,
      "heat keyboard focus was lost"
    )

    await page.evaluate(() =>
      scrollTo(0, document.documentElement.scrollHeight)
    )
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".heat-card")].some(
        (node) =>
          node.getBoundingClientRect().top >= 0 &&
          node.getBoundingClientRect().bottom <= innerHeight
      )
    )
    console.log(JSON.stringify({ bookmarks: count, stage: "search" }))
    const searchMs = await page.evaluate(async (count) => {
      const input = document.querySelector('[aria-label="搜索书签"]')
      const start = performance.now()
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      ).set.call(input, `site${count - 1}.test`)
      input.dispatchEvent(new Event("input", { bubbles: true }))
      while (
        !document.querySelector(
          `.search-results [data-bookmark-id="b${count - 1}"]`
        )
      )
        await new Promise((resolve) => requestAnimationFrame(resolve))
      return Math.round(performance.now() - start)
    }, count)
    await page.locator('[aria-label="搜索书签"]').fill("站点")
    await page.waitForSelector(".search-results")
    await page.evaluate(() => scrollTo(0, 0))
    await new Promise((resolve) => setTimeout(resolve, 150))
    const searchDOM = await page.$$eval(
      ".search-results .bookmark-card",
      (nodes) => nodes.length
    )
    assert.ok(searchDOM < 250)
    console.log(JSON.stringify({ bookmarks: count, stage: "keyboard" }))
    const tabTarget = await page.evaluate(() => {
      const cards = [
        ...document.querySelectorAll(".search-results .bookmark-card"),
      ]
      const last = cards.at(-1)
      last.focus({ preventScroll: true })
      return `b${Number(last.dataset.bookmarkId.slice(1)) + 1}`
    })
    await page.keyboard.press("Tab")
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset.bookmarkId),
      tabTarget,
      "virtualized keyboard focus was lost"
    )

    await page.locator('[aria-label="选择书签"]').click()
    const selectionTarget = await page.evaluate(() => {
      const checkbox = [
        ...document.querySelectorAll(".search-results .bookmark-checkbox"),
      ].at(-1)
      checkbox.focus({ preventScroll: true })
      return `b${Number(checkbox.closest("[data-item-id]").dataset.itemId.slice(1)) + 1}`
    })
    await page.keyboard.press("Tab")
    await new Promise((resolve) => setTimeout(resolve, 220))
    assert.equal(
      await page.evaluate(
        () => document.activeElement?.closest("[data-item-id]")?.dataset.itemId
      ),
      selectionTarget,
      "selection focus was lost"
    )
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("role")),
      "checkbox"
    )
    await page.keyboard.press("Space")
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-checked")
      ),
      "true"
    )
    await page.locator('[aria-label="退出多选"]').click()
    await page.focus('[aria-label="搜索书签"]')
    await page.keyboard.press("End")
    await page.waitForSelector(
      `.search-results [data-bookmark-id="b${count - 1}"]`
    )
    const lastReachable = await page.$eval(
      `.search-results [data-bookmark-id="b${count - 1}"]`,
      (el) => el.getBoundingClientRect().bottom <= innerHeight + 1
    )
    assert.ok(lastReachable, "keyboard search cannot reach final result")
    await page.keyboard.press("Escape")
    console.log(JSON.stringify({ bookmarks: count, stage: "sections" }))
    await page.locator('[aria-label="分区视图"]').click()
    await page.waitForSelector(".section-bookmarks .bookmark-card")
    await page.evaluate(() => scrollTo(0, 0))
    await new Promise((resolve) => setTimeout(resolve, 300))
    const sectionDOM = await page.$$eval(
      ".section-bookmarks .bookmark-card",
      (nodes) => nodes.length
    )
    assert.ok(
      sectionDOM < Math.max(350, count / 3),
      `section DOM grew to ${sectionDOM}`
    )
    assert.ok(
      readyMs < 5000 && searchMs < 500,
      `performance regression ${readyMs}/${searchMs}`
    )
    results.push({
      bookmarks: count,
      firstCanvasMs: readyMs,
      searchMs,
      heatUpdateMs,
      heatDOM,
      searchDOM,
      sectionDOM,
      lastReachable,
    })
    console.log(JSON.stringify(results.at(-1)))
    await page.close()
  }
  assert.deepEqual(errors, [])
  await mkdir("artifacts", { recursive: true })
  await writeFile(
    "artifacts/performance-check.json",
    JSON.stringify({ results, errors }, null, 2)
  )
  console.log(JSON.stringify({ results, errors }, null, 2))
} finally {
  await browser.close()
  await preview.close()
}

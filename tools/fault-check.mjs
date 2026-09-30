import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { launchBrowser, openPreview, servePreview } from "./runtime.mjs"
import { openSearch } from "./search-helpers.mjs"

const preview = await servePreview(),
  browser = await launchBrowser()
const checks = [],
  errors = []
try {
  for (const fault of ["constructor", "protocol"]) {
    const page = await browser.newPage()
    page.setDefaultTimeout(15000)
    page.on("pageerror", (error) => errors.push(error.message))
    await openPreview(page, preview.url)
    await page.evaluate(() => {
      localStorage.clear()
      const folder = {
        id: "root",
        title: "书签栏",
        path: "书签栏",
        root: true,
        parentId: "0",
        folderType: "bookmarks-bar",
      }
      const items = Array.from({ length: 1000 }, (_, i) => ({
        id: `fault${i}`,
        title: `故障站点 ${i}`,
        url: `https://fault${i}.test/`,
        parentId: "root",
        index: i,
      }))
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
      save("tabnest:demo-bookmarks:v2", {
        folders: [folder],
        groups: [{ id: "root", name: "书签栏", items }],
      })
      save("tabnest:clicks", {})
      save("tabnest:settings", { layout: "heat", newTab: true })
    })
    await page.evaluateOnNewDocument((fault) => {
      const NativeWorker = window.Worker
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          if (fault === "constructor")
            throw Error("Injected unavailable worker")
          super(...args)
        }
        postMessage(message) {
          super.postMessage({ ...message, version: 999 })
        }
      }
    }, fault)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.waitForSelector(".heat-card")
    await openSearch(page, "fault999.test")
    await page.waitForSelector('[data-value="bookmark:fault999"]')
    await page.keyboard.press("Escape")
    await page.evaluate(() => {
      window.open = () => null
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === "tabnest:recent:v1") throw Error("Injected recent quota")
        return original.call(this, key, value)
      }
      document
        .querySelector('[data-bookmark-id="fault0"]')
        .dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
          })
        )
    })
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("tabnest:clicks")).data[
          "https://fault0.test/"
        ] === 1
    )
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector('[data-bookmark-id="fault0"]').dataset.clicks
        ) === 1
    )
    checks.push(`worker-${fault}-fallback-and-independent-click-persistence`)
    await page.close()
  }
  const page = await browser.newPage()
  page.on("pageerror", (error) => errors.push(error.message))
  await openPreview(page, preview.url)
  await page.waitForSelector(".heat-card")
  await page.locator('[aria-label="外观与偏好"]').click()
  await page.waitForSelector(".settings-dialog")
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === "tabnest:settings") throw Error("Injected settings quota")
      return original.call(this, key, value)
    }
  })
  const control = await page.evaluateHandle(() =>
    [...document.querySelectorAll(".settings-segment button")].find(
      (el) => el.textContent.trim() === "宽松"
    )
  )
  await control.asElement().click()
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".settings-segment button")]
        .find((el) => el.textContent.trim() === "标准")
        ?.getAttribute("data-state") === "on"
  )
  await page.waitForSelector('[data-sonner-toast][data-type="error"]')
  checks.push("settings-write-failure-restores-confirmed-control")
  assert.deepEqual(errors, [])
  await writeFile(
    "artifacts/fault-check.json",
    JSON.stringify({ checks, errors }, null, 2)
  )
  console.log(JSON.stringify({ checks, errors }))
} finally {
  await browser.close()
  await preview.close()
}

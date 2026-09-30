import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { launchBrowser } from "./runtime.mjs"
const browser = await launchBrowser({ pipe: true, enableExtensions: true })
try {
  const id = await browser.installExtension(resolve("dist"))
  const page = await browser.newPage()
  await page.goto(`chrome-extension://${id}/index.html`)
  await page.waitForSelector(".brand")
  const url = "https://navigation.test/current"
  const bookmark = await page.evaluate(async (url) => {
    await chrome.storage.local.set({
      "tabnest:settings": {
        schemaVersion: 1,
        revision: 1,
        updatedAt: new Date().toISOString(),
        data: { layout: "heat", newTab: false },
      },
    })
    return chrome.bookmarks.create({
      parentId: "1",
      title: "Current target",
      url,
    })
  }, url)
  await page.waitForSelector(`[data-bookmark-id="${bookmark.id}"]`)
  await page.setRequestInterception(true)
  page.on("request", (r) =>
    r.url() === url
      ? r.respond({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Target</title>Target",
        })
      : r.continue()
  )
  const start = performance.now()
  await page.click(`[data-bookmark-id="${bookmark.id}"]`)
  await page.waitForFunction(() => document.title === "Target")
  const elapsed = performance.now() - start
  const verify = await browser.newPage()
  await verify.goto(`chrome-extension://${id}/index.html`)
  await verify.waitForFunction(
    async (url) =>
      (await chrome.storage.local.get("tabnest:clicks"))["tabnest:clicks"]
        ?.data[url] === 1,
    {},
    url
  )
  const data = await verify.evaluate(async () =>
    chrome.storage.local.get(["tabnest:clicks", "tabnest:recent:v1"])
  )
  assert.equal(data["tabnest:clicks"].data[url], 1)
  assert.equal(data["tabnest:recent:v1"].data[0].url, url)
  await writeFile(
    "artifacts/navigation-check.json",
    JSON.stringify(
      { currentTabMs: Math.round(elapsed), savedAfterUnload: true, data },
      null,
      2
    )
  )
  console.log({ currentTabMs: Math.round(elapsed), savedAfterUnload: true })
} finally {
  await browser.close()
}

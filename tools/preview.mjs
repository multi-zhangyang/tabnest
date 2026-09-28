import { mkdir } from "node:fs/promises"
import { launchBrowser, openPreview, servePreview } from "./runtime.mjs"
const preview = await servePreview()
const browser = await launchBrowser()
try {
  const page = await browser.newPage()
  page.on("pageerror", (error) => console.log("PAGE ERROR:", error.message))
  await openPreview(page, preview.url, { waitUntil: "networkidle0" })
  await page.waitForSelector(".heat-card")
  await mkdir("artifacts", { recursive: true })
  await page.screenshot({ path: "artifacts/heat-dark.png" })
  await page.click('[aria-label="文件夹视图"]')
  await new Promise((resolve) => setTimeout(resolve, 500))
  await page.screenshot({ path: "artifacts/folders.png" })
  console.log(
    await page.evaluate(() => ({
      cards: document.querySelectorAll(".heat-card").length,
      text: document.body.innerText,
      overflow: document.documentElement.scrollHeight - innerHeight,
    }))
  )
} finally {
  await browser.close()
  await preview.close()
}

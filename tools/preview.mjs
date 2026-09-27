import { mkdir } from "node:fs/promises"
import { launchBrowser, servePreview } from "./runtime.mjs"
const preview = await servePreview()
const browser = await launchBrowser()
try {
  const page = await browser.newPage()
  page.on("pageerror", (error) => console.log("PAGE ERROR:", error.message))
  await page.goto(preview.url, { waitUntil: "networkidle0" })
  await page.waitForSelector(".heat-card")
  await mkdir("artifacts", { recursive: true })
  await page.screenshot({ path: "artifacts/heat-dark.png" })
  await page.click('[aria-label="分区视图"]')
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

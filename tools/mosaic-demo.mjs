import { mkdir, writeFile, readFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { servePreview, launchBrowser, openPreview } from "./runtime.mjs"
const preview = await servePreview(),
  browser = await launchBrowser()
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await openPreview(page, preview.url)
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem("theme", "dark")
    localStorage.setItem(
      "tabnest:clicks",
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        updatedAt: new Date().toISOString(),
        data: {},
      })
    )
  })
  await page.reload()
  await page.waitForSelector(".heat-card")
  await new Promise((r) => setTimeout(r, 400))
  await page.evaluate(() => {
    window.open = () => null
    window.__demoStart = performance.now()
    window.__demoTimer = setInterval(
      () =>
        document
          .querySelector('[data-bookmark-id="b1"]')
          .dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              ctrlKey: true,
            })
          ),
      160
    )
  })
  await mkdir("artifacts/demo-frames", { recursive: true })
  const samples = []
  for (let i = 0; i < 50; i++) {
    const start = performance.now()
    samples.push(
      await page.$eval('[data-bookmark-id="b1"]', (el) => ({
        count: Number(el.dataset.clicks),
        ...el.parentElement.getBoundingClientRect().toJSON(),
      }))
    )
    await page.screenshot({
      path:
        "artifacts/demo-frames/frame-" + String(i).padStart(3, "0") + ".png",
    })
    if (i === 22) await page.evaluate(() => clearInterval(window.__demoTimer))
    await new Promise((r) =>
      setTimeout(r, Math.max(0, 80 - (performance.now() - start)))
    )
  }
  assert.ok(
    samples.some(
      (s) => s.width * s.height > samples[0].width * samples[0].height + 1
    )
  )
  await writeFile(
    "artifacts/mosaic-demo.json",
    JSON.stringify(
      { ...JSON.parse(await readFile('artifacts/candidate.json','utf8')), viewport: "1440×900", publicFixture: true, samples },
      null,
      2
    )
  )
} finally {
  await browser.close()
  await preview.close()
}

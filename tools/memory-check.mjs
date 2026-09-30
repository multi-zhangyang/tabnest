import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { launchBrowser, servePreview, openPreview } from "./runtime.mjs"
import { openSearch } from "./search-helpers.mjs"

const preview = await servePreview(),
  browser = await launchBrowser(),
  checks = []
try {
  const page = await browser.newPage(),
    errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.evaluateOnNewDocument(() => {
    const Native = window.Worker
    window.__workerStats = { created: 0, live: 0, indexes: 0 }
    window.Worker = new Proxy(Native, {
      construct(_, args) {
        const worker = new Native(...args),
          stats = window.__workerStats
        stats.created++
        stats.live++
        const send = worker.postMessage.bind(worker),
          terminate = worker.terminate.bind(worker)
        worker.postMessage = (...args) => {
          if (args[0]?.task === "search-index") stats.indexes++
          return send(...args)
        }
        worker.terminate = () => {
          stats.live--
          terminate()
        }
        return worker
      },
    })
  })
  await openPreview(page, preview.url)
  await page.evaluate(() => {
    localStorage.clear()
    const folder = { id: "memory", title: "书签", path: "书签", parentId: "1" }
    const items = Array.from({ length: 5000 }, (_, i) => ({
      id: `mem-${i}`,
      title: `站点 ${i}`,
      url: `https://site${i}.test/`,
      parentId: folder.id,
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
      groups: [{ id: folder.id, name: folder.title, items }],
    })
    save("tabnest:settings", { layout: "heat", iconMode: "favicon" })
    save("tabnest:clicks", {})
  })
  await page.reload()
  await page.waitForSelector(".heat-card")
  const client = await page.createCDPSession()
  const sample = async (phase) => {
    await client.send("HeapProfiler.collectGarbage")
    const metrics = await page.metrics(),
      workers = await page.evaluate(() => window.__workerStats)
    const workerHeaps = []
    for (const worker of browser
      .targets()
      .filter(
        (t) => t.type() === "other" && t.url().includes("compute-worker")
      )) {
      const session = await worker.createCDPSession()
      await session.send("HeapProfiler.collectGarbage")
      workerHeaps.push(await session.send("Runtime.getHeapUsage"))
      await session.detach()
    }
    const result = {
      phase,
      pageHeapBytes: metrics.JSHeapUsedSize,
      workerHeapBytes: workerHeaps.reduce((s, h) => s + h.usedSize, 0),
      workers,
    }
    checks.push(result)
    console.log(JSON.stringify(result))
    return result
  }
  const startup = await sample("startup")
  assert.equal(startup.workers.indexes, 0, "new tab eagerly indexed search")
  await openSearch(page, "站点 4999")
  await page.waitForSelector('[data-value="bookmark:mem-4999"]')
  await sample("search")
  await page.keyboard.press("Escape")
  await page.waitForFunction(() => window.__workerStats.live === 0, {
    timeout: 40000,
  })
  const idle = await sample("idle")
  assert.equal(idle.workerHeapBytes, 0)
  await openSearch(page, "站点 4999")
  await page.waitForSelector('[data-value="bookmark:mem-4999"]')
  const reopened = await sample("reopened")
  assert.ok(
    reopened.workers.indexes >= 2,
    "index not recreated after idle disposal"
  )
  assert.deepEqual(errors, [])
  await writeFile(
    "artifacts/memory-check.json",
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        browser: await browser.version(),
        bookmarks: 5000,
        scope:
          "V8 JavaScript heap after forced GC; excludes browser RSS, GPU and native image memory",
        checks,
        errors,
      },
      null,
      2
    )
  )
} finally {
  await browser.close()
  await preview.close()
}

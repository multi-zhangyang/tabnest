import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { launchBrowser } from "./runtime.mjs"
import { assertRenderedHeatFrame } from "./heat-assertions.mjs"

const fixtures = JSON.parse(
  await readFile(
    new URL("./fixtures/heat-pressure.json", import.meta.url),
    "utf8"
  )
)
const browser = await launchBrowser({
  pipe: true,
  enableExtensions: true,
  defaultViewport: { width: 1532, height: 732, deviceScaleFactor: 1 },
})
const errors = []
try {
  const extensionId = await browser.installExtension(resolve("dist"))
  const page = await browser.newPage()
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(`chrome-extension://${extensionId}/index.html`)
  await page.waitForSelector(".brand")
  const snapshot = await page.evaluate(
    async (fixtures) => {
      const folder = await chrome.bookmarks.create({
        parentId: "1",
        title: "Pressure regression",
      })
      const regions = []
      for (const [index, fixture] of fixtures.entries()) {
        const region = structuredClone(fixture.region)
        region.x = index * 728
        region.urls = region.urls.map(
          (_, i) => `https://pressure-native.test/${index}/${i}`
        )
        region.ids = []
        for (const [i, url] of region.urls.entries())
          region.ids.push(
            (
              await chrome.bookmarks.create({
                parentId: folder.id,
                title: `Site ${index}-${i}`,
                url,
              })
            ).id
          )
        regions.push(region)
      }
      const snapshot = {
        version: 8,
        allocationVersion: 1,
        width: 1448,
        height: 560,
        gap: 8,
        scale: 0.75,
        key: JSON.stringify([
          1448,
          8,
          0.75,
          regions.flatMap((r) => r.ids),
          regions.flatMap((r) => r.urls),
          560,
        ]),
        regions,
      }
      const doc = (data) => ({
        schemaVersion: 1,
        revision: 1,
        updatedAt: new Date().toISOString(),
        data,
      })
      await chrome.storage.local.set({
        "tabnest:settings": doc({
          layout: "heat",
          newTab: false,
          cardScale: 0.75,
        }),
        "tabnest:clicks": doc(
          Object.fromEntries(
            regions.flatMap((r) => r.urls.map((url, i) => [url, r.counts[i]]))
          )
        ),
      })
      localStorage.setItem(
        "tabnest:heat-layouts:v8",
        JSON.stringify([[snapshot.key, snapshot]])
      )
      return snapshot
    },
    [
      fixtures.find((f) => f.name === "pressure-0-12"),
      fixtures.find((f) => f.name === "pressure-0-14"),
    ]
  )
  await page.reload()
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.startup === "ready" &&
      document.querySelectorAll(".heat-cell").length === 48
  )
  await new Promise((r) => setTimeout(r, 300))
  const canvas = await page.$eval(".heat-canvas", (e) =>
    e.getBoundingClientRect().toJSON()
  )
  assert.equal(canvas.width, snapshot.width)
  assert.equal(canvas.height, snapshot.height)
  const sample = await page.evaluate(async (snapshot) => {
    const read = () =>
      [...document.querySelectorAll(".heat-cell")].map((e) => ({
        id: e.dataset.itemId,
        opacity: Number(getComputedStyle(e).opacity),
        ...e.getBoundingClientRect().toJSON(),
      }))
    let retargeting = false
    const before = read(),
      frames = []
    let raf
    const record = () => {
      const frame = read()
      for (const box of frame) box.retargeting = retargeting
      frames.push(frame)
      raf = requestAnimationFrame(record)
    }
    record()
    const data = Object.fromEntries(
      snapshot.regions.flatMap((r) =>
        r.urls.map((url, i) => [url, r.counts[i]])
      )
    )
    data[snapshot.regions[0].urls[11]]++
    data[snapshot.regions[1].urls[17]]++
    const stored = (await chrome.storage.local.get("tabnest:clicks"))[
      "tabnest:clicks"
    ]
    await chrome.storage.local.set({
      "tabnest:clicks": {
        ...stored,
        data,
        revision: stored.revision + 1,
        updatedAt: new Date().toISOString(),
      },
    })
    await new Promise((r) => setTimeout(r, 65))
    retargeting = true
    const latest = (await chrome.storage.local.get("tabnest:clicks"))[
      "tabnest:clicks"
    ]
    const retarget = { ...latest.data }
    retarget[snapshot.regions[0].urls[11]]++
    await chrome.storage.local.set({
      "tabnest:clicks": {
        ...latest,
        data: retarget,
        revision: latest.revision + 1,
        updatedAt: new Date().toISOString(),
      },
    })
    await new Promise((r) => setTimeout(r, 650))
    cancelAnimationFrame(raf)
    return { before, after: read(), frames }
  }, snapshot)
  const area = (b) => b.width * b.height
  for (const [index, target] of [
    [0, 11],
    [1, 17],
  ]) {
    const id = snapshot.regions[index].ids[target],
      old = sample.before.find((b) => b.id === id),
      next = sample.after.find((b) => b.id === id)
    assert.ok(area(next) > area(old) + 100, "packed target did not grow")
  }
  const fading = sample.frames.filter((frame) =>
    frame.some(
      (b) => snapshot.regions[0].ids.includes(b.id) && b.opacity < 0.99
    )
  )
  assert.ok(fading.length > 0, "unsafe region must stage its repartition")
  assert.ok(
    fading.every((frame) =>
      frame
        .filter((b) => snapshot.regions[1].ids.includes(b.id))
        .every((b) => b.opacity === 1)
    ),
    "safe region faded with a separate repartition"
  )
  assert.ok(
    sample.frames
      .filter((frame) => !frame[0].retargeting)
      .every((frame) => frame.filter((b) => b.opacity < 0.99).length <= 3),
    "local repartition faded the whole region"
  )
  for (const frame of sample.frames)
    assertRenderedHeatFrame(frame, snapshot, canvas)
  await page.locator('[aria-label="外观与偏好"]').click()
  await page.waitForSelector('[data-slot="dialog-title"]')
  const title = await page.$eval(
    '[data-slot="dialog-title"]',
    (e) => e.textContent
  )
  assert.equal(title, "外观与偏好")
  assert.equal(
    await page.$$eval(
      '[data-slot="dialog-header"] [data-slot="badge"]',
      (nodes) => nodes.length
    ),
    0
  )
  const frozen = await page.evaluate(async (id) => {
    const cell = document.querySelector(`[data-item-id="${id}"]`)
    const read = () => cell.getBoundingClientRect().toJSON()
    const before = read()
    const stored = (await chrome.storage.local.get("tabnest:clicks"))[
      "tabnest:clicks"
    ]
    const url = document.querySelector(`[data-bookmark-id="${id}"]`).href
    await chrome.storage.local.set({
      "tabnest:clicks": {
        ...stored,
        data: { ...stored.data, [url]: stored.data[url] + 1 },
        revision: stored.revision + 1,
        updatedAt: new Date().toISOString(),
      },
    })
    await new Promise((r) => setTimeout(r, 300))
    return { before, after: read() }
  }, snapshot.regions[1].ids[17])
  assert.deepEqual(
    frozen.after,
    frozen.before,
    "a dialog did not freeze the layout"
  )
  await page.locator('[data-slot="dialog-close"]').click()
  await page.waitForFunction(
    () => !document.querySelector('[data-slot="dialog-content"]')
  )
  await new Promise((r) => setTimeout(r, 350))
  const thawed = await page.$eval(
    `[data-item-id="${snapshot.regions[1].ids[17]}"]`,
    (e) => e.getBoundingClientRect().toJSON()
  )
  assert.ok(
    area(thawed) > area(frozen.before) + 1,
    "closing a dialog did not apply pending growth"
  )
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ])
  const reduced = await page.evaluate(async (id) => {
    const read = () =>
      [...document.querySelectorAll(".heat-cell")].map((e) => ({
        id: e.dataset.itemId,
        opacity: Number(getComputedStyle(e).opacity),
        ...e.getBoundingClientRect().toJSON(),
      }))
    const frames = [],
      before = read()
    let raf
    const record = () => {
      frames.push(read())
      raf = requestAnimationFrame(record)
    }
    record()
    const stored = (await chrome.storage.local.get("tabnest:clicks"))[
        "tabnest:clicks"
      ],
      url = document.querySelector(`[data-bookmark-id="${id}"]`).href
    await chrome.storage.local.set({
      "tabnest:clicks": {
        ...stored,
        data: { ...stored.data, [url]: stored.data[url] + 1 },
        revision: stored.revision + 1,
        updatedAt: new Date().toISOString(),
      },
    })
    await new Promise((r) => setTimeout(r, 300))
    cancelAnimationFrame(raf)
    return { before, after: read(), frames }
  }, snapshot.regions[1].ids[17])
  assert.ok(
    reduced.frames.every((frame) => frame.every((b) => b.opacity === 1)),
    "reduced motion faded cards"
  )
  for (const frame of reduced.frames)
    assertRenderedHeatFrame(frame, snapshot, canvas)
  const id = snapshot.regions[1].ids[17]
  assert.ok(
    area(reduced.after.find((b) => b.id === id)) >
      area(reduced.before.find((b) => b.id === id)) + 1,
    "reduced motion lost growth"
  )
  assert.deepEqual(errors, [])
  const build = JSON.parse(await readFile("dist/build-info.json", "utf8"))
  await writeFile(
    "artifacts/heat-pressure-check.json",
    JSON.stringify(
      {
        build,
        frames: sample.frames.length,
        fadeFrames: fading.length,
        checks: [
          "native-local-growth",
          "continuous-retarget",
          "independent-region-animation",
          "per-frame-geometry",
          "minimal-settings-title",
          "dialog-freeze-and-thaw",
          "reduced-motion-growth",
        ],
        errors,
      },
      null,
      2
    )
  )
  console.log(
    JSON.stringify({
      frames: sample.frames.length,
      fadeFrames: fading.length,
      errors,
    })
  )
} finally {
  await browser.close()
}

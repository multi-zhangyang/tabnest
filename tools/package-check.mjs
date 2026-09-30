import assert from "node:assert/strict"
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { resolve, join, sep } from "node:path"
import { unzipSync } from "fflate"
import { launchBrowser } from "./runtime.mjs"

const report = JSON.parse(
  await readFile("artifacts/release-report.json", "utf8")
)
const bytes = await readFile(`artifacts/${report.archive}`)
const sha256 = createHash("sha256").update(bytes).digest("hex")
assert.equal(sha256, report.sha256)
assert.equal(
  (await readFile(`artifacts/${report.archive}.sha256`, "utf8")).trim(),
  `${sha256}  ${report.archive}`
)
const directory = await mkdtemp(join(tmpdir(), "tabnest-package-"))
const files = unzipSync(bytes)
for (const [name, data] of Object.entries(files)) {
  const destination = resolve(directory, name)
  assert.ok(
    destination.startsWith(directory + sep),
    "Archive path escapes destination"
  )
  await mkdir(resolve(destination, ".."), { recursive: true })
  await writeFile(destination, data)
}
const browser = await launchBrowser({ pipe: true, enableExtensions: true }),
  errors = []
try {
  const id = await browser.installExtension(directory)
  const page = await browser.newPage()
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(`chrome-extension://${id}/index.html`)
  await page.waitForSelector(".brand")
  await page.evaluate(async () =>
    chrome.bookmarks.create({
      parentId: "1",
      title: "Package verification",
      url: "https://example.com/",
    })
  )
  await page.waitForSelector(".heat-card")
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.startup === "ready" &&
      Number(getComputedStyle(document.getElementById("root")).opacity) === 1
  )
  const opened = await browser.newPage()
  opened.on("pageerror", (e) => errors.push(e.message))
  await opened.goto("chrome://newtab")
  await opened.waitForSelector(".heat-card")
  await opened.waitForFunction(
    () => document.documentElement.dataset.startup === "ready"
  )
  for (const label of ["文件夹视图", "书签拼图"]) {
    await opened.locator(`[aria-label="${label}"]`).click()
    await opened.waitForFunction(
      () => !document.querySelector(".view-panel").inert
    )
    assert.equal(await opened.$$eval(".main-content", (els) => els.length), 1)
  }
  assert.ok(await opened.$(".heat-card"))
  assert.deepEqual(errors, [])
  const result = {
    version: report.version,
    archive: report.archive,
    sha256,
    browser: await browser.version(),
    checks: [
      "sha256-file-consistency",
      "packaged-mv3-install",
      "real-bookmark-render",
      "newtab-single-reveal",
      "packaged-mode-switch-single-tree",
    ],
    errors,
  }
  await writeFile(
    "artifacts/package-smoke.json",
    JSON.stringify(result, null, 2) + "\n"
  )
  console.log(JSON.stringify(result))
} finally {
  await browser.close()
}

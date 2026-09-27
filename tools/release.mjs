import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises"
import { resolve, relative } from "node:path"
import { gzipSync } from "node:zlib"
import { zipSync, unzipSync } from "fflate"

const root = resolve(import.meta.dirname, "..")
const dist = resolve(root, "dist")
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"))
const manifest = JSON.parse(
  await readFile(resolve(dist, "manifest.json"), "utf8")
)
assert.equal(manifest.manifest_version, 3)
assert.equal(manifest.version, pkg.version)
assert.equal(manifest.chrome_url_overrides.newtab, "index.html")
assert.deepEqual([...manifest.permissions].sort(), [
  "bookmarks",
  "favicon",
  "storage",
])
assert.match(
  manifest.content_security_policy.extension_pages,
  /script-src 'self'/
)
assert.ok(!manifest.host_permissions?.length)
const files = new Map()
async function visit(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name)
  )) {
    const path = resolve(directory, entry.name)
    assert.ok(!entry.isSymbolicLink(), "Release must not contain symlinks")
    if (entry.isDirectory()) await visit(path)
    else
      files.set(
        relative(dist, path).replaceAll("\\", "/"),
        new Uint8Array(await readFile(path))
      )
  }
}
await visit(dist)
for (const icon of Object.values(manifest.icons))
  assert.ok(files.has(icon), `Missing icon ${icon}`)
const html = new TextDecoder().decode(files.get("index.html"))
for (const [, source] of html.matchAll(/(?:src|href)="([^"]+)"/g))
  if (!source.startsWith("#"))
    assert.ok(
      files.has(source.replace(/^\.\//, "").replace(/^\//, "")),
      `Missing HTML asset ${source}`
    )
assert.ok(!/<script[^>]+src=["']https?:/i.test(html), "Remote executable code")
assert.ok(
  ![...files.keys()].some(
    (path) => path.endsWith(".map") || path.endsWith(".ts")
  ),
  "Unexpected source files in distribution"
)
const entries = Object.fromEntries(
  [...files].map(([name, bytes]) => [
    name,
    [bytes, { mtime: new Date(1980, 0, 1) }],
  ])
)
const zip = zipSync(entries, { level: 9 })
assert.ok(
  zip.byteLength < 2 * 1024 * 1024,
  "Extension exceeds 2 MB archive budget"
)
const initialJs = [...files]
  .filter(([name]) => /assets\/index-.*\.js$/.test(name))
  .reduce((sum, [, bytes]) => sum + gzipSync(bytes).byteLength, 0)
assert.ok(initialJs < 250 * 1024, "Initial JS exceeds 250 KB gzip budget")
const unpacked = unzipSync(zip)
assert.equal(Object.keys(unpacked).length, files.size)
for (const [name, bytes] of files) assert.deepEqual(unpacked[name], bytes)
const filename = `TabNest-v${pkg.version}.zip`
const output = resolve(root, "artifacts")
await mkdir(output, { recursive: true })
await writeFile(resolve(output, filename), zip)
const sha256 = createHash("sha256").update(zip).digest("hex")
await writeFile(
  resolve(output, `${filename}.sha256`),
  `${sha256}  ${filename}\n`
)
const report = {
  version: pkg.version,
  files: files.size,
  archiveBytes: zip.byteLength,
  initialJsGzipBytes: initialJs,
  sha256,
  archive: filename,
}
await writeFile(
  resolve(output, "release-report.json"),
  JSON.stringify(report, null, 2)
)
console.log(JSON.stringify(report, null, 2))

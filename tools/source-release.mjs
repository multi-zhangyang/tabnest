import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { resolve, relative } from "node:path"
import { zipSync, unzipSync } from "fflate"

const root = resolve(import.meta.dirname, "..")
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"))
const report = JSON.parse(
  await readFile(resolve(root, "artifacts/release-report.json"), "utf8")
)
assert.equal(report.version, pkg.version)
const entries = {}
async function visit(path) {
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
    assert.ok(
      !entry.isSymbolicLink(),
      "Source archive must not contain symlinks"
    )
    const file = resolve(path, entry.name)
    if (entry.isDirectory()) await visit(file)
    else {
      const name = relative(root, file).replaceAll("\\", "/")
      if (name.startsWith("tools/.") || /(?:\.log|\.tsbuildinfo)$/.test(name))
        continue
      entries[`TabNest-${pkg.version}/${name}`] = [
        new Uint8Array(await readFile(file)),
        { mtime: new Date(1980, 0, 1) },
      ]
    }
  }
}
for (const directory of ["src", "public", "tools", "docs", ".github"])
  await visit(resolve(root, directory))
for (const filename of [
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "CHANGELOG.md",
  "components.json",
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "eslint.config.js",
  ".gitignore",
  ".prettierrc",
  ".prettierignore",
]) {
  entries[`TabNest-${pkg.version}/${filename}`] = [
    new Uint8Array(await readFile(resolve(root, filename))),
    { mtime: new Date(1980, 0, 1) },
  ]
}
const zip = zipSync(entries, { level: 9 }),
  archive = `TabNest-v${pkg.version}-source.zip`
assert.equal(Object.keys(unzipSync(zip)).length, Object.keys(entries).length)
const sha256 = createHash("sha256").update(zip).digest("hex")
await writeFile(resolve(root, "artifacts", archive), zip)
await writeFile(
  resolve(root, "artifacts", archive + ".sha256"),
  `${sha256}  ${archive}\n`
)
console.log(
  JSON.stringify(
    {
      archive,
      bytes: zip.byteLength,
      files: Object.keys(entries).length,
      sha256,
    },
    null,
    2
  )
)

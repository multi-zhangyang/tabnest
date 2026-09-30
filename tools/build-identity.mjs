import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { resolve, relative } from "node:path"
export async function buildIdentity(root) {
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`
      if (entry.isSymbolicLink()) throw new Error(`Build input is a symlink: ${name}`)
      if (entry.isDirectory()) await visit(name)
      else files.push(name)
    }
  }
  await visit("src")
  await visit("public")
  files.push("package.json", "package-lock.json", "index.html", "vite.config.ts", "tools/build-identity.mjs", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json", "components.json", "LICENSE", "THIRD_PARTY_NOTICES.md")
  const hash = createHash("sha256")
  for (const name of files.sort()) {
    hash.update(relative(root, resolve(root, name)).replaceAll("\\", "/") + "\0")
    hash.update(await readFile(resolve(root, name)))
    hash.update("\0")
  }
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"))
  return { version: pkg.version, buildId: hash.digest("hex") }
}

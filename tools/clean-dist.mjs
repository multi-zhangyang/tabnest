import { lstat, realpath, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = await realpath(fileURLToPath(new URL("../", import.meta.url)))
const target = join(root, "dist")
try {
  const entry = await lstat(target)
  const resolved = await realpath(target)
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    resolved !== target ||
    dirname(resolved) !== root
  ) {
    throw new Error(
      `Refusing to clean a build directory outside the project: ${target}`
    )
  }
  await rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  })
} catch (error) {
  if (error.code !== "ENOENT") throw error
}

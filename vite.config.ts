import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { buildIdentity } from "./tools/build-identity.mjs"
import { readFile } from "node:fs/promises"
const identity = await buildIdentity(import.meta.dirname)
const license = await readFile(path.resolve(import.meta.dirname, "LICENSE"), "utf8")
const notices = await readFile(path.resolve(import.meta.dirname, "THIRD_PARTY_NOTICES.md"), "utf8")

// https://vite.dev/config/
export default defineConfig({
  // Relative assets work in the extension and the HTTP preview server.
  base: "./",
  plugins: [react(), tailwindcss(), { name: "tabnest-build-identity", generateBundle() {
    this.emitFile({ type: "asset", fileName: "build-info.json", source: JSON.stringify(identity) })
    this.emitFile({ type: "asset", fileName: "LICENSE.txt", source: license })
    this.emitFile({ type: "asset", fileName: "THIRD_PARTY_NOTICES.txt", source: notices })
  } }],
  define: { __TABNEST_VERSION__: JSON.stringify(identity.version), __TABNEST_BUILD_ID__: JSON.stringify(identity.buildId) },
  worker: { format: "es" },
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(import.meta.dirname, "index.html"),
        background: path.resolve(import.meta.dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? "background.js"
            : "assets/[name]-[hash].js",
      },
    },
    // 每次构建前清空 dist,避免旧 hash 文件堆积
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})

import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  // Relative assets work in the extension and the HTTP preview server.
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    // 每次构建前清空 dist,避免旧 hash 文件堆积
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})

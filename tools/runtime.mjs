import { existsSync } from "node:fs"
import { preview } from "vite"
import puppeteer from "puppeteer-core"

export function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean)
  const found = candidates.find((path) => existsSync(path))
  if (!found)
    throw new Error(
      "Chrome not found. Set CHROME_PATH to the installed browser executable."
    )
  return found
}
export function launchBrowser(options = {}) {
  return puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    // Puppeteer hides scrollbars by default, masking native scroll-lock shifts.
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--disable-gpu"],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    ...options,
  })
}
export async function servePreview() {
  if (process.env.TEST_URL)
    return { url: process.env.TEST_URL, close: async () => {} }
  const server = await preview({
    preview: { host: "127.0.0.1", port: 0, open: false },
    logLevel: "error",
  })
  return {
    url: `http://127.0.0.1:${server.httpServer.address().port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.httpServer.close((error) => (error ? reject(error) : resolve()))
      ),
  }
}

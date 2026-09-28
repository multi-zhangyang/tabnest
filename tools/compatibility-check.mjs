import { spawn } from "node:child_process"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import assert from "node:assert/strict"
import { servePreview, chromePath } from "./runtime.mjs"
const preview = await servePreview(),
  profile = await mkdtemp(join(tmpdir(), "tabnest-compat-"))
const executable = process.env.COMPAT_CHROME_PATH || chromePath()
const native = process.env.COMPAT_EXTENSION === "1"
const wslBrowser = process.env.COMPAT_WSL_BROWSER
const extensionPath = process.env.COMPAT_WSL_EXTENSION || resolve("dist")
const extensionArgs = native
  ? [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ]
  : []
const launchPrefix = wslBrowser
  ? [
      "-d",
      process.env.COMPAT_WSL_DISTRO || "HEAR-Linux",
      "--exec",
      ...(process.env.COMPAT_WSL_LIBRARIES
        ? ["env", `LD_LIBRARY_PATH=${process.env.COMPAT_WSL_LIBRARIES}`]
        : []),
      wslBrowser,
      "--no-sandbox",
    ]
  : []
const testProfile = wslBrowser ? `/tmp/tabnest-compat-${Date.now()}` : profile
const child = spawn(
  wslBrowser ? "wsl.exe" : executable,
  [
    ...launchPrefix,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${testProfile}`,
    ...extensionArgs,
    "about:blank",
  ],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }
)
let socket
const errors = []
try {
  const endpoint = await new Promise((res, rej) => {
    let output = ""
    const timer = setTimeout(() => rej(Error("CDP launch timeout")), 15000)
    child.stderr.on("data", (chunk) => {
      output += chunk.toString()
      const m = output.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) {
        clearTimeout(timer)
        res(m[1])
      }
    })
    child.on("error", rej)
  })
  socket = new WebSocket(endpoint)
  await new Promise((res, rej) => {
    socket.onopen = res
    socket.onerror = rej
  })
  let sequence = 0
  const requests = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const job = requests.get(message.id)
      requests.delete(message.id)
      if (message.error) job.reject(Error(JSON.stringify(message.error)))
      else job.resolve(message.result)
    } else if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text
      )
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      requests.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  const version = await send("Browser.getVersion")
  console.log(version.product)
  const { targetId } = await send("Target.createTarget", { url: "about:blank" })
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails)
      throw Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text
      )
    return result.result.value
  }
  const wait = async (expression) => {
    const start = Date.now()
    while (!(await evaluate(expression))) {
      if (Date.now() - start > 15000)
        throw Error(`Timed out: ${expression}\n${errors.join("\n")}`)
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  await call("Runtime.enable")
  await call("Page.enable")
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await call("Page.navigate", { url: native ? "chrome://newtab" : preview.url })
  let bookmarkId = "b3"
  if (native) {
    await wait(
      'typeof chrome !== "undefined" && !!chrome.bookmarks && !!document.querySelector(".app-header")'
    )
    bookmarkId = await evaluate(
      `(async()=>{const tree=await chrome.bookmarks.getTree();const root=tree[0].children.find(n=>!n.unmodifiable);const folder=await chrome.bookmarks.create({parentId:root.id,title:'兼容验收'});const item=await chrome.bookmarks.create({parentId:folder.id,title:'哔哩哔哩',url:'https://www.bilibili.com/'});await chrome.bookmarks.create({parentId:folder.id,title:'文件',url:'file:///C:/guide.pdf'});return item.id})()`
    )
    await wait(`!!document.querySelector('[data-bookmark-id="${bookmarkId}"]')`)
  } else await wait('document.querySelectorAll(".heat-card").length === 24')
  await evaluate("document.querySelector('[aria-label=\"打开搜索\"]').click()")
  await wait("!!document.querySelector('[aria-label=\"搜索书签\"]')")
  await evaluate(
    `(()=>{const e=document.querySelector('[aria-label="搜索书签"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'blbl');e.dispatchEvent(new Event('input',{bubbles:true}))})()`
  )
  await wait(
    `!!document.querySelector('[data-value="bookmark:${bookmarkId}"]')`
  )
  await new Promise((r) => setTimeout(r, 250))
  const bounds = await evaluate(
    'document.querySelector(".search-dialog").getBoundingClientRect().toJSON()'
  )
  assert.ok(
    bounds.x >= 0 &&
      bounds.y >= 0 &&
      Math.abs(bounds.x + bounds.width / 2 - 720) < 1
  )
  const reportName =
    "compatibility-" +
    version.product.replaceAll("/", "-") +
    (native ? "-extension" : "")
  const image = await call("Page.captureScreenshot", { format: "png" })
  await writeFile(
    resolve("artifacts/" + reportName + ".png"),
    Buffer.from(image.data, "base64")
  )
  assert.deepEqual(errors, [])
  const report = {
    browser: version.product,
    userAgent: version.userAgent,
    executable: wslBrowser || executable,
    checks: [
      native ? "native-mv3-load-and-bookmark-events" : "heat-render",
      "local-pinyin-search",
      "centered-dialog",
    ],
    errors,
  }
  await writeFile(
    "artifacts/" + reportName + ".json",
    JSON.stringify(report, null, 2)
  )
  console.log(JSON.stringify(report))
  await send("Browser.close")
} finally {
  socket?.close()
  child.kill()
  await preview.close()
}

import { spawn } from "node:child_process"
import { mkdtemp, writeFile, readdir, readFile } from "node:fs/promises"
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
  await evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`
  )
  await wait('!document.querySelector(".search-dialog")')
  const modeFrames = await evaluate(`(async()=>{
    const panel=document.querySelector('.view-panel'),frames=[];
    let running=true;
    const sample=()=>{
      const rect=panel.getBoundingClientRect();
      frames.push({top:rect.top,height:rect.height,opacity:Number(getComputedStyle(panel).opacity),trees:panel.querySelectorAll('.main-content').length,content:panel.querySelector('.heat-card')?'heat':'zones',switching:!!panel.dataset.switching});
      if(running)requestAnimationFrame(sample);
    };
    sample();
    document.querySelector('[aria-label="文件夹视图"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));
    await new Promise(r=>setTimeout(r,650));
    running=false;
    return frames;
  })()`)
  assert.ok(modeFrames.some((f) => f.switching && f.opacity < 1))
  assert.ok(modeFrames.every((f) => f.trees === 1))
  assert.ok(
    modeFrames
      .filter((f) => f.switching)
      .every(
        (f) =>
          Math.abs(f.height - modeFrames[0].height) < 0.1 &&
          Math.abs(f.top - modeFrames[0].top) < 0.1
      )
  )
  for (let i = 1; i < modeFrames.length; i++)
    if (modeFrames[i].content !== modeFrames[i - 1].content)
      assert.ok(
        modeFrames[i].opacity < 0.08 || modeFrames[i - 1].opacity < 0.08
      )
  await wait('!document.querySelector(".view-panel").inert')
  const nativeChecks=[]
  if(native){
    await evaluate(`document.querySelector('[aria-label="书签拼图"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))`)
    await wait('!document.querySelector(".view-panel").inert && !!document.querySelector(".heat-card")')
    const applicationUrl=await evaluate('location.href')
    const setMode=async(newTab)=>{
      await evaluate(`(async()=>{const key='tabnest:settings',old=(await chrome.storage.local.get(key))[key];await chrome.storage.local.set({[key]:{schemaVersion:1,revision:(old?.revision||0)+1,updatedAt:new Date().toISOString(),data:{...old?.data,newTab:${newTab}}}})})()`)
      await new Promise(r=>setTimeout(r,150))
    }
    await setMode(true)
    const existingIds=await evaluate(`(async()=>{return(await chrome.tabs.query({})).map(t=>t.id)})()`)
    await evaluate(`document.querySelector('[data-bookmark-id="${bookmarkId}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`)
    const opened=await evaluate(`(async()=>{const existing=${JSON.stringify(existingIds)};for(let i=0;i<50;i++){const tabs=await chrome.tabs.query({});const t=tabs.find(t=>!existing.includes(t.id));if(t)return{id:t.id,active:t.active};await new Promise(r=>setTimeout(r,100))}throw Error('foreground open missing')})()`)
    assert.equal(opened.active,true)
    await evaluate(`chrome.tabs.remove(${opened.id})`)
    await setMode(false)
    await evaluate(`document.querySelector('[data-bookmark-id="${bookmarkId}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`)
    for(let i=0;i<50;i++){const t=await send('Target.getTargetInfo',{targetId});if(t.targetInfo.url.startsWith('https://www.bilibili.com/'))break;if(i===49)throw Error('current tab open missing');await new Promise(r=>setTimeout(r,100))}
    await call('Page.navigate',{url:applicationUrl})
    await wait('!!document.querySelector(".heat-card")')
    nativeChecks.push('foreground-and-current-tab-open')
    const downloadPath=await mkdtemp(join(tmpdir(),'tabnest-compat-recovery-'))
    await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath})
    await evaluate(`(()=>{window.matchMedia=()=>{throw Error('Injected compatibility recovery')};window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:'system',storageArea:localStorage}))})()`)
    await wait(`document.body.textContent.includes('页面加载失败')`)
    await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='导出恢复文件').click()})()`)
    let recoveryName
    for(let i=0;i<100;i++){recoveryName=(await readdir(downloadPath)).find(n=>n.endsWith('.json'));if(recoveryName)break;await new Promise(r=>setTimeout(r,50))}
    assert.ok(recoveryName,'compatibility recovery export missing')
    assert.equal(JSON.parse(await readFile(join(downloadPath,recoveryName),'utf8')).format,'tabnest-recovery')
    await call('Page.reload')
    await wait('!!document.querySelector(".heat-card")')
    await evaluate(`document.querySelector('[aria-label="外观与偏好"]').click()`)
    await wait('!!document.querySelector(".settings-dialog")')
    await evaluate(`(()=>{[...document.querySelectorAll('.settings-navigation [role="tab"]')].find(b=>b.textContent==='数据').click()})()`)
    await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='导入书签').click()})()`)
    await wait('!!document.querySelector("#backup-file")')
    const doc=await call('DOM.getDocument'),fileNode=await call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#backup-file'})
    await call('DOM.setFileInputFiles',{nodeId:fileNode.nodeId,files:[join(downloadPath,recoveryName)]})
    await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='恢复')`)
    await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='恢复').click()})()`)
    await wait('!document.querySelector("#backup-file")')
    assert.equal(await evaluate(`(async()=>{return(await chrome.bookmarks.search({url:'https://www.bilibili.com/'})).length})()`),2)
    nativeChecks.push('fault-boundary-recovery-export-and-import')
    for(let i=errors.length-1;i>=0;i--)if(errors[i].includes('Injected compatibility recovery'))errors.splice(i,1)
  }
  assert.deepEqual(errors, [])
  const report = {
    browser: version.product,
    userAgent: version.userAgent,
    executable: wslBrowser || executable,
    checks: [
      native ? "native-mv3-load-and-bookmark-events" : "heat-render",
      "local-pinyin-search",
      "centered-dialog",
      "single-tree-mode-transition-fixed-height",
      ...nativeChecks,
    ],
    modeFrames: modeFrames.length,
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

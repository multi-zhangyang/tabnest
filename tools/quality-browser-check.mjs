import assert from "node:assert/strict"
import { writeFile, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { launchBrowser } from "./runtime.mjs"
const browser=await launchBrowser({pipe:true,enableExtensions:true})
const errors=[],checks=[]
try {
 const id=await browser.installExtension(resolve('dist')),page=await browser.newPage()
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`chrome-extension://${id}/index.html`)
 await page.waitForSelector('.brand')
 await page.evaluate(async()=>{
  await chrome.bookmarks.create({parentId:'1',title:'恢复验收',url:'https://recovery.test/'})
  await chrome.storage.local.set({'tabnest:clicks':{schemaVersion:1,revision:4,updatedAt:new Date().toISOString(),data:{'https://recovery.test/':74}}})
 })
 await page.waitForSelector('.heat-card')
 const directory=await mkdtemp(join(tmpdir(),'tabnest-recovery-'))
 const cdp=await browser.target().createCDPSession()
 await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:directory,eventsEnabled:true})
 // Force a real render exception inside the app, after normal initialization.
 await page.evaluate(()=>{
  document.fonts.load=()=>{throw Error('Injected render failure')}
  localStorage.setItem('tabnest:demo-bookmarks:v2','irrelevant')
 })
 // Use a malformed, previously valid layout update to exercise the outer boundary.
 await page.evaluate(async()=>{
  window.matchMedia=()=>{throw Error('Injected theme failure')}
  window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:'system',storageArea:localStorage}))
 })
 await page.waitForFunction(()=>document.body.textContent.includes('页面加载失败'))
 const before=await page.evaluate(async()=>({local:await chrome.storage.local.get(null),theme:localStorage.getItem('theme')}))
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='导出恢复文件').click())
 const { readdir }=await import('node:fs/promises')
 let file
 for(let i=0;i<100;i++){
  file=(await readdir(directory)).find(name=>name.endsWith('.json'))
  if(file)break
  await new Promise(r=>setTimeout(r,50))
 }
 assert.ok(file,'recovery download missing')
 const recovery=JSON.parse(await readFile(join(directory,file),'utf8'))
 assert.equal(recovery.format,'tabnest-recovery')
 assert.equal(recovery.sections.local.raw['tabnest:clicks'].data['https://recovery.test/'],74)
 assert.deepEqual(await page.evaluate(async()=>({local:await chrome.storage.local.get(null),theme:localStorage.getItem('theme')})),before,'emergency export mutated storage')
 checks.push({name:'outer-boundary-read-only-download',sections:Object.keys(recovery.sections)})
 await page.reload()
 await page.waitForSelector('.heat-card')
 const second=await browser.newPage()
 await second.goto(`chrome-extension://${id}/index.html`)
 await second.waitForSelector('.heat-card')
 await page.evaluate(async()=>{
  const book=(await chrome.bookmarks.getChildren('1'))[0]
  await chrome.bookmarks.update(book.id,{title:'原生修改'})
  const current=(await chrome.storage.local.get('tabnest:clicks'))['tabnest:clicks']
  await chrome.storage.local.set({'tabnest:clicks':{...current,revision:current.revision+1,data:{'https://recovery.test/':75}}})
 })
 await second.bringToFront()
 await second.waitForFunction(()=>document.querySelector('.heat-card')?.dataset.clicks==='75')
 await second.waitForFunction(()=>document.body.textContent.includes('原生修改'))
 checks.push({name:'background-resume-native-and-storage'})
 await second.locator('[aria-label="外观与偏好"]').click()
 await second.waitForSelector('.settings-dialog')
 await second.evaluate(()=>[...document.querySelectorAll('.settings-navigation [role="tab"]')].find(b=>b.textContent==='数据').click())
 await second.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='导入书签').click())
 await second.waitForSelector('#backup-file')
 await (await second.$('#backup-file')).uploadFile(join(directory,file))
 await second.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='恢复'))
 await second.click('#restore-preferences')
 await second.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='恢复').click())
 await second.waitForFunction(()=>!document.querySelector('#backup-file'))
 assert.equal(await second.evaluate(async()=>{const nodes=await chrome.bookmarks.search({url:'https://recovery.test/'});return nodes.length}),2)
 assert.equal(await second.evaluate(async()=>(await chrome.storage.local.get('tabnest:clicks'))['tabnest:clicks'].data['https://recovery.test/']),75)
 checks.push({name:'recovery-file-native-import-keeps-newer-clicks'})

 // Render errors are deliberate in the first phase only.
 assert.ok(errors.every(e=>e.includes('Injected')),JSON.stringify(errors))
 await writeFile('artifacts/quality-browser-check.json',JSON.stringify({browser:await browser.version(),checks,expectedErrors:errors,errors:[]},null,2))
} finally {await browser.close()}

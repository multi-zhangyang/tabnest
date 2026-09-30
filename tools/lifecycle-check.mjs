import assert from 'node:assert/strict'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {launchBrowser} from './runtime.mjs'
const profile=await mkdtemp(join(tmpdir(),'tabnest-lifecycle-'))
const checks=[],errors=[]
let browser
try{
 browser=await launchBrowser({pipe:true,enableExtensions:true,userDataDir:profile})
 const id=await browser.installExtension(resolve('dist')),url=`chrome-extension://${id}/index.html`
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForSelector('.brand')
 const bookmark=await page.evaluate(async()=>{
  const item=await chrome.bookmarks.create({parentId:'1',title:'重启恢复',url:'https://restart.test/'})
  await chrome.runtime.sendMessage({type:'record-open',url:item.url})
  return item
 })
 await page.waitForFunction(id=>document.querySelector(`[data-bookmark-id="${id}"]`)?.dataset.clicks==='1',{},bookmark.id)
 const control=await browser.newPage();await control.goto(url);await control.waitForSelector('.heat-card')
 await control.bringToFront()
 const tab=await page.evaluate(async()=>chrome.tabs.getCurrent())
 const discarded=await control.evaluate(async id=>{const tab=await chrome.tabs.discard(id);return {id:tab.id,discarded:tab.discarded}},tab.id)
 assert.equal(discarded.discarded,true,'Browser did not actually discard the tab')
 await control.evaluate(async id=>chrome.tabs.update(id,{active:true}),discarded.id)
 const restored=await (await browser.waitForTarget(t=>t.type()==='page' && t.url()===url && t!==control.target())).page()
 await restored.waitForSelector('.heat-card')
 assert.equal(await restored.$eval(`[data-bookmark-id="${bookmark.id}"]`,e=>e.dataset.clicks),'1')
 checks.push({name:'real-tab-discard-and-reload',discarded})
 const version=await browser.version();await browser.close();browser=undefined
 browser=await launchBrowser({pipe:true,enableExtensions:true,userDataDir:profile})
 const reinstalled=await browser.installExtension(resolve('dist'))
 assert.equal(reinstalled,id)
 const reopened=await browser.newPage();reopened.on('pageerror',e=>errors.push(e.message));await reopened.goto(url);await reopened.waitForSelector('.heat-card')
 assert.equal(await reopened.$eval(`[data-bookmark-id="${bookmark.id}"]`,e=>e.dataset.clicks),'1')
 assert.equal(await reopened.evaluate(async()=>(await chrome.bookmarks.search({url:'https://restart.test/'})).length),1)
 checks.push({name:'real-browser-process-restart-keeps-bookmarks-and-clicks'})
 assert.deepEqual(errors,[])
 await writeFile('artifacts/lifecycle-check.json',JSON.stringify({browser:version,checks,errors,actualSystemSleep:'not executed'},null,2))
 console.log(JSON.stringify(checks))
}finally{await browser?.close()}

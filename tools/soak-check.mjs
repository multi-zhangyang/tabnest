import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { launchBrowser } from "./runtime.mjs"
const duration=Number(process.env.SOAK_MS || 1800000), started=Date.now(),checks=[],errors=[]
const browser=await launchBrowser({pipe:true,enableExtensions:true})
try{
 const id=await browser.installExtension(resolve('dist')),url=`chrome-extension://${id}/index.html`
 let page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForSelector('.brand')
 await page.evaluate(async()=>{const folder=await chrome.bookmarks.create({parentId:'1',title:'持续交互'});for(let i=0;i<96;i++)await chrome.bookmarks.create({parentId:folder.id,title:`站点 ${i}`,url:`https://soak.test/${i}`})})
 await page.waitForSelector('.heat-card')
 const second=await browser.newPage();second.on('pageerror',e=>errors.push(e.message));await second.goto(url);await second.waitForSelector('.heat-card')
 let rounds=0
 while(Date.now()-started<duration){
  rounds++
  await page.bringToFront()
  await page.evaluate((round)=>{
   const selector=round%2?'[aria-label="文件夹视图"]':'[aria-label="书签拼图"]'
   document.querySelector(selector).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))
  },rounds)
  await page.waitForFunction(()=>!document.querySelector('.view-panel')?.inert)
  await page.evaluate(async(round)=>{
   const nodes=(await chrome.bookmarks.search({url:'https://soak.test/0'}))
   if(nodes.length)await chrome.bookmarks.update(nodes[0].id,{title:`站点 ${round}`})
   await chrome.runtime.sendMessage({type:'record-open',url:'https://soak.test/0'})
  },rounds)
  await second.bringToFront()
  await second.waitForFunction(async(round)=>(await chrome.storage.local.get('tabnest:clicks'))['tabnest:clicks']?.data['https://soak.test/0']===round,{},rounds)
  if(rounds%5===0){await second.reload();await second.waitForSelector('.heat-card, .section-card')}
  if(rounds%10===0){await page.reload();await page.waitForSelector('.brand')}
  checks.push({round:rounds,elapsedMs:Date.now()-started})
  if(rounds%10===0)console.log(JSON.stringify(checks.at(-1)))
  await new Promise(r=>setTimeout(r,Math.min(15000,Math.max(1,duration-(Date.now()-started)))))
 }
 assert.deepEqual(errors,[])
 await writeFile('artifacts/soak-check.json',JSON.stringify({browser:await browser.version(),elapsedMs:Date.now()-started,requestedMs:duration,rounds,checks,errors,scope:'real MV3 two-tab repeated modes, native updates, persistence, reload; actual OS sleep and browser process restart are separate checks'},null,2))
}finally{await browser.close()}

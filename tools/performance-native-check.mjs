import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import os from 'node:os'
import {launchBrowser,chromePath} from './runtime.mjs'
import {installCanvasClock,canvasFrameTime} from './performance-clock.mjs'
const browser=await launchBrowser({pipe:true,enableExtensions:true}),results=[],errors=[]
const samples=Number(process.env.PERF_SAMPLES||20)
try{
 const extension=await browser.installExtension(resolve('dist')),url=`chrome-extension://${extension}/index.html`
 const seed=await browser.newPage();await seed.goto(url);await seed.waitForSelector('.brand')
 for(const count of [500,5000,20000]){
  const fixture=await seed.evaluate(async(count)=>{
   const children=await chrome.bookmarks.getChildren('1');for(const node of children)await chrome.bookmarks.removeTree(node.id)
   const folders=[];const folderCount=count===500?50:count===5000?1000:2000
   for(let start=0;start<folderCount;start+=100)folders.push(...await Promise.all(Array.from({length:Math.min(100,folderCount-start)},(_,j)=>chrome.bookmarks.create({parentId:'1',title:`文件夹 ${start+j}`}))))
   const books=[]
   for(let start=0;start<count;start+=100)books.push(...await Promise.all(Array.from({length:Math.min(100,count-start)},(_,j)=>chrome.bookmarks.create({parentId:folders[Math.floor((start+j)*folderCount/count)].id,title:`站点 ${start+j}`,url:`https://site${start+j}.test/`}))))
   return books.map(b=>({id:b.id,url:b.url}))
  },count)
  for(const historicalHeat of [false,true]){
   const rows=[]
   const clicks=historicalHeat?Object.fromEntries(fixture.map((item,i)=>[item.url,i%5===0?0:((i*2654435761)>>>0)%4096])):{}
   for(let run=0;run<samples;run++){
    await seed.bringToFront()
    await seed.evaluate(async(clicks)=>{
     const doc=data=>({schemaVersion:1,revision:1,updatedAt:new Date().toISOString(),data})
     await chrome.storage.local.set({'tabnest:settings':doc({layout:'heat',iconMode:'favicon',newTab:true}),'tabnest:clicks':doc(clicks),'tabnest:recent:v1':doc([])})
     localStorage.removeItem('tabnest:heat-layouts:v8')
    },clicks)
    const page=await browser.newPage();await installCanvasClock(page);page.on('pageerror',e=>errors.push(e.message));const start=performance.now()
    await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForSelector('.heat-card')
    await page.waitForFunction(()=>Number(getComputedStyle(document.getElementById('root')).opacity)===1)
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    const firstCanvasMs=await canvasFrameTime(page),automationStartupMs=Math.round(performance.now()-start)
    const timing=await page.evaluate(async()=>{
     const card=document.querySelector('.heat-card'),id=card.dataset.bookmarkId,count=Number(card.dataset.clicks),initial=card.parentElement.getBoundingClientRect(),start=performance.now()
     card.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}))
     const until=async(test)=>{while(!test()){if(performance.now()-start>5000)throw Error('native timing timeout');await new Promise(r=>requestAnimationFrame(r))}}
     await until(()=>document.querySelector(`[data-bookmark-id="${id}"]`)?.dataset.clicks===String(count+1))
     const heatUpdateMs=Math.round(performance.now()-start)
     await until(()=>{const b=document.querySelector(`[data-bookmark-id="${id}"]`)?.parentElement.getBoundingClientRect();return b&&Math.abs(b.width*b.height-initial.width*initial.height)>.1})
     return {heatUpdateMs,firstAreaChangeMs:Math.round(performance.now()-start)}
    })
    await page.locator('[aria-label="打开搜索"]').click();await page.waitForSelector('[aria-label="搜索书签"]')
    const searchMs=await page.evaluate(async({count,id})=>{const start=performance.now(),input=document.querySelector('[aria-label="搜索书签"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,`site${count-1}.test`);input.dispatchEvent(new Event('input',{bubbles:true}));while(!document.querySelector(`[data-value="bookmark:${id}"]`)||document.querySelector('.search-command-list').getAttribute('aria-busy')==='true'){if(performance.now()-start>10000)throw Error('search timeout');await new Promise(r=>requestAnimationFrame(r))}return Math.round(performance.now()-start)},{count,id:fixture.at(-1).id})
    const mounted=await page.$$eval('.bookmark-card',els=>els.length)
    rows.push({run:run+1,firstCanvasMs,automationStartupMs,...timing,searchMs,mounted});console.log(JSON.stringify({count,historicalHeat,...rows.at(-1)}))
    for(const other of await browser.pages())if(other!==seed&&other!==page)await other.close()
    await page.close()
   }
   const p95=Object.fromEntries(['firstCanvasMs','heatUpdateMs','firstAreaChangeMs','searchMs','mounted'].map(key=>[key,rows.map(r=>r[key]).sort((a,b)=>a-b)[Math.ceil(samples*.95)-1]]))
   results.push({count,historicalHeat,samples:rows,p95})
  }
 }
 await writeFile('artifacts/performance-native.json',JSON.stringify({browser:await browser.version(),device:{os:`${os.platform()} ${os.release()}`,cpu:os.cpus()[0]?.model,cores:os.cpus().length,memoryGB:Math.round(os.totalmem()/1024**3),executable:chromePath(),viewport:'1440×900',gpu:process.env.TEST_GPU==='enabled'?'enabled':'disabled by test harness',cpuRate:1},method:'real MV3 Chrome bookmarks/storage; fresh pages; no layout cache; unthrottled; startup measured in browser from navigation start through two frames after valid visible canvas; automation wall time also recorded',results,errors},null,2))
 assert.deepEqual(errors,[])
 for(const result of results){const p=result.p95;assert.ok(p.firstCanvasMs<=1500,JSON.stringify(result));assert.ok(p.heatUpdateMs<=100,JSON.stringify(result));assert.ok(p.firstAreaChangeMs<=150,JSON.stringify(result));assert.ok(p.searchMs<=100,JSON.stringify(result));assert.ok(p.mounted<=250)}
}finally{await browser.close()}

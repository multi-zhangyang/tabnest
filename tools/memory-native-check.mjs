import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { writeFile,readFile } from "node:fs/promises"
import { resolve } from "node:path"
import os from 'node:os'
import { launchBrowser } from "./runtime.mjs"
const samples=[], errors=[]
const testedVersion=JSON.parse(await readFile(resolve(process.env.MEMORY_DIST||'dist','manifest.json'),'utf8')).version
const frozen=JSON.parse(await readFile('artifacts/candidate.json','utf8'))
const testedZipSha256=process.env.MEMORY_LABEL==='baseline'?(await readFile('artifacts/baseline-2.7.0/TabNest-v2.7.0.zip.sha256','utf8')).trim().split(/\s/)[0]:frozen.sha256
const browser=await launchBrowser({pipe:true,enableExtensions:true})
const pid=browser.process().pid
function processMemory(){
 if(process.platform==='win32'){
  const cmd=`$all=Get-CimInstance Win32_Process; $ids=[System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${pid}); do { $changed=$false; foreach($p in $all){ if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)){$changed=$true} } } while($changed); $sum=0; foreach($id in $ids){ $p=Get-Process -Id $id -ErrorAction SilentlyContinue; if($p){$sum+=$p.WorkingSet64} }; Write-Output $sum`
  return Number(spawnSync('powershell.exe',['-NoProfile','-Command',cmd],{windowsHide:true,encoding:'utf8'}).stdout.trim())
 }
 const rows=spawnSync('ps',['-e','-o','pid=,ppid=,rss='],{encoding:'utf8'}).stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number))
 const ids=new Set([pid]); let changed=true
 while(changed){changed=false;for(const [id,parent] of rows)if(ids.has(parent)&&!ids.has(id)){ids.add(id);changed=true}}
 return rows.filter(([id])=>ids.has(id)).reduce((sum,[,,rss])=>sum+rss*1024,0)
}
try {
 const id=await browser.installExtension(resolve(process.env.MEMORY_DIST || 'dist'))
 const seed=await browser.newPage();await seed.goto(`chrome-extension://${id}/index.html`);await seed.waitForSelector('.brand')
 const count=Number(process.env.MEMORY_COUNT||5000)
 await seed.evaluate(async(count)=>{
  const folder=await chrome.bookmarks.create({parentId:'1',title:'内存验收'})
  for(let start=0;start<count;start+=100)await Promise.all(Array.from({length:Math.min(100,count-start)},(_,j)=>chrome.bookmarks.create({parentId:folder.id,title:`站点 ${start+j}`,url:`https://memory.test/${start+j}`})))
  await chrome.storage.local.set({'tabnest:settings':{schemaVersion:1,revision:1,updatedAt:new Date().toISOString(),data:{layout:'heat',iconMode:'favicon'}}})
 },count)
 await seed.close()
 const pages=[]
 const sample=async(phase)=>{
  let heap=0, workerHeap=0; const isolates=new Set()
  for(const page of pages){const cdp=await page.createCDPSession();await cdp.send('HeapProfiler.collectGarbage');const isolate=(await cdp.send('Runtime.getIsolateId')).id; if(!isolates.has(isolate)){isolates.add(isolate);heap+=(await cdp.send('Runtime.getHeapUsage')).usedSize};await cdp.detach()}
  const workers=browser.targets().filter(t=>t.url().includes('compute-worker'))
  for(const target of workers){try{const cdp=await target.createCDPSession();await cdp.send('HeapProfiler.collectGarbage');workerHeap+=(await cdp.send('Runtime.getHeapUsage')).usedSize;await cdp.detach()}catch{/* disposed */}}
  const rss=[];for(let i=0;i<3;i++)rss.push(processMemory())
  const result={phase,tabs:pages.length,pageHeapBytes:heap,workerHeapBytes:workerHeap,workers:workers.length,processWorkingSetBytes:rss.sort((a,b)=>a-b)[1]}
  samples.push(result);console.log(JSON.stringify(result));return result
 }
 for(const targetCount of [1,5,10]){
  while(pages.length<targetCount){const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`chrome-extension://${id}/index.html`);await page.waitForSelector('.heat-card');pages.push(page)}
  await new Promise(r=>setTimeout(r,2000))
  await sample('opened')
 }
 const active=pages.at(-1);await active.bringToFront()
 const baseline=await sample('baseline')
 for(let i=0;i<20;i++){
  await active.locator('[aria-label="打开搜索"]').click()
  const input=await active.waitForSelector('[aria-label="搜索书签"]');await input.type(`memory.test/${i}`)
  await active.waitForSelector(`[data-value^="bookmark:"]`);await active.keyboard.press('Escape')
  await active.evaluate(()=>document.querySelector('.heat-card').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true})))
  await new Promise(r=>setTimeout(r,100))
  for(const other of await browser.pages())if(!pages.includes(other))await other.close()
 }
 await sample('20-rounds')
 const blank=await browser.newPage();await blank.bringToFront()
 await new Promise(r=>setTimeout(r,31000))
 const idle=await sample('background-idle')
 await active.bringToFront();await active.waitForSelector('.heat-card')
 const resumed=await sample('resumed')
 const heapGrowthBytes=resumed.pageHeapBytes-baseline.pageHeapBytes
 while(pages.length>1)await pages.pop().close()
 await blank.close();await sample('closed-to-one')
 assert.deepEqual(errors,[])
 await writeFile(`artifacts/memory-native-${count}${process.env.MEMORY_LABEL ? '-'+process.env.MEMORY_LABEL : ''}.json`,JSON.stringify({testedVersion,testedZipSha256,browser:await browser.version(),device:{os:`${os.platform()} ${os.release()}`,cpu:os.cpus()[0]?.model,memoryGB:Math.round(os.totalmem()/1024**3),gpu:process.env.TEST_GPU==='enabled'?'enabled':'disabled by test harness'},count,heapGrowthBytes,scope:'V8 heap deduplicated by isolate, plus sum of working sets of this disposable browser process tree; shared pages can be counted by more than one process; excludes unrelated browser sessions',samples,errors},null,2))
 assert.equal(idle.workers,0)
 if(process.env.MEMORY_LABEL!=='baseline')assert.ok(heapGrowthBytes<=Math.max(5*1024**2,baseline.pageHeapBytes*.1),'heap growth exceeds budget')
} finally {await browser.close()}

import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
const names=["startup","virtual-focus","browser","extension","scroll","ui-details","surfaces","product","upgrade","mosaic","heat-growth","navigation","memory","view-switch","faults","quality-browser","package"]
const scripts={"ui-details":"ui-detail",surfaces:"surface",upgrade:"upgrade-ui",package:"package",mosaic:"mosaic-layout",faults:"fault"}
const run=(name,args)=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,["tools/run-check.mjs",name,process.execPath,...args],{stdio:"inherit",windowsHide:true,env:process.env})
 child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(Error(`${name} failed (${code})`)))
})
if(!process.env.TEST_BATCH)process.env.TEST_BATCH=JSON.parse(await readFile("artifacts/candidate.json","utf8")).batch
await run("lint",["node_modules/eslint/bin/eslint.js","."])
const {readdir}=await import("node:fs/promises")
await run("units",["--test",...(await readdir("tools")).filter(name=>name.endsWith(".test.mjs")).map(name=>`tools/${name}`)])
const selected=process.env.CHECK_FROM ? names.slice(names.indexOf(process.env.CHECK_FROM)) : process.env.CHECK_NAMES ? process.env.CHECK_NAMES.split(',') : names
if(process.env.CHECK_FROM && !names.includes(process.env.CHECK_FROM))throw Error('Unknown CHECK_FROM')
if(selected.some(name=>!names.includes(name)))throw Error('Unknown CHECK_NAMES')
for(const name of selected)await run(name,[`tools/${scripts[name]||name}-check.mjs`])
if(process.env.SKIP_PERFORMANCE!=="1")await run("performance",["tools/performance-check.mjs"])
if(process.env.npm_lifecycle_event==='release')await import('./release-checks.mjs')
await writeFile("artifacts/current-batch.json",JSON.stringify({batch:process.env.TEST_BATCH,release:JSON.parse(await readFile("artifacts/release-report.json","utf8"))},null,2))

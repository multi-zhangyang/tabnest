import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises"
import { resolve } from "node:path"
import os from "node:os"
import { buildIdentity } from "./build-identity.mjs"
const root = resolve(import.meta.dirname, "..")
const release = JSON.parse(await readFile(resolve(root,"artifacts/release-report.json"),"utf8"))
const identity = await buildIdentity(root)
assert.equal(identity.buildId,release.buildId,"Candidate no longer matches source; rebuild and start a new batch")
const batch = process.env.TEST_BATCH
assert.ok(batch, "TEST_BATCH is required")
const candidate=JSON.parse(await readFile(resolve(root,'artifacts/candidate.json'),'utf8'))
assert.equal(batch,candidate.batch,'TEST_BATCH must match the frozen candidate')
assert.equal(candidate.buildId,release.buildId)
assert.equal(candidate.sha256,release.sha256)
assert.equal(createHash('sha256').update(await readFile(resolve(root,'artifacts',release.archive))).digest('hex'),release.sha256,'Candidate ZIP changed')
const [name, command, ...args] = process.argv.slice(2)
assert.ok(/^[a-z0-9-]+$/.test(name) && command)
const startedAt = new Date().toISOString()
const toolFingerprint=createHash('sha256')
for(const toolName of (await readdir(resolve(root,'tools'))).filter(n=>/\.(mjs|mts)$/.test(n)).sort())toolFingerprint.update(toolName+'\0').update(await readFile(resolve(root,'tools',toolName)))
const toolsAtStart=toolFingerprint.digest('hex')
const primary = {browser:'browser-check.json',extension:'extension-check.json',startup:'startup-check.json',scroll:'scroll-check.json','ui-details':'ui-detail-check.json',surfaces:'surface-check.json',product:'product-check.json',upgrade:'upgrade-ui-check.json',mosaic:'mosaic-layout-check.json','heat-growth':'heat-growth-check.json',navigation:'navigation-check.json',memory:'memory-check.json','view-switch':'view-switch-check.json','virtual-focus':'virtual-focus-check.json',faults:'fault-check.json','quality-browser':'quality-browser-check.json',package:'package-smoke.json',performance:'performance-check.json','performance-cpu':'performance-check.json','performance-native':'performance-native.json',soak:'soak-check.json','memory-5000':'memory-native-5000.json','memory-20000':'memory-native-20000.json','memory-baseline-5000':'memory-native-5000-baseline.json','memory-baseline-20000':'memory-native-20000-baseline.json','memory-comparison':'memory-comparison.json',lifecycle:'lifecycle-check.json'}[name]
// A deterministic report still has to be produced by this invocation.
if(primary)await rm(resolve(root,'artifacts',primary),{force:true})
const before = new Map()
for (const name of await readdir(resolve(root,"artifacts"))) {
  try { const bytes = await readFile(resolve(root,"artifacts",name)); before.set(name,createHash("sha256").update(bytes).digest("hex")) } catch { /* directories */ }
}
const result = await new Promise((resolveResult,reject) => {
  const child = spawn(command,args,{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"],env:process.env})
  let log=""
  child.stdout.on("data", chunk=>{ log+=chunk; process.stdout.write(chunk) })
  child.stderr.on("data", chunk=>{ log+=chunk; process.stderr.write(chunk) })
  child.on("error",reject)
  child.on("exit",code=>resolveResult({code,log}))
})
const evidence = { batch,version:release.version,buildId:release.buildId,extensionSha256:release.sha256,platform:process.env.TEST_PLATFORM || `${os.platform()}-${os.release()}`,startedAt,finishedAt:new Date().toISOString(),command:[command,...args],exitCode:result.code }
assert.equal((await buildIdentity(root)).buildId,release.buildId,"Source changed during verification")
const directory = resolve(root,"artifacts/runs",batch,evidence.platform.replaceAll(/[^a-zA-Z0-9.-]/g,"-"))
await mkdir(directory,{recursive:true})
await writeFile(resolve(directory,`${name}.log`),result.log)
const outputs=[]
const stems={"ui-details":"ui-detail",surfaces:"surface",upgrade:"upgrade-ui",package:"package-smoke",performance:"performance",'performance-cpu':'performance','performance-native':'performance-native',units:"unit",memory:"memory-check",faults:'fault',"memory-5000":"memory-native-5000","memory-20000":"memory-native-20000","memory-baseline-5000":"memory-native-5000-baseline","memory-baseline-20000":"memory-native-20000-baseline","chrome-114":"compatibility-Chrome-114",edge:"compatibility-Edg",soak:"soak", "virtual-focus":"virtual-focus"}
const stem=stems[name] || name
const extraStems = {"heat-growth":["heat-reclaim","heat-growth"],"mosaic":["mosaic-layout"],"view-switch":["view-switch"],"quality-browser":["quality-browser"]}[name] || []
for (const file of await readdir(resolve(root,"artifacts"))) {
    if (file!==primary && !file.startsWith(stem) && !extraStems.some(prefix=>file.startsWith(prefix))) continue
  try {
    let bytes=await readFile(resolve(root,"artifacts",file))
    if (before.get(file)===createHash("sha256").update(bytes).digest("hex")) continue
    if (file.endsWith(".json")) {
      const report=JSON.parse(bytes)
      if (!Array.isArray(report)) { report.evidence=evidence; bytes=Buffer.from(JSON.stringify(report,null,2)); await writeFile(resolve(root,"artifacts",file),bytes) }
    }
    const outputName=name==='performance-cpu'&&file.startsWith('performance-')?file.replace('performance-','performance-cpu-'):file===`${name}.json`?`result-${file}`:file
    await writeFile(resolve(directory,outputName),bytes)
    outputs.push({name:outputName,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length})
  } catch { /* directories */ }
}
const missing=!!primary && result.code===0 && !outputs.some(o=>o.name===primary || o.name===`result-${primary}` || (name==='performance-cpu'&&o.name==='performance-cpu-check.json'))
const completed={...evidence,exitCode:missing?1:evidence.exitCode,toolFingerprint:toolsAtStart,outputs}
await writeFile(resolve(directory,`${name}.json`),JSON.stringify(completed,null,2))
if(missing)console.error(`Missing fresh primary report: ${primary}`)
process.exitCode=completed.exitCode || 0

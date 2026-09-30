import assert from "node:assert/strict"
import { readFile, writeFile, readdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import { zipSync } from "fflate"
import { resolve, relative } from "node:path"
import {validateEvidence,validateChecks} from './release-validation.mjs'
import {buildIdentity} from './build-identity.mjs'
const release=JSON.parse(await readFile("artifacts/release-report.json","utf8"))
const batch=process.env.TEST_BATCH || JSON.parse(await readFile("artifacts/candidate.json","utf8")).batch
assert.ok(batch,"TEST_BATCH required")
const candidate=JSON.parse(await readFile('artifacts/candidate.json','utf8'))
assert.equal(candidate.batch,batch)
assert.equal(candidate.buildId,release.buildId)
assert.equal(candidate.sha256,release.sha256)
assert.equal((await buildIdentity(process.cwd())).buildId,release.buildId,'source no longer matches candidate')
assert.equal(createHash('sha256').update(await readFile(`artifacts/${release.archive}`)).digest('hex'),release.sha256)
const root=resolve("artifacts/runs",batch)
const entries={}
const checks=[]
const assertClean = (value, file) => {
 if (Array.isArray(value)) { value.forEach(v=>assertClean(v,file)); return }
 if (!value || typeof value !== 'object') return
 if (value.errors) assert.deepEqual(value.errors,[],file)
 if (value.violations) assert.deepEqual(value.violations,[],file)
}
async function visit(directory) {
 for (const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
  const path=resolve(directory,entry.name)
  if(entry.isDirectory()) await visit(path)
  else {
   const bytes=await readFile(path)
   if(entry.name.endsWith('.json')) {
    const report=JSON.parse(bytes)
    const evidence=report.batch?report:report.evidence
    if(evidence) {
     validateEvidence(report,release,batch)
     if(report.outputs) {
      checks.push({name:entry.name,platform:evidence.platform})
      for (const output of report.outputs) {
       const content=await readFile(resolve(directory,output.name))
       assert.equal(createHash('sha256').update(content).digest('hex'),output.sha256,`changed evidence ${output.name}`)
       assert.equal(content.length,output.bytes)
      }
     }
    }
    assertClean(report,path)
   }
   entries[relative(root,path).replaceAll('\\','/')]=[new Uint8Array(bytes),{mtime:new Date(1980,0,1)}]
  }
 }
}
await visit(root)
validateChecks(checks)
for(const name of [release.archive,`${release.archive}.sha256`,'release-report.json','candidate.json'])entries[`candidate/${name}`]=[new Uint8Array(await readFile(`artifacts/${name}`)),{mtime:new Date(1980,0,1)}]
for(const name of await readdir('artifacts/baseline-2.7.0'))if(name.endsWith('.zip')||name.endsWith('.sha256'))entries[`baseline/${name}`]=[new Uint8Array(await readFile(`artifacts/baseline-2.7.0/${name}`)),{mtime:new Date(1980,0,1)}]
try{
 const hardware=await readFile(`artifacts/hardware-${release.version}.json`),report=JSON.parse(hardware)
 assert.equal(report.buildId,release.buildId);assert.equal(report.extensionSha256,release.sha256);assert.equal(report.batch,batch)
 entries['hardware.json']=[new Uint8Array(hardware),{mtime:new Date(1980,0,1)}]
}catch(error){if(error.code!=='ENOENT')throw error}
async function archiveAttempts(directory){
 for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const path=resolve(directory,entry.name)
  if(entry.isDirectory())await archiveAttempts(path)
  else entries[`attempts/${relative(resolve('artifacts/attempts',batch),path).replaceAll('\\','/')}`]=[new Uint8Array(await readFile(path)),{mtime:new Date(1980,0,1)}]
 }
}
try{await archiveAttempts(resolve('artifacts/attempts',batch))}catch(error){if(error.code!=='ENOENT')throw error}
const summary={version:release.version,buildId:release.buildId,extensionSha256:release.sha256,batch,checks,entries:Object.entries(entries).map(([name,[bytes]])=>({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))}
await writeFile('artifacts/verification-report.json',JSON.stringify(summary,null,2))
entries['verification-report.json']=[new TextEncoder().encode(JSON.stringify(summary,null,2)),{mtime:new Date(1980,0,1)}]
const zip=zipSync(entries,{level:9}),archive=`TabNest-v${release.version}-verification.zip`,sha=createHash('sha256').update(zip).digest('hex')
await writeFile(`artifacts/${archive}`,zip)
await writeFile(`artifacts/${archive}.sha256`,`${sha}  ${archive}\n`)
console.log(JSON.stringify({archive,bytes:zip.length,sha256:sha}))

import assert from 'node:assert/strict'
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import {unzipSync} from 'fflate'
import {resolve,dirname,sep} from 'node:path'
const report=JSON.parse(await readFile('artifacts/release-report.json','utf8'))
const {createHash}=await import('node:crypto')
const bytes=await readFile(`artifacts/${report.archive}`)
assert.equal(createHash('sha256').update(bytes).digest('hex'),report.sha256)
const root=resolve(process.env.CANDIDATE_DIST||'dist')
if(root===resolve('dist'))await import('./clean-dist.mjs')
for(const [name,data] of Object.entries(unzipSync(bytes))){
 const path=resolve(root,name);assert.ok(path.startsWith(root+sep));await mkdir(dirname(path),{recursive:true});await writeFile(path,data)
}

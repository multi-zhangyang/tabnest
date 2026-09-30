import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {unzipSync} from 'fflate'
import {resolve,dirname,sep} from 'node:path'
import {createHash} from 'node:crypto'
const baseline=await readFile('artifacts/baseline-2.7.0/TabNest-v2.7.0.zip')
const expected=(await readFile('artifacts/baseline-2.7.0/TabNest-v2.7.0.zip.sha256','utf8')).trim().split(/\s/)[0]
assert.equal(createHash('sha256').update(baseline).digest('hex'),expected,'Baseline checksum mismatch')
const root=resolve('artifacts/baseline-2.7.0/dist')
for(const [name,bytes] of Object.entries(unzipSync(baseline))){
 const path=resolve(root,name);assert.ok(path.startsWith(root+sep));const {mkdir}=await import('node:fs/promises');await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes)
}

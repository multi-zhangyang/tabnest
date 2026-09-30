import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
const results=[]
for(const count of [5000,20000]){
 const current=JSON.parse(await readFile(`artifacts/memory-native-${count}.json`,'utf8'))
 const baseline=JSON.parse(await readFile(`artifacts/memory-native-${count}-baseline.json`,'utf8'))
 assert.equal(current.browser,baseline.browser)
 for(const tabs of [1,5,10]){
  const a=current.samples.find(s=>s.phase==='opened'&&s.tabs===tabs),b=baseline.samples.find(s=>s.phase==='opened'&&s.tabs===tabs)
  const ratio=a.processWorkingSetBytes/b.processWorkingSetBytes
  results.push({count,tabs,baselineBytes:b.processWorkingSetBytes,currentBytes:a.processWorkingSetBytes,ratio})
 }
}
await writeFile('artifacts/memory-comparison.json',JSON.stringify({scope:'same machine/browser disposable process-tree working set medians, shared process pages can be counted more than once; opened stable states',results,errors:[]},null,2))
console.log(JSON.stringify(results))
for(const row of results)assert.ok(row.ratio<=1.1,`working set budget exceeded: ${JSON.stringify(row)}`)

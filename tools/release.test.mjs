import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validateEvidence,validateChecks,platformChecks,releaseChecks} from './release-validation.mjs'
const release={buildId:'build',sha256:'zip'}
const valid={batch:'batch',buildId:'build',extensionSha256:'zip',exitCode:0}
test('release aggregation rejects stale batch, build, candidate and failed or absent reports',()=>{
 validateEvidence(valid,release,'batch')
 for(const change of [{batch:'old'},{buildId:'old'},{extensionSha256:'old'},{exitCode:1}])assert.throws(()=>validateEvidence({...valid,...change},release,'batch'))
 assert.throws(()=>validateEvidence({...valid,command:['node','browser-check.mjs'],outputs:[]},release,'batch'))
 const checks=['windows-current','Linux-current'].flatMap(platform=>platformChecks.map(name=>({name:`${name}.json`,platform})))
 checks.push(...releaseChecks.map(name=>({name:`${name}.json`,platform:'compatibility'})))
 validateChecks(checks)
 assert.throws(()=>validateChecks(checks.filter(c=>c.name!=='soak.json')))
 assert.throws(()=>validateChecks(checks.filter(c=>!(c.platform==='Linux-current'&&c.name==='performance.json'))))
 assert.throws(()=>validateEvidence({evidence:valid,requestedMs:1000,elapsedMs:1000},release,'batch'))
 assert.throws(()=>validateEvidence({evidence:valid,results:[{count:500,p95:{firstCanvasMs:1},samples:[{firstCanvasMs:1}]}]},release,'batch'))
})
test('release aggregation validates the full memory comparison and rejects failed budgets',()=>{
 const results=[5000,20000].flatMap(count=>[1,5,10].map(tabs=>({count,tabs,currentBytes:100,baselineBytes:100,ratio:1})))
 const report={evidence:valid,scope:'opened stable states',results}
 validateEvidence(report,release,'batch')
 assert.throws(()=>validateEvidence({...report,results:results.slice(1)},release,'batch'))
 assert.throws(()=>validateEvidence({...report,results:results.map((row,i)=>i===0?{...row,currentBytes:120,ratio:1.2}:row)},release,'batch'))
 assert.throws(()=>validateEvidence({...report,results:results.map((row,i)=>i===0?{...row,ratio:.5}:row)},release,'batch'))
})

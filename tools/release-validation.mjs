import assert from 'node:assert/strict'
export const platformChecks=['units','lint','browser','extension','startup','scroll','ui-details','surfaces','product','upgrade','mosaic','heat-growth','navigation','memory','view-switch','virtual-focus','faults','quality-browser','performance','package']
export const releaseChecks=['chrome-114','edge','soak','lifecycle','performance-native','performance-cpu','memory-5000','memory-20000','memory-baseline-5000','memory-baseline-20000','memory-comparison']
export function validateEvidence(report,release,batch){
 const evidence=report.batch?report:report.evidence
 if(!evidence)return
 assert.equal(evidence.batch,batch,'stale batch')
 assert.equal(evidence.buildId,release.buildId,'stale build')
 assert.equal(evidence.extensionSha256,release.sha256,'different candidate')
 assert.equal(evidence.exitCode,0,'failed verification')
 if(report.outputs){
  // Log-only lint/unit runs are valid; browser and performance runs need artifacts.
  if(!evidence.command?.some(arg=>arg.includes('eslint') || arg==='--test'))assert.ok(report.outputs.some(o=>o.name.endsWith('.json')),'missing result document')
 }
 if(report.results?.some(r=>r.p95?.firstCanvasMs!==undefined)){
  const cpu=report.device?.cpuRate||1
  const targets=cpu===4?{firstCanvasMs:3000,searchMs:200,heatUpdateMs:200,firstAreaChangeMs:300}:{firstCanvasMs:1500,searchMs:100,heatUpdateMs:100,firstAreaChangeMs:150}
  for(const row of report.results){
   assert.ok(row.samples?.length>=20,'performance requires at least twenty samples')
   for(const [metric,limit]of Object.entries(targets)){
    const observed=row.samples.map(sample=>sample[metric]).sort((a,b)=>a-b)[Math.ceil(row.samples.length*.95)-1]
    assert.equal(row.p95[metric],observed,'incorrect percentile')
    assert.ok(observed<=limit,`${metric} exceeded budget`)
   }
   for(const sample of row.samples)assert.ok(Math.max(...['mounted','heatDOM','searchDOM','sectionDOM','bottomDOM'].map(key=>sample[key]||0))<=250,'mounted bookmark budget')
  }
  const counts=cpu===4?[5000]:[500,5000,20000]
  for(const count of counts)for(const historical of [false,true])assert.ok(report.results.some(row=>row.count===count&&!!row.historicalHeat===historical),'missing performance scenario')
 }
 if(report.requestedMs!==undefined)assert.ok(report.requestedMs>=1800000&&report.elapsedMs>=1800000,'soak requires thirty actual minutes')
 if(report.testedVersion!==undefined){
  assert.ok([5000,20000].includes(report.count),'missing memory fixture')
  assert.ok([release.version,'2.7.0'].includes(report.testedVersion),'unexpected memory version')
  if(report.testedVersion===release.version)assert.equal(report.testedZipSha256,release.sha256,'memory tested a different ZIP')
  assert.match(report.testedZipSha256,/^[a-f0-9]{64}$/,'missing memory ZIP identity')
  for(const tabs of [1,5,10])assert.ok(report.samples?.some(s=>s.phase==='opened'&&s.tabs===tabs),'missing memory tab count')
  for(const phase of ['baseline','20-rounds','background-idle','resumed','closed-to-one'])assert.ok(report.samples?.some(s=>s.phase===phase),'missing memory phase')
  for(const sample of report.samples)for(const metric of ['pageHeapBytes','workerHeapBytes','processWorkingSetBytes'])assert.ok(Number.isFinite(sample[metric])&&sample[metric]>=0,'invalid memory measurement')
  const baseline=report.samples.find(s=>s.phase==='baseline'),resumed=report.samples.find(s=>s.phase==='resumed')
  assert.equal(report.heapGrowthBytes,resumed.pageHeapBytes-baseline.pageHeapBytes,'incorrect heap growth')
  assert.equal(report.samples.find(s=>s.phase==='background-idle').workers,0,'idle Worker remains')
  if(report.testedVersion===release.version)assert.ok(report.heapGrowthBytes<=Math.max(5*1024**2,baseline.pageHeapBytes*.1),'heap growth exceeded budget')
 }
 if(report.scope?.includes('opened stable states')){
  assert.equal(report.results?.length,6,'incomplete memory comparison')
  for(const count of [5000,20000])for(const tabs of [1,5,10]){
   const row=report.results.find(r=>r.count===count&&r.tabs===tabs)
   assert.ok(row,'missing memory comparison scenario')
   assert.ok(Number.isFinite(row.currentBytes)&&row.currentBytes>0&&Number.isFinite(row.baselineBytes)&&row.baselineBytes>0,'invalid working set')
   assert.equal(row.ratio,row.currentBytes/row.baselineBytes,'incorrect memory ratio')
   assert.ok(row.ratio<=1.1,'process memory exceeded budget')
  }
 }
}
export function validateChecks(checks){
 const platforms=[...new Set(checks.map(c=>c.platform))]
 const requiredPlatforms=platforms.filter(p=>/^(win32|windows|Linux|ubuntu)/.test(p)&&checks.some(c=>c.platform===p&&c.name==='browser.json'))
 assert.ok(requiredPlatforms.some(p=>/^(win32|windows)/.test(p)),'Windows verification required')
 assert.ok(requiredPlatforms.some(p=>/^(Linux|ubuntu)/.test(p)),'Linux verification required')
 for(const platform of requiredPlatforms)for(const name of platformChecks)
  assert.ok(checks.some(c=>c.name===`${name}.json`&&c.platform===platform),`Missing ${platform} check: ${name}`)
 for(const name of releaseChecks)assert.ok(checks.some(c=>c.name===`${name}.json`),`Missing release check: ${name}`)
}

import {spawn} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const candidate=JSON.parse(await readFile('artifacts/candidate.json','utf8'))
process.env.TEST_BATCH=candidate.batch
const run=(name,script,env={})=>new Promise((res,rej)=>{
 if(process.env.RELEASE_CHECKS&&!process.env.RELEASE_CHECKS.split(',').includes(name)){res();return}
 const child=spawn(process.execPath,['tools/run-check.mjs',name,process.execPath,`tools/${script}.mjs`],{stdio:'inherit',windowsHide:true,env:{...process.env,...env}})
 child.on('error',rej);child.on('exit',code=>code===0?res():rej(Error(`${name} failed (${code})`)))
})
// Run serially on one machine so functional load does not distort timing samples.
await run('performance-cpu','performance-check',{PERF_COUNT:'5000',PERF_CPU:'4',PERF_SAMPLES:'20'})
await run('performance-native','performance-native-check',{PERF_COUNT:'',PERF_CPU:'',PERF_SAMPLES:'20'})
await run('lifecycle','lifecycle-check')
await run('soak','soak-check',{SOAK_MS:'1800000'})
await import('./unpack-baseline.mjs')
for(const count of [5000,20000]){
 await run(`memory-${count}`,'memory-native-check',{MEMORY_COUNT:String(count),MEMORY_DIST:'dist',MEMORY_LABEL:''})
 await run(`memory-baseline-${count}`,'memory-native-check',{MEMORY_COUNT:String(count),MEMORY_DIST:resolve('artifacts/baseline-2.7.0/dist'),MEMORY_LABEL:'baseline'})
}
await run('memory-comparison','memory-comparison')
if(process.platform==='win32'){
 const minimum=process.env.MINIMUM_CHROME_PATH
 if(process.env.SKIP_MINIMUM_COMPAT!=='1'&&(!process.env.RELEASE_CHECKS||process.env.RELEASE_CHECKS.split(',').includes('chrome-114'))){
  if(!minimum)throw Error('MINIMUM_CHROME_PATH is required for release verification')
  await run('chrome-114','compatibility-check',{COMPAT_EXTENSION:'1',COMPAT_CHROME_PATH:minimum})
 }
 await run('edge','compatibility-check',{COMPAT_EXTENSION:'1',COMPAT_CHROME_PATH:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'})
}

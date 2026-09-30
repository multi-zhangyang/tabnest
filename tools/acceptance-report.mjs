import { readFile, writeFile, readdir } from "node:fs/promises"
const release=JSON.parse(await readFile('artifacts/release-report.json','utf8'))
const verification=JSON.parse(await readFile('artifacts/verification-report.json','utf8'))
if(release.buildId!==verification.buildId || release.sha256!==verification.extensionSha256) throw Error('Stale verification')
const platforms=[...new Set(verification.checks.map(c=>c.platform))]
const reports=[]
for(const platform of await readdir(`artifacts/runs/${verification.batch}`)){
 for(const file of await readdir(`artifacts/runs/${verification.batch}/${platform}`)){
  if(!file.endsWith('.json'))continue
  const report=JSON.parse(await readFile(`artifacts/runs/${verification.batch}/${platform}/${file}`,'utf8'))
  if(report.results&&report.evidence?.buildId===release.buildId)reports.push({platform,file,report})
 }
}
const timing=reports.filter(r=>r.report.results.some(s=>s.p95?.firstCanvasMs!==undefined))
const rows=timing.flatMap(({platform,file,report})=>report.results.map(r=>`| ${platform} | ${file.includes('native')?'MV3':file.includes('cpu')?'预览 · CPU×4':'预览'} | ${r.count} | ${r.historicalHeat?'历史':'零'} | ${r.samples.length} | ${r.p95.firstCanvasMs} | ${r.p95.searchMs} | ${r.p95.heatUpdateMs} | ${r.p95.firstAreaChangeMs} |`))
const memory=reports.find(r=>r.file==='result-memory-comparison.json'||r.file==='memory-comparison.json')
let attempts=''
try{
 const directory=`artifacts/attempts/${verification.batch}`
 const records=[]
 async function visitAttempts(path){
  for(const entry of await readdir(path,{withFileTypes:true})){
   const file=`${path}/${entry.name}`
   if(entry.isDirectory())await visitAttempts(file)
   else if(entry.name==='performance-check.json'){
    const failed=JSON.parse(await readFile(file,'utf8'))
    const exceeded=failed.results.filter(row=>row.p95.firstCanvasMs>1500).map(row=>`${row.count} 条${row.historicalHeat?'历史':'零'}热度 ${row.p95.firstCanvasMs}ms`).join('、')
    records.push(`${file.slice(directory.length+1)}：${exceeded||'历史运行'}`)
   }
  }
 }
 await visitAttempts(directory)
 attempts=`历史候选记录：${records.join('；')}。前一候选的降速搜索超限，修正了等待状态造成的多余候选挂载，并减少约束投影循环开销；修正后冻结新构建并重新验收。Linux 历史运行出现首屏波动，同期主机有其他项目负载，不能据此单独断定原因。最终两平台采用相同的浏览器内计时，另保留自动化工具耗时。历史及中断记录保留在验收包 attempts 目录，不作为当前构建通过证据。\n\n`
}catch(error){if(error.code!=='ENOENT')throw error}
await writeFile(`docs/acceptance-${release.version}.md`,`# TabNest ${release.version} 验收\n\n构建：${release.buildId}\n\n安装包 SHA-256：${release.sha256}\n\n批次：${verification.batch}\n\n实际平台：${platforms.join('、')}\n\nZIP ${release.archiveBytes} 字节；首屏 JavaScript gzip 合计 ${release.initialJsGzipBytes} 字节。\n\n## 性能实测\n\n各场景至少 20 个样本，表中为 P95，单位 ms。预览与真实 MV3 分别记录。设备、浏览器、GPU 与 CPU 降速条件保存在原始报告中。\n\n| 平台 | 环境 | 书签 | 热度 | 样本 | 首屏 | 搜索 | 保存 | 首次面积变化 |\n|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\n## 内存对照\n\n${memory?`同机同浏览器的稳定期浏览器进程树工作集，三次测量取中位数。共享页面可能被不同进程重复计入；JS 堆按 V8 isolate 去重。\n\n| 书签 | 标签页 | 2.7.0 MB | 2.7.1 MB | 比值 |\n|---|---|---|---|---|\n${memory.report.results.map(r=>`| ${r.count} | ${r.tabs} | ${(r.baselineBytes/1024**2).toFixed(1)} | ${(r.currentBytes/1024**2).toFixed(1)} | ${r.ratio.toFixed(3)} |`).join('\n')}`:'见同版本内存原始报告。'}\n\n## 已执行检查\n\n${verification.checks.map(c=>`- ${c.platform}：${c.name.replace('.json','')}`).join('\n')}\n\n## 实测范围\n\n${attempts}Linux 使用 WSL 中的真实 Linux Chrome，当前测试为 headless，GPU 由测试脚本禁用；不将其表述为 Linux 桌面或硬件 GPU 实测。浏览器进程重启和原生标签页丢弃单独执行。实际系统休眠、商店提交、公开发布和 GitHub Actions 云端运行未执行，不计为通过。详细样本和日志见同版本验收包。\n`)

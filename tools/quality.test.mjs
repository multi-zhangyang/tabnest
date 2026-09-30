import { test, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "vite"
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error" })
after(() => server.close())
const heat = await server.ssrLoadModule("/src/lib/heat-layout.ts")
const sessions = await server.ssrLoadModule("/src/lib/heat-session.ts")
const recovery = await server.ssrLoadModule("/src/lib/recovery-file.ts")
const theme = await server.ssrLoadModule("/src/lib/theme-storage.ts")
const client = await server.ssrLoadModule('/src/lib/compute-client.ts')
const items = Array.from({ length: 96 }, (_, i) => ({ id: `incremental-${i}`, title: `站点 ${i}`, url: `https://incremental.test/${i}` }))
test("region planning and solving reproduce the full layout without changing distant regions", () => {
  const input = { items, clicks: { [items[0].url]: 30, [items[40].url]: 900 }, width: 1356, available: 728, gap: 8, scale: 1 }
  const plan = heat.planHeatRegions(input)
  const regions = plan.regions.map(r => heat.solveHeatRegion(r, r.urls.map(url => input.clicks[url] || 0), 8, 1, true))
  const full = heat.heatCanvas(items, input.clicks, 1356, 728)
  assert.deepEqual(regions, full.snapshot.regions)
  const next = heat.solveHeatRegion(regions[0], regions[0].counts.map((n,i) => n + (i === 0 ? 1 : 0)), 8, 1)
  assert.ok(next.boxes[0].width * next.boxes[0].height >= regions[0].boxes[0].width * regions[0].boxes[0].height)
  assert.equal(heat.solveHeatRegion(regions[1], regions[1].counts, 8, 1), regions[1])
})
test("staged session preserves full height, resolves viewport jumps and updates URL copies together", () => {
  const duplicates = items.map((item,i) => ({ ...item, id: `copies-${i}`, url: i === 50 ? items[0].url : item.url }))
  const clicks = { [items[0].url]: 30 }
  const session = sessions.createHeatSession({ items: duplicates, clicks, width: 1356, available: 728, gap: 8, scale: 1 })
  const height = session.snapshot.height
  session.solve(session.visibleIndices(0, 700))
  assert.equal(session.snapshot.height, height)
  session.solve(session.pending)
  const before = session.snapshot
  session.update({ ...clicks, [items[0].url]: 31 }, [items[0].url])
  assert.equal(session.pending.size, 2)
  session.solve(session.pending)
  assert.equal(session.snapshot.regions[0].counts[0],31)
  assert.equal(session.snapshot.regions[2].counts[2],31)
  assert.equal(session.snapshot.regions[1],before.regions[1])
  assert.ok(session.visible(height - 400, height, "").length)
  assert.equal(session.box(duplicates[95].id).item.id,duplicates[95].id)
})
test("obsolete region work cannot overwrite a newer persisted click", () => {
  const fresh = items.map(item=>({...item,id:`stale-${item.id}`,url:item.url.replace('incremental','stale')}))
  const session = sessions.createHeatSession({ items:fresh, clicks: {}, width: 1356, available: 728, gap: 8, scale: 1 })
  session.solve(session.pending)
  session.update({ [fresh[0].url]: 1 })
  const old = sessions.solveRegionTasks(session.tasks(session.pending),8,1)
  session.update({ [fresh[0].url]: 2 })
  session.accept(old)
  assert.ok(session.pending.size)
  session.solve(session.pending)
  assert.equal(session.snapshot.regions[0].counts[0],2)
})
test("recovery preserves unknown documents while importing only validated sections", async () => {
  const values = { 'tabnest:settings': { schemaVersion: 999, data: {} }, 'tabnest:clicks': { schemaVersion: 1, revision: 3, data: { 'https://valid.test/': 45 } } }
  const tree = [{ id:'0', title:'', children:[{ id:'1', title:'书签栏', children:[{id:'2',title:'例子',url:'https://valid.test/'}] }] }]
  const file = { format:'tabnest-recovery', version:1, exportedAt:new Date().toISOString(), sections:{ bookmarks:{status:'ok',raw:tree},local:{status:'ok',raw:values},theme:{status:'ok',raw:'light'} } }
  const result = recovery.parseRecoveryFile(file)
  assert.equal(result.data.groups[0].items[0].title,'例子')
  assert.equal(result.preferences.settings,undefined)
  assert.equal(result.preferences.clicks['https://valid.test/'],45)
  assert.deepEqual(result.failures,['设置'])
  assert.equal(file.sections.local.raw['tabnest:settings'].schemaVersion,999)
})
test("theme reads fail safely and failed writes preserve storage", () => {
  globalThis.localStorage = { getItem(){throw Error('blocked')},setItem(){throw Error('quota')} }
  assert.equal(theme.readTheme(),'dark')
  assert.throws(() => theme.saveTheme('light'),/主题保存失败/)
})
test('compute protocol rejects mismatched identities and ignores canceled late results',async()=>{
 const originalWorker=globalThis.Worker,originalTimeout=globalThis.setTimeout
 const workers=[]
 globalThis.Worker=class {
  messages=[]
  constructor(){workers.push(this)}
  postMessage(message){this.messages.push(message)}
  terminate(){this.terminated=true}
  reply(request,changes={}){this.onmessage({data:{...request,value:'accepted',...changes}})}
 }
 globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===30000?1:ms,...args)
 try{
  const wrong=client.compute('heat-delta',{}, {session:1,dataRevision:2,requestRevision:3})
  const worker=workers[0]
  worker.reply(worker.messages[0],{session:99})
  await assert.rejects(wrong,/计算版本不兼容/)
  const abort=new AbortController()
  const canceled=client.compute('heat-viewport',{}, {session:1,dataRevision:2,requestRevision:4,signal:abort.signal})
  const obsolete=worker.messages.at(-1)
  abort.abort()
  await assert.rejects(canceled,{name:'AbortError'})
  assert.equal(worker.messages.at(-1).task,'cancel')
  worker.reply(obsolete)
  const newest=client.compute('heat-delta',{}, {session:1,dataRevision:2,requestRevision:5})
  worker.reply(worker.messages.at(-1))
  assert.equal(await newest,'accepted')
  await new Promise(resolve=>originalTimeout(resolve,10))
  assert.equal(worker.terminated,true)
 }finally{globalThis.Worker=originalWorker;globalThis.setTimeout=originalTimeout}
})
test('emergency export keeps corrupt and unknown raw documents without storage writes',async()=>{
 const values={'tabnest:settings':'{broken','tabnest:clicks':JSON.stringify({schemaVersion:999,revision:1,data:{}}),'theme':'unknown'}
 let writes=0
 globalThis.localStorage={...values,getItem(key){if(key==='tabnest:demo-bookmarks:v2')throw Error('unreadable bookmarks');return values[key]??null},setItem(){writes++}}
 const file=await recovery.createRecoveryFile()
 assert.equal(file.sections.bookmarks.status,'error')
 assert.equal(file.sections.local.raw['tabnest:settings'],'{broken')
 assert.equal(file.sections.local.raw['tabnest:clicks'],values['tabnest:clicks'])
 assert.equal(file.sections.theme.raw,'unknown')
 assert.equal(writes,0)
})

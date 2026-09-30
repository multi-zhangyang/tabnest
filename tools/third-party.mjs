import { readFile, writeFile, readdir, mkdir } from "node:fs/promises"
import { resolve } from "node:path"
const lock=JSON.parse(await readFile("package-lock.json","utf8"))
const entries=[]
for (const [path,entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue
  let pkg
  try { pkg=JSON.parse(await readFile(resolve(path,"package.json"),"utf8")) }
  catch (error) { if (entry.optional && error.code === "ENOENT") continue; throw error }
  const licenses=[]
  for (const file of await readdir(path)) if (/^(license|licence|copying|notice)(?:\.|$)/i.test(file)) {
    try { licenses.push({file,text:await readFile(resolve(path,file),"utf8")}) } catch { /* directory */ }
  }
  entries.push({name:pkg.name,version:pkg.version,license:pkg.license || entry.license || "SEE LICENSE",licenses})
}
await mkdir("docs/licenses",{recursive:true})
await writeFile("docs/licenses/third-party.json",JSON.stringify(entries,null,2)+"\n")
await writeFile("THIRD_PARTY_NOTICES.md",`# Third-party notices\n\nRuntime dependencies distributed with TabNest. Trademarks remain the property of their owners. Local brand assets retain [their notices](public/brands/LICENSE.txt).\n\n${entries.map(e=>`## ${e.name} ${e.version}\n\nLicense: ${e.license}\n\n${e.licenses.map(l=>`### ${l.file}\n\n\x60\x60\x60text\n${l.text.trim()}\n\x60\x60\x60\n`).join("\n")}`).join("\n")}\n`)

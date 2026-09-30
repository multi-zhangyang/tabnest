import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
const child=spawn(process.execPath,["tools/release.mjs"],{stdio:"inherit",windowsHide:true})
const code=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("exit",resolve)})
if(code)process.exit(code)
const release=JSON.parse(await readFile("artifacts/release-report.json","utf8"))
const batch=process.env.TEST_BATCH || `${release.version}-${Date.now()}`
await writeFile("artifacts/candidate.json",JSON.stringify({batch,...release},null,2))

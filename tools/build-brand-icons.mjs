import * as icons from "simple-icons"
import { mkdir, writeFile } from "node:fs/promises"

const brands = {
  github: ["siGithub", "ffffff", null],
  youtube: ["siYoutube", "ffffff", "ff0033"],
  taobao: ["siTaobao", "ffffff", "ff6900"],
  notion: ["siNotion", "191919", "ffffff"],
  douban: ["siDouban", "ffffff", "008b0b"],
  vercel: ["siVercel", "ffffff", "08090a"],
  gmail: ["siGmail", "EA4335", null],
  claude: ["siClaude", "ffffff", "c8795a"],
  gemini: ["siGooglegemini", "8e9bff", null],
  qwen: ["siQwen", "704dff", "ffffff"],
  zhihu: ["siZhihu", "ffffff", "087cff"],
  weibo: ["siSinaweibo", "ff4c46", null],
  bilibili: ["siBilibili", "ffffff", "ed648e"],
  vite: ["siVite", "b166ff", null],
  tailwind: ["siTailwindcss", "24c1d4", null],
  stackoverflow: ["siStackoverflow", "ffffff", "f48024"],
  figma: ["siFigma", "b993ff", "151515"],
  cloudflare: ["siCloudflare", "ffffff", "f78124"],
  aliyun: ["siAlibabacloud", "ff7800", null],
  mdn: ["siMdnwebdocs", "ffffff", "111a23"],
}
await mkdir("public/brands", { recursive: true })
for (const [name, [key, color, background]] of Object.entries(brands)) {
  const icon = icons[key]
  if (!icon) throw new Error(key)
  const path = icon.path
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${background ? `<rect width="64" height="64" rx="14" fill="#${background}"/>` : ""}<g transform="translate(${background ? 12 : 2} ${background ? 12 : 2}) scale(${background ? 40 / 24 : 60 / 24})"><path fill="#${color}" d="${path}"/></g></svg>`
  await writeFile(`public/brands/${name}.svg`, svg)
}
await writeFile(
  "public/brands/LICENSE.txt",
  "Brand paths from Simple Icons (CC0-1.0). https://simpleicons.org\nBrand marks are trademarks of their respective owners.\n"
)
for (const [name, domain] of [
  ["chatgpt.png", "chatgpt.com"],
  ["tencent.png", "cloud.tencent.com"],
  ["jd.png", "jd.com"],
  ["zai.svg", "z.ai"],
  ["gmail.ico", "mail.google.com"],
  ["figma.png", "figma.com"],
  ["gemini.png", "gemini.google.com"],
  ["vite.svg", "vite.dev"],
  ["taobao.png", "taobao.com"],
]) {
  try {
    const response = await fetch(`https://favicon.im/${domain}?larger=true`, {
      signal: AbortSignal.timeout(12000),
    })
    if (
      !response.ok ||
      !response.headers.get("content-type")?.startsWith("image/")
    )
      throw new Error(domain)
    await writeFile(
      `public/brands/${name}`,
      new Uint8Array(await response.arrayBuffer())
    )
    console.log(`Saved ${name}`)
  } catch (error) {
    console.warn(`Unavailable: ${name}`, error.message)
  }
}

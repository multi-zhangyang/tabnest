import { domainOf } from "./urls"

const brands: Record<string, [string, string]> = {
  "github.com": ["github.svg", "green"],
  "youtube.com": ["youtube.svg", "red"],
  "taobao.com": ["taobao.png", "orange"],
  "notion.so": ["notion.svg", "rose"],
  "notion.com": ["notion.svg", "rose"],
  "douban.com": ["douban.svg", "green"],
  "vercel.com": ["vercel.svg", "blue"],
  "mail.google.com": ["gmail.ico", "rust"],
  "claude.ai": ["claude.svg", "purple"],
  "gemini.google.com": ["gemini.png", "amber"],
  "tongyi.aliyun.com": ["qwen.svg", "rose"],
  "qwen.ai": ["qwen.svg", "purple"],
  "zhihu.com": ["zhihu.svg", "blue"],
  "weibo.com": ["weibo.svg", "blue"],
  "bilibili.com": ["bilibili.svg", "rose"],
  "vite.dev": ["vite.svg", "amber"],
  "tailwindcss.com": ["tailwind.svg", "green"],
  "stackoverflow.com": ["stackoverflow.svg", "green"],
  "figma.com": ["figma.png", "olive"],
  "cloudflare.com": ["cloudflare.svg", "rust"],
  "aliyun.com": ["aliyun.svg", "orange"],
  "developer.mozilla.org": ["mdn.svg", "blue"],
  "chatgpt.com": ["chatgpt.png", "purple"],
  "chat.openai.com": ["chatgpt.png", "purple"],
  "cloud.tencent.com": ["tencent.png", "olive"],
  "jd.com": ["jd.png", "red"],
  "z.ai": ["zai.svg", "blue"],
}

export function hash(value: string) {
  let result = 2166136261
  for (let i = 0; i < value.length; i++)
    result = Math.imul(result ^ value.charCodeAt(i), 16777619)
  result = Math.imul(result ^ (result >>> 16), 0x85ebca6b)
  result = Math.imul(result ^ (result >>> 13), 0xc2b2ae35)
  result ^= result >>> 16
  return result >>> 0
}

export function brandOf(url: string) {
  const domain = domainOf(url)
  const found = brands[domain]
  return {
    icon: found ? `./brands/${found[0]}` : undefined,
    tone:
      found?.[1] ||
      ["blue", "green", "orange", "rose", "purple", "amber", "olive", "rust"][
        hash(domain) % 8
      ],
  }
}

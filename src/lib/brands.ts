import { domainOf } from "./urls"

const brands: Record<string, [string, string]> = {
  "github.com": ["github.svg", "blue"],
  "youtube.com": ["youtube.svg", "red"],
  "taobao.com": ["taobao.png", "orange"],
  "notion.so": ["notion.svg", "purple"],
  "notion.com": ["notion.svg", "purple"],
  "douban.com": ["douban.svg", "green"],
  "vercel.com": ["vercel.svg", "blue"],
  "mail.google.com": ["gmail.ico", "red"],
  "claude.ai": ["claude.svg", "rust"],
  "gemini.google.com": ["gemini.png", "blue"],
  "tongyi.aliyun.com": ["qwen.svg", "rose"],
  "qwen.ai": ["qwen.svg", "purple"],
  "zhihu.com": ["zhihu.svg", "blue"],
  "weibo.com": ["weibo.svg", "amber"],
  "bilibili.com": ["bilibili.svg", "rose"],
  "vite.dev": ["vite.svg", "purple"],
  "tailwindcss.com": ["tailwind.svg", "green"],
  "stackoverflow.com": ["stackoverflow.svg", "orange"],
  "figma.com": ["figma.png", "rose"],
  "cloudflare.com": ["cloudflare.svg", "amber"],
  "aliyun.com": ["aliyun.svg", "orange"],
  "developer.mozilla.org": ["mdn.svg", "blue"],
  "chatgpt.com": ["chatgpt.png", "green"],
  "chat.openai.com": ["chatgpt.png", "green"],
  "cloud.tencent.com": ["tencent.png", "blue"],
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

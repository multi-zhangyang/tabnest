import type { BookmarkGroup, BookmarkItem } from "./types"

export function demoGroups(): BookmarkGroup[] {
  const bm = (
    id: string,
    title: string,
    url: string,
    daysAgo: number
  ): BookmarkItem => ({
    id,
    title,
    url,
    dateAdded: Date.now() - daysAgo * 86400000,
  })
  return [
    {
      name: "常用",
      items: [
        bm("b1", "GitHub", "https://github.com", 30),
        bm("b2", "知乎", "https://www.zhihu.com", 12),
        bm("b3", "哔哩哔哩", "https://www.bilibili.com", 1),
        bm("b4", "YouTube", "https://www.youtube.com", 5),
        bm("b5", "Gmail", "https://mail.google.com", 3),
      ],
    },
    {
      name: "AI-Space",
      items: [
        bm("a1", "ChatGPT", "https://chat.openai.com", 2),
        bm("a2", "Claude", "https://claude.ai", 2),
        bm("a3", "Gemini", "https://gemini.google.com", 6),
        bm("a4", "Z.ai", "https://z.ai", 9),
        bm("a5", "通义千问", "https://tongyi.aliyun.com", 15),
      ],
    },
    {
      name: "开发工具",
      items: [
        bm("d1", "MDN Web Docs", "https://developer.mozilla.org", 20),
        bm("d2", "Vite", "https://vite.dev", 4),
        bm("d3", "Tailwind CSS", "https://tailwindcss.com", 7),
        bm("d4", "Stack Overflow", "https://stackoverflow.com", 11),
        bm("d5", "Figma", "https://www.figma.com", 8),
        bm("d6", "Notion", "https://www.notion.so", 13),
      ],
    },
    {
      name: "云厂商",
      items: [
        bm("c1", "Vercel", "https://vercel.com", 10),
        bm("c2", "Cloudflare", "https://www.cloudflare.com", 14),
        bm("c3", "阿里云", "https://www.aliyun.com", 18),
        bm("c4", "腾讯云", "https://cloud.tencent.com", 22),
      ],
    },
    {
      name: "生活",
      items: [
        bm("l1", "淘宝", "https://www.taobao.com", 16),
        bm("l2", "京东", "https://www.jd.com", 17),
        bm("l3", "豆瓣", "https://www.douban.com", 25),
        bm("l4", "微博", "https://weibo.com", 26),
      ],
    },
  ].map((group) => ({
    ...group,
    id: `demo-${group.name}`,
    items: group.items.map((item, index) => ({
      ...item,
      parentId: `demo-${group.name}`,
      index,
    })),
  }))
}

export const DEMO_CLICKS: Record<string, number> = {
  "https://www.youtube.com": 96,
  "https://github.com": 74,
  "https://chat.openai.com": 58,
  "https://www.taobao.com": 31,
  "https://www.notion.so": 24,
  "https://www.douban.com": 19,
  "https://claude.ai": 17,
  "https://mail.google.com": 14,
  "https://www.zhihu.com": 11,
  "https://gemini.google.com": 9,
  "https://www.bilibili.com": 7,
  "https://developer.mozilla.org": 6,
  "https://tailwindcss.com": 5,
  "https://vite.dev": 4,
  "https://www.figma.com": 3,
  "https://stackoverflow.com": 2,
  "https://www.cloudflare.com": 2,
  "https://cloud.tencent.com": 1,
  "https://vercel.com": 1,
  "https://z.ai": 1,
}

export function sectionFixture() {
  const sections = [
    [
      "native-bar",
      "书签栏",
      [
        ["GitHub", "github.com"],
        ["哔哩哔哩", "www.bilibili.com"],
        ["YouTube", "www.youtube.com"],
        ["知乎", "www.zhihu.com"],
        ["豆瓣", "www.douban.com"],
        ["淘宝", "www.taobao.com"],
        ["京东", "www.jd.com"],
        ["微博", "weibo.com"],
        ["Figma", "www.figma.com"],
        ["Notion", "www.notion.so"],
        ["MDN Web Docs", "developer.mozilla.org"],
      ],
    ],
    [
      "folder-ai",
      "AI-Space",
      [
        ["ChatGPT", "chat.openai.com"],
        ["Claude", "claude.ai"],
        ["Gemini", "gemini.google.com"],
        ["Z.ai", "z.ai"],
        ["通义千问", "tongyi.aliyun.com"],
        ["DeepSeek", "chat.deepseek.com"],
        ["Perplexity", "www.perplexity.ai"],
        ["Grok", "grok.com"],
        ["Kimi", "www.kimi.com"],
        ["Hugging Face", "huggingface.co"],
      ],
    ],
    [
      "folder-mail",
      "E-Mail",
      [
        ["Gmail", "mail.google.com"],
        ["Outlook", "outlook.live.com"],
      ],
    ],
    [
      "folder-cloud",
      "云厂商",
      [
        ["Vercel", "vercel.com"],
        ["Cloudflare", "www.cloudflare.com"],
        ["阿里云", "www.aliyun.com"],
        ["腾讯云", "cloud.tencent.com"],
        ["Amazon Web Services", "aws.amazon.com"],
      ],
    ],
    [
      "folder-other",
      "Anything Else",
      [
        ["Vite", "vite.dev"],
        ["Tailwind CSS", "tailwindcss.com"],
        ["Stack Overflow", "stackoverflow.com"],
        ["Dribbble", "dribbble.com"],
        ["Pinterest", "www.pinterest.com"],
        ["Linear", "linear.app"],
        ["掘金", "juejin.cn"],
        ["Unsplash", "unsplash.com"],
        ["少数派", "sspai.com"],
      ],
    ],
  ]
  const folders = sections.map(([id, title], index) => ({
    id,
    title,
    path: index === 0 ? title : `书签栏 / ${title}`,
    parentId: index === 0 ? "0" : "native-bar",
    ...(index === 0 ? { root: true, folderType: "bookmarks-bar" } : {}),
  }))
  folders.push({
    id: "native-other",
    title: "其他书签",
    path: "其他书签",
    parentId: "0",
    root: true,
    folderType: "other",
  })
  const groups = sections.map(([id, , sites]) => ({
    id,
    name: folders.find((folder) => folder.id === id).path,
    items: sites.map(([title, domain], index) => ({
      id: `${id}-${index}`,
      parentId: id,
      title,
      url: `https://${domain}/`,
      index,
      dateAdded: 1750000000000 + index * 1000,
    })),
  }))
  groups.push({ id: "native-other", name: "其他书签", items: [] })
  return { folders, groups }
}

import assert from "node:assert/strict"
import { mkdir, writeFile,readFile } from "node:fs/promises"
import {resolve} from 'node:path'
import { launchBrowser, openPreview, servePreview } from "./runtime.mjs"
import { openSearch } from "./search-helpers.mjs"

// Public sample sites only. This fixture never reads a Chrome bookmark tree.
const sections = [
  [
    "开发文档",
    [
      ["MDN Web Docs", "https://developer.mozilla.org/zh-CN/", 32],
      ["Vite", "https://vite.dev/guide/", 15],
      ["Tailwind CSS", "https://tailwindcss.com/docs", 24],
      ["Stack Overflow", "https://stackoverflow.com/", 9],
    ],
  ],
  [
    "工作空间",
    [
      ["GitHub", "https://github.com/", 72],
      ["Figma", "https://www.figma.com/", 36],
      ["Notion", "https://www.notion.so/", 48],
      ["Gmail", "https://mail.google.com/", 12],
    ],
  ],
  [
    "AI 工作台",
    [
      ["ChatGPT", "https://chatgpt.com/", 56],
      ["Claude", "https://claude.ai/", 28],
      ["Gemini", "https://gemini.google.com/", 8],
      ["通义千问", "https://tongyi.aliyun.com/", 4],
    ],
  ],
  [
    "云端部署",
    [
      ["Vercel", "https://vercel.com/", 18],
      ["Cloudflare", "https://www.cloudflare.com/", 10],
      ["阿里云", "https://www.aliyun.com/", 3],
      ["腾讯云", "https://cloud.tencent.com/", 2],
    ],
  ],
  [
    "阅读与社区",
    [
      ["知乎", "https://www.zhihu.com/", 16],
      ["豆瓣", "https://www.douban.com/", 7],
      ["哔哩哔哩", "https://www.bilibili.com/", 20],
      ["YouTube", "https://www.youtube.com/", 44],
    ],
  ],
  [
    "灵感收藏",
    [
      ["Figma Community", "https://www.figma.com/community", 5],
      ["GitHub Explore", "https://github.com/explore", 2],
      ["Notion 模板", "https://www.notion.so/templates", 1],
      ["MDN CSS", "https://developer.mozilla.org/zh-CN/docs/Web/CSS", 0],
    ],
  ],
]
const folders = [
  {
    id: "sample-bar",
    title: "书签栏",
    path: "书签栏",
    parentId: "0",
    root: true,
    folderType: "bookmarks-bar",
  },
]
const clicks = {},
  groups = [{ id: "sample-bar", name: "书签栏", items: [] }]
for (const [index, [title, sites]] of sections.entries()) {
  const id = `sample-folder-${index}`,
    path = `书签栏 / ${title}`
  folders.push({ id, title, path, parentId: "sample-bar", index })
  groups.push({
    id,
    name: path,
    items: sites.map(([title, url, count], i) => {
      clicks[url] = count
      return {
        id: `sample-${index}-${i}`,
        title,
        url,
        parentId: id,
        index: i,
        dateAdded: 1750000000000 + i * 1000,
      }
    }),
  })
}
folders.push({
  id: "sample-other",
  title: "其他书签",
  path: "其他书签",
  parentId: "0",
  root: true,
  folderType: "other",
})
groups.push({ id: "sample-other", name: "其他书签", items: [] })
assert.ok(
  !process.env.TEST_URL,
  "Documentation captures must use the isolated local preview"
)
const preview = await servePreview(),
  browser = await launchBrowser(),
  errors = []
try {
  const page = await browser.newPage()
  const store=process.env.STORE_SCREENSHOTS==='1'
  if(store)await page.setViewport({width:1280,height:800,deviceScaleFactor:1})
  page.on("pageerror", (e) => errors.push(e.message))
  await page.setRequestInterception(true)
  page.on("request", (request) => {
    if (
      request.url().startsWith(preview.url) ||
      /^(data|blob):/.test(request.url())
    )
      void request.continue()
    else void request.abort()
  })
  await openPreview(page, preview.url)
  await page.evaluate(
    ({ groups, folders, clicks }) => {
      localStorage.clear()
      const save = (key, data) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            schemaVersion: 1,
            revision: 1,
            updatedAt: "2026-09-28T00:00:00.000Z",
            data,
          })
        )
      save("tabnest:demo-bookmarks:v2", { groups, folders })
      save("tabnest:clicks", clicks)
      save("tabnest:settings", { layout: "heat", onlineIcons: false })
      localStorage.setItem("theme", "light")
    },
    { groups, folders, clicks }
  )
  await mkdir("docs/images", { recursive: true })
  if(store)await mkdir('docs/store/screenshots',{recursive:true})
  const shots = []
  async function capture(name) {
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(
        [...document.images].map((img) => img.decode().catch(() => {}))
      )
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      ),
      false
    )
    const path = `docs/images/${name}.webp`
    await page.screenshot({ path, type: "webp", quality: 88 })
    if(store)await page.screenshot({path:`docs/store/screenshots/${name}.png`})
    shots.push(path)
  }
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => localStorage.setItem("theme", theme), theme)
    await page.reload()
    await page.waitForSelector(".bookmark-card")
    await page.locator('[aria-label="书签拼图"]').click()
    await page.waitForSelector(".heat-card")
    await capture(`mosaic-${theme}`)
    await page.locator('[aria-label="文件夹视图"]').click()
    await page.waitForSelector(".section-board")
    assert.equal(
      await page.$eval(
        ".section-board",
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length
      ),
      3
    )
    await capture(`folders-${theme}`)
  }
  await openSearch(page, "wendang")
  await page.waitForSelector('[data-value^="folder:"]')
  await capture("search-dark")
  await page.keyboard.press("Escape")
  await page.locator('[aria-label="新建"]').click()
  const item = await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="menuitem"]')].find(
      (e) => e.textContent === "新建书签"
    )
  )
  await item.asElement().asLocator().click()
  await page.waitForSelector("#bookmark-url")
  await capture("editor-dark")
  assert.deepEqual(errors, [])
  await writeFile(
    "artifacts/docs-screenshots.json",
    JSON.stringify(
      {
        source: "tools/docs-screenshots.mjs",
        personalBookmarks: false,
        count: 24,
        viewport: store?'1280 × 800':"1440 × 900",
        shots,
        errors,
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ screenshots: shots, errors }))
  if(store){
    const candidate=JSON.parse(await readFile('artifacts/candidate.json','utf8'))
    await writeFile('docs/store/screenshots/metadata.json',JSON.stringify({version:candidate.version,buildId:candidate.buildId,extensionSha256:candidate.sha256,viewport:'1280×800',fixture:'public sample bookmarks',personalBookmarks:false,files:shots.map(path=>resolve(path).split(/[\\/]/).at(-1).replace('.webp','.png'))},null,2))
  }
} finally {
  await browser.close()
  await preview.close()
}

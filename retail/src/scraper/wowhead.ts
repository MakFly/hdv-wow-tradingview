import type { Page } from "playwright"
import { newPage } from "./browser"
import { htmlToMarkdown } from "./parser"
import { upsert } from "../db"

const BASE = "https://www.wowhead.com/fr"

type GuideLink = {
  url: string
  category: string
  spec?: string
  className?: string
}

const GUIDE_PATHS: GuideLink[] = [
  // Class guides — will be expanded dynamically
  { url: "/guides/classes", category: "class-overview" },
  // M+ guides
  { url: "/guides/mythic-plus", category: "m+" },
  // Raid guides
  { url: "/guides/raids", category: "raid" },
  // Gearing
  { url: "/guides/gearing", category: "gear" },
]

async function extractGuideLinks(page: Page, path: string, category: string): Promise<GuideLink[]> {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 })
  await page.waitForTimeout(2000)

  const links = await page.evaluate((cat) => {
    const anchors = document.querySelectorAll<HTMLAnchorElement>(
      ".guide-list a, .guides-list a, .listview-row a, article a[href*='/guide']"
    )
    return Array.from(anchors)
      .map((a) => ({ url: a.href, title: a.textContent?.trim() ?? "" }))
      .filter((l) => l.url.includes("/guide") || l.url.includes("/guides/"))
      .map((l) => ({
        url: new URL(l.url).pathname,
        category: cat,
      }))
  }, category)

  return links
}

async function scrapeGuidePage(page: Page, url: string): Promise<{ title: string; content: string } | null> {
  try {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 30_000 })
    await page.waitForTimeout(2000)

    const result = await page.evaluate(() => {
      const titleEl = document.querySelector("h1, .heading-size-1")
      const contentEl =
        document.querySelector(".guide-body") ??
        document.querySelector("#guide-body") ??
        document.querySelector("article") ??
        document.querySelector(".text")

      if (!titleEl || !contentEl) return null

      return {
        title: titleEl.textContent?.trim() ?? "",
        content: contentEl.innerHTML,
      }
    })

    if (!result) return null
    return { title: result.title, content: htmlToMarkdown(result.content) }
  } catch {
    return null
  }
}

export async function scrapeWowhead(maxGuides = 30) {
  console.log("⏳ Scraping Wowhead FR guides...")
  const page = await newPage()
  let scraped = 0

  try {
    const allLinks: GuideLink[] = []

    for (const guide of GUIDE_PATHS) {
      const links = await extractGuideLinks(page, guide.url, guide.category)
      allLinks.push(...links)
    }

    const unique = [...new Map(allLinks.map((l) => [l.url, l])).values()].slice(
      0,
      maxGuides
    )

    for (const link of unique) {
      const result = await scrapeGuidePage(page, link.url)
      if (!result) continue

      upsert(
        "guides",
        {
          url: `${BASE}${link.url}`,
          source: "wowhead",
          category: link.category,
          spec: link.spec ?? null,
          class: link.className ?? null,
          title: result.title,
          content_md: result.content,
          scraped_at: Date.now(),
          updated_at: Date.now(),
        },
        "url"
      )
      scraped++
    }
  } finally {
    await page.close()
  }

  console.log(`✓ ${scraped} guides from Wowhead FR`)
}

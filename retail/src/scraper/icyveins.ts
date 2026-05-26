import type { Page } from "playwright"
import { newPage } from "./browser"
import { htmlToMarkdown } from "./parser"
import { upsert } from "../db"

const BASE = "https://www.icy-veins.com/wow/fr"

type GuideLink = {
  url: string
  category: string
  spec?: string
  className?: string
}

const CATEGORIES = [
  { path: "/guides-classes", category: "class" },
  { path: "/guides-donjons-mythique-plus", category: "m+" },
  { path: "/guides-raids", category: "raid" },
]

async function extractLinks(page: Page, path: string, category: string): Promise<GuideLink[]> {
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 })
    await page.waitForTimeout(2000)

    const links = await page.evaluate((cat) => {
      const anchors = document.querySelectorAll<HTMLAnchorElement>(
        "a[href*='guide'], a[href*='builds'], .nav-content a"
      )
      return Array.from(anchors)
        .map((a) => ({ url: a.href, title: a.textContent?.trim() ?? "" }))
        .filter((l) => l.url.includes("guide") || l.url.includes("builds"))
        .map((l) => ({
          url: new URL(l.url).pathname,
          category: cat,
        }))
    }, category)

    return links
  } catch {
    return []
  }
}

async function scrapeGuidePage(page: Page, fullUrl: string): Promise<{ title: string; content: string } | null> {
  try {
    await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
    await page.waitForTimeout(2000)

    const result = await page.evaluate(() => {
      const titleEl = document.querySelector("h1, .page-title")
      const contentEl =
        document.querySelector(".guide-content") ??
        document.querySelector(".page-content") ??
        document.querySelector("article") ??
        document.querySelector("main .content")

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

export async function scrapeIcyVeins(maxGuides = 30) {
  console.log("⏳ Scraping Icy Veins FR guides...")
  const page = await newPage()
  let scraped = 0

  try {
    const allLinks: GuideLink[] = []

    for (const cat of CATEGORIES) {
      const links = await extractLinks(page, cat.path, cat.category)
      allLinks.push(...links)
    }

    const unique = [...new Map(allLinks.map((l) => [l.url, l])).values()].slice(
      0,
      maxGuides
    )

    for (const link of unique) {
      const fullUrl = link.url.startsWith("http")
        ? link.url
        : `https://www.icy-veins.com${link.url}`

      const result = await scrapeGuidePage(page, fullUrl)
      if (!result) continue

      upsert(
        "guides",
        {
          url: fullUrl,
          source: "icyveins",
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

  console.log(`✓ ${scraped} guides from Icy Veins FR`)
}

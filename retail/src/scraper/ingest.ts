import { scrapeWowhead } from "./wowhead"
import { scrapeIcyVeins } from "./icyveins"
import { closeBrowser } from "./browser"
import { closeDb } from "../db"

export async function ingestGuides(maxPerSource = 30) {
  const start = Date.now()
  console.log("🚀 Starting guide scraping (FR)\n")

  try {
    await scrapeWowhead(maxPerSource)
    await scrapeIcyVeins(maxPerSource)

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`\n✅ Guide scraping complete in ${elapsed}s`)
  } catch (e) {
    console.error("\n❌ Guide scraping failed:", e)
    throw e
  } finally {
    await closeBrowser()
    closeDb()
  }
}

import { ingestClasses } from "./endpoints/classes"
import { ingestTalents } from "./endpoints/talents"
import { ingestSpells } from "./endpoints/spells"
import { ingestDungeons, ingestMythicKeystone } from "./endpoints/dungeons"
import { ingestAchievements } from "./endpoints/achievements"
import { ingestProfessions } from "./endpoints/professions"
import { closeDb } from "../db"

export async function ingestAll() {
  const start = Date.now()
  console.log("🚀 Starting Blizzard API ingestion (locale=fr_FR, region=eu)\n")

  try {
    await ingestClasses()
    await ingestTalents()
    await ingestSpells()
    await ingestDungeons()
    await ingestMythicKeystone()
    await ingestAchievements()
    await ingestProfessions()

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`\n✅ Ingestion complete in ${elapsed}s`)
  } catch (e) {
    console.error("\n❌ Ingestion failed:", e)
    throw e
  } finally {
    closeDb()
  }
}

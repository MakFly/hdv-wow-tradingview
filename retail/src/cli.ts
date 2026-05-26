import "./config"
import { Command } from "commander"
import { ingestAll } from "./blizzard/ingest"
import { ingestGuides } from "./scraper/ingest"
import { search, getClassInfo, getDungeonInfo, getMplusMeta } from "./search"
import { closeDb } from "./db"

const program = new Command()
  .name("wow-knowledge")
  .description("WoW Retail knowledge base — FR")
  .version("0.1.0")

program
  .command("ingest")
  .argument("<source>", "blizzard | guides | all")
  .option("--max <n>", "max guides per source", "30")
  .action(async (source: string, opts: { max: string }) => {
    if (source === "blizzard" || source === "all") {
      await ingestAll()
    }
    if (source === "guides" || source === "all") {
      await ingestGuides(Number(opts.max))
    }
    closeDb()
  })

program
  .command("search")
  .argument("<query...>", "search terms")
  .option("-n, --limit <n>", "max results", "15")
  .action((queryParts: string[], opts: { limit: string }) => {
    const query = queryParts.join(" ")
    const results = search(query, Number(opts.limit))

    if (results.length === 0) {
      console.log(`Aucun résultat pour "${query}"`)
      return
    }

    console.log(`\n🔍 Résultats pour "${query}" (${results.length}):\n`)
    for (const r of results) {
      const badge = `[${r.type.toUpperCase()}]`.padEnd(14)
      const desc = r.description
        ? `  ${r.description.slice(0, 100)}${r.description.length > 100 ? "…" : ""}`
        : ""
      console.log(`${badge} ${r.name}`)
      if (desc) console.log(`              ${desc}`)
      console.log()
    }
    closeDb()
  })

program
  .command("class")
  .argument("<class>", "class name (fr)")
  .argument("[spec]", "spec name (fr)")
  .action((className: string, specName?: string) => {
    const info = getClassInfo(className, specName)
    if (!info) {
      console.log(`Classe "${className}" non trouvée.`)
      return
    }

    console.log(`\n⚔️  ${info.class.name}`)
    console.log(`   Type de puissance: ${info.class.power_type ?? "—"}`)
    console.log(`\n   Spécialisations:`)
    for (const s of info.specs) {
      console.log(`   - ${s.name} (${s.role ?? "?"})`)
      if (s.description) console.log(`     ${(s.description as string).slice(0, 120)}`)
    }

    if (info.talents.length > 0) {
      console.log(`\n   Talents (${info.talents.length}):`)
      for (const t of info.talents.slice(0, 20)) {
        console.log(`   [${t.tier},${t.col}] ${t.name}`)
        if (t.description) console.log(`           ${(t.description as string).slice(0, 100)}`)
      }
      if (info.talents.length > 20) {
        console.log(`   ... et ${info.talents.length - 20} de plus`)
      }
    }
    closeDb()
  })

program
  .command("dungeon")
  .argument("<name>", "dungeon name (fr)")
  .action((name: string) => {
    const info = getDungeonInfo(name)
    if (!info) {
      console.log(`Donjon "${name}" non trouvé.`)
      return
    }

    console.log(`\n🏰 ${info.dungeon.name}`)
    console.log(`   Type: ${info.dungeon.instance_type ?? "?"}`)
    console.log(`   Extension: ${info.dungeon.expansion ?? "?"}`)
    if (info.dungeon.description) {
      console.log(`   ${(info.dungeon.description as string).slice(0, 200)}`)
    }

    if (info.encounters.length > 0) {
      console.log(`\n   Boss (${info.encounters.length}):`)
      for (const e of info.encounters) {
        console.log(`   - ${e.name}`)
      }
    }

    if (info.guides.length > 0) {
      console.log(`\n   Guides associés:`)
      for (const g of info.guides) {
        console.log(`   📖 ${g.title} [${g.source}]`)
        console.log(`      ${g.url}`)
      }
    }
    closeDb()
  })

program
  .command("meta")
  .argument("<type>", "m+")
  .action((type: string) => {
    if (type === "m+" || type === "mplus") {
      const info = getMplusMeta()
      console.log(`\n🗝️  Donjons M+ actuels (${info.dungeons.length}):`)
      for (const d of info.dungeons) {
        console.log(`   - ${d.name}`)
      }
      if (info.latestMeta) {
        console.log(`\n   Dernière meta snapshot: ${new Date(info.latestMeta.captured_at as number).toLocaleDateString("fr-FR")}`)
      }
    } else {
      console.log(`Type "${type}" non supporté. Disponible: m+`)
    }
    closeDb()
  })

program.parse()

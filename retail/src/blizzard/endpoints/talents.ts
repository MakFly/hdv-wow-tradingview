import { bnetGetWithRetry } from "../client"
import { getDb, upsertMany } from "../../db"

type TalentTreeIndex = {
  spec_talent_trees: Array<{
    key: { href: string }
    name: string
  }>
  class_talent_trees: Array<{
    key: { href: string }
    name: string
  }>
}

type TalentTree = {
  id: number
  playable_class: { id: number }
  playable_specialization?: { id: number }
  talent_nodes: Array<{
    id: number
    node_type: { type: string }
    ranks: Array<{
      rank: number
      tooltip: {
        talent: { id: number; name: string }
        spell_tooltip: { description?: string }
      }
    }>
    display_row: number
    display_col: number
  }>
}

export async function ingestTalents() {
  console.log("⏳ Ingesting talent trees...")

  const index = await bnetGetWithRetry<TalentTreeIndex>(
    "/data/wow/talent/tree/index"
  )
  if (!index) return

  const talentRows: Record<string, unknown>[] = []
  const seen = new Set<number>()

  const db = getDb()
  const specs = db.query("SELECT id, class_id FROM specs").all() as Array<{
    id: number
    class_id: number
  }>

  for (const spec of specs) {
    const tree = await bnetGetWithRetry<TalentTree>(
      `/data/wow/talent/tree/${spec.class_id}/playable-specialization/${spec.id}`
    )
    if (!tree?.talent_nodes) continue

    for (const node of tree.talent_nodes) {
      if (!node.ranks?.length) continue
      const rank = node.ranks[0]
      const talentId = rank.tooltip?.talent?.id
      if (!talentId || seen.has(talentId)) continue
      seen.add(talentId)

      talentRows.push({
        id: talentId,
        spec_id: spec.id,
        class_id: spec.class_id,
        name: rank.tooltip.talent.name,
        description: rank.tooltip.spell_tooltip?.description ?? null,
        tier: node.display_row,
        col: node.display_col,
        node_type: node.node_type?.type ?? null,
        tree_type: "spec",
      })
    }
  }

  upsertMany("talents", talentRows)
  console.log(`✓ ${talentRows.length} talents`)
}

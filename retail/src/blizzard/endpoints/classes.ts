import { bnetGetWithRetry } from "../client"
import { upsertMany } from "../../db"

type ClassIndex = {
  classes: Array<{ id: number; name: string; key: { href: string } }>
}

type ClassDetail = {
  id: number
  name: string
  power_type: { name: string }
  specializations: Array<{ id: number; name: string; key: { href: string } }>
}

type SpecDetail = {
  id: number
  name: string
  playable_class: { id: number }
  role: { type: string; name: string }
  description?: string
}

export async function ingestClasses() {
  console.log("⏳ Ingesting classes...")
  const index = await bnetGetWithRetry<ClassIndex>("/data/wow/playable-class/index")
  if (!index?.classes) return

  const classRows: Record<string, unknown>[] = []
  const specRows: Record<string, unknown>[] = []

  for (const cls of index.classes) {
    const detail = await bnetGetWithRetry<ClassDetail>(
      `/data/wow/playable-class/${cls.id}`
    )
    if (!detail) continue

    classRows.push({
      id: detail.id,
      name: detail.name,
      power_type: detail.power_type?.name ?? null,
    })

    if (detail.specializations) {
      for (const spec of detail.specializations) {
        const specDetail = await bnetGetWithRetry<SpecDetail>(
          `/data/wow/playable-specialization/${spec.id}`
        )
        if (!specDetail) continue

        specRows.push({
          id: specDetail.id,
          class_id: specDetail.playable_class.id,
          name: specDetail.name,
          role: specDetail.role?.name ?? null,
          description: specDetail.description ?? null,
        })
      }
    }
  }

  upsertMany("classes", classRows)
  upsertMany("specs", specRows)
  console.log(`✓ ${classRows.length} classes, ${specRows.length} specs`)
}

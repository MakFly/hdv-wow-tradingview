import { useEffect, useState } from "react"
import { Badge } from "./ui/badge"
import { Skeleton } from "./ui/skeleton"

const API = import.meta.env.VITE_API_URL || ""

type EquipItem = {
  slot_type: string
  slot: string
  id: number
  name: string
  quality: string
  quality_name: string
  ilvl: number
  enchant: string | null
  gems: string[]
}

type CharMedia = {
  render: string | null
  avatar: string | null
  inset: string | null
}

type CharStats = {
  health?: number
  power?: number
  power_type?: { name: string }
  strength?: { effective: number }
  agility?: { effective: number }
  intellect?: { effective: number }
  stamina?: { effective: number }
  mastery?: { rating: number; value: number }
  versatility?: number
  versatility_damage_done_bonus?: number
  melee_crit?: { rating: number; value: number }
  melee_haste?: { rating: number; value: number }
  spell_crit?: { rating: number; value: number }
  spell_haste?: { rating: number; value: number }
  armor?: { effective: number }
  speed?: { rating: number }
  avoidance?: { rating: number }
}

const QUALITY_BG: Record<string, string> = {
  POOR: "from-gray-800/80 to-gray-900/80 border-gray-600/60",
  COMMON: "from-gray-700/80 to-gray-800/80 border-gray-500/60",
  UNCOMMON: "from-green-950/80 to-green-900/50 border-green-500/60",
  RARE: "from-blue-950/80 to-blue-900/50 border-blue-500/60",
  EPIC: "from-purple-950/80 to-purple-900/50 border-purple-500/60",
  LEGENDARY: "from-orange-950/80 to-orange-900/50 border-orange-500/60",
  ARTIFACT: "from-amber-950/80 to-amber-900/50 border-amber-400/60",
  HEIRLOOM: "from-cyan-950/80 to-cyan-900/50 border-cyan-500/60",
}

const QUALITY_TEXT: Record<string, string> = {
  POOR: "text-gray-400",
  COMMON: "text-gray-100",
  UNCOMMON: "text-green-400",
  RARE: "text-blue-400",
  EPIC: "text-purple-400",
  LEGENDARY: "text-orange-400",
  ARTIFACT: "text-amber-300",
  HEIRLOOM: "text-cyan-300",
}

const LEFT_SLOTS = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST"]
const RIGHT_SLOTS = ["HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2"]
const BOTTOM_SLOTS = ["MAIN_HAND", "OFF_HAND"]

const SLOT_FR: Record<string, string> = {
  HEAD: "Tête",
  NECK: "Cou",
  SHOULDER: "Épaules",
  BACK: "Dos",
  CHEST: "Torse",
  SHIRT: "Chemise",
  TABARD: "Tabard",
  WRIST: "Poignets",
  HANDS: "Mains",
  WAIST: "Taille",
  LEGS: "Jambes",
  FEET: "Pieds",
  FINGER_1: "Anneau 1",
  FINGER_2: "Anneau 2",
  TRINKET_1: "Bijou 1",
  TRINKET_2: "Bijou 2",
  MAIN_HAND: "Main droite",
  OFF_HAND: "Main gauche",
}

function GearSlot({ item, slot, side }: { item?: EquipItem; slot: string; side: "left" | "right" | "bottom" }) {
  const label = SLOT_FR[slot] ?? slot
  const isRight = side === "right"

  if (!item) {
    return (
      <div className={`flex items-center gap-2 min-h-[48px] rounded border border-dashed border-white/10 bg-black/30 px-2 py-1 ${isRight ? "flex-row-reverse text-right" : ""}`}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-white/10 bg-black/50">
          <span className="text-[9px] text-white/20">—</span>
        </div>
        <span className="text-[10px] text-white/30">{label}</span>
      </div>
    )
  }

  const bg = QUALITY_BG[item.quality] ?? QUALITY_BG.COMMON
  const textColor = QUALITY_TEXT[item.quality] ?? "text-white"

  return (
    <div
      className={`group relative flex items-center gap-2 min-h-[48px] rounded border bg-gradient-to-r px-2 py-1 transition-all hover:scale-[1.02] hover:shadow-lg ${bg} ${isRight ? "flex-row-reverse text-right" : ""}`}
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded border bg-black/60 font-mono text-[11px] font-bold text-white ${bg.includes("border") ? "" : "border-white/20"}`}>
        {item.ilvl}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] uppercase tracking-wider text-white/40">{label}</div>
        <div className={`truncate text-xs font-semibold leading-tight ${textColor}`}>
          {item.name}
        </div>
        {item.enchant && (
          <div className="truncate text-[9px] text-emerald-400">{item.enchant}</div>
        )}
        {item.gems.length > 0 && (
          <div className="truncate text-[9px] text-sky-300">{item.gems.join(", ")}</div>
        )}
      </div>
    </div>
  )
}

export function CharacterSheet({
  realm,
  name,
  className,
  level,
  race,
  faction,
  specName,
}: {
  realm: string
  name: string
  className?: string
  level?: number
  race?: string
  faction?: string
  specName?: string
}) {
  const [equipment, setEquipment] = useState<EquipItem[]>([])
  const [media, setMedia] = useState<CharMedia | null>(null)
  const [stats, setStats] = useState<CharStats | null>(null)
  const [loading, setLoading] = useState(true)

  const charPath = `${realm}/${encodeURIComponent(name.toLowerCase())}`

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/api/me/character/${charPath}/equipment?region=eu`).then((r) => r.ok ? r.json() : null),
      fetch(`${API}/api/me/character/${charPath}/media?region=eu`).then((r) => r.ok ? r.json() : null),
      fetch(`${API}/api/me/character/${charPath}/stats?region=eu`).then((r) => r.ok ? r.json() : null),
    ]).then(([eq, med, st]) => {
      setEquipment(eq?.items ?? [])
      setMedia(med)
      setStats(st)
    }).finally(() => setLoading(false))
  }, [charPath])

  const bySlot = new Map(equipment.map((i) => [i.slot_type, i]))
  const gearItems = equipment.filter((i) => !["SHIRT", "TABARD"].includes(i.slot_type))
  const avgIlvl = gearItems.length > 0
    ? Math.round(gearItems.reduce((s, i) => s + i.ilvl, 0) / gearItems.length)
    : 0

  if (loading) {
    return (
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-b from-slate-900 via-slate-950 to-black p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_200px_1fr]">
          <Skeleton className="h-[420px] bg-white/5" />
          <Skeleton className="h-[420px] bg-white/5" />
          <Skeleton className="h-[420px] bg-white/5" />
        </div>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-b from-slate-900 via-slate-950 to-black">
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-amber-900/5 via-transparent to-transparent" />

      {/* Header */}
      <div className="relative flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        {media?.avatar && (
          <img
            src={media.avatar}
            alt={name}
            className="h-12 w-12 rounded-full ring-2 ring-amber-500/50 sm:h-14 sm:w-14"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-white sm:text-xl">{name}</h2>
          <p className="text-xs text-white/50 sm:text-sm">
            {level && <span>Niveau {level} </span>}
            {race && <span>{race} </span>}
            {className && <span className="text-amber-300">{className}</span>}
            {specName && <span className="text-white/40"> — {specName}</span>}
          </p>
          {faction && (
            <span className={`text-[10px] uppercase tracking-wider ${faction === "Alliance" ? "text-blue-400" : "text-red-400"}`}>
              {faction}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge className="bg-purple-600/30 text-purple-200 border border-purple-500/40 text-sm font-bold px-3">
            {avgIlvl} iLvl
          </Badge>
          <span className="text-[10px] text-white/30">Moy. équipement</span>
        </div>
      </div>

      {/* Main gear layout */}
      <div className="relative grid gap-2 p-3 sm:p-4 lg:grid-cols-[minmax(180px,1fr)_auto_minmax(180px,1fr)]">
        {/* Left slots */}
        <div className="space-y-1.5 lg:space-y-2">
          {LEFT_SLOTS.map((slot) => (
            <GearSlot key={slot} item={bySlot.get(slot)} slot={slot} side="left" />
          ))}
        </div>

        {/* Center render */}
        <div className="hidden items-center justify-center px-2 lg:flex">
          {media?.render ? (
            <img
              src={media.render}
              alt={name}
              className="max-h-[480px] w-auto object-contain drop-shadow-[0_0_15px_rgba(255,200,50,0.15)]"
            />
          ) : media?.inset ? (
            <img
              src={media.inset}
              alt={name}
              className="h-72 w-auto rounded-lg object-cover opacity-80"
            />
          ) : (
            <div className="flex h-[480px] w-44 items-center justify-center rounded-lg border border-dashed border-white/10">
              <span className="text-xs text-white/20">Aucun rendu</span>
            </div>
          )}
        </div>

        {/* Mobile render (between columns) */}
        {media?.render && (
          <div className="flex items-center justify-center py-4 lg:hidden">
            <img
              src={media.render}
              alt={name}
              className="max-h-64 w-auto object-contain"
            />
          </div>
        )}

        {/* Right slots */}
        <div className="space-y-1.5 lg:space-y-2">
          {RIGHT_SLOTS.map((slot) => (
            <GearSlot key={slot} item={bySlot.get(slot)} slot={slot} side="right" />
          ))}
        </div>
      </div>

      {/* Weapons */}
      <div className="grid grid-cols-2 gap-2 border-t border-white/5 px-3 py-3 sm:px-4">
        {BOTTOM_SLOTS.map((slot) => (
          <GearSlot key={slot} item={bySlot.get(slot)} slot={slot} side="left" />
        ))}
      </div>

      {/* Stats panel */}
      {stats && (
        <div className="border-t border-white/10 px-4 py-4 sm:px-6">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-amber-400/80">Statistiques</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatsGroup title="Attributs principaux" items={[
              { label: "Points de vie", value: stats.health },
              { label: stats.power_type?.name ?? "Ressource", value: stats.power },
              { label: "Force", value: stats.strength?.effective },
              { label: "Agilité", value: stats.agility?.effective },
              { label: "Intelligence", value: stats.intellect?.effective },
              { label: "Endurance", value: stats.stamina?.effective },
            ]} />
            <StatsGroup title="Stats secondaires" items={[
              { label: "Critique", value: stats.melee_crit?.value ?? stats.spell_crit?.value, suffix: "%" },
              { label: "Hâte", value: stats.melee_haste?.value ?? stats.spell_haste?.value, suffix: "%" },
              { label: "Maîtrise", value: stats.mastery?.value, suffix: "%" },
              { label: "Polyvalence", value: stats.versatility_damage_done_bonus, suffix: "%" },
            ]} />
            <StatsGroup title="Défense" items={[
              { label: "Armure", value: stats.armor?.effective },
              { label: "Vitesse", value: stats.speed?.rating },
              { label: "Évitement", value: stats.avoidance?.rating },
            ]} />
          </div>
        </div>
      )}
    </div>
  )
}

function StatsGroup({ title, items }: { title: string; items: Array<{ label: string; value?: number; suffix?: string }> }) {
  const filtered = items.filter((i) => i.value != null && i.value > 0)
  if (filtered.length === 0) return null

  return (
    <div className="space-y-1">
      <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">{title}</h4>
      {filtered.map((item) => (
        <div key={item.label} className="flex items-center justify-between text-xs">
          <span className="text-white/60">{item.label}</span>
          <span className="font-mono text-white/90">
            {typeof item.value === "number" && item.value > 1000
              ? Math.round(item.value).toLocaleString()
              : item.value?.toFixed(item.suffix === "%" ? 2 : 0)}
            {item.suffix ?? ""}
          </span>
        </div>
      ))}
    </div>
  )
}

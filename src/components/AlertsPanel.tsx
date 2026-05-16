import { useState } from "react"
import { Bell, Plus, Trash2, Power } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const API = import.meta.env.VITE_API_URL || ""

export type Alert = {
  id: string
  label: string
  type: "craft" | "flip" | "prix"
  threshold: number
  direction: "above" | "below"
  active: boolean
}

type AlertsPanelProps = {
  alerts: Alert[]
  onRefresh: () => void
}

export function AlertsPanel({ alerts, onRefresh }: AlertsPanelProps) {
  const [showForm, setShowForm] = useState(false)
  const [formLabel, setFormLabel] = useState("")
  const [formType, setFormType] = useState<"craft" | "flip" | "prix">("craft")
  const [formThreshold, setFormThreshold] = useState("")
  const [formDirection, setFormDirection] = useState<"above" | "below">("above")
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!formLabel.trim() || !formThreshold) return
    setCreating(true)
    try {
      const res = await fetch(`${API}/api/alerts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: formLabel.trim(),
          type: formType,
          threshold: Number(formThreshold),
          direction: formDirection,
        }),
      })
      if (res.ok) {
        setFormLabel("")
        setFormThreshold("")
        setShowForm(false)
        onRefresh()
      }
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    await fetch(`${API}/api/alerts/${id}`, { method: "DELETE" })
    onRefresh()
  }

  const handleToggle = async (id: string) => {
    await fetch(`${API}/api/alerts/${id}/toggle`, { method: "POST" })
    onRefresh()
  }

  return (
    <Card className="gap-0 p-0">
      <CardHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
        <CardTitle className="text-muted-foreground flex items-center gap-2 text-xs tracking-widest uppercase">
          <Bell className="h-3.5 w-3.5" />
          Alertes
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus className="h-3 w-3" />
          <span className="hidden sm:inline">Nouvelle alerte</span>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {/* Create form */}
        {showForm && (
          <div className="border-b p-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Input
                placeholder="Label"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                className="text-sm"
              />
              <Select value={formType} onValueChange={(v) => setFormType(v as typeof formType)}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="craft">Craft</SelectItem>
                  <SelectItem value="flip">Flip</SelectItem>
                  <SelectItem value="prix">Prix</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Seuil (or)"
                value={formThreshold}
                onChange={(e) => setFormThreshold(e.target.value)}
                className="text-sm"
              />
              <Select value={formDirection} onValueChange={(v) => setFormDirection(v as typeof formDirection)}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">Au-dessus</SelectItem>
                  <SelectItem value="below">En-dessous</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-8 w-full"
                onClick={handleCreate}
                disabled={creating || !formLabel.trim() || !formThreshold}
              >
                {creating ? "..." : "Créer"}
              </Button>
            </div>
          </div>
        )}

        {/* Alert list */}
        {alerts.length === 0 && !showForm ? (
          <div className="text-muted-foreground px-4 py-6 text-center text-sm">
            Aucune alerte configurée.
          </div>
        ) : (
          <div className="divide-border divide-y">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center gap-2 px-4 py-2 sm:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`truncate text-sm font-medium ${
                        alert.active ? "text-foreground" : "text-muted-foreground line-through"
                      }`}
                    >
                      {alert.label}
                    </span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {alert.type}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    {alert.direction === "above" ? "Au-dessus" : "En-dessous"} de{" "}
                    <span className="font-mono text-amber-400">
                      {alert.threshold.toLocaleString("fr-FR")}g
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-8 w-8 shrink-0 p-0 ${alert.active ? "text-emerald-400" : "text-muted-foreground"}`}
                  onClick={() => handleToggle(alert.id)}
                  title={alert.active ? "Désactiver" : "Activer"}
                >
                  <Power className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0 text-red-400 hover:text-red-300"
                  onClick={() => handleDelete(alert.id)}
                  title="Supprimer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

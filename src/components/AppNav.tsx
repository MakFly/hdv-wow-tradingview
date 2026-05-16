import { BarChart3, BookOpen, Coins, User } from "lucide-react"
import { Button } from "./ui/button"

export type AppView = "dashboard" | "profile" | "opportunities" | "encyclopedia"

const NAV_ITEMS: Array<{ id: AppView; label: string; icon: typeof BarChart3 }> = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "profile", label: "Profil", icon: User },
  { id: "opportunities", label: "Opportunités", icon: Coins },
  { id: "encyclopedia", label: "Encyclopédie", icon: BookOpen },
]

export function AppNav({
  active,
  onChange,
  disabled,
}: {
  active: AppView
  onChange: (view: AppView) => void
  disabled?: AppView[]
}) {
  return (
    <nav className="flex items-center gap-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const isActive = active === item.id
        const isDisabled = disabled?.includes(item.id)

        return (
          <Button
            key={item.id}
            variant={isActive ? "secondary" : "ghost"}
            size="sm"
            className={`h-7 gap-1.5 text-xs ${
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            } ${isDisabled ? "pointer-events-none opacity-40" : ""}`}
            onClick={() => onChange(item.id)}
            disabled={isDisabled}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{item.label}</span>
          </Button>
        )
      })}
    </nav>
  )
}

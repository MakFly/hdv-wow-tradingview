import { useLocation, useNavigate } from "react-router-dom"
import { BarChart3, BookOpen, Coins, User, Menu } from "lucide-react"
import { useState } from "react"
import { Button } from "./ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"

export type AppView = "dashboard" | "profile" | "opportunities" | "encyclopedia"

const NAV_ITEMS: Array<{ id: AppView; path: string; label: string; icon: typeof BarChart3 }> = [
  { id: "dashboard", path: "/", label: "Dashboard", icon: BarChart3 },
  { id: "profile", path: "/profile", label: "Profil", icon: User },
  { id: "opportunities", path: "/opportunities", label: "Opportunités", icon: Coins },
  { id: "encyclopedia", path: "/encyclopedia", label: "Encyclopédie", icon: BookOpen },
]

const PATH_TO_VIEW: Record<string, AppView> = {
  "/": "dashboard",
  "/profile": "profile",
  "/opportunities": "opportunities",
  "/encyclopedia": "encyclopedia",
}

export function useActiveView(): AppView {
  const { pathname } = useLocation()
  return PATH_TO_VIEW[pathname] ?? "dashboard"
}

export function AppNav({ disabled }: { disabled?: AppView[] }) {
  const navigate = useNavigate()
  const active = useActiveView()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Desktop nav */}
      <nav className="hidden items-center gap-1 md:flex">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = active === item.id
          const isDisabled = disabled?.includes(item.id)

          return (
            <Button
              key={item.id}
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              className={`h-8 gap-1.5 text-xs ${
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              } ${isDisabled ? "pointer-events-none opacity-40" : ""}`}
              onClick={() => navigate(item.path)}
              disabled={isDisabled}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Button>
          )
        })}
      </nav>

      {/* Mobile hamburger */}
      <div className="md:hidden">
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <Menu className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = active === item.id
              const isDisabled = disabled?.includes(item.id)

              return (
                <DropdownMenuItem
                  key={item.id}
                  className={`gap-2 ${isActive ? "bg-accent" : ""} ${isDisabled ? "opacity-40" : ""}`}
                  disabled={isDisabled}
                  onClick={() => {
                    navigate(item.path)
                    setOpen(false)
                  }}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}

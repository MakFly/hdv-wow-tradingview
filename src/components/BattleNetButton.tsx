import { useState } from "react"
import { Button } from "./ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { LogOut, User, Swords } from "lucide-react"

const API = import.meta.env.VITE_API_URL || "http://localhost:8788"

type AuthStatus = {
  linked: boolean
  battletag?: string
  expires_at?: number
  expired?: boolean
}

export function BattleNetButton({
  status,
  onStatusChange,
}: {
  status: AuthStatus | null
  onStatusChange: () => void
}) {
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/auth/url`)
      const { url } = await res.json()
      window.location.href = url
    } catch {
      setLoading(false)
    }
  }

  async function handleLogout() {
    await fetch(`${API}/auth/logout`, { method: "POST" })
    onStatusChange()
  }

  if (!status || !status.linked) {
    return (
      <Button
        onClick={handleLogin}
        disabled={loading}
        className="h-8 gap-2 bg-[#148EFF] text-white hover:bg-[#0f6fcc] dark:bg-[#148EFF] dark:hover:bg-[#0f6fcc]"
        size="sm"
      >
        <BattleNetIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Battle.net</span>
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 border-[#148EFF]/30 text-[#148EFF]"
        >
          <BattleNetIcon className="h-4 w-4" />
          <span className="hidden sm:inline">{status.battletag}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem className="gap-2 text-xs text-muted-foreground" disabled>
          <User className="h-3 w-3" />
          {status.battletag}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" disabled>
          <Swords className="h-3 w-3" />
          {status.expired ? "Token expiré" : "Connecté"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 text-red-400" onClick={handleLogout}>
          <LogOut className="h-3 w-3" />
          Déconnexion
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BattleNetIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M32.3 8.5c1.5 0 4.3.7 5.6 3.6 1.2 2.6 1.4 7 .6 11.5l-.3 1.6 1.4-.7c4.4-2.3 8.5-3.5 10.7-3 1.7.4 2.8 1.5 3.2 3.3.6 2.5-.4 6.3-3 10.3l-.8 1.3 1.4.3c4 .8 7 2.2 8.2 4 .8 1.2.9 2.6.2 4-1 2.2-4 4.3-8.4 5.5l-1.5.4.8 1.3c2.3 3.8 3.2 7.3 2.4 9.6-.6 1.6-1.8 2.5-3.7 2.7-2.7.3-6.7-1-10.8-3.6l-1.2-.8-.5 1.4c-1.6 4.5-3.8 7.6-5.9 8.4-1.4.5-2.8.2-4-.9-1.9-1.7-3.2-5.3-3.4-9.8l-.1-1.5-1.3.8c-4.2 2.5-8.1 3.6-10.5 2.8-1.6-.6-2.5-1.8-2.7-3.7-.2-2.6 1.1-6.5 3.8-10.5l.9-1.3-1.5-.4C7.8 43.5 5 41.7 4 39.8c-.7-1.3-.6-2.7.3-4 1.3-1.9 4.6-3.5 9-4.3l1.5-.3-.9-1.2c-2.6-3.7-4-7.4-3.5-9.9.3-1.7 1.3-2.8 3-3.4 2.5-.8 6.5.1 10.8 2.5l1.3.7-.2-1.5c-.5-4.6-.1-8.2 1.3-10.5.9-1.5 2.2-2.2 3.7-2.3h2z" />
    </svg>
  )
}

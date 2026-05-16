import { useState, useEffect, useCallback } from "react"
import { useLocation, useNavigate } from "react-router-dom"

const API = import.meta.env.VITE_API_URL || ""

export type AuthStatus = {
  linked: boolean
  battletag?: string
  expires_at?: number
  expired?: boolean
}

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const location = useLocation()
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API}/auth/status`)
      const data = await res.json()
      setStatus(data)
    } catch {
      setStatus({ linked: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const code = params.get("code")
    if (!code) return

    navigate("/", { replace: true })

    ;(async () => {
      try {
        const res = await fetch(`${API}/auth/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })
        if (res.ok) await refresh()
      } catch {
        // exchange failed
      }
    })()
  }, [location.search, navigate, refresh])

  return { status, loading, refresh }
}

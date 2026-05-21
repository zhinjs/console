import { useState, useCallback, useEffect } from 'react'
import { cn } from '@zhin.js/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { getApiBase, readAuthFromQuery, verifyAndStoreCredentials } from '../utils/auth'

interface LoginPageProps {
  onSuccess: () => void
}

export default function LoginPage({ onSuccess }: LoginPageProps) {
  const queryAuth = readAuthFromQuery()
  const [apiBase, setApiBaseValue] = useState(() => {
    if (queryAuth?.apiBaseUrl) return queryAuth.apiBaseUrl
    const stored = getApiBase()
    if (stored && stored !== window.location.origin) return stored
    return 'http://localhost:8086'
  })
  const [token, setTokenValue] = useState(() => queryAuth?.token ?? '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = useCallback(async () => {
    setLoading(true)
    setError('')

    const result = await verifyAndStoreCredentials(apiBase, token)
    if (result.ok) {
      onSuccess()
    } else {
      setError(result.message)
    }
    setLoading(false)
  }, [token, apiBase, onSuccess])

  useEffect(() => {
    if (!queryAuth) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const result = await verifyAndStoreCredentials(queryAuth.apiBaseUrl, queryAuth.token)
      if (cancelled) return
      if (result.ok) {
        onSuccess()
      } else {
        setError(result.message)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [queryAuth, onSuccess])

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className={cn('w-full max-w-md mx-4')}>
        <CardHeader className="text-center space-y-2">
          <div className="flex items-center justify-center mx-auto w-12 h-12 rounded-xl bg-foreground text-background font-bold text-xl">
            Z
          </div>
          <CardTitle className="text-xl">Zhin.js 控制台</CardTitle>
          <CardDescription>
            配置 Remote Console：API 地址与 Bearer Token
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleLogin()
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Input
                type="url"
                placeholder="API Base URL（如 http://127.0.0.1:8086）"
                value={apiBase}
                onChange={(e) => setApiBaseValue(e.target.value)}
              />
              <Input
                type="password"
                placeholder="API Token"
                value={token}
                onChange={(e) => {
                  setTokenValue(e.target.value)
                  if (error) setError('')
                }}
                autoFocus
              />
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '验证中...' : '连接'}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              须填写运行 test-bot 的 Host 地址（与预览站 5173 不同）。localhost 与 127.0.0.1 请与 corsOrigins 一致。
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

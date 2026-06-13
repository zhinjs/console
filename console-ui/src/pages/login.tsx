import { useState, useCallback, useEffect, useMemo } from 'react'
import { cn } from '@zhin.js/client'
import { Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import {
  getSavedLogin,
  getStoredApiBase,
  listSavedLogins,
  normalizeApiBase,
  removeSavedLogin,
  touchSavedLogin,
  upsertSavedLogin,
  verifyAndStoreCredentials,
} from '../utils/auth'

interface LoginPageProps {
  onSuccess: () => void
  /** 来自 ?apiBaseUrl=...，仅预填表单 */
  initialApiBase?: string | null
}

export default function LoginPage({ onSuccess, initialApiBase }: LoginPageProps) {
  const [savedLogins, setSavedLogins] = useState(() => listSavedLogins())
  const [apiBase, setApiBaseValue] = useState(() => {
    if (initialApiBase) return initialApiBase
    const stored = getStoredApiBase()
    if (stored) return stored
    return 'http://localhost:8086'
  })
  const [token, setTokenValue] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const selectedSavedBase = useMemo(() => {
    const normalized = normalizeApiBase(apiBase)
    if (!normalized) return ''
    return savedLogins.some((s) => normalizeApiBase(s.apiBase) === normalized) ? normalized : ''
  }, [apiBase, savedLogins])

  const applySavedLogin = useCallback((base: string) => {
    const saved = getSavedLogin(base)
    if (!saved) return
    setApiBaseValue(saved.apiBase)
    setTokenValue(saved.token)
    if (error) setError('')
  }, [error])

  const handleLogin = useCallback(async () => {
    setLoading(true)
    setError('')

    const result = await verifyAndStoreCredentials(apiBase, token)
    if (result.ok) {
      if (remember) {
        upsertSavedLogin(apiBase, token)
      } else {
        touchSavedLogin(apiBase)
      }
      setSavedLogins(listSavedLogins())
      onSuccess()
    } else {
      setError(result.message)
    }
    setLoading(false)
  }, [token, apiBase, remember, onSuccess])

  const handleRemoveSaved = useCallback(() => {
    if (!selectedSavedBase) return
    removeSavedLogin(selectedSavedBase)
    setSavedLogins(listSavedLogins())
    setTokenValue('')
  }, [selectedSavedBase])

  useEffect(() => {
    if (initialApiBase) setApiBaseValue(initialApiBase)
  }, [initialApiBase])

  useEffect(() => {
    const base = initialApiBase || getStoredApiBase() || apiBase
    const saved = getSavedLogin(base)
    if (saved) setTokenValue(saved.token)
  }, [initialApiBase])

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
            {savedLogins.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">已保存的连接</label>
                <div className="flex gap-2">
                  <Select
                    value={selectedSavedBase || undefined}
                    onValueChange={(value) => applySavedLogin(value)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="选择 Host 快速填入…" />
                    </SelectTrigger>
                    <SelectContent>
                      {savedLogins.map((item) => (
                        <SelectItem key={item.apiBase} value={normalizeApiBase(item.apiBase)}>
                          {item.apiBase}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    disabled={!selectedSavedBase}
                    onClick={handleRemoveSaved}
                    title="删除此保存"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Input
                type="url"
                placeholder="API Base URL（如 http://127.0.0.1:8086）"
                aria-label="API Base URL"
                value={apiBase}
                onChange={(e) => {
                  setApiBaseValue(e.target.value)
                  if (error) setError('')
                }}
              />
              <Input
                type="password"
                placeholder="API Token（须手动输入，勿通过 URL 传递）"
                aria-label="API Token"
                value={token}
                onChange={(e) => {
                  setTokenValue(e.target.value)
                  if (error) setError('')
                }}
                autoFocus={savedLogins.length === 0}
              />
              {error && (
                <p className="text-sm text-destructive" role="alert">{error}</p>
              )}
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={remember}
                onCheckedChange={(v) => setRemember(v === true)}
              />
              <span className="text-sm text-muted-foreground">保存登录信息，下次可快速选择</span>
            </label>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '验证中...' : selectedSavedBase && token ? '快速连接' : '连接'}
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

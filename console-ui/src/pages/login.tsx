import { LanguageSelect } from '../components/LanguageSelect'
import { useI18n } from '../i18n'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { Trash2, ShieldCheck, Eye, EyeOff } from 'lucide-react'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import {
  getSavedLogin, getStoredApiBase, listSavedLogins, normalizeApiBase, removeSavedLogin,
  touchSavedLogin, upsertSavedLogin, verifyAndStoreCredentials,
} from '../utils/auth'
import './login.css'

interface LoginPageProps {
  onSuccess: () => void
  /** Only the Host address may be prefilled from a URL. */
  initialApiBase?: string | null
}

export default function LoginPage({ onSuccess, initialApiBase }: LoginPageProps) {
  const i18n = useI18n()
  const [savedLogins, setSavedLogins] = useState(() => listSavedLogins())
  const [apiBase, setApiBaseValue] = useState(() => initialApiBase || getStoredApiBase() || 'http://localhost:8086')
  const [token, setTokenValue] = useState('')
  const [remember, setRemember] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const selectedSavedBase = useMemo(() => {
    const normalized = normalizeApiBase(apiBase)
    return savedLogins.some(saved => normalizeApiBase(saved.apiBase) === normalized) ? normalized : ''
  }, [apiBase, savedLogins])

  const applySavedLogin = useCallback((base: string) => {
    const saved = getSavedLogin(base)
    if (!saved) return
    setApiBaseValue(saved.apiBase)
    setTokenValue(saved.token)
    setShowToken(false)
    setError('')
  }, [])

  const handleLogin = useCallback(async () => {
    if (loading) return
    setLoading(true)
    setError('')
    const result = await verifyAndStoreCredentials(apiBase, token, i18n.locale, remember)
    if (result.ok) {
      if (remember) upsertSavedLogin(apiBase, token)
      else touchSavedLogin(apiBase)
      setSavedLogins(listSavedLogins())
      setShowToken(false)
      onSuccess()
    } else setError(result.message)
    setLoading(false)
  }, [token, apiBase, remember, onSuccess, i18n, loading])

  const handleRemoveSaved = useCallback(() => {
    if (!selectedSavedBase) return
    removeSavedLogin(selectedSavedBase)
    setSavedLogins(listSavedLogins())
    setTokenValue('')
    setShowToken(false)
  }, [selectedSavedBase])

  useEffect(() => { if (initialApiBase) setApiBaseValue(initialApiBase) }, [initialApiBase])
  useEffect(() => {
    const saved = getSavedLogin(initialApiBase || getStoredApiBase() || apiBase)
    if (saved) setTokenValue(saved.token)
  }, [initialApiBase])

  return <div className="console-login">
    <div className="console-login-layout">
      <section className="console-login-intro">
        <div className="console-login-brand"><span className="console-login-mark" aria-hidden="true">Z</span><span>Zhin Console</span></div>
        <h1>{i18n.t('连接你的机器人')}</h1>
        <p>{i18n.t('连接运行 Zhin 的设备，管理会话、账号和任务。')}</p>
        <div className="console-login-notes"><ShieldCheck aria-hidden="true" /><span>{i18n.t('令牌用于验证你的访问权限。')}</span></div>
      </section>
      <section className="console-login-panel" aria-label={i18n.t('连接设置')}>
        <div className="console-login-panel-head"><LanguageSelect /></div>
        <form className="console-login-form" onSubmit={event => { event.preventDefault(); void handleLogin() }}>
          {savedLogins.length > 0 && <div className="console-login-field">
            <span>{i18n.t('已保存的连接')}</span>
            <div className="console-login-saved">
              <Select value={selectedSavedBase || undefined} onValueChange={applySavedLogin} disabled={loading}>
                <SelectTrigger aria-label={i18n.t('已保存的连接')}><SelectValue placeholder={i18n.t('选择 Host 快速填入…')} /></SelectTrigger>
                <SelectContent>{savedLogins.map(saved => <SelectItem key={saved.apiBase} value={normalizeApiBase(saved.apiBase)}>{saved.apiBase}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" disabled={loading || !selectedSavedBase} onClick={handleRemoveSaved} title={i18n.t('删除此保存')} aria-label={i18n.t('删除此保存')}><Trash2 /></Button>
            </div>
          </div>}
          <label className="console-login-field" htmlFor="console-login-address">
            <span>{i18n.t('Host 地址')}</span>
            <Input id="console-login-address" type="url" required disabled={loading} autoComplete="url" spellCheck={false}
              aria-label="API Base URL" placeholder="http://localhost:8086" value={apiBase}
              onChange={event => { setApiBaseValue(event.target.value); setError('') }} />
            <small>{i18n.t('填写机器人启动日志中的地址。')}</small>
          </label>
          <div className="console-login-field">
            <label htmlFor="console-login-token">{i18n.t('访问令牌')}</label>
            <div className="console-login-token">
              <Input id="console-login-token" type={showToken ? 'text' : 'password'} required disabled={loading} autoComplete="off" spellCheck={false}
                aria-label="API Token" value={token} placeholder={i18n.t('请输入 Token')}
                onChange={event => { setTokenValue(event.target.value); setError('') }} autoFocus={savedLogins.length === 0} />
              <Button type="button" variant="ghost" size="icon" disabled={loading} aria-pressed={showToken}
                aria-label={i18n.t(showToken ? '隐藏令牌' : '显示令牌')} onClick={() => setShowToken(visible => !visible)}>{showToken ? <EyeOff /> : <Eye />}</Button>
            </div>
          </div>
          {error && <p className="console-login-error" role="alert">{error}</p>}
          <label className="console-login-remember"><Checkbox checked={remember} disabled={loading} onCheckedChange={value => setRemember(value === true)} /><span>{i18n.t('记住此连接')}</span></label>
          {!remember && <p className="console-login-session-note">{i18n.t('访问令牌仅保留在本次浏览器会话。')}</p>}
          <Button type="submit" disabled={loading}>{loading ? i18n.t('验证中...') : selectedSavedBase && token ? i18n.t('快速连接') : i18n.t('连接')}</Button>
          <details className="console-login-help"><summary>{i18n.t('无法连接？')}</summary><p>{i18n.t('填写 Bot 启动日志中的 Host 地址。使用本地地址时，请确保 Host 的 corsOrigins 允许当前 Console 来源。')}</p></details>
        </form>
      </section>
    </div>
  </div>
}

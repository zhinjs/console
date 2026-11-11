import { LanguageSelect } from '../components/LanguageSelect'
import { useI18n } from '../i18n'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Trash2, ShieldCheck, Eye, EyeOff } from 'lucide-react'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import {
  getSavedLogin, getStoredApiBase, listSavedLogins, normalizeApiBase, removeSavedLogin,
  touchSavedLogin, upsertSavedLogin, verifyAndStoreCredentials,
} from '../utils/auth'
import { loginFailureField, normalizeHostAddress, type HostAddressResult, type LoginField } from './login-model.mjs'
import './login.css'

interface LoginPageProps {
  onSuccess: () => void
  /** Host address from a login link (`?apiBaseUrl=`). */
  initialApiBase?: string | null
  /** Token from a `?token=` link; the caller has already removed it from the address bar. */
  initialToken?: string | null
  /** Called once the link token has been used, so it is not tried again after a later sign-out. */
  onInitialTokenConsumed?: () => void
}

type LoginErrors = Partial<Record<LoginField, string>>

const ADDRESS_ID = 'console-login-address'
const ADDRESS_HINT_ID = 'console-login-address-hint'
const ADDRESS_ERROR_ID = 'console-login-address-error'
const TOKEN_ID = 'console-login-token'
const TOKEN_ERROR_ID = 'console-login-token-error'
const SUMMARY_ID = 'console-login-error'

export default function LoginPage({ onSuccess, initialApiBase, initialToken, onInitialTokenConsumed }: LoginPageProps) {
  const i18n = useI18n()
  const [savedLogins, setSavedLogins] = useState(() => listSavedLogins())
  const [apiBase, setApiBaseValue] = useState(() => initialApiBase || getStoredApiBase() || 'http://localhost:8086')
  const [token, setTokenValue] = useState('')
  const [remember, setRemember] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [errors, setErrors] = useState<LoginErrors>({})
  const [loading, setLoading] = useState(false)
  // A fresh object per failure, so focus moves again even when the same field fails twice.
  const [focusRequest, setFocusRequest] = useState<{ field: LoginField } | null>(null)
  const addressRef = useRef<HTMLInputElement | null>(null)
  const tokenRef = useRef<HTMLInputElement | null>(null)
  const summaryRef = useRef<HTMLParagraphElement | null>(null)
  const linkAttempted = useRef(false)

  const addressError = useCallback((result: HostAddressResult) => {
    if (result.ok) return undefined
    if (result.reason === 'empty') return i18n.t('请填写 Host 地址。')
    if (result.reason === 'protocol') return i18n.t('Host 地址只支持 http:// 或 https://。')
    return i18n.t('Host 地址无效，请填写如 http://127.0.0.1:8086 的地址。')
  }, [i18n])

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
    setErrors({})
  }, [])

  const handleLogin = useCallback(async (rawBase: string, rawToken: string) => {
    if (loading) return
    const address = normalizeHostAddress(rawBase)
    const next: LoginErrors = {}
    if (!address.ok) next.apiBase = addressError(address)
    if (!rawToken.trim()) next.token = i18n.t('请输入访问令牌。')
    if (next.apiBase || next.token) {
      setErrors(next)
      setFocusRequest({ field: next.apiBase ? 'apiBase' : 'token' })
      return
    }
    const base = (address as { value: string }).value
    setApiBaseValue(base)
    setErrors({})
    setLoading(true)
    const result = await verifyAndStoreCredentials(base, rawToken, i18n.locale, remember)
    if (result.ok) {
      if (remember) upsertSavedLogin(base, rawToken)
      else touchSavedLogin(base)
      setSavedLogins(listSavedLogins())
      setShowToken(false)
      setLoading(false)
      onSuccess()
      return
    }
    const field = loginFailureField(result)
    setErrors({ [field]: result.message })
    setLoading(false)
    setFocusRequest({ field })
  }, [remember, onSuccess, i18n, loading, addressError])

  useEffect(() => {
    if (!focusRequest) return
    const target = focusRequest.field === 'apiBase' ? addressRef : focusRequest.field === 'token' ? tokenRef : summaryRef
    target.current?.focus()
  }, [focusRequest])

  const handleRemoveSaved = useCallback(() => {
    if (!selectedSavedBase) return
    removeSavedLogin(selectedSavedBase)
    setSavedLogins(listSavedLogins())
    setTokenValue('')
    setShowToken(false)
  }, [selectedSavedBase])

  useEffect(() => { if (initialApiBase) setApiBaseValue(initialApiBase) }, [initialApiBase])
  useEffect(() => {
    if (initialToken) return
    const saved = getSavedLogin(initialApiBase || getStoredApiBase() || apiBase)
    if (saved) setTokenValue(saved.token)
  }, [initialApiBase])
  // A `?token=` link signs in once; on failure the fields stay editable for a manual retry.
  useEffect(() => {
    if (!initialToken || linkAttempted.current) return
    linkAttempted.current = true
    onInitialTokenConsumed?.()
    setTokenValue(initialToken)
    void handleLogin(initialApiBase || apiBase, initialToken)
  }, [initialToken])

  const describedBy = (...ids: Array<string | false | undefined>) => ids.filter(Boolean).join(' ') || undefined

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
        <form className="console-login-form" noValidate onSubmit={event => { event.preventDefault(); void handleLogin(apiBase, token) }}>
          {savedLogins.length > 0 && <div className="console-login-field">
            <label htmlFor="console-login-saved">{i18n.t('已保存的连接')}</label>
            <div className="console-login-saved">
              <Select value={selectedSavedBase || undefined} onValueChange={applySavedLogin} disabled={loading}>
                <SelectTrigger id="console-login-saved"><SelectValue placeholder={i18n.t('选择 Host 快速填入…')} /></SelectTrigger>
                <SelectContent>{savedLogins.map(saved => <SelectItem key={saved.apiBase} value={normalizeApiBase(saved.apiBase)}>{saved.apiBase}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" disabled={loading || !selectedSavedBase} onClick={handleRemoveSaved} title={i18n.t('删除此保存')} aria-label={i18n.t('删除此保存')}><Trash2 /></Button>
            </div>
          </div>}
          <div className="console-login-field">
            <label htmlFor={ADDRESS_ID}>{i18n.t('Host 地址')}</label>
            <Input id={ADDRESS_ID} ref={addressRef} type="text" inputMode="url" required disabled={loading} autoComplete="url" spellCheck={false}
              autoCapitalize="none" placeholder="http://localhost:8086" value={apiBase}
              aria-invalid={errors.apiBase ? true : undefined} aria-describedby={describedBy(ADDRESS_HINT_ID, errors.apiBase && ADDRESS_ERROR_ID)}
              onChange={event => { setApiBaseValue(event.target.value); setErrors(current => ({ ...current, apiBase: undefined, form: undefined })) }}
              onBlur={event => {
                const result = normalizeHostAddress(event.target.value)
                if (!result.ok && result.reason !== 'empty') setErrors(current => ({ ...current, apiBase: addressError(result) }))
              }} />
            <small id={ADDRESS_HINT_ID}>{i18n.t('填写机器人启动日志中的地址。')}</small>
            {errors.apiBase && <p id={ADDRESS_ERROR_ID} className="console-login-error">{errors.apiBase}</p>}
          </div>
          <div className="console-login-field">
            <label htmlFor={TOKEN_ID}>{i18n.t('访问令牌')}</label>
            <div className="console-login-token">
              <Input id={TOKEN_ID} ref={tokenRef} type={showToken ? 'text' : 'password'} required disabled={loading} autoComplete="off" spellCheck={false}
                value={token} placeholder={i18n.t('请输入 Token')}
                aria-invalid={errors.token ? true : undefined} aria-describedby={describedBy(errors.token && TOKEN_ERROR_ID)}
                onChange={event => { setTokenValue(event.target.value); setErrors(current => ({ ...current, token: undefined, form: undefined })) }}
                autoFocus={savedLogins.length === 0 && !initialToken} />
              <Button type="button" variant="ghost" size="icon" disabled={loading} aria-pressed={showToken}
                aria-label={i18n.t(showToken ? '隐藏令牌' : '显示令牌')} onClick={() => setShowToken(visible => !visible)}>{showToken ? <EyeOff /> : <Eye />}</Button>
            </div>
            {errors.token && <p id={TOKEN_ERROR_ID} className="console-login-error">{errors.token}</p>}
          </div>
          {errors.form && <p id={SUMMARY_ID} ref={summaryRef} className="console-login-error" role="alert" tabIndex={-1}>{errors.form}</p>}
          <label className="console-login-remember"><Checkbox checked={remember} disabled={loading} onCheckedChange={value => setRemember(value === true)} /><span>{i18n.t('记住此连接')}</span></label>
          {!remember && <p className="console-login-session-note">{i18n.t('访问令牌仅保留在本次浏览器会话。')}</p>}
          <Button type="submit" disabled={loading}>{loading ? i18n.t('验证中...') : selectedSavedBase && token ? i18n.t('快速连接') : i18n.t('连接')}</Button>
          <details className="console-login-help"><summary>{i18n.t('无法连接？')}</summary><p>{i18n.t('填写 Bot 启动日志中的 Host 地址。使用本地地址时，请确保 Host 的 corsOrigins 允许当前 Console 来源。')}</p></details>
        </form>
      </section>
    </div>
  </div>
}

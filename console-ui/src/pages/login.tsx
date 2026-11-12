import { LanguageSelect } from '../components/LanguageSelect'
import { useI18n } from '../i18n'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Trash2, ShieldCheck, Eye, EyeOff, KeyRound, UserRound } from 'lucide-react'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import {
  getSavedLogin, getStoredApiBase, listSavedLogins, normalizeApiBase, removeSavedLogin,
  touchSavedLogin, upsertSavedLogin, verifyAndStoreCredentials,
} from '../utils/auth'
import { ConfirmDialog } from '../components/confirm-dialog'
import { signInWithPassword } from '../utils/console-auth-api'
import { authErrorMessage } from '../utils/console-auth-model.mjs'
import {
  initialLoginMode, linkNeedsConfirmation, lockoutMs, loginFailureField, normalizeHostAddress, passwordFailureField, saveLoginMode,
  type HostAddressResult, type LoginField, type LoginMode,
} from './login-model.mjs'
import './login.css'

interface LoginPageProps {
  onSuccess: () => void
  /** Host address from a login link (`#apiBaseUrl=` or `?apiBaseUrl=`). */
  initialApiBase?: string | null
  /** Token from a `#token=` link; the caller has already removed it from the address bar. */
  initialToken?: string | null
  /** The link carried `?token=`, which was removed from the address bar and not used. */
  queryTokenRejected?: boolean
  /** Called once the link token has been used, so it is not tried again after a later sign-out. */
  onInitialTokenConsumed?: () => void
  /** Sign-in method to open with; defaults to {@link initialLoginMode}. */
  initialMode?: LoginMode
}

type LoginErrors = Partial<Record<LoginField, string>>

const ADDRESS_ID = 'console-login-address'
const ADDRESS_HINT_ID = 'console-login-address-hint'
const ADDRESS_ERROR_ID = 'console-login-address-error'
const TOKEN_ID = 'console-login-token'
const TOKEN_ERROR_ID = 'console-login-token-error'
const SUMMARY_ID = 'console-login-error'
const USERNAME_ID = 'console-login-username'
const USERNAME_ERROR_ID = 'console-login-username-error'
const PASSWORD_ID = 'console-login-password'
const PASSWORD_ERROR_ID = 'console-login-password-error'

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export default function LoginPage({ onSuccess, initialApiBase, initialToken, queryTokenRejected, onInitialTokenConsumed, initialMode }: LoginPageProps) {
  const i18n = useI18n()
  const [savedLogins, setSavedLogins] = useState(() => listSavedLogins())
  const [apiBase, setApiBaseValue] = useState(() => initialApiBase || getStoredApiBase() || 'http://localhost:8086')
  const [token, setTokenValue] = useState('')
  const [mode, setMode] = useState<LoginMode>(() => initialToken ? 'token' : initialMode ?? initialLoginMode({ initialToken, savedCount: savedLogins.length, storage: browserStorage() }))
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // A rate-limited sign-in (429) keeps the button disabled until the Host's Retry-After passes.
  const [lockedUntil, setLockedUntil] = useState(0)
  const [remember, setRemember] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [errors, setErrors] = useState<LoginErrors>(() => queryTokenRejected
    ? { form: i18n.t('token 不能放在 ? 参数里：它已从地址栏移除且未被使用。请改用 #token= 链接，或在下方手动输入。') }
    : {})
  // A link to a Host that is not among the saved connections waits for the person to confirm it.
  const [pendingLink, setPendingLink] = useState<{ apiBase: string; token: string } | null>(null)
  const [loading, setLoading] = useState(false)
  // A fresh object per failure, so focus moves again even when the same field fails twice.
  const [focusRequest, setFocusRequest] = useState<{ field: LoginField } | null>(null)
  const addressRef = useRef<HTMLInputElement | null>(null)
  const tokenRef = useRef<HTMLInputElement | null>(null)
  const usernameRef = useRef<HTMLInputElement | null>(null)
  const passwordRef = useRef<HTMLInputElement | null>(null)
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
      // A bootstrap token stops working once the owner exists: it is never saved.
      if (remember && result.kind !== 'bootstrap') upsertSavedLogin(base, rawToken)
      else touchSavedLogin(base)
      saveLoginMode(browserStorage(), 'token')
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

  const handlePasswordLogin = useCallback(async (rawBase: string) => {
    if (loading || lockedUntil > Date.now()) return
    const address = normalizeHostAddress(rawBase)
    const next: LoginErrors = {}
    if (!address.ok) next.apiBase = addressError(address)
    if (!username.trim()) next.username = i18n.t('请输入用户名。')
    if (!password) next.password = i18n.t('请输入密码。')
    if (next.apiBase || next.username || next.password) {
      setErrors(next)
      setFocusRequest({ field: next.apiBase ? 'apiBase' : next.username ? 'username' : 'password' })
      return
    }
    const base = (address as { value: string }).value
    setApiBaseValue(base)
    setErrors({})
    setLoading(true)
    const result = await signInWithPassword(base, username, password, remember)
    setLoading(false)
    if (result.ok) {
      setPassword('')
      touchSavedLogin(base)
      saveLoginMode(browserStorage(), 'password')
      onSuccess()
      return
    }
    const wait = lockoutMs(result)
    if (wait) setLockedUntil(Date.now() + wait)
    const field = passwordFailureField(result)
    setErrors({ [field]: authErrorMessage(result, i18n.t, 'login') })
    setFocusRequest({ field })
  }, [loading, lockedUntil, username, password, remember, onSuccess, i18n, addressError])

  useEffect(() => {
    if (!lockedUntil) return
    const timer = setTimeout(() => setLockedUntil(0), Math.max(0, lockedUntil - Date.now()))
    return () => clearTimeout(timer)
  }, [lockedUntil])

  useEffect(() => {
    if (!focusRequest) return
    const refs = { apiBase: addressRef, token: tokenRef, username: usernameRef, password: passwordRef, form: summaryRef }
    refs[focusRequest.field].current?.focus()
  }, [focusRequest])

  const switchMode = useCallback((next: LoginMode) => {
    setMode(next)
    setErrors(current => ({ apiBase: current.apiBase }))
  }, [])

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
  // A `#token=` link signs in once (after confirmation for an unsaved Host); on failure the fields stay editable.
  useEffect(() => {
    if (!initialToken || linkAttempted.current) return
    linkAttempted.current = true
    onInitialTokenConsumed?.()
    const target = initialApiBase || apiBase
    if (linkNeedsConfirmation(target, savedLogins.map(saved => saved.apiBase))) {
      setPendingLink({ apiBase: target, token: initialToken })
      return
    }
    setTokenValue(initialToken)
    void handleLogin(target, initialToken)
  }, [initialToken])

  const confirmLink = useCallback(() => {
    if (!pendingLink) return
    setPendingLink(null)
    setMode('token')
    setTokenValue(pendingLink.token)
    void handleLogin(pendingLink.apiBase, pendingLink.token)
  }, [pendingLink, handleLogin])

  const pendingHost = pendingLink ? normalizeHostAddress(pendingLink.apiBase) : null

  const describedBy = (...ids: Array<string | false | undefined>) => ids.filter(Boolean).join(' ') || undefined

  return <div className="console-login">
    <div className="console-login-layout">
      <section className="console-login-intro">
        <div className="console-login-brand"><span className="console-login-mark" aria-hidden="true">Z</span><span>Zhin Console</span></div>
        <h1>{i18n.t('连接你的机器人')}</h1>
        <p>{i18n.t('连接运行 Zhin 的设备，管理会话、账号和任务。')}</p>
        <div className="console-login-notes"><ShieldCheck aria-hidden="true" /><span>{i18n.t('账号与令牌由管理网关验证：机器人实例停止时也能登录，查看实例日志并重新启动。')}</span></div>
      </section>
      <section className="console-login-panel" aria-label={i18n.t('连接设置')}>
        <div className="console-login-panel-head"><LanguageSelect /></div>
        <div className="console-login-modes" role="group" aria-label={i18n.t('登录方式')}>
          <Button type="button" variant={mode === 'password' ? 'secondary' : 'ghost'} size="sm" aria-pressed={mode === 'password'} disabled={loading}
            onClick={() => switchMode('password')}><UserRound />{i18n.t('账号登录')}</Button>
          <Button type="button" variant={mode === 'token' ? 'secondary' : 'ghost'} size="sm" aria-pressed={mode === 'token'} disabled={loading}
            onClick={() => switchMode('token')}><KeyRound />{i18n.t('访问令牌')}</Button>
        </div>
        <form className="console-login-form" noValidate onSubmit={event => {
          event.preventDefault()
          if (mode === 'password') void handlePasswordLogin(apiBase)
          else void handleLogin(apiBase, token)
        }}>
          {mode === 'token' && savedLogins.length > 0 && <div className="console-login-field">
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
          {mode === 'password' && <>
            <div className="console-login-field">
              <label htmlFor={USERNAME_ID}>{i18n.t('用户名')}</label>
              <Input id={USERNAME_ID} ref={usernameRef} type="text" required disabled={loading} autoComplete="username" spellCheck={false}
                autoCapitalize="none" value={username}
                aria-invalid={errors.username ? true : undefined} aria-describedby={describedBy(errors.username && USERNAME_ERROR_ID)}
                onChange={event => { setUsername(event.target.value); setErrors(current => ({ ...current, username: undefined, form: undefined })) }} />
              {errors.username && <p id={USERNAME_ERROR_ID} className="console-login-error">{errors.username}</p>}
            </div>
            <div className="console-login-field">
              <label htmlFor={PASSWORD_ID}>{i18n.t('密码')}</label>
              <div className="console-login-token">
                <Input id={PASSWORD_ID} ref={passwordRef} type={showPassword ? 'text' : 'password'} required disabled={loading} autoComplete="current-password"
                  value={password} aria-invalid={errors.password ? true : undefined} aria-describedby={describedBy(errors.password && PASSWORD_ERROR_ID)}
                  onChange={event => { setPassword(event.target.value); setErrors(current => ({ ...current, password: undefined, form: undefined })) }} />
                <Button type="button" variant="ghost" size="icon" disabled={loading} aria-pressed={showPassword}
                  aria-label={i18n.t(showPassword ? '隐藏密码' : '显示密码')} onClick={() => setShowPassword(visible => !visible)}>{showPassword ? <EyeOff /> : <Eye />}</Button>
              </div>
              {errors.password && <p id={PASSWORD_ERROR_ID} className="console-login-error">{errors.password}</p>}
            </div>
          </>}
          {mode === 'token' && <div className="console-login-field">
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
            <small>{i18n.t('API 令牌，或首次初始化时使用的初始化令牌。')}</small>
          </div>}
          {errors.form && <p id={SUMMARY_ID} ref={summaryRef} className="console-login-error" role="alert" tabIndex={-1}>{errors.form}</p>}
          <label className="console-login-remember"><Checkbox checked={remember} disabled={loading} onCheckedChange={value => setRemember(value === true)} /><span>{i18n.t('记住此连接')}</span></label>
          {!remember && <p className="console-login-session-note">{i18n.t(mode === 'password' ? '登录状态仅保留在本次浏览器会话。' : '访问令牌仅保留在本次浏览器会话。')}</p>}
          <Button type="submit" disabled={loading || lockedUntil > 0}>{loading ? i18n.t('验证中...')
            : mode === 'password' ? i18n.t('登录')
            : selectedSavedBase && token ? i18n.t('快速连接') : i18n.t('连接')}</Button>
          <details className="console-login-help"><summary>{i18n.t('无法连接？')}</summary><p>{i18n.t('填写 Bot 启动日志中的 Host 地址。使用本地地址时，请确保 Host 的 corsOrigins 允许当前 Console 来源。')}</p></details>
        </form>
        {/* Cancelling (or closing after confirmLink ran) drops the link token; the address stays prefilled. */}
        <ConfirmDialog open={pendingLink !== null} title={i18n.t('连接到这个 Host？')}
          description={i18n.t('此链接会用其中的访问令牌登录 {0}。该地址不在已保存的连接中，只有信任它时才继续；取消则只填入地址。', [pendingHost?.ok ? pendingHost.value : pendingLink?.apiBase ?? ''])}
          confirmLabel={i18n.t('连接')} onConfirm={confirmLink}
          onOpenChange={open => { if (!open) setPendingLink(null) }} />
      </section>
    </div>
  </div>
}

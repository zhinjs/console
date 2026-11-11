import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Database, ShieldCheck, UserRoundPlus, Loader2, CheckCircle2, AlertCircle, LogOut } from 'lucide-react'
import { useI18n } from '../../i18n'
import { LanguageSelect } from '../../components/LanguageSelect'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { SelectField } from '../../components/ui/select'
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group'
import {
  createFirstOwner, getSetupDatabase, getSetupStatus, hostAnswers, saveSetupDatabase, testSetupDatabase,
} from '../../utils/console-auth-api'
import {
  KEEP_DATABASE, MIN_PASSWORD_LENGTH, authErrorMessage, connectionKey, connectionPayload, databaseSummaryText,
  defaultDatabaseChoice, initialConnectionValues, missingConnectionFields, newPasswordProblem, normalizeUsername,
  usernameProblem, waitForHost, type AuthFailure,
} from '../../utils/console-auth-model.mjs'
import { setHostOnboarding } from '../../utils/console-session.mjs'
import { notifyAuthRequired } from '../../utils/auth'
import type { SetupDatabaseChoices, SetupDatabaseField, SetupDatabaseProbe, SetupDriver } from '../../contracts/console-auth'
import '../login.css'
import './setup.css'

interface SetupWizardProps {
  /** The owner exists and the Console holds their session. */
  onComplete: () => void
  /** Present when the wizard was opened from the shell (open local Host). */
  onCancel?: () => void
}

type Step = 'database' | 'owner'
type Phase = 'loading' | 'ready' | 'restarting' | 'restart-manual' | 'blocked'

/** Labels for the connection fields the Host's dialect definitions declare. */
function fieldLabel(field: SetupDatabaseField, t: (message: string) => string): string {
  switch (field.name) {
    case 'filename': return t('数据库文件')
    case 'host': return t('主机')
    case 'port': return t('端口')
    case 'user': return t('用户名')
    case 'password': return t('密码')
    case 'database': case 'dbName': return t('数据库名')
    case 'url': return t('连接地址')
    default: return field.name
  }
}

/**
 * First-run setup (zhinjs/zhin ADR 0049 §7, ADR 0053 §2 steps 1–2), driven by `GET /auth/setup`
 * with the bootstrap token: database (keep, or pick a driver, test, save + restart), then the owner.
 */
export default function SetupWizard({ onComplete, onCancel }: SetupWizardProps) {
  const i18n = useI18n()
  const [step, setStep] = useState<Step>('database')
  const [phase, setPhase] = useState<Phase>('loading')
  const [blocked, setBlocked] = useState<AuthFailure | null>(null)
  const [choices, setChoices] = useState<SetupDatabaseChoices | null>(null)
  const [choice, setChoice] = useState<string>(defaultDatabaseChoice())
  const [values, setValues] = useState<Record<string, string>>({})
  const [probe, setProbe] = useState<{ key: string; result: SetupDatabaseProbe } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'test' | 'save' | 'owner' | null>(null)
  const [notice, setNotice] = useState('')
  const restartAbort = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    setPhase('loading')
    setError('')
    const status = await getSetupStatus()
    if (!status.ok) {
      setBlocked(status)
      setPhase('blocked')
      return
    }
    setHostOnboarding(status.data.onboarding)
    if (!status.data.setupRequired) {
      setBlocked({ ok: false, status: 409, code: 'conflict', message: '' })
      setPhase('blocked')
      return
    }
    const database = await getSetupDatabase()
    if (!database.ok) {
      setBlocked(database)
      setPhase('blocked')
      return
    }
    setChoices(database.data)
    setChoice(defaultDatabaseChoice())
    setProbe(null)
    setPhase('ready')
  }, [])

  useEffect(() => {
    void load()
    return () => restartAbort.current?.abort()
  }, [load])

  const driver: SetupDriver | null = useMemo(
    () => choices?.drivers.find(item => item.dialect === choice) ?? null, [choices, choice])
  const payload = useMemo(() => connectionPayload(driver, values), [driver, values])
  const tested = probe !== null && probe.key === connectionKey(payload) && probe.result.ok

  const selectDriver = (value: string) => {
    setChoice(value)
    setError('')
    setProbe(null)
    const next = choices?.drivers.find(item => item.dialect === value)
    setValues(next ? initialConnectionValues(next) : {})
  }

  const runTest = async () => {
    if (!driver) return
    const missing = missingConnectionFields(driver, values)
    if (missing.length) {
      setError(i18n.t('请填写：{0}', [missing.map(name => fieldLabel(driver.fields.find(field => field.name === name)!, i18n.t)).join('、')]))
      return
    }
    setBusy('test')
    setError('')
    const result = await testSetupDatabase(payload)
    setBusy(null)
    if (!result.ok) {
      setError(authErrorMessage(result, i18n.t, 'setup'))
      return
    }
    setProbe({ key: connectionKey(payload), result: result.data })
  }

  const awaitRestart = async () => {
    restartAbort.current?.abort()
    const controller = new AbortController()
    restartAbort.current = controller
    setPhase('restarting')
    const back = await waitForHost({ probe: hostAnswers, signal: controller.signal })
    if (controller.signal.aborted) return
    if (!back) {
      setPhase('restart-manual')
      setError(i18n.t('Host 还没有恢复。请确认它已重新启动，然后继续。'))
      return
    }
    await load()
    setStep('owner')
  }

  const save = async () => {
    if (!driver || !tested) return
    setBusy('save')
    setError('')
    const result = await saveSetupDatabase(payload)
    setBusy(null)
    if (!result.ok) {
      setError(authErrorMessage(result, i18n.t, 'setup'))
      return
    }
    setNotice(result.data.notice ?? '')
    if (result.data.restarting) await awaitRestart()
    else setPhase('restart-manual')
  }

  const continueAfterManualRestart = async () => {
    setError('')
    if (await hostAnswers()) {
      await load()
      setStep('owner')
    } else {
      setError(i18n.t('Host 还没有恢复。请确认它已重新启动，然后继续。'))
    }
  }

  const steps: Array<{ id: Step; label: string; icon: typeof Database }> = [
    { id: 'database', label: i18n.t('数据库'), icon: Database },
    { id: 'owner', label: i18n.t('所有者'), icon: UserRoundPlus },
  ]

  return <div className="console-login console-setup">
    <div className="console-setup-layout">
      <header className="console-setup-head">
        <div className="console-login-brand"><span className="console-login-mark" aria-hidden="true">Z</span><span>Zhin Console</span></div>
        <div className="console-setup-head-actions">
          <LanguageSelect />
          {onCancel
            ? <Button type="button" variant="ghost" size="sm" onClick={onCancel}>{i18n.t('返回')}</Button>
            : <Button type="button" variant="ghost" size="sm" onClick={() => notifyAuthRequired()}><LogOut />{i18n.t('断开')}</Button>}
        </div>
      </header>
      <section className="console-login-panel console-setup-panel" aria-labelledby="console-setup-title">
        <h1 id="console-setup-title" className="console-setup-title">{i18n.t('初始化这台机器人')}</h1>
        <p className="console-setup-lead">
          <ShieldCheck aria-hidden="true" />
          <span>{i18n.t('你正在使用初始化令牌。创建第一个所有者之后，它会立即失效，以后用账号登录。')}</span>
        </p>
        <ol className="console-setup-steps" aria-label={i18n.t('初始化步骤')}>
          {steps.map((item, index) => {
            const Icon = item.icon
            const state = item.id === step ? 'current' : index < steps.findIndex(s => s.id === step) ? 'done' : 'todo'
            return <li key={item.id} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="console-setup-step-mark">{state === 'done' ? <CheckCircle2 aria-hidden="true" /> : <Icon aria-hidden="true" />}</span>
              <span>{i18n.t('第 {0} 步', [index + 1])} · {item.label}</span>
            </li>
          })}
        </ol>

        {phase === 'loading' && <p className="console-setup-status" role="status"><Loader2 className="animate-spin" aria-hidden="true" />{i18n.t('正在读取初始化状态…')}</p>}

        {phase === 'blocked' && blocked && <div className="console-setup-blocked">
          <p className="console-login-error" role="alert">{authErrorMessage(blocked, i18n.t, 'setup')}</p>
          <div className="console-setup-actions">
            {blocked.code === 'conflict'
              ? <Button type="button" onClick={() => notifyAuthRequired()}>{i18n.t('用账号登录')}</Button>
              : <Button type="button" variant="outline" onClick={() => void load()}>{i18n.t('重试')}</Button>}
          </div>
        </div>}

        {(phase === 'restarting' || phase === 'restart-manual') && <div className="console-setup-restart" role="status">
          {phase === 'restarting'
            ? <p className="console-setup-status"><Loader2 className="animate-spin" aria-hidden="true" />{i18n.t('数据库已保存，Host 正在重启，完成后自动继续…')}</p>
            : <p>{i18n.t('数据库已保存。重启 Host 后新数据库才会生效。')}</p>}
          {notice && <p className="console-setup-note">{notice}</p>}
          {error && <p className="console-login-error" role="alert">{error}</p>}
          {phase === 'restart-manual' && <Button type="button" onClick={() => void continueAfterManualRestart()}>{i18n.t('Host 已重启，继续')}</Button>}
        </div>}

        {phase === 'ready' && step === 'database' && choices && <div className="console-setup-body">
          <h2>{i18n.t('选择数据库')}</h2>
          <p className="console-setup-note">{i18n.t('账号、角色与审计日志存放在这里。可以先保持当前数据库，以后在「运维 → 配置文件」里修改。')}</p>
          <RadioGroup aria-label={i18n.t('选择数据库')} name="setup-database" value={choice} onValueChange={selectDriver}>
            <label className="console-choice-card">
              <RadioGroupItem value={KEEP_DATABASE} className="mt-1" />
              <span>
                <span className="font-medium">{i18n.t('保持当前数据库')}（{choices.dialect}）</span>
                <span className="block text-xs text-muted-foreground">
                  {choices.source === 'config' ? i18n.t('来自配置文件') : i18n.t('默认数据库')}
                  {databaseSummaryText(choices.summary) ? ` · ${databaseSummaryText(choices.summary)}` : ''}
                </span>
              </span>
            </label>
            {choices.drivers.map(item => <label key={item.dialect} className="console-choice-card" data-disabled={!item.available || undefined}>
              <RadioGroupItem value={item.dialect} disabled={!item.available} className="mt-1" />
              <span>
                <span className="font-medium">{item.label}</span>
                <span className="block text-xs text-muted-foreground">{item.description}</span>
                {!item.available && item.missingPackage && <span className="block text-xs text-muted-foreground">
                  {i18n.t('需要先安装驱动：在项目目录运行 pnpm add {0}，然后刷新此页。', [item.missingPackage])}
                </span>}
              </span>
            </label>)}
          </RadioGroup>

          {driver && <fieldset className="console-setup-fields">
            <legend>{i18n.t('连接 {0}', [driver.label])}</legend>
            {driver.fields.map(field => {
              const id = `console-setup-db-${field.name}`
              const label = fieldLabel(field, i18n.t)
              return <div key={field.name} className="console-login-field">
                <label htmlFor={id}>{label}{field.required ? ' *' : ''}</label>
                {field.type === 'enum' && field.options
                  ? <SelectField id={id} value={values[field.name] ?? ''} disabled={busy !== null}
                    options={field.options.map(option => ({ value: option, label: option }))}
                    onValueChange={value => setValues(current => ({ ...current, [field.name]: value }))} />
                  : <Input id={id} type={field.secret ? 'password' : 'text'} inputMode={field.type === 'integer' ? 'numeric' : undefined}
                    autoComplete={field.secret ? 'new-password' : 'off'} spellCheck={false} disabled={busy !== null}
                    value={values[field.name] ?? ''} placeholder={field.default !== undefined ? String(field.default) : undefined}
                    onChange={event => { const value = event.target.value; setValues(current => ({ ...current, [field.name]: value })) }} />}
                {field.secret && field.env && <small>{i18n.t('保存到项目 .env 的 {0}，配置文件里只写引用；也可以填 ${变量名} 引用已有变量。', [field.env])}</small>}
              </div>
            })}
            <p className="console-setup-note">{i18n.t('切换数据库不会迁移旧库数据：插件数据仍留在原数据库。')}</p>
            {probe && <p className={probe.result.ok ? 'console-setup-ok' : 'console-login-error'} role="status">
              {probe.result.ok
                ? <><CheckCircle2 aria-hidden="true" />{typeof probe.result.latencyMs === 'number' ? i18n.t('连接成功（{0} ms）', [probe.result.latencyMs]) : i18n.t('连接成功')}</>
                : <><AlertCircle aria-hidden="true" />{i18n.t('连接失败：{0}', [probe.result.error ?? ''])}</>}
            </p>}
            {probe?.result.ok && !tested && <p className="console-setup-note">{i18n.t('连接信息已修改，请重新测试。')}</p>}
          </fieldset>}

          {error && <p className="console-login-error" role="alert">{error}</p>}
          <div className="console-setup-actions">
            {driver
              ? <>
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void runTest()}>
                  {busy === 'test' ? i18n.t('测试中…') : i18n.t('测试连接')}</Button>
                <Button type="button" disabled={busy !== null || !tested} onClick={() => void save()}
                  title={tested ? undefined : i18n.t('先测试连接，成功后才能保存')}>
                  {busy === 'save' ? i18n.t('保存中…') : i18n.t('保存并重启 Host')}</Button>
              </>
              : <Button type="button" onClick={() => { setError(''); setStep('owner') }}>{i18n.t('下一步')}</Button>}
          </div>
        </div>}

        {phase === 'ready' && step === 'owner' && <OwnerForm busy={busy === 'owner'} onBack={() => setStep('database')}
          onSubmit={async input => {
            setBusy('owner')
            const result = await createFirstOwner(input)
            setBusy(null)
            if (result.ok) { onComplete(); return null }
            return authErrorMessage(result, i18n.t, 'setup')
          }} />}
      </section>
    </div>
  </div>
}

type OwnerProblem = Partial<Record<'username' | 'password' | 'confirm' | 'form', string>>

function OwnerForm({ busy, onBack, onSubmit }: {
  busy: boolean
  onBack: () => void
  /** Resolves to an error message, or null on success. */
  onSubmit: (input: { username: string; password: string; displayName?: string }) => Promise<string | null>
}) {
  const i18n = useI18n()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problems, setProblems] = useState<OwnerProblem>({})

  const submit = async () => {
    const next: OwnerProblem = {}
    const nameProblem = usernameProblem(username)
    if (nameProblem === 'empty') next.username = i18n.t('请输入用户名。')
    if (nameProblem === 'format') next.username = i18n.t('用户名只能包含小写字母、数字、点、下划线和连字符，2–64 位，以字母或数字开头。')
    const passwordProblem = newPasswordProblem(password, confirm)
    if (passwordProblem === 'empty') next.password = i18n.t('请输入密码。')
    if (passwordProblem === 'short') next.password = i18n.t('密码至少 {0} 位。', [MIN_PASSWORD_LENGTH])
    if (passwordProblem === 'mismatch') next.confirm = i18n.t('两次输入的密码不一致。')
    setProblems(next)
    if (Object.keys(next).length) return
    const message = await onSubmit({ username: normalizeUsername(username), password, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) })
    if (message) setProblems({ form: message })
  }

  const field = (id: string, label: string, value: string, set: (value: string) => void, extra: {
    type?: string; autoComplete?: string; problem?: string; hint?: string
  } = {}) => <div className="console-login-field">
    <label htmlFor={id}>{label}</label>
    <Input id={id} type={extra.type ?? 'text'} autoComplete={extra.autoComplete} spellCheck={false} autoCapitalize="none" disabled={busy}
      value={value} aria-invalid={extra.problem ? true : undefined} aria-describedby={extra.problem ? `${id}-error` : extra.hint ? `${id}-hint` : undefined}
      onChange={event => { set(event.target.value); setProblems({}) }} />
    {extra.hint && <small id={`${id}-hint`}>{extra.hint}</small>}
    {extra.problem && <p id={`${id}-error`} className="console-login-error">{extra.problem}</p>}
  </div>

  return <form className="console-setup-body" noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
    <h2>{i18n.t('创建所有者')}</h2>
    <p className="console-setup-note">{i18n.t('所有者拥有全部权限，可以再添加其他账号。请妥善保管密码：忘记时只能在服务器上用 zhin console user passwd 重置。')}</p>
    {field('console-setup-username', i18n.t('用户名'), username, setUsername, { autoComplete: 'username', problem: problems.username, hint: i18n.t('小写字母、数字、点、下划线和连字符。') })}
    {field('console-setup-display-name', i18n.t('显示名称（可选）'), displayName, setDisplayName, { autoComplete: 'name' })}
    {field('console-setup-password', i18n.t('密码'), password, setPassword, { type: 'password', autoComplete: 'new-password', problem: problems.password, hint: i18n.t('至少 {0} 位。', [MIN_PASSWORD_LENGTH]) })}
    {field('console-setup-confirm', i18n.t('确认密码'), confirm, setConfirm, { type: 'password', autoComplete: 'new-password', problem: problems.confirm })}
    {problems.form && <p className="console-login-error" role="alert">{problems.form}</p>}
    <div className="console-setup-actions">
      <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>{i18n.t('上一步')}</Button>
      <Button type="submit" disabled={busy}>{busy ? i18n.t('创建中…') : i18n.t('创建所有者并登录')}</Button>
    </div>
  </form>
}

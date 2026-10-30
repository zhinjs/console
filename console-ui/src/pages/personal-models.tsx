import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, Loader2, Plus, RefreshCw } from 'lucide-react'
import { useI18n } from '../i18n'
import { apiFetch } from '../utils/auth'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { agentSessionsPath } from '../utils/agent-session'
import { isDemoMode } from '../utils/demo-mode'
import { PageShell } from '../components/PageShell'
import { PageHeader } from '../components/PageHeader'
import { ErrorAlert } from '../components/error-alert'
import { EmptyState } from '../components/empty-state'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { SelectField } from '../components/ui/select'
import { Checkbox } from '../components/ui/checkbox'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { PersonalSessionModelPicker } from './PersonalSessionModelPicker'
import {
  PERSONAL_MODEL_SDKS, personalModelRequiresApiKey, personalModelEntry, personalModelFailure, readPersonalModelsView, readPersonalSessionRows, personalSessionQuery,
  type PersonalModelsView, type PersonalOwnerModels, type PersonalSessionRow, type ModelCapabilities,
} from './personal-models-model.mjs'

export default function PersonalModelsPage() {
  const scope = useInboxCacheScope()
  return <PersonalModelsWorkspace key={scope ?? 'disconnected'} scope={scope} />
}
function PersonalModelsWorkspace({ scope }: { scope?: string }) {
  const i18n = useI18n()
  const [view, setView] = useState<PersonalModelsView | null>(null)
  const [ownerId, setOwnerId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const sequence = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current += 1 } }, [])
  const load = useCallback(async () => {
    if (!isInboxCacheScopeActive(scope)) return
    const current = ++sequence.current
    setLoading(true); setError('')
    try {
      const response = await apiFetch('/api/agent/personal-models', { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok || body.success !== true) { if (current === sequence.current && mounted.current && isInboxCacheScopeActive(scope)) setError(personalModelFailure(response.status, body.code)); return }
      const result = readPersonalModelsView(body)
      if (current === sequence.current && mounted.current && isInboxCacheScopeActive(scope)) {
        setView(result)
        setOwnerId(previous => result.owners.some(owner => owner.ownerId === previous) ? previous : result.owners.length === 1 ? result.owners[0].ownerId : '')
      }
    } catch { if (current === sequence.current && mounted.current && isInboxCacheScopeActive(scope)) setError('个人模型请求失败，请检查输入后重试。') }
    finally { if (current === sequence.current && mounted.current) setLoading(false) }
  }, [scope])
  useEffect(() => { void load() }, [load])
  const selected = view?.owners.find(owner => owner.ownerId === ownerId)
  return <PageShell>
    <PageHeader title={i18n.t('个人模型')} description={i18n.t('管理自己的模型连接，为每个个人会话选择模型。')}
      actions={<Button variant="outline" onClick={() => void load()} disabled={loading || !scope}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>} />
    {error ? <ErrorAlert error={i18n.t(error)} onRetry={() => void load()} /> : null}
    {!scope ? <EmptyState title={i18n.t('请先登录个人账号。')} /> : null}
    {view && view.owners.length > 0 ? <>
      <label className="block max-w-xl space-y-2 text-sm font-medium">
        <span>{i18n.t('个人身份')}</span>
        <SelectField aria-label={i18n.t('个人身份')} value={ownerId} onValueChange={setOwnerId}
          options={[{ value: '', label: i18n.t('请选择个人身份') }, ...view.owners.map(owner => ({ value: owner.ownerId, label: `${owner.owner.platform} · ${owner.owner.endpoint} · ${owner.owner.subjectId}` }))]} />
      </label>
      {selected ? <PersonalOwnerWorkspace key={selected.ownerId} owner={selected} scope={scope} reload={load} /> : null}
    </> : null}
    {loading && !view ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" />{i18n.t('正在加载…')}</p> : null}
  </PageShell>
}
function PersonalOwnerWorkspace({ owner, scope, reload }: { owner: PersonalOwnerModels; scope?: string; reload: () => Promise<void> }) {
  const i18n = useI18n()
  const [editing, setEditing] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [saved, setSaved] = useState(false)
  return <>
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3"><CardTitle>{i18n.t('我的模型连接')}</CardTitle>
          <Button variant="outline" onClick={() => { setEditing(null); setSaved(false); setFormKey(value => value + 1) }}><Plus />{i18n.t('新增连接')}</Button></div>
        <CardDescription>{i18n.t('API Key 只用于此个人身份，不会随会话记录导出。')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {owner.presets.length ? <div className="divide-y rounded-md border">{owner.presets.map(preset => {
          const model = owner.models.find(model => model.id === preset.modelId)!
          const connection = owner.connections.find(connection => connection.id === model.connectionId)!
          return <div key={preset.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0"><p className="font-medium">{model.model}</p><p className="break-all text-xs text-muted-foreground">{connection.sdk} · {connection.baseUrl}</p></div>
            <Button variant="outline" size="sm" onClick={() => { setEditing(preset.id); setSaved(false); setFormKey(value => value + 1) }}>{i18n.t('编辑')}</Button>
          </div>
        })}</div> : <p className="text-sm text-muted-foreground">{i18n.t('还没有个人模型连接。')}</p>}
        {saved ? <Alert variant="success"><AlertDescription>{i18n.t('模型连接已保存。')}</AlertDescription></Alert> : null}
        <PersonalModelForm key={`${owner.ownerId}:${owner.revision}:${formKey}`} owner={owner} presetId={editing} scope={scope}
          onSaved={async () => { setEditing(null); setSaved(true); setFormKey(value => value + 1); await reload() }} />
      </CardContent>
    </Card>
    <PersonalSessionDirectory key={owner.ownerId} owner={owner} scope={scope} />
  </>
}
function PersonalModelForm({ owner, presetId, scope, onSaved }: {
  owner: PersonalOwnerModels; presetId: string | null; scope?: string; onSaved: () => Promise<void>
}) {
  const i18n = useI18n()
  const preset = owner.presets.find(value => value.id === presetId)
  const model = preset && owner.models.find(value => value.id === preset.modelId)
  const connection = model && owner.connections.find(value => value.id === model.connectionId)
  const [sdk, setSdk] = useState(connection?.sdk ?? '')
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '')
  const [modelName, setModel] = useState(model?.model ?? '')
  const [apiKey, setApiKey] = useState('')
  const requiresApiKey = personalModelRequiresApiKey(sdk, connection?.hasKey ?? false)
  const [capabilities, setCapabilities] = useState<ModelCapabilities>(() => structuredClone(model?.capabilities ?? {}))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving || isDemoMode() || !isInboxCacheScopeActive(scope) || (requiresApiKey && !apiKey.trim())) return
    const entry = personalModelEntry({ presetId, sdk, baseUrl, model: modelName, capabilities, apiKey })
    // Clear the write-only secret before awaiting fetch; failures require deliberate re-entry.
    setApiKey(''); setSaving(true); setError('')
    try {
      const response = await apiFetch('/api/agent/personal-models', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: owner.owner, expectedRevision: owner.revision, entry }) })
      const body = await response.json()
      if (!mounted.current || !isInboxCacheScopeActive(scope)) return
      if (!response.ok || body.success !== true) { setError(response.status >= 500 ? '提交结果尚未确认，请刷新查看后再操作。' : personalModelFailure(response.status, body.code)); return }
      await onSaved()
    } catch { if (mounted.current && isInboxCacheScopeActive(scope)) setError('提交结果尚未确认，请刷新查看后再操作。') }
    finally { if (mounted.current) setSaving(false) }
  }
  const fieldClass = 'space-y-2 text-sm font-medium'
  const disabled = saving || isDemoMode()
  return <form onSubmit={event => void submit(event)} className="space-y-5">
    <h3 className="text-sm font-semibold">{i18n.t(presetId ? '编辑模型连接' : '新增模型连接')}</h3>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className={fieldClass}><span>{i18n.t('协议')}</span><SelectField value={sdk} onValueChange={setSdk} disabled={disabled}
        aria-label={i18n.t('协议')} options={[{ value: '', label: i18n.t('请选择协议') }, ...PERSONAL_MODEL_SDKS.map(value => ({ value, label: value }))]} /></label>
      <label className={fieldClass}><span>{i18n.t('模型名称')}</span><Input value={modelName} onChange={event => setModel(event.target.value)} required disabled={disabled} autoComplete="off" /></label>
      <label className={`${fieldClass} sm:col-span-2`}><span>Base URL</span><Input type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} required disabled={disabled} placeholder="https://api.example.com/v1" autoComplete="off" />
        <span className="block text-xs font-normal text-muted-foreground">{i18n.t('个人连接仅支持公网 HTTPS 地址。')}</span></label>
      <label className={`${fieldClass} sm:col-span-2`}><span>API Key</span><Input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} required={requiresApiKey} disabled={disabled} autoComplete="off"
        placeholder={connection?.hasKey ? i18n.t('已保存密钥；留空保持现有密钥') : i18n.t('输入 API Key')} />
      </label>
    </div>
    <details className="rounded-md border p-4"><summary className="cursor-pointer text-sm font-medium">{i18n.t('模型能力（可选）')}</summary>
      <p className="my-3 text-xs text-muted-foreground">{i18n.t('能力声明用于匹配模型，不授予工具权限。')}</p>
      <fieldset className="space-y-3" disabled={disabled}><legend className="mb-2 text-sm">{i18n.t('支持的输入')}</legend>
        <div className="flex flex-wrap gap-4">{(['text', 'image', 'audio', 'video', 'file'] as const).map((value, index) => <label key={value} className="flex items-center gap-2 text-sm">
          <Checkbox checked={capabilities.input?.includes(value) ?? false} onCheckedChange={checked => setCapabilities(previous => ({ ...previous,
            input: checked === true ? [...(previous.input ?? []), value] : (previous.input ?? []).filter(item => item !== value) }))} />
          {i18n.t(['文本', '图片', '音频', '视频', '文件'][index])}</label>)}</div>
        <div className="grid gap-3 sm:grid-cols-3">{(['streaming', 'toolCalling', 'thinking'] as const).map((key, index) => <label key={key} className={fieldClass}>
          <span>{i18n.t(['流式输出', '工具调用能力', '推理能力'][index])}</span>
          <SelectField value={capabilities[key] === undefined ? '' : String(capabilities[key])} onValueChange={value => setCapabilities(previous => {
            const next = { ...previous }; if (value === '') delete next[key]; else next[key] = value === 'true'; return next
          })} options={[{ value: '', label: i18n.t('未声明') }, { value: 'true', label: i18n.t('支持') }, { value: 'false', label: i18n.t('不支持') }]} />
        </label>)}</div>
      </fieldset>
    </details>
    {error ? <ErrorAlert error={i18n.t(error)} /> : null}
    <Button type="submit" disabled={disabled || !sdk || !modelName.trim() || !baseUrl.trim() || (requiresApiKey && !apiKey.trim())}>
      {saving ? <Loader2 className="animate-spin" /> : <KeyRound />}{i18n.t('保存模型连接')}
    </Button>
  </form>
}
function PersonalSessionDirectory({ owner, scope }: { owner: PersonalOwnerModels; scope?: string }) {
  const i18n = useI18n()
  const [rows, setRows] = useState<PersonalSessionRow[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const sequence = useRef(0)
  useEffect(() => () => { sequence.current += 1 }, [])
  const load = async (more = false) => {
    if (loading || !isInboxCacheScopeActive(scope)) return
    const current = ++sequence.current
    setLoading(true); setError('')
    try {
      const response = await apiFetch(personalSessionQuery(owner.owner, more ? rows?.length ?? 0 : 0), { cache: 'no-store' })
      const body = await response.json()
      if (!isInboxCacheScopeActive(scope) || current !== sequence.current) return
      if (!response.ok || body.success !== true) { setError(personalModelFailure(response.status, body.code)); return }
      const result = readPersonalSessionRows(body, owner.owner)
      setRows(previous => more ? [...(previous ?? []), ...result.rows] : result.rows); setHasMore(result.hasMore)
    } catch { if (isInboxCacheScopeActive(scope) && current === sequence.current) setError('个人会话目录读取失败。') }
    finally { if (current === sequence.current) setLoading(false) }
  }
  const row = rows?.find(row => row.sessionKey === selected)
  return <Card>
    <CardHeader><CardTitle>{i18n.t('我的会话')}</CardTitle><CardDescription>{i18n.t('只显示此个人身份自己的会话。')}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}{i18n.t(rows === null ? '加载我的会话' : '刷新')}</Button>
      {error ? <ErrorAlert error={i18n.t(error)} /> : null}
      {rows && rows.length === 0 ? <p className="text-sm text-muted-foreground">{i18n.t('还没有个人会话。')}</p> : null}
      {rows && rows.length > 0 ? <label className="block space-y-2 text-sm font-medium"><span>{i18n.t('选择个人会话')}</span>
        <SelectField value={selected} onValueChange={setSelected} aria-label={i18n.t('选择个人会话')}
          options={[{ value: '', label: i18n.t('请选择会话') }, ...rows.map(row => ({ value: row.sessionKey, label: `${row.address.conversation.id}${row.address.conversation.threadId ? ` · ${row.address.conversation.threadId}` : ''}` }))]} /></label> : null}
      {hasMore ? <Button variant="outline" onClick={() => void load(true)} disabled={loading}>{i18n.t('加载更多')}</Button> : null}
      {row ? <><PersonalSessionModelPicker key={row.sessionKey} sessionKey={row.sessionKey} address={row.address} ownerModels={owner} connectionScope={scope} />
        <Button variant="link" asChild><Link to={`${agentSessionsPath(row.sessionKey)}&personalOwner=${encodeURIComponent(owner.ownerId)}`}>{i18n.t('打开个人会话')}</Link></Button></> : null}
    </CardContent>
  </Card>
}

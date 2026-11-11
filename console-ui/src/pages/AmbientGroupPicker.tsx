import { useI18n } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { requestConsole } from '../utils/console-rpc'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { ENDPOINT_RPC } from '../contracts/zhin-console'
import { ErrorAlert } from '../components/error-alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Input } from '../components/ui/input'
import { describeReadFailure } from './ambient-engagement-model.mjs'
import {
  addManualGroups,
  buildGroupCatalog,
  groupNamesFromCatalog,
  groupPickerView,
  groupsOutsideCatalog,
  readGroupEndpoints,
  toggleGroupSelection,
  type GroupCatalog,
  type GroupListResult,
} from './ambient-group-picker-model.mjs'

export interface AmbientGroupCatalogRead {
  loading: boolean
  error: string | null
  catalog: GroupCatalog | null
  retry: () => void
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Group lists of every connected account, read only while the picker is shown. One account failing does not hide the others. */
export function useAmbientGroupCatalog(): AmbientGroupCatalogRead {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  const sequence = useRef(0)
  const [state, setState] = useState<Omit<AmbientGroupCatalogRead, 'retry'>>({ loading: true, error: null, catalog: null })
  const load = useCallback(async () => {
    const request = ++sequence.current
    const current = () => request === sequence.current && isInboxCacheScopeActive(scope)
    setState({ loading: true, error: null, catalog: null })
    try {
      const endpoints = readGroupEndpoints(await requestConsole({ type: ENDPOINT_RPC.LIST }), i18n.locale).filter((endpoint) => endpoint.connected)
      const results = await Promise.all(endpoints.map((endpoint): Promise<GroupListResult> =>
        requestConsole<{ groups?: unknown }>({ type: ENDPOINT_RPC.GROUPS, adapter: endpoint.adapter, endpointKey: endpoint.name }).then(
          (result) => ({ adapter: endpoint.adapter, endpoint: endpoint.name, groups: result?.groups ?? [] }),
          (error: unknown) => ({ adapter: endpoint.adapter, endpoint: endpoint.name, error: errorText(error) }),
        )))
      if (current()) setState({ loading: false, error: null, catalog: buildGroupCatalog(results) })
    } catch (error) {
      if (current()) setState({ loading: false, error: errorText(error), catalog: null })
    }
  }, [scope, i18n.locale])
  useEffect(() => {
    void load()
    return () => { sequence.current += 1 }
  }, [load])
  return { ...state, retry: () => { void load() } }
}

export function AmbientGroupPicker({ groups, onChange }: { groups: string[]; onChange: (groups: string[]) => void }) {
  return <AmbientGroupPickerView groups={groups} onChange={onChange} read={useAmbientGroupCatalog()} />
}

export function AmbientGroupPickerView({ groups, onChange, read }: { groups: string[]; onChange: (groups: string[]) => void; read: AmbientGroupCatalogRead }) {
  const i18n = useI18n()
  const [query, setQuery] = useState('')
  const [manualText, setManualText] = useState('')
  const [manualInvalid, setManualInvalid] = useState<string[]>([])
  const view = groupPickerView({ loading: read.loading, error: read.error, catalog: read.catalog, query })
  const catalog = read.catalog ?? { sections: [], failures: [] }
  const names = groupNamesFromCatalog(catalog)
  const outside = new Set(read.catalog ? groupsOutsideCatalog(groups, read.catalog) : groups)
  const listUsable = view.kind === 'ready' || view.kind === 'no-match'
  const groupListLabel = i18n.t("群列表")

  const addManual = () => {
    const result = addManualGroups(groups, manualText)
    setManualInvalid(result.invalid)
    if (result.invalid.length > 0 || result.groups === groups) return
    onChange(result.groups)
    setManualText('')
  }

  return <div className="space-y-3">
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{i18n.t("已选的群（{0}）", [groups.length])}</p>
      {groups.length === 0
        ? <p className="text-sm text-muted-foreground">{i18n.t("还没有选群。")}</p>
        : <ul aria-label={i18n.t("已选的群")} className="divide-y rounded-md border text-sm">
          {groups.map((group) => {
            const name = names.get(group)
            return <li key={group} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block break-all font-medium">{name ?? group}</span>
                {name ? <span className="console-table-sub break-all">{group}</span> : null}
              </span>
              {outside.has(group) && read.catalog ? <Badge variant="secondary">{i18n.t("不在群列表中")}</Badge> : null}
              <Button type="button" variant="ghost" size="icon" aria-label={i18n.t("移除 {0}", [name ?? group])} onClick={() => onChange(groups.filter((item) => item !== group))}><X /></Button>
            </li>
          })}
        </ul>}
    </div>

    <div className="space-y-2 rounded-md border p-3">
      <Input
        type="search"
        aria-label={i18n.t("搜索群名或群号")}
        placeholder={i18n.t("搜索群名、群号或账号")}
        value={query}
        disabled={!listUsable}
        onChange={(event) => setQuery(event.target.value)}
      />
      {view.kind === 'loading' ? <p role="status" className="text-sm text-muted-foreground">{i18n.t("正在读取群列表…")}</p> : null}
      {view.kind === 'denied' ? <p role="status" className="text-sm text-muted-foreground">{describeReadFailure(view.error, groupListLabel, i18n.locale).text} {i18n.t("可以在下面手动填写群号。")}</p> : null}
      {view.kind === 'error' ? <ErrorAlert error={describeReadFailure(view.error, groupListLabel, i18n.locale).text} onRetry={read.retry} /> : null}
      {view.kind === 'empty' ? <p className="text-sm text-muted-foreground">{view.noOnlineAccount ? i18n.t("没有在线的账号，读不到群列表。可以在下面手动填写群号。") : i18n.t("在线账号里没有读到群。可以在下面手动填写群号。")}</p> : null}
      {view.kind === 'no-match' ? <p className="text-sm text-muted-foreground">{i18n.t("没有群名、群号或账号包含「{0}」的群。", [query.trim()])}</p> : null}
      {view.kind === 'ready' ? <div className="max-h-72 space-y-3 overflow-y-auto">
        {view.sections.map((section) => <fieldset key={section.key} className="space-y-1">
          <legend className="text-xs font-medium text-muted-foreground">{section.endpoint} · {section.adapter}</legend>
          {section.groups.map((group) => <label key={group.value} className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50">
            <Checkbox className="mt-0.5" checked={groups.includes(group.value)} onCheckedChange={() => onChange(toggleGroupSelection(groups, group.value))} />
            <span className="min-w-0">
              <span className="block break-all">{group.name || group.id}</span>
              <span className="console-table-sub break-all">{group.value}</span>
            </span>
          </label>)}
        </fieldset>)}
      </div> : null}
      {listUsable && catalog.failures.length > 0 ? <div role="status" className="space-y-1 text-xs text-warning">
        {catalog.failures.map((failure) => <p key={`${failure.adapter}/${failure.endpoint}`} className="break-all">{i18n.t("{0}（{1}）的群列表没读到：{2}", [failure.endpoint, failure.adapter, failure.error])}</p>)}
        <Button type="button" variant="outline" size="sm" onClick={read.retry}>{i18n.t("重新读取群列表")}</Button>
      </div> : null}
    </div>

    <div className="space-y-1">
      <label className="block text-xs font-medium text-muted-foreground" htmlFor="ambient-manual-group">{i18n.t("群不在列表里？手动填写")}</label>
      <div className="flex gap-2">
        <Input
          id="ambient-manual-group"
          placeholder={i18n.t("平台:群号，例如 qq:123456")}
          value={manualText}
          onChange={(event) => { setManualText(event.target.value); setManualInvalid([]) }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addManual() } }}
        />
        <Button type="button" variant="outline" onClick={addManual} disabled={manualText.trim() === ''}>{i18n.t("加入")}</Button>
      </div>
      {manualInvalid.length > 0 ? <p role="alert" className="text-xs text-destructive">{i18n.t("群的写法是「平台:群号」，例如 qq:123456。这些需要改一下：{0}", [manualInvalid.join('、')])}</p> : null}
    </div>
  </div>
}

import { useEffect, useState, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { Card } from '../../components/ui/card'
import { StatusState } from '../../components/StatusState'
import { requestConsole } from '../../utils/console-rpc'
import { ENDPOINT_RPC } from '../../contracts/zhin-console'
import { endpointAddress } from '../endpoint-detail/endpoint-request.mjs'
import { readEndpointList } from '../endpoint-list-model.mjs'
import type { EndpointSummaryItem } from '../features/use-feature-data'
import { FeatureLevelPanel, FeatureReadOnlyNote } from '../features/feature-level-panel'
import { scopeKey, type Scope } from '../../scope/scope-tree.mjs'

/** Label / value pairs at the top of an 概览 tab. */
export function ObjectFacts({ items }: { items: readonly { label: string; value: ReactNode }[] }) {
  return (
    <Card className="p-4">
      <dl className="console-object-facts">
        {items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
      </dl>
    </Card>
  )
}

/** `endpoint.info` for one account; `info` stays null while loading or when the Host does not know it. */
export function useEndpointInfo(adapter: string, endpoint: string) {
  const i18n = useI18n()
  const [state, setState] = useState<{ info: EndpointSummaryItem | null; error: unknown; loaded: boolean }>({ info: null, error: null, loaded: false })
  useEffect(() => {
    let cancelled = false
    requestConsole<unknown>({ type: ENDPOINT_RPC.INFO, ...endpointAddress(adapter, endpoint) }).then(
      data => { if (!cancelled) setState({ info: readEndpointList({ endpoints: [data] }, i18n.locale)[0] ?? null, error: null, loaded: true }) },
      (error: unknown) => { if (!cancelled) setState({ info: null, error, loaded: true }) },
    )
    return () => { cancelled = true }
  }, [adapter, endpoint, i18n.locale])
  return state
}

/** 功能 tab below 全局: switches and overrides of this level, with what it inherits and what is locked. */
export function ScopeFeaturesPanel({ scope }: { scope: Scope }) {
  const i18n = useI18n()
  const key = scopeKey(scope)
  if (scope.level === 'global') return null
  if (key === null) {
    return <StatusState kind="unsupported" title={i18n.t('这个范围不能单独配置功能')}
      description={i18n.t('适配器名称不是实例别名，或账号 ID 含有不支持的字符；这里沿用上级配置。')} />
  }
  return (
    <>
      <FeatureReadOnlyNote />
      <FeatureLevelPanel level={scope.level} levelKey={key} adapter={scope.adapter!} endpoint={scope.endpoint} />
    </>
  )
}

/** 记录 tab: see records-panel.tsx. */
export { ScopeRecordsPanel } from './records-panel'

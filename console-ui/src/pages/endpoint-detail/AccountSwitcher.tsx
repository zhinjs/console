import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bot, Check, ChevronDown, Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useConfirm } from '../../components/confirm-dialog'
import { Button } from '../../components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '../../components/ui/dropdown-menu'
import { ENDPOINT_RPC } from '../../contracts/zhin-console'
import { requestConsole } from '../../utils/console-rpc'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { readEndpointList } from '../endpoint-list-model.mjs'
import type { EndpointInfo } from './types'
import { endpointHref } from '../../console-routes.mjs'
import { SCOPE_ROOT } from '../../scope/scope-tree.mjs'

type DirectoryState = { scope?: string; endpoints: ReturnType<typeof readEndpointList>; loading: boolean; error: string | null }
const accountPath = (adapter: string, name: string) => endpointHref(adapter, name, 'chat')

/** A read-only directory, scoped to the current Host and credentials. */
export function AccountSwitcher({ adapter, endpointId, info, loadErr, hasDraft = false, sending = false, onBeforeLeave }: {
  adapter: string; endpointId: string; info: EndpointInfo | null; loadErr: string | null; hasDraft?: boolean; sending?: boolean; onBeforeLeave?(): void
}) {
  const i18n = useI18n()
  const navigate = useNavigate()
  const scope = useInboxCacheScope()
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [directory, setDirectory] = useState<DirectoryState | null>(null)
  const switching = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const { confirm, ConfirmDialog } = useConfirm()

  useEffect(() => {
    if (!open) return
    let active = true
    setDirectory({ scope, endpoints: [], loading: true, error: null })
    void requestConsole({ type: ENDPOINT_RPC.LIST }).then(data => {
      if (!active || !isInboxCacheScopeActive(scope)) return
      setDirectory({ scope, endpoints: readEndpointList(data, i18n.locale), loading: false, error: null })
    }).catch(error => {
      if (active && isInboxCacheScopeActive(scope)) setDirectory({ scope, endpoints: [], loading: false, error: (error as Error).message })
    })
    return () => { active = false }
  }, [open, scope, revision, i18n.locale])

  // Never render a former Host's directory, even before cleanup effects run.
  const view = directory?.scope === scope && isInboxCacheScopeActive(scope) ? directory : null
  const known = !!info && !loadErr
  const connected = known && info.connected
  const status = !known ? i18n.t('状态未知') : connected ? i18n.t('在线') : i18n.t('离线')
  const guardNavigation = async (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (sending || switching.current || !isInboxCacheScopeActive(scope)) { event.preventDefault(); return }
    if (!hasDraft) return
    event.preventDefault()
    switching.current = true
    setOpen(false)
    onBeforeLeave?.()
    try {
      const approved = await confirm({ title: i18n.t('离开当前聊天？'), description: i18n.t('未发送的文字、附件和引用不会带到另一个账号。'), confirmLabel: i18n.t('放弃草稿并继续') })
      if (approved && isInboxCacheScopeActive(scope)) navigate(path)
    } finally {
      switching.current = false
      if (trigger.current?.isConnected && !trigger.current.closest('[inert]')) trigger.current.focus()
    }
  }

  return <>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button ref={trigger} type="button" className="im-account-switcher" aria-label={i18n.t('切换聊天账号')} disabled={sending}>
          <span className="im-sidebar-endpoint-icon"><Bot className="h-4 w-4" /></span>
          <span className="im-account-identity">
            <span className="im-account-name">{info?.name || endpointId}</span>
            <span className="im-account-meta"><span>{adapter}</span><span className={connected ? 'im-connection-pill im-connection-pill--on' : 'im-connection-pill im-connection-pill--off'}>{connected ? <Wifi size={10} /> : <WifiOff size={10} />}{status}</span></span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="im-account-menu" style={{ zIndex: 1100 }} onCloseAutoFocus={event => { if (switching.current) event.preventDefault() }}>
        <DropdownMenuLabel>{i18n.t('聊天账号')}</DropdownMenuLabel>
        {!view || view.loading ? <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />{i18n.t('加载中')}</p>
          : view.error ? <div className="p-2"><p role="alert" className="mb-2 text-sm text-destructive">{i18n.t('加载失败：{0}', [view.error])}</p><Button type="button" size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}><RefreshCw className="h-4 w-4" />{i18n.t('重试')}</Button></div>
          : view.endpoints.length === 0 ? <p className="p-2 text-sm text-muted-foreground" role="status">{i18n.t('没有可切换的聊天账号')}</p>
          : view.endpoints.map(endpoint => {
            const current = endpoint.adapter === adapter && endpoint.name === endpointId
            const path = accountPath(endpoint.adapter, endpoint.name)
            return <DropdownMenuItem key={path} asChild disabled={sending}>
              <Link to={path} aria-current={current ? 'page' : undefined} onClick={event => { if (current) event.preventDefault(); else void guardNavigation(event, path) }}>
                <Bot className="h-4 w-4" /><span className="im-account-identity"><span className="im-account-name">{endpoint.name}</span><span className="im-account-meta">{endpoint.adapter} · {endpoint.connected ? i18n.t('在线') : i18n.t('离线')}</span></span>{current && <Check className="h-4 w-4 shrink-0" aria-label={i18n.t('当前账号')} />}
              </Link>
            </DropdownMenuItem>
          })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild disabled={sending}><Link to={SCOPE_ROOT} onClick={event => void guardNavigation(event, SCOPE_ROOT)}>{i18n.t('管理聊天账号')}</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {ConfirmDialog}
  </>
}

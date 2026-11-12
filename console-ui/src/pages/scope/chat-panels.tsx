import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useIsMobile } from '../../hooks/useIsMobile'
import { EndpointWorkspaceView } from '../endpoint-detail'
import type { SidebarSelection } from '../endpoint-detail/types'
import { chatRequestKey, readChatRequest, writeChatRequest } from '../endpoint-detail/chat-workspace-model.mjs'
import type { Scope } from '../../scope/scope-tree.mjs'
import './chat-panels.css'

/**
 * Phones: the object page header sits above the tab, so opening a chat (or a conversation's 聊天
 * tab) scrolls the workspace to the top of the screen and the chat gets the whole viewport.
 */
function useChatIntoView(key: string | null) {
  const ref = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  useEffect(() => {
    if (!isMobile || key === null) return
    ref.current?.scrollIntoView({ block: 'start' })
  }, [isMobile, key])
  return ref
}

/** History state marking an entry pushed by a pick in the account chat list (back returns to the list). */
const FROM_LIST = 'zhinChatFromList'

/**
 * 账号 · 聊天: the conversation list beside the chat. The open conversation lives in the URL
 * (`?tab=chat&conversation=<kind>:<id>`, `&inbox=requests|notices`), so refresh, links and the back
 * button restore it; on a phone the list and the chat are two panes of the same URL history.
 */
export function AccountChatPanel({ scope }: { scope: Scope & { level: 'endpoint' } }) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const request = readChatRequest(params)
  const ref = useChatIntoView(chatRequestKey(request))
  const onSelectionChange = useCallback((selection: SidebarSelection | null) => {
    setParams(previous => writeChatRequest(previous, selection), selection ? { state: { [FROM_LIST]: true } } : { replace: true })
  }, [setParams])
  const fromList = (location.state as Record<string, unknown> | null)?.[FROM_LIST] === true
  const onBack = useCallback(() => {
    if (fromList) navigate(-1)
    else setParams(previous => writeChatRequest(previous, null), { replace: true })
  }, [fromList, navigate, setParams])
  return (
    <div className="console-object-chat console-chat-panel" ref={ref}>
      <EndpointWorkspaceView
        mode="account"
        target={{
          adapter: scope.adapter!,
          endpointId: scope.endpoint!,
          ...(request?.type === 'channel' ? { channelType: request.channelType, channelId: request.id } : {}),
          ...(request && request.type !== 'channel' ? { view: request.type } : {}),
        }}
        onSelectionChange={onSelectionChange}
        onBack={onBack}
      />
    </div>
  )
}

/** 会话 · 聊天: this conversation only; members, diagnostics and history stay in its header. */
export function ConversationChatPanel({ scope }: { scope: Scope & { level: 'conversation' } }) {
  const ref = useChatIntoView(`${scope.kind}:${scope.id}`)
  return (
    <div className="console-object-chat console-chat-panel" ref={ref}>
      <EndpointWorkspaceView
        mode="conversation"
        target={{ adapter: scope.adapter!, endpointId: scope.endpoint!, channelType: scope.kind, channelId: scope.id }}
      />
    </div>
  )
}

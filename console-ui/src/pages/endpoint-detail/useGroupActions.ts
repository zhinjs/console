import { useCallback, useState } from 'react'
import { useWebSocket } from '@zhin.js/client'
import { useToast } from '../../components/toast'
import type { MemberRow, SidebarSelection } from './types'

const GROUP_ACTION_LABELS: Record<
  'endpoint:groupKick' | 'endpoint:groupMute' | 'endpoint:groupAdmin',
  string
> = {
  'endpoint:groupKick': '已踢出群成员',
  'endpoint:groupMute': '已禁言群成员',
  'endpoint:groupAdmin': '已更新管理员权限',
}

export function useGroupActions(params: {
  adapter: string
  endpointId: string
  selection: SidebarSelection | null
}) {
  const { adapter, endpointId, selection } = params
  const { sendRequest } = useWebSocket()
  const { success, error: toastError } = useToast()

  const [members, setMembers] = useState<MemberRow[]>([])
  const [membersLoading, setMembersLoading] = useState(false)

  const loadMembers = useCallback(async () => {
    if (selection?.type !== 'channel' || selection.channelType !== 'group' || adapter !== 'icqq') return
    setMembersLoading(true)
    try {
      const r = await sendRequest<{ members: MemberRow[] }>({
        type: 'endpoint:groupMembers',
        data: { adapter, endpointId, groupId: selection.id },
      })
      setMembers(r.members || [])
    } catch (e) {
      toastError((e as Error).message, '加载群成员失败')
      setMembers([])
    } finally {
      setMembersLoading(false)
    }
  }, [selection, sendRequest, adapter, endpointId, toastError])

  const groupAction = useCallback(
    async (
      type: 'endpoint:groupKick' | 'endpoint:groupMute' | 'endpoint:groupAdmin',
      userId: number | string,
      extra?: { enable?: boolean },
    ) => {
      if (selection?.type !== 'channel' || selection.channelType !== 'group') return false
      try {
        await sendRequest({
          type,
          data: {
            adapter,
            endpointId,
            groupId: selection.id,
            userId: String(userId),
            ...extra,
          },
        })
        await loadMembers()
        success(GROUP_ACTION_LABELS[type])
        return true
      } catch (e) {
        toastError((e as Error).message, '群管理操作失败')
        return false
      }
    },
    [selection, sendRequest, adapter, endpointId, loadMembers, success, toastError],
  )

  return {
    members,
    setMembers,
    membersLoading,
    loadMembers,
    groupAction,
  }
}

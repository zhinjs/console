import { useCallback, useState } from 'react'
import { useToast } from '../../components/toast'
import { ENDPOINT_RPC } from '../../contracts/zhin-console'
import { requestConsole } from '../../utils/console-rpc'
import type { MemberRow, SidebarSelection } from './types'

export type GroupAction =
  | typeof ENDPOINT_RPC.GROUP_KICK
  | typeof ENDPOINT_RPC.GROUP_MUTE
  | typeof ENDPOINT_RPC.GROUP_ADMIN

const GROUP_ACTION_LABELS: Record<GroupAction, string> = {
  [ENDPOINT_RPC.GROUP_KICK]: '已踢出群成员',
  [ENDPOINT_RPC.GROUP_MUTE]: '已禁言群成员',
  [ENDPOINT_RPC.GROUP_ADMIN]: '已更新管理员权限',
}

export function useGroupActions(params: {
  adapter: string
  endpointId: string
  selection: SidebarSelection | null
}) {
  const { adapter, endpointId, selection } = params
  const { success, error: toastError } = useToast()

  const [members, setMembers] = useState<MemberRow[]>([])
  const [membersLoading, setMembersLoading] = useState(false)

  const loadMembers = useCallback(async () => {
    if (selection?.type !== 'channel' || selection.channelType !== 'group' || adapter !== 'icqq') return
    setMembersLoading(true)
    try {
      const r = await requestConsole<{ members: MemberRow[] }>({
        type: ENDPOINT_RPC.GROUP_MEMBERS,
        data: { adapter, endpointKey: endpointId, groupId: selection.id },
      })
      setMembers(r.members || [])
    } catch (e) {
      toastError((e as Error).message, '加载群成员失败')
      setMembers([])
    } finally {
      setMembersLoading(false)
    }
  }, [selection, adapter, endpointId, toastError])

  const groupAction = useCallback(
    async (
      type: GroupAction,
      userId: number | string,
      extra?: { enable?: boolean },
    ) => {
      if (selection?.type !== 'channel' || selection.channelType !== 'group') return false
      try {
        await requestConsole({
          type,
          data: {
            adapter,
            endpointKey: endpointId,
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
    [selection, adapter, endpointId, loadMembers, success, toastError],
  )

  return {
    members,
    setMembers,
    membersLoading,
    loadMembers,
    groupAction,
  }
}

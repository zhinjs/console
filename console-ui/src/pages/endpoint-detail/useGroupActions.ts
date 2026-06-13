import { useCallback, useState } from 'react'
import { useWebSocket } from '@zhin.js/client'
import type { MemberRow, SidebarSelection } from './types'

export function useGroupActions(params: {
  adapter: string
  endpointId: string
  selection: SidebarSelection | null
}) {
  const { adapter, endpointId, selection } = params
  const { sendRequest } = useWebSocket()

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
      console.error('Failed to load group members:', (e as Error).message)
      setMembers([])
    } finally {
      setMembersLoading(false)
    }
  }, [selection, sendRequest, adapter, endpointId])

  const groupAction = useCallback(
    async (
      type: 'endpoint:groupKick' | 'endpoint:groupMute' | 'endpoint:groupAdmin',
      userId: number | string,
      extra?: { enable?: boolean },
    ) => {
      if (selection?.type !== 'channel' || selection.channelType !== 'group') return
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
      } catch (e) {
        console.error('Group action failed:', (e as Error).message)
      }
    },
    [selection, sendRequest, adapter, endpointId, loadMembers],
  )

  return {
    members,
    setMembers,
    membersLoading,
    loadMembers,
    groupAction,
  }
}

import { useI18n } from '../../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/toast'
import { ENDPOINT_RPC } from '../../contracts/zhin-console'
import { requestConsole } from '../../utils/console-rpc'
import type { MemberRow, SidebarSelection } from './types'
import { groupMembersKey, membersForGroup, membersPending, type GroupMembersState } from './group-members-model.mjs'

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
  const i18n = useI18n()
  const { adapter, endpointId, selection } = params
  const { success, error: toastError } = useToast()
  const messages = useRef({ i18n, success, toastError })
  messages.current = { i18n, success, toastError }

  // Members are stored with the group they were read for; another group's selection sees an empty,
  // pending list instead of the previous group's members (which could be kicked by mistake).
  const groupKey = adapter === 'icqq' ? groupMembersKey(adapter, endpointId, selection) : null
  const groupId = groupKey != null && selection?.type === 'channel' ? selection.id : null
  const groupKeyRef = useRef(groupKey)
  groupKeyRef.current = groupKey
  const [memberState, setMemberState] = useState<GroupMembersState<MemberRow>>({ key: null, members: [] })
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const loadSeqRef = useRef(0)
  const members = membersForGroup(memberState, groupKey)
  const membersLoading = groupKey != null && (loadingKey === groupKey || membersPending(memberState, groupKey))

  const loadMembers = useCallback(async () => {
    if (groupKey == null || groupId == null) return
    const seq = ++loadSeqRef.current
    const current = () => seq === loadSeqRef.current && groupKeyRef.current === groupKey
    setLoadingKey(groupKey)
    try {
      const r = await requestConsole<{ members: MemberRow[] }>({
        type: ENDPOINT_RPC.GROUP_MEMBERS,
        adapter, endpointKey: endpointId, groupId,
      })
      if (!current()) return
      setMemberState({ key: groupKey, members: r.members || [] })
    } catch (e) {
      if (!current()) return
      messages.current.toastError((e as Error).message, messages.current.i18n.t("加载群成员失败"))
      setMemberState({ key: groupKey, members: [], failed: true })
    } finally {
      if (seq === loadSeqRef.current) setLoadingKey(null)
    }
  }, [adapter, endpointId, groupId, groupKey])

  useEffect(() => {
    if (groupKey == null) { loadSeqRef.current++; setLoadingKey(null); return }
    void loadMembers()
  }, [groupKey, loadMembers])

  const groupAction = useCallback(
    async (
      type: GroupAction,
      userId: number | string,
      extra?: { enable?: boolean; duration?: number },
      expectedGroupKey?: string | null,
    ) => {
      if (groupKey == null || groupId == null) return false
      // The confirmation is async: refuse if the user switched groups since picking the member.
      if (expectedGroupKey !== undefined && (expectedGroupKey !== groupKey || groupKeyRef.current !== groupKey)) {
        messages.current.toastError(messages.current.i18n.t("群聊已切换，请重新选择成员"), messages.current.i18n.t("群管理操作失败"))
        return false
      }
      try {
        await requestConsole({
          type,
          ...{
            adapter,
            endpointKey: endpointId,
            groupId,
            userId: String(userId),
            ...extra,
          },
        })
        await loadMembers()
        messages.current.success(messages.current.i18n.t(GROUP_ACTION_LABELS[type]))
        return true
      } catch (e) {
        messages.current.toastError((e as Error).message, messages.current.i18n.t("群管理操作失败"))
        return false
      }
    },
    [adapter, endpointId, groupId, groupKey, loadMembers],
  )

  return {
    members,
    membersGroupKey: groupKey,
    membersFailed: memberState.key === groupKey && !!memberState.failed,
    membersLoading,
    loadMembers,
    groupAction,
  }
}

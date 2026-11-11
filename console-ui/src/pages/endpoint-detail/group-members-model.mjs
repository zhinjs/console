/** Identity of a group member list: account plus group. Members read for one key never show under another. */
export function groupMembersKey(adapter, endpointId, selection) {
  if (selection?.type !== 'channel' || selection.channelType !== 'group') return null
  return JSON.stringify([adapter, endpointId, selection.id])
}

export function membersForGroup(state, key) {
  return key != null && state.key === key ? state.members : []
}

/** The selected group has not finished a member read yet, so an empty list would be misleading. */
export function membersPending(state, key) {
  return key != null && state.key !== key
}

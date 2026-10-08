/** @typedef {{ adapter: string, endpoint: string }} MessageRoute */
/** @typedef {{ agent: string, messageRoute?: MessageRoute }} MessageRouteMember */
/** @typedef {{ adapter: string, name: string }} EndpointOption */
/** @typedef {{ projectId: string, enabled?: boolean, sponsors?: readonly string[] }} WorkroomSponsorDraft */

/**
 * Creates the visible initial state for a new Workroom. The principal comes
 * from the authenticated Host response and remains visible/editable in the
 * Sponsor Principals field before publish.
 * @param {{ projectId: string, agent?: string, principalId?: string }} input
 */
export function createNewWorkroomDraft(input) {
  return {
    projectId: input.projectId,
    name: 'New Workroom',
    enabled: false,
    members: input.agent ? [{ agent: input.agent, role: /** @type {const} */ ('orchestrator') }] : [],
    ...(input.principalId ? { sponsors: [input.principalId] } : {}),
  }
}

/**
 * An enabled Project without a Sponsor cannot be read or governed through the
 * Workroom Console, so reject that draft before it reaches the Runtime CAS.
 * @param {readonly WorkroomSponsorDraft[]} drafts
 */
export function validateWorkroomSponsors(drafts) {
  return drafts.flatMap(draft => {
    const sponsors = draft.sponsors ?? []
    const message = draft.enabled !== false && !sponsors.length ? '已启用的项目至少需要一位负责人'
      : sponsors.some(id => !id.trim() || id !== id.trim()) ? '负责人标识不能为空或含首尾空格'
      : new Set(sponsors).size !== sponsors.length ? '负责人标识不能重复' : null
    return message ? [{ projectId: draft.projectId, message }] : []
  })
}

/**
 * Encodes an Endpoint identity for native select values without confusing
 * adapter/name boundaries when either side contains punctuation.
 * @param {MessageRoute | undefined} route
 */
export function endpointRouteKey(route) {
  return route ? `${route.adapter}\0${route.endpoint}` : ''
}

/** @param {string} value @returns {MessageRoute | undefined} */
export function parseEndpointRouteKey(value) {
  if (!value) return undefined
  const separator = value.indexOf('\0')
  if (separator <= 0 || separator === value.length - 1) return undefined
  return {
    adapter: value.slice(0, separator),
    endpoint: value.slice(separator + 1),
  }
}

/**
 * Validates the client-visible portion of the source-owned Workroom
 * messageRoute contract. The Runtime remains authoritative on publish.
 * @param {readonly MessageRouteMember[]} members
 * @param {readonly EndpointOption[]} endpoints
 * @param {{ validateKnownEndpoints?: boolean }} [options]
 */
export function validateWorkroomMessageRoutes(members, endpoints, options = {}) {
  const validateKnownEndpoints = options.validateKnownEndpoints !== false
  const knownEndpoints = new Set(endpoints.map((endpoint) =>
    endpointRouteKey({ adapter: endpoint.adapter, endpoint: endpoint.name })))
  /** @type {Map<string, Set<string>>} */
  const agentsByRoute = new Map()
  for (const member of members) {
    if (!member.messageRoute) continue
    const key = endpointRouteKey(member.messageRoute)
    const agents = agentsByRoute.get(key) ?? new Set()
    agents.add(member.agent)
    agentsByRoute.set(key, agents)
  }

  return members.flatMap((member, memberIndex) => {
    if (!member.messageRoute) return []
    const key = endpointRouteKey(member.messageRoute)
    const label = `${member.messageRoute.adapter}:${member.messageRoute.endpoint}`
    if (validateKnownEndpoints && !knownEndpoints.has(key)) {
      return [{
        memberIndex,
        code: 'unknown',
        message: `Endpoint ${label} 不在当前 Runtime Endpoint 列表中，请重新选择或改为继承主空间。`,
      }]
    }
    const agents = [...(agentsByRoute.get(key) ?? [])]
    if (agents.length > 1) {
      return [{
        memberIndex,
        code: 'conflict',
        message: `Endpoint ${label} 同时分配给多个 Agent（${agents.join('、')}），请为每个 Agent 选择独立出口。`,
      }]
    }
    return []
  })
}

/**
 * A cached catalog is useful for reading, but a failed refresh must not claim
 * that it is current or allow publication. Local drafts remain untouched.
 * @param {{ hasCatalog: boolean, loading: boolean, saving?: boolean, error?: string | null, dirty?: boolean, readOnly?: boolean }} state
 */
export function catalogAvailability(state) {
  const current = state.hasCatalog && !state.loading && !state.error
  return {
    canEdit: current && !state.readOnly && !state.saving,
    canPublish: current && !state.readOnly && !state.saving && Boolean(state.dirty),
    revisionDetail: !state.hasCatalog ? '目录尚未加载'
      : state.loading ? '正在核验目录'
      : state.error ? (state.dirty ? '刷新失败；保留未发布修改' : '刷新失败；显示上次加载的目录')
      : state.dirty ? '存在未发布修改' : '已与持久目录同步',
  }
}

/** @param {readonly { projectId: string }[]} drafts */
export function validateWorkroomProjectIds(drafts) {
  const ids = drafts.map(draft => draft.projectId.trim())
  const counts = new Map()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return ids.map(id => !id ? 'Project ID 不能为空' : counts.get(id) > 1 ? 'Project ID 不能重复' : !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) ? '使用 1–64 位小写字母、数字、下划线或连字符，首位为字母或数字' : null)
}

export function validateWorkroomBasics(draft, endpoints, validateKnownEndpoints = true) {
  const orchestrators = draft.members.filter(member => member.role === 'orchestrator').map(member => member.agent)
  function bindingIssues(binding, required) {
    if (!binding) return required ? { endpoint: '请选择消息渠道', id: '请输入协作空间标识', agent: '请选择协调成员' } : {}
    return {
      ...(!binding.adapter || !binding.endpoint ? { endpoint: '请选择消息渠道' } : validateKnownEndpoints && !endpoints.some(endpoint => endpoint.adapter === binding.adapter && endpoint.name === binding.endpoint) ? { endpoint: '当前渠道已不可用，请重新选择' } : {}),
      ...(!binding.id.trim() ? { id: '请输入协作空间标识' } : binding.kind === 'repository' && !/^[^/\s]+\/[^/\s]+$/.test(binding.id.trim()) ? { id: '仓库格式为 owner/repo' } : {}),
      ...(!orchestrators.includes(binding.agent) ? { agent: '请选择具有 orchestrator 角色的成员' } : {}),
    }
  }
  return { name: !draft.name.trim() ? '请输入名称' : null, conversation: bindingIssues(draft.conversation, draft.enabled !== false), sponsorConversation: bindingIssues(draft.sponsorConversation, false) }
}

export function validateWorkroomMembers(draft, agents) {
  const counts = new Map()
  for (const member of draft.members) {
    const key = `${member.agent}\0${member.role}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return {
    orchestrator: draft.enabled !== false && !draft.members.some(member => member.role === 'orchestrator') ? '已启用的项目需要至少一位协调成员' : null,
    members: draft.members.map(member => ({
      ...(!member.agent ? { agent: '请选择 Agent' } : !agents.includes(member.agent) ? { agent: '当前 Agent 已不可用，请重新选择' } : {}),
      ...(counts.get(`${member.agent}\0${member.role}`) > 1 ? { role: '同一 Agent 的角色不能重复' } : {}),
      ...(member.assignmentRoute?.kind === 'remote' && (!member.assignmentRoute.endpointId?.trim() || member.assignmentRoute.endpointId !== member.assignmentRoute.endpointId.trim()) ? { endpointId: '请输入远程入口标识，不含首尾空格' } : {}),
    })),
  }
}

/** Compare complete catalog definitions independent of object key ordering. */
export function workroomDefinitionsMatch(actual, expected) {
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    return value
  }
  return JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected))
}

/** Mirror Host ownership order, including shared Sponsor audiences and member message routes. */
export function validateWorkroomSpaceOwnership(drafts) {
  const issues = drafts.map(() => ({ members: [] }));
  const owners = new Map();
  function address(binding, route = binding) {
    if (!binding?.id || !route?.adapter || !route?.endpoint) return null;
    return `${route.adapter}:${route.endpoint}:${binding.kind}:${binding.kind === 'repository' ? binding.id.toLowerCase() : binding.id}`;
  }
  function report(ref, message) {
    if (ref.field === 'member') issues[ref.index].members.push({ memberIndex: ref.memberIndex, code: 'conflict', message });
    else issues[ref.index][ref.field] = message;
  }
  for (const [index, draft] of drafts.entries()) {
    if (draft.enabled === false) continue;
    for (const field of ['conversation','sponsorConversation']) {
      const key = address(draft[field]); if (!key) continue;
      const ref = {index,field}; const kind = field === 'sponsorConversation' ? 'sponsor' : 'workroom';
      const owner = owners.get(key);
      if (owner && (owner.kind !== 'sponsor' || kind !== 'sponsor')) {
        const message = '此空间已用于其他协作或负责人空间，请使用不同标识。';
        report(ref,message);owner.refs.forEach(ref => report(ref,message));
      } else if (owner) { owner.projects.push(index);owner.refs.push(ref); }
      else owners.set(key,{kind,projects:[index],refs:[ref]});
    }
    if (!draft.conversation) continue;
    for (const [memberIndex, member] of draft.members.entries()) {
      if (!member.messageRoute) continue;
      const key=address(draft.conversation,member.messageRoute);if(!key)continue;
      const ref={index,field:'member',memberIndex};const owner=owners.get(key);
      if(owner && !owner.projects.includes(index)) {
        const message='此消息出口对应的空间已被其他项目占用。';report(ref,message);owner.refs.forEach(ref=>report(ref,message));
      } else if(!owner) owners.set(key,{kind:'workroom',projects:[index],refs:[ref]});
    }
  }
  for(const owner of owners.values()) {
    if(owner.kind!=='sponsor' || owner.projects.length<2)continue;
    const audiences=owner.projects.map(index=>JSON.stringify([...(drafts[index].sponsors??[])].sort()));
    if(audiences.includes('[]') || new Set(audiences).size!==1) owner.refs.forEach(ref=>report(ref,'共享负责人空间的项目必须配置相同且非空的负责人集合。'));
  }
  return issues;
}

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
  return drafts
    .filter((draft) => draft.enabled !== false && !draft.sponsors?.length)
    .map((draft) => ({
      projectId: draft.projectId,
      message: `已启用的 Workroom ${draft.projectId} 至少需要一个 Sponsor principal。`,
    }))
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

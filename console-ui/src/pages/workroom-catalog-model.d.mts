export interface MessageRoute {
  adapter: string
  endpoint: string
}

export interface MessageRouteMember {
  agent: string
  messageRoute?: MessageRoute
}

export interface MessageRouteEndpointOption {
  adapter: string
  name: string
}

export interface MessageRouteIssue {
  memberIndex: number
  code: 'unknown' | 'conflict'
  message: string
}

export interface WorkroomSponsorDraft {
  projectId: string
  enabled?: boolean
  sponsors?: string[]
}

export interface NewWorkroomDraft extends WorkroomSponsorDraft {
  name: string
  enabled: false
  members: Array<{ agent: string; role: 'orchestrator' }>
}

export interface WorkroomSponsorIssue {
  projectId: string
  message: string
}

export function createNewWorkroomDraft(input: {
  projectId: string
  agent?: string
  principalId?: string
}): NewWorkroomDraft
export function validateWorkroomSponsors(
  drafts: readonly WorkroomSponsorDraft[],
): WorkroomSponsorIssue[]

export function endpointRouteKey(route?: MessageRoute): string
export function parseEndpointRouteKey(value: string): MessageRoute | undefined
export function validateWorkroomMessageRoutes(
  members: readonly MessageRouteMember[],
  endpoints: readonly MessageRouteEndpointOption[],
  options?: { validateKnownEndpoints?: boolean },
): MessageRouteIssue[]

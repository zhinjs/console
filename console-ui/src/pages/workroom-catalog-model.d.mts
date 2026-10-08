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

export function catalogAvailability(state: {
  hasCatalog: boolean
  loading: boolean
  saving?: boolean
  error?: string | null
  dirty?: boolean
  readOnly?: boolean
}): { canEdit: boolean; canPublish: boolean; revisionDetail: string }

export function validateWorkroomProjectIds(drafts: readonly { projectId: string }[]): (string | null)[]

export interface BindingIssues { endpoint?: string; id?: string; agent?: string }
export interface BasicIssues { name: string | null; conversation: BindingIssues; sponsorConversation: BindingIssues }
export function validateWorkroomBasics(draft: { name: string; enabled?: boolean; members: { agent: string; role: string }[]; conversation?: { adapter: string; endpoint: string; kind: string; id: string; agent: string }; sponsorConversation?: { adapter: string; endpoint: string; kind: string; id: string; agent: string } }, endpoints: readonly { adapter: string; name: string }[], validateKnownEndpoints?: boolean): BasicIssues

export interface MemberIssues { agent?: string; role?: string; endpointId?: string }
export interface WorkroomMemberIssues { orchestrator: string | null; members: MemberIssues[] }
export function validateWorkroomMembers(draft: { enabled?: boolean; members: { agent: string; role: string; assignmentRoute?: { kind: string; endpointId?: string } }[] }, agents: readonly string[]): WorkroomMemberIssues
export function workroomDefinitionsMatch(actual: unknown, expected: unknown): boolean

export function validateWorkroomSpaceOwnership(drafts: readonly { enabled?: boolean; sponsors?: string[]; conversation?: {adapter:string; endpoint:string; kind:string; id:string}; sponsorConversation?: {adapter:string; endpoint:string; kind:string; id:string}; members: readonly MessageRouteMember[] }[]): { conversation?: string; sponsorConversation?: string; members: MessageRouteIssue[] }[];

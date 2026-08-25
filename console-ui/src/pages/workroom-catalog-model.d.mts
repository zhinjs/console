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

export function endpointRouteKey(route?: MessageRoute): string
export function parseEndpointRouteKey(value: string): MessageRoute | undefined
export function validateWorkroomMessageRoutes(
  members: readonly MessageRouteMember[],
  endpoints: readonly MessageRouteEndpointOption[],
  options?: { validateKnownEndpoints?: boolean },
): MessageRouteIssue[]

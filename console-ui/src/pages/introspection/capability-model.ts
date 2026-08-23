import type { SupportedIntrospectionKind } from '../../contracts/zhin-console'

export type IntrospectionTab = SupportedIntrospectionKind

interface RuntimeCapabilityRow {
  readonly [key: string]: unknown
}

export interface CommandRow extends RuntimeCapabilityRow {
  readonly pattern?: string
  readonly desc?: string
  readonly parameters?: unknown[]
  readonly aliases?: unknown[]
  readonly permissions?: unknown[]
  readonly plugin?: string
}

export interface MiddlewareRow extends RuntimeCapabilityRow {
  readonly name?: string
  readonly phase?: string
  readonly target?: string
  readonly order?: number
  readonly owner?: string
  readonly source?: string
}

export interface ComponentRow extends RuntimeCapabilityRow {
  readonly name?: string
  readonly owner?: string
  readonly source?: string
}

export interface EndpointRow extends RuntimeCapabilityRow {
  readonly adapter?: string
  readonly name?: string
  readonly online?: boolean
  readonly status?: string
}

export interface BindingRow extends RuntimeCapabilityRow {
  readonly name?: string
  readonly provider?: string
  readonly model?: string
  readonly mcpServers?: unknown[]
  readonly hasAgentFile?: boolean
}

export interface ToolRow extends RuntimeCapabilityRow {
  readonly name?: string
  readonly description?: string
  readonly source?: string
}

export interface McpRow extends RuntimeCapabilityRow {
  readonly name?: string
  readonly connected?: boolean
  readonly toolCount?: number
  readonly error?: string
}

export interface CapabilityRowMap {
  commands: CommandRow
  middlewares: MiddlewareRow
  components: ComponentRow
  endpoints: EndpointRow
  bindings: BindingRow
  tools: ToolRow
  mcp: McpRow
}

export type CapabilityItem = CapabilityRowMap[IntrospectionTab]

import type { SchemaField } from '../../components/PluginConfigForm/types'
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type ObjectValue = { [key: string]: Json }
export type Kind = 'language' | 'decision' | 'image'
export interface DriverRef {
  id: string
  owner: string
  contractVersion: string
}
/** Display metadata from the held Driver declaration; never execution policy. */
export interface SupportMetadata {
  readonly status: 'standard' | 'experimental'
  readonly notice?: string
}
export interface Driver extends DriverRef {
  support?: SupportMetadata
  label: string
  source?: string
  authentication: string[]
  discovery?: boolean
  serviceSchema?: Record<string, unknown>
  modelContracts: { protocol: string; kinds: Kind[] }[]
}
export interface ModelDefinition {
  id: string
  kinds: Kind[]
  protocol: string
  input?: string[]
  streaming?: boolean
  toolCalling?: boolean
  thinking?: boolean
  contextWindow?: number
  maxOutputTokens?: number
}
export interface Resource {
  id: string
  rootId: string
  ownerId: string
  revision: number
  label?: string
}
export interface Service extends Resource {
  driver: DriverRef
  options: ObjectValue
  models: Record<string, ModelDefinition>
}
export interface Account extends Resource {
  serviceId: string
  incarnation: string
  authentication: { method: string; source?: string }
}
export interface Profile extends Resource {
  accountId: string
  model: string
  parameters: ObjectValue
}
export interface AccountStatus {
  status: string
  revision: number
  preparation?: string
  source?: 'environment-expression'
  retryAt?: number
  failure?: {
    kind: 'temporary-response' | 'response-error' | 'transport-unknown' | 'invalid-response'
    status?: number
    oauthError?: string
  }
}
export interface View {
  rootId: string
  revision: number
  ownerId: string
  hostAdministrator: boolean
  services: Record<string, Service>
  accounts: Record<string, Account>
  profiles: Record<string, Profile>
  statuses: Record<string, AccountStatus>
  drivers: Driver[]
  deployment: Array<{
    id: string
    label?: string
    model: string
    accountId: string
    accountIncarnation: string
    definition: ModelDefinition
    support?: SupportMetadata
  }>
  purposes?: Purposes
}
export interface ScopeModels {
  chat?: string
  perception?: { profile: string; fallbacks?: string[] }
}
export interface DecisionPolicy {
  profile?: string
  mode: 'off' | 'shadow' | 'active'
  timeoutMs?: number
  minConfidence?: number
  topK?: number
  maxCandidates?: number
  maxSelections?: number
}
export interface Purposes {
  defaults: ScopeModels & { summary?: string; image?: string; ambient?: string }
  decisions?: Record<string, DecisionPolicy>
  agents?: Record<string, string>
  adapters?: Record<string, ScopeModels>
  endpoints?: Record<string, ScopeModels>
  scenes?: Record<string, { chat?: string }>
}
export interface Owner {
  id: string
  label: string
  kind: 'host' | 'personal'
  personal?: import('../personal-session-model.mjs').PersonalOwner
}
export interface ProfileSelection {
  id: string
  rootId: string
  accountId: string
  accountIncarnation: string
  kind: 'language'
}
export class InferenceRequestError extends Error {
  constructor(code: string, status?: number, mutationOutcome?: 'not-committed')
  code: string
  status: number
  mutationOutcome?: 'not-committed'
}
export function inferencePath(path?: string, ownerId?: string): string
export function inferenceRequest<T = unknown>(
  fetch: typeof globalThis.fetch,
  input: { path?: string; ownerId?: string; body?: unknown; method?: string; signal?: AbortSignal }
): Promise<T>
export function inferenceError(error: unknown, locale?: 'zh-CN' | 'en'): string
export function resourceBindings(
  view: View
): Record<'services' | 'accounts' | 'profiles', Record<string, string>>
export function driverKey(driver: DriverRef): string
export function serviceDriver(view: View, serviceId: string): Driver | undefined
export function profileSupport(view: View, profile: Profile): SupportMetadata | undefined
export function profileSelection(view: View, profile: Profile, kind?: 'language'): ProfileSelection
export function selectableLanguageProfiles(
  view: View,
  locale?: 'zh-CN' | 'en'
): Array<{ id: string; label: string; selection: ProfileSelection; support?: SupportMetadata }>
export function schemaField(schema?: Record<string, unknown>): SchemaField
export function purposePlan(draft: Purposes, original?: Purposes): unknown
export interface Targets {
  agentsAvailable: boolean
  agents: Array<{ name: string; nickname?: string }>
  adaptersAvailable: boolean
  adapters: Array<{ capabilityId: string; platform: string }>
  endpoints: Array<{
    key: string
    capabilityId: string
    instanceId: string
    address: { rootId: string; platform: string; endpoint: string; adapterId: string }
  }>
  scenesAvailable: boolean
  scenesError?: string
  scenes: Array<{
    key: string
    address: {
      rootId: string
      platform: string
      endpoint: string
      conversation: import('../endpoint-detail/types').DiagnosticConversation
    }
  }>
  sceneHasMore: boolean
}
export function applyInferenceChange(
  fetch: typeof globalThis.fetch,
  input: { ownerId: string; prepared: ObjectValue; mutationId: string }
): Promise<{
  status: 'committed' | 'conflict' | 'not-committed' | 'commit-unknown'
  code?: string
  receipt?: { graphRevision: number }
}>
export function pendingMutationKey(base: string, ownerId: string): string
export function readPendingMutation(
  storage: Pick<Storage, 'getItem'>,
  base: string,
  ownerId: string
): string | null
export function storePendingMutation(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  input: { base: string; ownerId: string; mutationId: string | null }
): void
export function driverLabel(driver: Driver, drivers: readonly Driver[]): string

export type ProfileUsageLevel = 'default' | 'decision' | 'agent' | 'adapter' | 'endpoint' | 'scene'
export interface ProfileUsage { key: string; level: ProfileUsageLevel; label: string }
export function profileUsages(purposes: Purposes | null | undefined, profileId: string, locale?: 'zh-CN' | 'en'): ProfileUsage[] | null

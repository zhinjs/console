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
export interface AccountLastCall {
  outcome: 'ok' | 'auth' | 'rate-limit' | 'server' | 'rejected' | 'timeout' | 'network'
  status?: number
  at: number
}
export interface ProbeResult {
  status: 'ok' | 'failed'
  kind?: string
  code?: string
  httpStatus?: number
  durationMs: number
  at: number
  profileId: string
}
export interface AccountStatus {
  status: string
  revision: number
  preparation?: string
  source?: 'environment-expression'
  retryAt?: number
  /** `env://` Host account without a credential record yet (#1250). */
  environment?: 'present' | 'missing'
  lastCall?: AccountLastCall
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
  environmentReferences?: 'local-cli' | 'console-owner' | 'none'
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
  modelAvailability?: ModelAvailabilityView
  /**
   * Host administrators only (#1270, ADR 0066 D7): whether each purpose key takes effect, keyed
   * `agents.<key>`, `ambient` (the interjection judge chain) and `decisions.<task>`. Older Hosts omit it.
   */
  purposeEffects?: Record<string, PurposeEffect>
}
export type PurposeIgnoredReason = 'binding-name' | 'ambiguous' | 'no-target' | 'ambient-not-configured' | 'no-conversations' | 'mode-off'
export interface PurposeEffectMember { profile: string; kind?: 'language' | 'decision' }
export interface PurposeEffect {
  status: 'effective' | 'ignored'
  reason?: PurposeIgnoredReason | string
  /** `ambient` only: the judge chain actually used, in order. */
  chain?: PurposeEffectMember[]
  /** `ambient` only: the chain is the deployment chat model's. */
  inheritedFrom?: 'chat'
  /** `ambient` only: the compared model. */
  compare?: PurposeEffectMember
  target?: 'binding' | 'sub-agent'
  agents?: string[]
  ignoredAgents?: string[]
}
/** `purposes.ambient` (ADR 0066 D1): the interjection judge. */
export interface AmbientJudgePolicy {
  profile?: string
  fallbacks?: string[]
  compare?: string
  minConfidence?: number
  mode?: 'active' | 'shadow'
  timeoutMs?: number
}
export interface ScopeModels {
  chat?: string
  /** Ordered fallbacks of `chat` (#1250; the Host's graph shape). Absent on older Hosts. */
  chatFallbacks?: string[]
  perception?: { profile: string; fallbacks?: string[] }
}
export type ModelFallbackReason = 'quota_exhausted' | 'billing' | 'auth' | 'timeout' | 'context_overflow'
export interface ModelUnavailability { accountId: string; model: string; reason: ModelFallbackReason; since: number; until: number }
export interface ModelFallbackEndpoint { profileId: string; accountId: string; model: string }
export interface ModelFallbackEvent {
  purpose: string
  from: ModelFallbackEndpoint
  to: ModelFallbackEndpoint
  reason: ModelFallbackReason
  phase: 'selection' | 'request'
  at: number
  fromUntil?: number
  notice: string
}
/** Host administrators only (#1250): skipped models and recent switches. */
export interface ModelAvailabilityView {
  notice: string
  unavailable: ModelUnavailability[]
  recentFallbacks: ModelFallbackEvent[]
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
  /** ADR 0066: the merged interjection judge; older Hosts store `defaults.ambient` + `decisions.ambient` instead. */
  ambient?: AmbientJudgePolicy
  defaults: ScopeModels & { summary?: string; summaryFallbacks?: string[]; image?: string; ambient?: string; ambientFallbacks?: string[] }
  decisions?: Record<string, DecisionPolicy>
  agents?: Record<string, string>
  agentFallbacks?: Record<string, string[]>
  adapters?: Record<string, ScopeModels>
  endpoints?: Record<string, ScopeModels>
  scenes?: Record<string, { chat?: string; chatFallbacks?: string[] }>
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
  constructor(code: string, status?: number, mutationOutcome?: 'not-committed', reason?: string, path?: string)
  code: string
  status: number
  mutationOutcome?: 'not-committed'
  reason?: string
  /** The configuration path the Host named (`details.path`). */
  path?: string
}
export function configPathLabel(path: string, locale?: 'zh-CN' | 'en'): string
export function canReferenceEnvironment(view: View): boolean
export function supportsConnectionTest(view: Pick<View, 'environmentReferences'> | null | undefined): boolean
export function connectionTestError(error: unknown, locale?: 'zh-CN' | 'en'): string
export function accountEnvironmentVariable(account: Account | undefined): string | undefined
export function describeLastCall(lastCall: AccountLastCall | undefined, locale?: 'zh-CN' | 'en'): string
export function describeProbe(result: ProbeResult, locale?: 'zh-CN' | 'en'): string
export function newlyBoundLanguageProfiles(draft: Purposes, original: Purposes | undefined): string[]
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
export function effectiveAuthMethod(chosen: string, methods: readonly string[]): string
export function oauthCallbackProblem(value: string, redirectUri?: string | null): 'empty' | 'not-url' | 'other-address' | 'no-code' | null
export function accountHasModels(view: Pick<View, 'profiles'> | null | undefined, accountId: string): boolean
export function withModelKind(value: ModelDefinition, kind: Kind, checked: boolean): ModelDefinition
export function withModelProtocol(value: ModelDefinition, protocol: string, driver: Driver | undefined): ModelDefinition
export function languageInputMissing(value: ModelDefinition | null | undefined): boolean
export interface ModelEntryInput { editing?: boolean; manualEntry?: boolean; choiceCount?: number; discovery?: boolean; discovered?: boolean }
export interface ModelEntryView { input: boolean; canToggle: boolean; hint: 'none-returned' | 'discoverable' | 'manual-only' | null }
export function modelEntryView(input?: ModelEntryInput): ModelEntryView
export function profileSupport(view: View, profile: Profile): SupportMetadata | undefined
export function profileSelection(view: View, profile: Profile, kind?: 'language'): ProfileSelection
export function selectableLanguageProfiles(
  view: View,
  locale?: 'zh-CN' | 'en'
): Array<{ id: string; label: string; selection: ProfileSelection; support?: SupportMetadata }>
export function schemaField(schema?: Record<string, unknown>): SchemaField
export function purposePlan(draft: Purposes, original?: Purposes, options?: {
  fallbacks?: boolean
  /** ADR 0066 Hosts: the `purposes.ambient` entry (undefined: unchanged, not written). */
  ambientJudge?: { entry: AmbientJudgePolicy | null | undefined }
}): unknown
export function cleanFallbacks(primary: string, chain: readonly string[] | undefined): string[]
export function languageReference(profile: string, chain?: readonly string[]): { profile: string; fallbacks?: string[] }
export function supportsPurposeFallbacks(view: Pick<View, 'modelAvailability'> | null | undefined): boolean
export function moveFallback(chain: readonly string[] | undefined, index: number, delta: number): string[]
export function profileAvailability(view: View, profileId: string, now?: number): ModelUnavailability | undefined
export function describeUnavailability(entry: ModelUnavailability | undefined, locale?: 'zh-CN' | 'en'): string
export interface RecentFallbackRow { key: string; purpose: string; from: string; to: string; reason: string; at: string; selection: boolean }
export function recentFallbackRows(view: View, locale?: 'zh-CN' | 'en'): RecentFallbackRow[]
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

export type ProfileUsageLevel = 'default' | 'ambient' | 'decision' | 'agent' | 'adapter' | 'endpoint' | 'scene'
export interface ProfileUsage {
  key: string
  level: ProfileUsageLevel
  label: string
  /** The reference exists but does not take effect (`purposeEffects`). */
  ignored?: boolean
  reason?: string
}
export function profileUsages(purposes: Purposes | null | undefined, profileId: string, locale?: 'zh-CN' | 'en', effects?: Record<string, PurposeEffect>): ProfileUsage[] | null
export function ignoredReasonText(reason: string | undefined, locale?: 'zh-CN' | 'en'): string
export function profileChoiceGroup(view: View, profile: Profile, locale?: 'zh-CN' | 'en'): { key: string; label: string; agent: boolean }
export interface PurposeProfileChoice {
  value: string
  group: string
  agent: boolean
  description: string
  keywords: string
  profile: Profile
}
export function purposeProfileChoices(view: View, kind: Kind, locale?: 'zh-CN' | 'en'): PurposeProfileChoice[]

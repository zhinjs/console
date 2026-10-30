import type { DiagnosticConversation } from './endpoint-detail/types'
export interface PersonalOwner { rootId: string; platform: string; endpoint: string; adapterId: string; subjectId: string }
export interface PersonalAddress { rootId: string; platform: string; endpoint: string; subjectId: string; conversation: DiagnosticConversation }
export interface ModelCapabilities { input?: ('text' | 'image' | 'audio' | 'video' | 'file')[]; streaming?: boolean; toolCalling?: boolean; thinking?: boolean }
export interface PersonalConnection { id: string; revision: number; sdk: string; baseUrl?: string; hasKey: boolean }
export interface PersonalModel { id: string; connectionId: string; model: string; capabilities: ModelCapabilities }
export interface PersonalPreset { id: string; modelId: string }
export interface DeploymentPreset extends PersonalPreset { model: string; sdk: string; capabilities: ModelCapabilities }
export interface PersonalOwnerModels { owner: PersonalOwner; ownerId: string; revision: number; connections: PersonalConnection[]; models: PersonalModel[]; presets: PersonalPreset[] }
export interface PersonalModelsView { owners: PersonalOwnerModels[]; deployment: DeploymentPreset[] }
export interface PersonalSessionRow { sessionKey: string; address: PersonalAddress; updatedAt: number }
export interface PersonalSessionView { state: { identity: { key: string; address: PersonalAddress }; revision: number; selection: { kind: 'inherit' } | { kind: 'preset'; presetId: string } }; presets: { personal: PersonalPreset[]; deployment: DeploymentPreset[] } }
export const PERSONAL_MODEL_SDKS: readonly string[]
export function isPersonalSessionKey(value: unknown): boolean
export function readPersonalOwner(value: unknown): PersonalOwner | null
export function readPersonalAddress(value: unknown): PersonalAddress | null
export function addressBelongsToOwner(address: PersonalAddress, owner: PersonalOwner): boolean
export function readPersonalSessionRows(body: unknown, owner: PersonalOwner): { rows: PersonalSessionRow[]; hasMore: boolean }
export function personalSessionQuery(owner: PersonalOwner, offset?: number): string
export function personalSessionAddressQuery(address: PersonalAddress): string
export function readPersonalSessionView(body: unknown, sessionKey: string, address: PersonalAddress): PersonalSessionView
export function personalModelFailure(status?: number, code?: string): string

export function readPersonalModelsView(body: unknown): PersonalModelsView

export interface PersonalModelEntryDraft { presetId?: string | null; sdk: string; baseUrl: string; model: string; capabilities: ModelCapabilities; apiKey?: string }
export function personalModelRequiresApiKey(sdk: string, hasStoredKey?: boolean): boolean
export function personalModelEntry(input: PersonalModelEntryDraft): Omit<PersonalModelEntryDraft, 'presetId' | 'apiKey'> & { presetId?: string; apiKey?: string }

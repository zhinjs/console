import type { DiagnosticConversation } from './endpoint-detail/types'
import type { ProfileSelection } from './inference/model.mjs'
export interface PersonalOwner {
  rootId: string
  platform: string
  endpoint: string
  adapterId: string
  subjectId: string
}
export interface PersonalAddress {
  rootId: string
  platform: string
  endpoint: string
  subjectId: string
  conversation: DiagnosticConversation
}
export interface PersonalSessionRow {
  sessionKey: string
  address: PersonalAddress
  updatedAt: number
}
export interface PersonalSessionState {
  identity: { key: string; address: PersonalAddress }
  revision: number
  selection: { kind: 'inherit' } | { kind: 'profile'; profile: ProfileSelection }
}
export function samePersonalSessionSelection(
  left: PersonalSessionState['selection'] | undefined,
  right: PersonalSessionState['selection'] | undefined
): boolean
export function isPersonalSessionKey(value: unknown): boolean
export function readPersonalOwner(value: unknown): PersonalOwner | null
export function readPersonalAddress(value: unknown): PersonalAddress | null
export function addressBelongsToOwner(address: PersonalAddress, owner: PersonalOwner): boolean
export function readPersonalSessionRows(
  body: unknown,
  owner: PersonalOwner
): { rows: PersonalSessionRow[]; hasMore: boolean }
export function readPersonalSessionState(
  state: unknown,
  sessionKey: string,
  address: PersonalAddress
): PersonalSessionState

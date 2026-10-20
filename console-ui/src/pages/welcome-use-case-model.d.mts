import type { TaskUseCase } from './task-center-model.mjs'
import type { PluginManagementState } from './plugin-management-model.mjs'
import type { DiagnosticConversation } from './endpoint-detail/types'
export const WELCOME_USE_CASE: 'group-welcome'
export interface WelcomeInstance { instanceKey: string; packageName: string; status: string }
export interface WelcomeEvidence { state: PluginManagementState; incarnation: string; welcome: { messagePresent: boolean | null; mode: 'all' | 'none' | 'selected' | 'unknown'; targets: DiagnosticConversation[] } }
export function readWelcomeUseCase(payload: unknown): TaskUseCase
export function readWelcomeInstances(payload: unknown, packageName: string): WelcomeInstance[]
export function welcomeReturnUrl(instanceKey?: string): string
export function welcomeConfigUrl(instanceKey: string): string
export function welcomeDetailUrl(instanceKey: string): string
export function readWelcomeEvidence(state: unknown, plan: unknown, instanceKey: string, packageName: string, source: unknown): WelcomeEvidence
export function welcomeEvidenceKey(value?: WelcomeEvidence | null): string | undefined
export function welcomeApplied(value?: WelcomeEvidence | null): boolean
export function welcomeReady(value?: WelcomeEvidence | null, target?: unknown): boolean
export function welcomeTargetKey(target: unknown): string | undefined

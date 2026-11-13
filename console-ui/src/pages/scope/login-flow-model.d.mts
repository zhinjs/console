/** Login Assist v2 wire types (mirror of `@zhin.js/console-protocol` `login.ts`, ADR 0058). */
export type LoginChallengeKind = 'qrcode' | 'link_verify' | 'slider' | 'sms' | 'device' | 'auth' | 'confirm' | 'other'
export type LoginFlowState = 'active' | 'online' | 'failed' | 'cancelled' | 'expired'
export type LoginStepKind = 'connect' | 'challenge' | 'verifying' | 'info'
export type LoginStepStatus = 'active' | 'done' | 'failed' | 'skipped'
export type LoginErrorCode = 'code_invalid' | 'rate_limited' | 'challenge_expired' | 'risk_blocked' | 'credential_invalid' | 'network' | 'unknown'
export type LoginOutcomeResult = 'accepted' | 'rejected' | 'expired' | 'needs_new_challenge' | 'online' | 'failed'
export type LoginNextAction = 'retry_input' | 'refresh_challenge' | 'relogin' | 'wait' | 'none'

export interface LoginOutcome {
  readonly result: LoginOutcomeResult
  readonly code?: LoginErrorCode
  readonly message?: string
  readonly next?: LoginNextAction
  readonly retryAfterMs?: number
}
export interface LoginChallengeAction {
  readonly id: string
  readonly label: string
  readonly variant: 'primary' | 'secondary' | 'danger'
  readonly requiresInput?: boolean
  readonly cooldownMs?: number
}
export interface LoginChallengeInput {
  readonly kind: 'code' | 'ticket' | 'text'
  readonly label: string
  readonly pattern?: string
  readonly patternHint?: string
  readonly length?: number
  readonly secret?: boolean
  readonly extract?: 'ticket-json-or-url'
}
export interface LoginHelpStep { readonly text: string; readonly blockId?: string; readonly doneWhen?: 'copied' | 'opened' | 'manual' }
export interface LoginChallengeHelp { readonly short: string; readonly steps: readonly LoginHelpStep[]; readonly warning?: string }
export interface LoginLinkBlock { readonly kind: 'link'; readonly id?: string; readonly label: string; readonly url: string; readonly showQr?: boolean }
export interface LoginCopyBlock {
  readonly kind: 'copy'
  readonly id: string
  readonly label: string
  readonly content: string
  readonly format: 'json' | 'script' | 'text'
  readonly sensitive?: boolean
  readonly collapsed?: boolean
  readonly collapsedLabel?: string
  readonly bookmarklet?: boolean
  readonly thenOpen?: string
  readonly redacted?: boolean
}
export interface LoginNoteBlock { readonly kind: 'note'; readonly id?: string; readonly text: string; readonly tone: 'info' | 'warning' }
export type LoginChallengeBlock = LoginCopyBlock | LoginLinkBlock | LoginNoteBlock
export type LoginRenderBlock = (LoginCopyBlock & { readonly openLink?: LoginLinkBlock }) | LoginLinkBlock | LoginNoteBlock
export interface LoginChallengeMedia {
  readonly qrImage?: string
  readonly qrImageOmitted?: boolean
  readonly linkOmitted?: boolean
  readonly link?: Readonly<{ url: string; label: string }>
  readonly expiresAt?: number
  readonly refreshable?: boolean
  readonly captcha?: Readonly<{ provider: 'tencent'; query: string; helperUrl?: string }>
}
export interface LoginChallenge {
  readonly id: string
  readonly kind: LoginChallengeKind
  readonly title: string
  readonly help?: LoginChallengeHelp
  readonly blocks: readonly LoginChallengeBlock[]
  readonly media?: LoginChallengeMedia
  readonly input?: LoginChallengeInput
  readonly actions: readonly LoginChallengeAction[]
  readonly expiresAt?: number
}
export interface LoginStep {
  readonly id: string
  readonly kind: LoginStepKind
  readonly status: LoginStepStatus
  readonly title: string
  readonly titleKey?: string
  readonly detail?: string
  readonly at: number
  readonly endedAt?: number
  readonly challenge?: LoginChallenge
  readonly taskId?: string
  readonly outcome?: LoginOutcome
}
export interface LoginEndpointIdentity { readonly canonicalId: string; readonly instanceId: string; readonly epoch: number; readonly incarnationId: string }
export interface LoginFlow {
  readonly id: string
  readonly adapter: string
  readonly endpointKey: string
  readonly endpointIdentity?: LoginEndpointIdentity
  readonly startedAt: number
  readonly updatedAt: number
  readonly revision: number
  readonly attempt: number
  readonly state: LoginFlowState
  readonly currentStep?: string
  readonly steps: readonly LoginStep[]
  readonly lastOutcome?: LoginOutcome
  readonly pendingConfirmation?: boolean
  readonly activeTaskId?: string
}
export interface LoginDeclaration {
  readonly mode: 'interactive' | 'credential' | 'external'
  readonly challenges?: readonly LoginChallengeKind[]
  readonly relogin?: boolean
  readonly refreshQr?: boolean
}
export interface LoginSubmitValue { readonly action: string; readonly values: Readonly<Record<string, string>> }

export const LOGIN_FLOW_EVENT: 'endpoint.login.flow'
export const LOGIN_RPC: Readonly<{
  LIST: 'login.list'; SUBMIT: 'login.submit'; CANCEL: 'login.cancel'; FLOW_LIST: 'login.flow.list'; FLOW_GET: 'login.flow.get'; RELOGIN: 'login.relogin'; REFRESH: 'login.refresh'
}>
export const LOGIN_FLOW_POLL_MS: number
export const LOGIN_FLOW_DEBOUNCE_MS: number
export const LOGIN_SUBMIT_TIMEOUT_MS: number
export const LOGIN_UNSUPPORTED_CODE: 'unsupported'

export function isSafeHttpUrl(value: unknown): value is string
export function isSafeImageSource(value: unknown): value is string
export function challengeActions(challenge: Partial<LoginChallenge> | undefined): readonly LoginChallengeAction[]
export function readChallenge(raw: unknown): LoginChallenge | undefined
export function readLoginFlow(raw: unknown): LoginFlow | null
export function readLoginFlowList(reply: unknown, target?: { adapter: string; endpointKey: string }): LoginFlow[]
export function readLoginFlowGet(reply: unknown): LoginFlow | null
export function newerFlow(current: LoginFlow | null | undefined, incoming: LoginFlow | null | undefined): LoginFlow | null
export function mergeRedactedFlow(previous: LoginFlow | null | undefined, incoming: LoginFlow | null | undefined): LoginFlow | null
export function flowNeedsLiveRead(flow: LoginFlow | null | undefined): boolean
export function activeChallengeStep(flow: LoginFlow | null | undefined): (LoginStep & { readonly challenge: LoginChallenge }) | null
export function activeVerifyingStep(flow: LoginFlow | null | undefined): LoginStep | null
export function activeInfoSteps(flow: LoginFlow | null | undefined): LoginStep[]

export type Tone = 'warning' | 'success' | 'destructive' | 'muted' | 'info'
export const FLOW_STATE_COPY: Readonly<Record<LoginFlowState, Readonly<{ label: string; tone: Tone }>>>
export function flowStateBadge(flow: LoginFlow | null | undefined): Readonly<{ label: string; tone: Tone }> | null
export const LOGIN_ERROR_COPY: Readonly<Record<LoginErrorCode, Readonly<{ title: string; description: string; next: LoginNextAction }>>>
export const NEXT_ACTION_COPY: Readonly<Record<Exclude<LoginNextAction, 'none'>, Readonly<{ label: string; hint: string }>>>
export interface OutcomeView {
  readonly tone: Tone
  readonly title: string
  readonly description?: string
  readonly message?: string
  readonly next?: Exclude<LoginNextAction, 'none'>
  readonly retryAfterMs?: number
  readonly code?: LoginErrorCode
}
export function outcomeView(outcome: LoginOutcome | undefined | null): OutcomeView | null
export interface TimelineStep {
  readonly id: string
  readonly kind: LoginStepKind
  readonly status: LoginStepStatus
  readonly title: string
  readonly at: number
  readonly endedAt?: number
  readonly detail?: string
  readonly outcome?: OutcomeView
  readonly challengeKind?: LoginChallengeKind
  readonly current: boolean
  readonly collapsed: boolean
}
export function flowTimeline(flow: LoginFlow | null | undefined): Readonly<{ steps: readonly TimelineStep[]; currentIndex: number; total: number }>
export function loginStepBadge(endpoint: unknown): Readonly<{ index: number; total: number; title: string }> | null

export interface LoginProgress { readonly copied?: readonly string[]; readonly opened?: readonly string[]; readonly ticked?: readonly number[] }
export interface ChecklistItem {
  readonly number: number
  readonly text: string
  readonly blockId?: string
  readonly doneWhen?: 'copied' | 'opened' | 'manual'
  readonly done: boolean
  readonly auto: boolean
  readonly current: boolean
}
export function helpChecklist(challenge: LoginChallenge | null | undefined, progress?: LoginProgress): Readonly<{ items: readonly ChecklistItem[]; current: number | null; total: number; doneCount: number }>
export function recordProgress(progress: LoginProgress | undefined, event: { type: 'copied' | 'opened'; blockId: string } | { type: 'tick'; number: number }): { copied: string[]; opened: string[]; ticked: number[] }
export function challengeBlocks(challenge: LoginChallenge | null | undefined): LoginRenderBlock[]
export function bookmarkletHref(block: LoginChallengeBlock | null | undefined): string | null

export interface InputCheck {
  readonly state: 'empty' | 'partial' | 'ok' | 'invalid'
  readonly value: string
  readonly message?: string
  readonly messageValues?: readonly string[]
  readonly remaining?: number
  readonly ticket?: Readonly<{ ticket: string; randstr?: string }>
  readonly source?: 'json' | 'url' | 'text'
}
export function checkLoginInput(input: LoginChallengeInput | undefined, raw: string): InputCheck
export function ticketPreview(ticket: string): string
export function submitValueFor(challenge: LoginChallenge | undefined, action: LoginChallengeAction, inputValue?: string): LoginSubmitValue
export function captchaSubmitValue(reply: { ticket: string; randstr: string }): LoginSubmitValue
export function cooldownRemaining(action: LoginChallengeAction | undefined, options?: { openedAt?: number; lastUsedAt?: number; now?: number }): number
export function deadlineProgress(expiresAt: number | undefined, options?: { startedAt?: number; now?: number }): Readonly<{ secondsLeft: number; fraction: number; expired: boolean }> | null
export function formatCountdown(seconds: number): string

export type SubmitReply =
  | Readonly<{ kind: 'outcome'; outcome: LoginOutcome; flow?: LoginFlow }>
  | Readonly<{ kind: 'pending'; flow?: LoginFlow }>
  | Readonly<{ kind: 'accepted'; flow?: LoginFlow }>
export function readSubmitReply(reply: unknown): SubmitReply
export const PENDING_RESULT_COPY: string
export function submitReceiptResult(read: SubmitReply): Readonly<{ status: 'saved' | 'failed' | 'unknown'; message: string; detail?: string; detailFromHost?: boolean }>
export function verifySubmission(flow: LoginFlow | null | undefined, taskId: string): Readonly<{ applied: boolean; message: string }> | undefined
export const SUBMIT_ERROR_COPY: Readonly<Record<'input_invalid' | 'input_required' | 'invalid_action' | 'unsupported', string>>
export function flowsUnsupported(status: { kind: string; serverCode?: string; message?: string } | null | undefined): boolean
export function flowControls(flow: LoginFlow | null | undefined, declaration: LoginDeclaration | undefined, canOperate: boolean): Readonly<{ relogin: boolean; refresh: boolean; cancel: boolean }>
export function readLoginDeclaration(endpoint: unknown): LoginDeclaration | undefined
export const CHALLENGE_KIND_COPY: Readonly<Record<LoginChallengeKind, string>>

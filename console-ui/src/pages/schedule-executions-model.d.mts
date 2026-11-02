export type ExecutionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'unsettled' | 'budget_partial'
export type DeliveryStatus = 'not_requested' | 'not_sent' | 'delivered' | 'partial' | 'failed' | 'unknown'
export interface ExecutionSummary { runId: string; jobId: string; label?: string; source: 'scheduled' | 'manual' | 'event' | 'preview'; queuedAt: number; startedAt?: number; finishedAt?: number; status: ExecutionStatus; attemptCount: number; deliveryStatus?: DeliveryStatus; recordingIssue?: boolean }
export interface ExecutionResult { success: boolean; status?: 'succeeded' | 'failed' | 'cancelled' | 'budget_partial'; output: string; error?: string; durationMs: number; tokenUsage: { input: number; output: number }; replay?: { disposition: 'safe' | 'committed' | 'unknown'; operations: Array<{ id: string; status: string; toolName?: string }> }; delivery?: { status: DeliveryStatus; channel: string; message?: string; deliveryUnknown?: true } }
export interface ExecutionProgress { type: 'attempt_progress'; runId: string; jobId: string; attemptId: string; at: number; phase: 'model' | 'tool' | 'approval' | 'delivery'; status: string; toolName?: string; code?: string }
export interface ExecutionAttempt { runId: string; jobId: string; attemptId: string; number: number; startedAt: number; finishedAt?: number; progress: ExecutionProgress[]; result?: ExecutionResult; retry?: { decision: 'retry' | 'stop'; reason: 'cancelled' | 'timeout' | 'attempt_budget_exhausted' | 'committed' | 'unknown' | 'not_retryable' | 'read_only' | 'not_submitted' } }
export interface ExecutionRecord extends ExecutionSummary { version: 1; scheduledAt?: number; job: { id: string; label?: string; createdBy?: { userId: string; name?: string }; notify?: { channel: string; target?: { scene: { platform: string; endpointKey: string; sceneId: string; kind: string; parent?: { kind: string; sceneId: string } }; threadId?: string } } }; attempts: ExecutionAttempt[]; result?: ExecutionResult }
export interface ExecutionPage { runs: ExecutionSummary[]; nextCursor: string | null; recordingHealth: { activeWriteFailures: number; incompleteCompletedRuns: number; lastFailureAt?: number; lastRun?: { runId: string; jobId: string } } }
export function readExecutionPage(body: unknown, jobId?: string, locale?: 'zh-CN' | 'en'): ExecutionPage
export function readExecutionDetail(body: unknown, jobId: string, runId: string, locale?: 'zh-CN' | 'en'): ExecutionRecord
export function readExecutionCleanup(body: unknown, locale?: 'zh-CN' | 'en'): { deleted: number; cutoff: number }
export function executionQuery(jobId?: string, cursor?: string): string
export function executionDetailQuery(jobId: string, runId: string): string
export function executionFailure(status: number, locale?: 'zh-CN' | 'en'): string
export function executionStatus(status: string, locale?: 'zh-CN' | 'en'): string
export function deliveryStatus(status?: string, locale?: 'zh-CN' | 'en', unknown?: boolean): string
export function progressLabel(event: Pick<ExecutionProgress, 'phase' | 'status' | 'toolName'>, locale?: 'zh-CN' | 'en'): string

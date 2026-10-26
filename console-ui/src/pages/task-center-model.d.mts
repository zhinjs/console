import type { DiagnosticConversation } from './endpoint-detail/types'
import type { SchemaField } from '../components/PluginConfigForm/types'
export type TaskAction = 'pause' | 'resume' | 'cancel' | 'update'
export type TaskState = 'scheduled' | 'paused' | 'running' | 'unknown' | 'succeeded' | 'failed' | 'cancelled'
export interface AdminTask { id: string; ownership: 'administrator'; title: string; target: DiagnosticConversation; state: TaskState; createdAt: number; nextRunAt?: number; lastRunAt?: number; timezone?: string; detail?: string; parameters: Record<string, unknown>; actions: TaskAction[] }
export interface TaskReceipt { requestId: string; taskId: string; operation: 'create' | TaskAction }
export interface TaskSnapshot { revision: string; tasks: AdminTask[]; receipts: TaskReceipt[] }
export interface TaskProvider extends TaskSnapshot { owner: string; packageName?: string | null; title: string; description: string; schema: Record<string, unknown>; effects: string[] }
export interface TaskProviders { generation: number; providers: TaskProvider[] }
export interface PendingTask { owner: string; requestId: string; operation: 'create' | TaskAction; generation: number; host: string; scope: string }
export interface TaskUseCase { id: string; title: string; summary: string; packageName: string; mode: string; steps: string[]; limitations: string[] }
export interface TaskMutationBody { generation: number; owner: string; requestId: string; expectedRevision: string; target?: DiagnosticConversation; parameters?: Record<string, unknown>; id?: string; action?: TaskAction }
export const TASK_STATE_LABELS: Record<TaskState, string>
export const TASK_ACTION_LABELS: Record<TaskAction, string>
export function readTaskSnapshot(value: unknown, locale?: 'zh-CN' | 'en'): TaskSnapshot
export function readTaskProviders(body: unknown, locale?: 'zh-CN' | 'en'): TaskProviders
export function readTaskMutation(body: unknown, locale?: 'zh-CN' | 'en'): { generation: number; provider: TaskProvider }
export function taskBusinessError(body: unknown): string | undefined
export function readTaskUseCases(body: unknown, locale?: 'zh-CN' | 'en'): TaskUseCase[]
export function reconcileTaskMutation(catalog: TaskProviders, pending: PendingTask): { receipt: TaskReceipt; task?: AdminTask } | undefined
export function readPendingTask(value: unknown): PendingTask | undefined
export function taskParameterFields(schema: unknown, locale?: 'zh-CN' | 'en'): { fields: Record<string, SchemaField>; unsupported?: string }
export function taskDefaults(schema: unknown, locale?: 'zh-CN' | 'en'): Record<string, unknown>
export function validateTaskParameters(schema: unknown, parameters: Record<string, unknown>, locale?: 'zh-CN' | 'en'): string[]
export function availableTaskActions(task: AdminTask): TaskAction[]
export function taskTimeLabel(time?: number, timezone?: string, locale?: 'zh-CN' | 'en'): string
export function taskDateTimeLabel(value: unknown, timezone?: string, locale?: 'zh-CN' | 'en'): string
export function taskParameterSummary(schema: Record<string, unknown>, parameters: Record<string, unknown>, timezone?: string, locale?: 'zh-CN' | 'en'): Array<{ key: string; title: string; value: string }>
export function taskActionDescription(action: string, locale?: 'zh-CN' | 'en'): string
export function taskMutationBody(input: { generation: number; provider: TaskProvider; requestId: string; target?: DiagnosticConversation; parameters?: Record<string, unknown>; id?: string; action?: TaskAction }, locale?: 'zh-CN' | 'en'): TaskMutationBody

export type RequestAction = 'approve' | 'reject' | 'consume'
export interface RequestRef { readonly platformRequestId: string; readonly id?: number }
export interface RequestActionPayload { action: RequestAction; adapter: string; endpointKey: string; platformRequestId: string; id?: number }
export interface SideEventRpc { REQUEST_APPROVE: string; REQUEST_REJECT: string; REQUEST_CONSUMED: string; NOTICE_CONSUMED: string }
export const REQUEST_ACTIONS: readonly RequestAction[]
export function requestReceiptKey(adapter: string, endpointKey: string, request: RequestRef): string
export function noticeReceiptKey(adapter: string, endpointKey: string, id: number): string
export function requestActionPayload(action: RequestAction, adapter: string, endpointKey: string, request: RequestRef): RequestActionPayload
export function requestActionBody(payload: RequestActionPayload, rpc: SideEventRpc): { type: string } & Record<string, unknown>
type Plan = { payload?: unknown }
export function requestActionHandlers(options: { send: (body: { type: string } & Record<string, unknown>) => Promise<unknown>; reload: () => Promise<readonly { platformRequestId?: string; id?: number }[] | null>; rpc: SideEventRpc; t?: (text: string) => string }): { submit: (plan: Plan) => Promise<unknown>; verify: (plan: Plan) => Promise<{ applied?: boolean; message?: string }> }
export function noticeActionHandlers(options: { send: (body: { type: string } & Record<string, unknown>) => Promise<unknown>; reload: () => Promise<readonly { id: number }[] | null>; rpc: SideEventRpc; t?: (text: string) => string }): { submit: (plan: Plan) => Promise<unknown>; verify: (plan: Plan) => Promise<{ applied?: boolean; message?: string }> }

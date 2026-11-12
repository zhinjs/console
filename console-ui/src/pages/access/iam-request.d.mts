export declare class IamRequestError extends Error {
  constructor(message: string, options?: { status?: number; code?: string; hostMessage?: string; retryAfter?: number })
  readonly status: number
  readonly code: string
  readonly hostMessage: string
  readonly retryAfter?: number
}
export type IamErrorKind = 'unsupported' | 'last_owner' | 'forbidden' | 'database_busy' | 'unavailable' | 'failed'
export function iamErrorKind(error: unknown): IamErrorKind
export function readIamReply(status: number, json: unknown, t: (message: string, values?: readonly unknown[]) => string, retryAfterHeader?: string | null): unknown

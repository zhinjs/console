export declare class IamRequestError extends Error {
  constructor(message: string, options?: { status?: number; code?: string; hostMessage?: string })
  readonly status: number
  readonly code: string
  readonly hostMessage: string
}
export type IamErrorKind = 'unsupported' | 'last_owner' | 'forbidden' | 'unavailable' | 'failed'
export function iamErrorKind(error: unknown): IamErrorKind
export function readIamReply(status: number, json: unknown, t: (message: string, values?: readonly unknown[]) => string): unknown

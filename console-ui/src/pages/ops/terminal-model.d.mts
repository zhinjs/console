import type { TerminalServerControl, TerminalTarget } from '../../contracts/gateway'

type Translate = (message: string, values?: readonly unknown[]) => string

export declare const TERMINAL_CLOSE_CODES: Readonly<{
  normal: 1000; abnormal: 1006; startFailed: 1011; badRequest: 4400; invalidTicket: 4401; forbidden: 4403; tooManySessions: 4429
}>
export declare const TERMINAL_PING_MS: number
export declare const TERMINAL_MIN_SIZE: number
export declare const TERMINAL_MAX_SIZE: number

export function terminalPaths(base?: string): Readonly<{ targets: string; tickets: string; socket: string }>
export function readTerminalTargets(value: unknown): TerminalTarget[]
export function terminalSocketUrl(apiBase: string, ticket: string, base?: string, location?: { href: string }): string
export function clampTerminalSize(value: unknown): number
export function parseServerControl(text: string): (TerminalServerControl & Record<string, unknown>) | null
export function endReasonMessage(reason: string, t: Translate): string
export function reasonForClose(code: number | undefined, closeReason?: string): string
export function terminalHttpError(status: number, body: unknown, t: Translate): { kind: 'disabled' | 'unauthorized' | 'forbidden' | 'too-many-sessions' | 'unavailable' | 'failed'; message: string }

export interface TerminalEnd {
  readonly reason: string
  readonly code: number | null
  readonly message: string
}

export interface TerminalSocketLike {
  binaryType: string
  readonly readyState: number
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
  onerror: ((event: unknown) => void) | null
}

export interface TerminalConnectionDeps {
  requestTicket(target: string, cols: number, rows: number): Promise<{ ticket: string }>
  socketUrl(ticket: string): string
  WebSocket: new (url: string) => TerminalSocketLike
  setInterval?: (handler: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
  onReady?(info: Extract<TerminalServerControl, { type: 'ready' }>): void
  onOutput?(bytes: Uint8Array): void
  onError?(message: string): void
  onEnd?(end: TerminalEnd): void
}

export interface TerminalConnection {
  readonly state: 'idle' | 'connecting' | 'ready' | 'ended'
  start(target: string, cols: number, rows: number): Promise<void>
  write(data: string | Uint8Array): boolean
  resize(cols: number, rows: number): boolean
  dispose(): void
}

export function createTerminalConnection(deps: TerminalConnectionDeps, t: Translate): TerminalConnection

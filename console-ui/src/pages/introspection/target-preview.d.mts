import type { RenderingDiagnostic } from '../endpoint-detail/rendering-diagnostics.mjs'
export interface PreviewEndpoint { name: string; connected: boolean; endpoint: { id: string; adapter: string } }
export interface PreviewTarget { endpoint: { id: string; adapter: string }; kind: 'private' | 'group' | 'channel'; id: string; parent?: { kind: 'private' | 'group' | 'channel'; id: string }; threadId?: string }
export function readPreviewEndpoints(payload: unknown): PreviewEndpoint[]
export function buildPreviewTarget(endpoint: PreviewEndpoint['endpoint'] | undefined, fields: { kind: string; id: string; parentKind?: string; parentId?: string; threadId?: string }): PreviewTarget
export function readPreviewResponse(body: unknown, target?: PreviewTarget): { output: unknown; rendering?: RenderingDiagnostic; generation?: number }
export function createPreviewRequestGate(): { begin(): { signal: AbortSignal; current(): boolean }; cancel(): void }

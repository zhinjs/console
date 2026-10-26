export interface RenderingDiagnostic {
  forms: Array<'text' | 'image' | 'native'>
  fallbacks: Array<'renderer_unavailable' | 'renderer_failed' | 'media_unsupported' | 'html_text_policy' | 'markdown_text_policy' | 'interactive_text_policy'>
}
export function readRendering(value: unknown, locale?: 'zh-CN' | 'en'): RenderingDiagnostic | undefined
export function renderingLabels(value: unknown, locale?: 'zh-CN' | 'en'): { forms: string[]; fallbacks: string[] } | undefined
export function matchesMessageConversation(message: { channelType: string; channelId: string; parent?: { type?: string; kind?: string; id: string }; threadId?: string }, selection: import('./types').SidebarSelection | null): boolean
export function correlateChatRows<T extends { endpoint?: { id: string; adapter: string }; id: string; messageId?: string; channelType: string; channelId: string; outgoing?: boolean; local?: boolean; timestamp: number; content: unknown; rendering?: RenderingDiagnostic }>(rows: T[], limit?: number): T[]
export function readMessagePush(payload: unknown, locale?: 'zh-CN' | 'en'): { conversation: import('./types').DiagnosticConversation; endpoint: { id: string; adapter: string }; adapter: string; endpointKey: string; channelId: string; channelType: string; sender?: unknown; content: unknown; timestamp: number; parent?: { type: 'group' | 'guild'; id: string }; threadId?: string; messageId?: string; outgoing: boolean; rendering?: RenderingDiagnostic; renderingError?: string } | undefined

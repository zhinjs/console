export interface ConversationListNotice { text: string; tone: 'neutral' | 'warning' | 'error'; details?: string }
export function conversationListNotice(input: {total: number; errors?: string[]; connected?: boolean; historyOnly?: boolean}): ConversationListNotice | null

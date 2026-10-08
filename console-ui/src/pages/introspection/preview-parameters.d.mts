export function previewParameters(item: Record<string, unknown>): { hasExample: boolean; text: string }
export function copyJson(value: unknown, clipboard: Pick<Clipboard, 'writeText'>): Promise<string>

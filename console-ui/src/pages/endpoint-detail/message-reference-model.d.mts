export interface TextReference {
  id: string
  senderName: string
  summary: string
}
export type Translate = (message: string, values?: readonly unknown[]) => string
export const TEXT_REFERENCE_SUMMARY_LIMIT: number
export function textReferencePrefix(kind: 'quote' | 'forward', reference: TextReference, t: Translate): string
export function textReferenceSendOptions(
  drafts: { quote: TextReference | null; forward: TextReference | null },
  t: Translate,
): { textPrefix?: string; displayPrefixSegments?: Array<{ type: 'text'; data: { text: string } }> }
export type CopySummaryResult = 'copied' | 'failed' | 'unavailable'
export function copyMessageSummary(
  text: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  document: Document | undefined,
): Promise<CopySummaryResult>

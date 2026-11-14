export type AnsiTone = 'default' | 'muted' | 'danger' | 'success' | 'warning' | 'info' | 'accent'
export const ANSI_TONES: readonly AnsiTone[]
export interface AnsiSegment {
  text: string
  tone: AnsiTone | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
}
export function parseAnsi(input: string): AnsiSegment[]
export function stripAnsi(input: string): string
export function hasLeadingTime(input: string): boolean

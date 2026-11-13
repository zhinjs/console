export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H'
export interface QrCode {
  readonly version: number
  readonly size: number
  readonly ecl: QrErrorCorrection
  readonly mask: number
  /** `modules[y][x] === true` for a dark module. */
  readonly modules: readonly (readonly boolean[])[]
}
export const QR_MIN_VERSION: number
export const QR_MAX_VERSION: number
export function rawDataModules(version: number): number
export function dataCodewords(version: number, ecl: QrErrorCorrection): number
export function alignmentPositions(version: number): number[]
export function formatBits(ecl: QrErrorCorrection, mask: number): number
export function versionBits(version: number): number
export function reedSolomonDivisor(degree: number): number[]
export function reedSolomonRemainder(data: readonly number[], divisor: readonly number[]): number[]
export function encodeQr(text: string, options?: { ecl?: QrErrorCorrection; minVersion?: number; maxVersion?: number; mask?: number }): QrCode
export function penaltyScore(modules: readonly (readonly boolean[])[]): number
export function qrSvgPath(qr: QrCode, border?: number): string

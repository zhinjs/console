export const MASONRY_MIN_WIDTH: number
export const MASONRY_MAX_WIDTH: number
export const MASONRY_GAP: number
export function masonryLayout(availableWidth: number, heights: number[]): { columns: number; maxWidth: number; columnWidth: number; items: { column: number; row: number; span: number }[] }

export const MASONRY_MIN_WIDTH = 240
export const MASONRY_MAX_WIDTH = 380
export const MASONRY_GAP = 16

export function masonryLayout(availableWidth, heights) {
  const width = Math.max(0, availableWidth)
  const capacity = Math.max(1, Math.floor((width + MASONRY_GAP) / (MASONRY_MIN_WIDTH + MASONRY_GAP)))
  const columns = Math.min(capacity, Math.max(1, Math.ceil((width + MASONRY_GAP) / (MASONRY_MAX_WIDTH + MASONRY_GAP))))
  const maxWidth = columns * MASONRY_MAX_WIDTH + (columns - 1) * MASONRY_GAP
  const columnWidth = Math.max(0, (Math.min(width, maxWidth) - (columns - 1) * MASONRY_GAP) / columns)
  const bottoms = Array(columns).fill(0)
  const items = heights.map(height => {
    const column = bottoms.indexOf(Math.min(...bottoms))
    const top = bottoms[column]
    const span = Math.max(1, Math.ceil(height))
    bottoms[column] += span + MASONRY_GAP
    return { column: column + 1, row: top + 1, span }
  })
  return { columns, maxWidth, columnWidth, items }
}

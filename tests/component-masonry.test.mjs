import assert from 'node:assert/strict'
import test from 'node:test'
import { masonryLayout, MASONRY_MIN_WIDTH, MASONRY_MAX_WIDTH, MASONRY_GAP } from '../console-ui/src/pages/introspection/masonry-layout.mjs'

test('columns flex between bounds without expanding the inter-column gap', () => {
  for (const width of [180, 240, 390, 510, 768, 900, 1494, 1920]) {
    const result = masonryLayout(width, [100, 200])
    assert.ok(result.columnWidth <= MASONRY_MAX_WIDTH)
    assert.ok(result.columnWidth >= MASONRY_MIN_WIDTH || result.columns === 1)
    assert.ok(result.columns * result.columnWidth + (result.columns - 1) * MASONRY_GAP <= width + 0.001)
  }
  assert.equal(masonryLayout(1494, []).columns, 4)
  assert.equal(masonryLayout(900, []).columns, 3)
  assert.equal(masonryLayout(390, []).columns, 1)
})

test('each next card fills the shortest column and changing content cannot overlap cards', () => {
  for (const heights of [[200, 100, 180, 80, 300, 60], [600, 100, 180, 80, 32, 60]]) {
    const result = masonryLayout(900, heights)
    const bottoms = Array(result.columns).fill(0)
    result.items.forEach((item, index) => {
      assert.equal(item.row - 1, Math.min(...bottoms))
      assert.ok(item.row - 1 >= bottoms[item.column - 1])
      assert.ok(item.span >= heights[index])
      bottoms[item.column - 1] = item.row - 1 + item.span + MASONRY_GAP
    })
  }
})

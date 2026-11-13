import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  alignmentPositions, dataCodewords, encodeQr, formatBits, qrSvgPath, rawDataModules, reedSolomonDivisor, reedSolomonRemainder, versionBits,
} from '../console-ui/src/pages/scope/qr-code.mjs'

const golden = JSON.parse(readFileSync(new URL('./fixtures/qr-golden.json', import.meta.url), 'utf8'))
const rows = qr => qr.modules.map(row => row.map(dark => (dark ? '1' : '0')).join(''))

test('matrices match an independent encoder module for module (versions 2, 3 and 8, levels M and Q)', () => {
  assert.ok(golden.cases.length >= 3)
  for (const item of golden.cases) {
    const qr = encodeQr(item.text, { ecl: item.ecl, mask: item.mask })
    assert.equal(qr.version, item.version, item.text)
    assert.deepEqual(rows(qr), item.rows, item.text)
  }
})

test('capacity and structure tables follow the standard', () => {
  assert.equal(rawDataModules(1), 208)
  assert.equal(rawDataModules(7), 1568)
  assert.equal(rawDataModules(40), 29648)
  assert.deepEqual([dataCodewords(1, 'L'), dataCodewords(1, 'M'), dataCodewords(1, 'Q'), dataCodewords(1, 'H')], [19, 16, 13, 9])
  assert.equal(dataCodewords(40, 'L'), 2956)
  assert.deepEqual(alignmentPositions(1), [])
  assert.deepEqual(alignmentPositions(2), [6, 18])
  assert.deepEqual(alignmentPositions(7), [6, 22, 38])
  assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138])
  // Annex C: level M, mask 5 → 100000011001110; version 7 → 000111110010010100.
  assert.equal(formatBits('M', 5).toString(2).padStart(15, '0'), '100000011001110')
  assert.equal(versionBits(7).toString(2).padStart(18, '0'), '000111110010010100')
  // Reed–Solomon over GF(256): generator for 7 ECC codewords (version 1-L) and a known remainder.
  assert.deepEqual(reedSolomonDivisor(7), [127, 122, 154, 164, 11, 68, 117])
  assert.deepEqual(reedSolomonRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], reedSolomonDivisor(10)),
    [196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
})

test('every code has finder, timing and dark modules; the smallest version that fits is chosen', () => {
  const qr = encodeQr('https://accounts.qq.com/login/attack?sid=0123456789abcdef')
  assert.equal(qr.size, qr.version * 4 + 17)
  assert.ok(qr.mask >= 0 && qr.mask <= 7)
  const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111']
  const grid = rows(qr)
  for (const [x, y] of [[0, 0], [qr.size - 7, 0], [0, qr.size - 7]]) {
    assert.deepEqual(grid.slice(y, y + 7).map(row => row.slice(x, x + 7)), finder)
  }
  for (let index = 8; index < qr.size - 8; index++) assert.equal(qr.modules[6][index], index % 2 === 0, 'timing row')
  assert.equal(qr.modules[qr.size - 8][8], true, 'dark module')
  assert.equal(encodeQr('x'.repeat(14), { ecl: 'M' }).version, 1)
  assert.equal(encodeQr('x'.repeat(15), { ecl: 'M' }).version, 2)
  assert.equal(encodeQr('中', { ecl: 'H' }).version, 1, 'UTF-8 bytes')
})

test('long texts, bad options and the SVG path', () => {
  assert.throws(() => encodeQr('x'.repeat(3000), { ecl: 'L' }), RangeError)
  assert.throws(() => encodeQr('x', { ecl: 'Z' }), RangeError)
  assert.throws(() => encodeQr('x', { mask: 8 }), RangeError)
  assert.throws(() => encodeQr('x'.repeat(200), { maxVersion: 2 }), RangeError)
  const qr = encodeQr('HELLO')
  const path = qrSvgPath(qr, 4)
  assert.match(path, /^M4 4h7v1h-7z/u, 'first run is the top-left finder row')
  const dark = qr.modules.flat().filter(Boolean).length
  const covered = [...path.matchAll(/h(\d+)v1/gu)].reduce((sum, match) => sum + Number(match[1]), 0)
  assert.equal(covered, dark, 'runs cover exactly the dark modules')
})

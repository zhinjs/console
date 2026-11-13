/**
 * Tiny QR Code encoder (ISO/IEC 18004, byte mode only), zero dependencies. Used to show a
 * verification link as a QR code in the browser (Login Assist `link.showQr`), so the phone that has
 * to verify can scan it; the link never leaves the page.
 *
 * Algorithm after Project Nayuki's "QR Code generator library" (MIT License,
 * https://www.nayuki.io/page/qr-code-generator-library), reduced to what the Console needs:
 * UTF-8 byte segments, versions 1–40, error correction L / M / Q / H, automatic or fixed mask.
 */

const ECC_ORDINAL = Object.freeze({ L: 0, M: 1, Q: 2, H: 3 })
/** Format-info bits of each level (L=01, M=00, Q=11, H=10). */
const ECC_FORMAT_BITS = Object.freeze({ L: 1, M: 0, Q: 3, H: 2 })

const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
]
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
]

export const QR_MIN_VERSION = 1
export const QR_MAX_VERSION = 40

/** Number of modules available for data and ECC in a version (after all function patterns). */
export function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (version >= 7) result -= 36
  }
  return result
}

/** Data codewords (bytes) a version holds at an error correction level. */
export function dataCodewords(version, ecl) {
  const ordinal = ECC_ORDINAL[ecl]
  return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[ordinal][version] * NUM_ERROR_CORRECTION_BLOCKS[ordinal][version]
}

/** Centres of the alignment patterns of a version (ascending). */
export function alignmentPositions(version) {
  if (version === 1) return []
  const size = version * 4 + 17
  const numAlign = Math.floor(version / 7) + 2
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2
  const result = [6]
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
  return result
}

/** The 15 format bits (with BCH code and mask pattern) for a level and mask. */
export function formatBits(ecl, mask) {
  const data = (ECC_FORMAT_BITS[ecl] << 3) | mask
  let rem = data
  for (let index = 0; index < 10; index++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

/** The 18 version bits (with BCH code), versions ≥ 7. */
export function versionBits(version) {
  let rem = version
  for (let index = 0; index < 12; index++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

const bit = (value, index) => ((value >>> index) & 1) !== 0

function multiply(x, y) {
  let z = 0
  for (let index = 7; index >= 0; index--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> index) & 1) * x
  }
  return z
}

/** Reed–Solomon generator polynomial of a degree (coefficients without the leading 1). */
export function reedSolomonDivisor(degree) {
  const result = new Array(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let index = 0; index < degree; index++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = multiply(root, 0x02)
  }
  return result
}

/** Reed–Solomon remainder (ECC codewords) of `data` by `divisor`. */
export function reedSolomonRemainder(data, divisor) {
  const result = divisor.map(() => 0)
  for (const byte of data) {
    const factor = byte ^ result.shift()
    result.push(0)
    divisor.forEach((coefficient, index) => { result[index] ^= multiply(coefficient, factor) })
  }
  return result
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/**
 * Encodes `text` (UTF-8, byte mode). Options: `ecl` (`'L' | 'M' | 'Q' | 'H'`, default `'M'`),
 * `minVersion` / `maxVersion` (1–40), `mask` (0–7; default: the lowest penalty). Returns
 * `{ version, size, ecl, mask, modules }`, `modules[y][x] === true` for a dark module. Throws a
 * `RangeError` when the text does not fit.
 */
export function encodeQr(text, options = {}) {
  const ecl = options.ecl ?? 'M'
  if (!(ecl in ECC_ORDINAL)) throw new RangeError(`invalid error correction level: ${ecl}`)
  const minVersion = options.minVersion ?? QR_MIN_VERSION
  const maxVersion = options.maxVersion ?? QR_MAX_VERSION
  if (!(QR_MIN_VERSION <= minVersion && minVersion <= maxVersion && maxVersion <= QR_MAX_VERSION)) throw new RangeError('invalid version range')
  const mask = options.mask ?? -1
  if (mask < -1 || mask > 7 || !Number.isInteger(mask)) throw new RangeError('mask must be 0–7')
  const bytes = Array.from(new TextEncoder().encode(String(text)))

  let version = minVersion
  let usedBits
  for (;; version++) {
    const countBits = version <= 9 ? 8 : 16
    usedBits = bytes.length < 2 ** countBits ? 4 + countBits + bytes.length * 8 : Infinity
    if (usedBits <= dataCodewords(version, ecl) * 8) break
    if (version >= maxVersion) throw new RangeError('text too long for a QR code')
  }

  // Data bits: mode, count, bytes, terminator, byte padding, pad codewords.
  const bits = []
  const append = (value, length) => { for (let index = length - 1; index >= 0; index--) bits.push((value >>> index) & 1) }
  append(0x4, 4)
  append(bytes.length, version <= 9 ? 8 : 16)
  for (const byte of bytes) append(byte, 8)
  const capacity = dataCodewords(version, ecl) * 8
  append(0, Math.min(4, capacity - bits.length))
  append(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8)
  const data = []
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[index + j]
    data.push(byte)
  }

  const codewords = interleaveWithEcc(data, version, ecl)
  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x, y, dark) => { modules[y][x] = dark; fn[y][x] = true }

  // Function patterns: timing, finders, alignment, format (placeholder), version.
  for (let index = 0; index < size; index++) {
    set(6, index, index % 2 === 0)
    set(index, 6, index % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4)
      }
    }
  }
  const positions = alignmentPositions(version)
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(positions[i] + dx, positions[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }
  const drawFormat = (maskIndex) => {
    const value = formatBits(ecl, maskIndex)
    for (let index = 0; index <= 5; index++) set(8, index, bit(value, index))
    set(8, 7, bit(value, 6))
    set(8, 8, bit(value, 7))
    set(7, 8, bit(value, 8))
    for (let index = 9; index < 15; index++) set(14 - index, 8, bit(value, index))
    for (let index = 0; index < 8; index++) set(size - 1 - index, 8, bit(value, index))
    for (let index = 8; index < 15; index++) set(8, size - 15 + index, bit(value, index))
    set(8, size - 8, true)
  }
  drawFormat(0)
  if (version >= 7) {
    const value = versionBits(version)
    for (let index = 0; index < 18; index++) {
      const a = size - 11 + (index % 3)
      const b = Math.floor(index / 3)
      set(a, b, bit(value, index))
      set(b, a, bit(value, index))
    }
  }

  // Codewords in the zig-zag order, skipping function modules.
  let index = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vertical : vertical
        if (!fn[y][x] && index < codewords.length * 8) {
          modules[y][x] = bit(codewords[index >>> 3], 7 - (index & 7))
          index++
        }
      }
    }
  }

  const applyMask = (maskIndex) => {
    const test = MASKS[maskIndex]
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!fn[y][x] && test(x, y)) modules[y][x] = !modules[y][x]
    }
  }
  let chosen = mask
  if (chosen === -1) {
    let best = Infinity
    for (let candidate = 0; candidate < 8; candidate++) {
      applyMask(candidate)
      drawFormat(candidate)
      const score = penaltyScore(modules)
      if (score < best) { best = score; chosen = candidate }
      applyMask(candidate)
    }
  }
  applyMask(chosen)
  drawFormat(chosen)
  return Object.freeze({ version, size, ecl, mask: chosen, modules })
}

function interleaveWithEcc(data, version, ecl) {
  const ordinal = ECC_ORDINAL[ecl]
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ordinal][version]
  const blockEccLength = ECC_CODEWORDS_PER_BLOCK[ordinal][version]
  const rawCodewords = Math.floor(rawDataModules(version) / 8)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLength = Math.floor(rawCodewords / numBlocks)
  const divisor = reedSolomonDivisor(blockEccLength)
  const blocks = []
  for (let index = 0, offset = 0; index < numBlocks; index++) {
    const block = data.slice(offset, offset + shortBlockLength - blockEccLength + (index < numShortBlocks ? 0 : 1))
    offset += block.length
    const ecc = reedSolomonRemainder(block, divisor)
    if (index < numShortBlocks) block.push(0)
    blocks.push(block.concat(ecc))
  }
  const result = []
  for (let index = 0; index < blocks[0].length; index++) {
    blocks.forEach((block, j) => {
      if (index !== shortBlockLength - blockEccLength || j >= numShortBlocks) result.push(block[index])
    })
  }
  return result
}

/** Mask penalty (N1 runs, N2 boxes, N3 finder-like patterns, N4 balance). */
export function penaltyScore(modules) {
  const size = modules.length
  let result = 0
  const addHistory = (length, history) => {
    if (history[0] === 0) length += size
    history.pop()
    history.unshift(length)
  }
  const countPatterns = (history) => {
    const n = history[1]
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n
    return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
  }
  const terminate = (color, length, history) => {
    if (color) { addHistory(length, history); length = 0 }
    addHistory(length + size, history)
    return countPatterns(history)
  }
  for (const vertical of [false, true]) {
    for (let a = 0; a < size; a++) {
      let color = false
      let run = 0
      const history = [0, 0, 0, 0, 0, 0, 0]
      for (let b = 0; b < size; b++) {
        const dark = vertical ? modules[b][a] : modules[a][b]
        if (dark === color) {
          run++
          if (run === 5) result += 3
          else if (run > 5) result++
        } else {
          addHistory(run, history)
          if (!color) result += countPatterns(history) * 40
          color = dark
          run = 1
        }
      }
      result += terminate(color, run, history) * 40
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = modules[y][x]
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) result += 3
    }
  }
  let dark = 0
  for (const row of modules) for (const module of row) if (module) dark++
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  return result + k * 10
}

/**
 * One SVG path (`M x y h1 v1 h-1 z` per dark module, merged per row run) for a `viewBox` of
 * `size + 2 * border`. Render it dark on a light tile: scanners need the light quiet zone.
 */
export function qrSvgPath(qr, border = 4) {
  const parts = []
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue
      let run = 1
      while (x + run < qr.size && qr.modules[y][x + run]) run++
      parts.push(`M${x + border} ${y + border}h${run}v1h-${run}z`)
      x += run - 1
    }
  }
  return parts.join('')
}

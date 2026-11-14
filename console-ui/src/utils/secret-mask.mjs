/**
 * The Host's secret mask (`@zhin.js/console-protocol` `maskConsoleEnvValue`, zhinjs/zhin#1250), for
 * every secret the Console masks itself (environment values, read-back hints of config secrets).
 * Values shorter than SECRET_MASK_REVEAL_MIN_LENGTH characters become the mask alone, longer ones
 * keep their first and last two characters around it. The mask has a fixed width, so it never
 * tells the length. Characters are counted, not UTF-16 units.
 */

/** One masked character. A run of SECRET_MASK_RUN of them stands for the hidden part. */
export const SECRET_MASK_CHAR = '●'
export const SECRET_MASK_RUN = 8
/** Values shorter than this are masked completely; longer ones show their first and last two characters. */
export const SECRET_MASK_REVEAL_MIN_LENGTH = 16
/** The fixed-width mask itself. */
export const SECRET_MASK = SECRET_MASK_CHAR.repeat(SECRET_MASK_RUN)

/** `''` for an empty value, the mask alone below the threshold, otherwise 2 + mask + 2 characters. */
export function maskSecretText(value) {
  const chars = Array.from(String(value ?? ''))
  if (chars.length === 0) return ''
  if (chars.length < SECRET_MASK_REVEAL_MIN_LENGTH) return SECRET_MASK
  return `${chars.slice(0, 2).join('')}${SECRET_MASK}${chars.slice(-2).join('')}`
}

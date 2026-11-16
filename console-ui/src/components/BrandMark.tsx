/**
 * The Zhin brand mark: the favicon's shape (client/favicon.svg) as an inline SVG.
 *
 * Its colors are the palette-independent brand tokens (`--brand`, `--brand-foreground`,
 * `--brand-dot` in theme-tokens.css): #76EEC6 in light, #7FFFD4 in dark, with a near-black deep
 * green Z. They never follow the selected palette.
 *
 * TODO(console#125): once @zhin.js/console-ui publishes `BrandMark`, use it and delete this file.
 */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false" data-brand-mark="">
      <rect width="64" height="64" rx="18" style={{ fill: 'hsl(var(--brand))' }} />
      <path d="M18 18H46L43.4 24.2L28.5 40H45.5V47H17.5L20.1 40.8L35 25H18V18Z" style={{ fill: 'hsl(var(--brand-foreground))' }} />
      <circle cx="49" cy="15" r="5" style={{ fill: 'hsl(var(--brand-dot))' }} />
    </svg>
  )
}

/** One product name everywhere: the login page, the top bar and the browser tab. */
export const PRODUCT_NAME = 'Zhin Console'

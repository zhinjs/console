# Lightweight Console UI refresh

## Visual language

- Colour comes from the selectable palettes described in [appearance.md](appearance.md); feedback and status keep small semantic accents.
- Use the browser's normal font scale instead of multiplying the entire app by 125%. Native browser zoom and preferred font size still work.
- Match the adapter pages' system-font stack, restrained radii, and readable content hierarchy.
- Conversation surfaces are defined once in `console-ui/src/im-workspace.css`, imported by the entry stylesheet `client/style.css`. No grid wallpaper, glass layers, or decorative bubble shadows.
- Preserve syntax highlighting and meaningful data colors; do not replace information with decoration.

## Interaction changes

- Sign-in has explicit labels, optional token visibility, and closed-by-default connection help.
- Remembering a connection is opt-in. Unchecked tokens live in sessionStorage; checked tokens live in localStorage. Both stores are cleared before replacing the active token, avoiding precedence conflicts.
- Connection probes have an eight-second timeout. Host addresses remain non-secret site preferences, as required by the SDK's API-base contract.
- Error/warning notifications require dismissal or replacement by newer feedback; routine notifications expire after five seconds. Hover and keyboard focus pause expiry independently. Identical messages coalesce, and the stack is bounded to five notifications.
- Failed restart requests do not reload the page or leave the action permanently busy.
- Offline accounts are not labelled stopped unless the Host reports stopped transport.
- Sending has a visible label. Plain-text composition uses the ordinary UI font; Markdown mode keeps a monospace editor.
- On phones, message actions sit below their bubbles and the composer toolbar uses labelled, touch-sized icons. Standalone message IDs are collapsed by default; rendering errors, fallbacks, and direction uncertainty remain visible.
- Closed mobile drawers are inert. The conversation drawer has an explicit close action, Escape handling, Tab containment, and focus restoration.
- Existing permissions, mutation confirmations, configuration revisions, delivery paths, and credential redaction remain intact.

## Local verification

Start the read-only, loopback-only fixture with synthetic data:

```bash
pnpm exec node scripts/ui-preview-host.mjs
```

An optional argument selects a different fixture port. The fixture never calls a real Host, platform, model, or database. It keeps data in memory and rejects mutations deliberately, so failure feedback can be checked without side effects.

Build and serve the real production frontend:

```bash
pnpm build
```

```bash
pnpm preview
```

Use `http://127.0.0.1:5173` to keep preview browser storage separate from an existing localhost login. Sign in to the fixture's loopback address with the synthetic token `ui-preview`. The allowed Console origins are ports 9000 and 5173 on localhost/127.0.0.1; update the fixture's explicit origin list if you change these ports.

## Checks

```bash
pnpm typecheck
```

```bash
pnpm test
```

These checks do not replace browser interaction testing or prove that messages reached a platform.

The application continues to use its declared published SDK dependencies. This refresh does not restore removed APIs in Zhin or change RPC/event names.

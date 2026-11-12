import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { applyTheme, initializeTheme, getThemePreferences, getThemeSnapshot, setThemePreferences, subscribeTheme, THEME_MODES, THEME_PALETTES, THEME_STORAGE_KEY, PALETTE_STORAGE_KEY } from '../console-ui/src/theme/index.ts'

function fixture({ mode, palette, dark = false, blocked = false } = {}) {
  const previous = { window: globalThis.window, document: globalThis.document }
  const saved = new Map(), writes = [], classes = new Set(), properties = new Map([['--primary', '154 54% 40%'], ['--background', '150 30% 97%'], ['--host-extension-color', 'keep']])
  if (mode !== undefined) saved.set(THEME_STORAGE_KEY, mode)
  if (palette !== undefined) saved.set(PALETTE_STORAGE_KEY, palette)
  const storage = { getItem(key) { if (blocked) throw Error('blocked'); return saved.get(key) ?? null }, setItem(key, value) { if (blocked) throw Error('blocked'); writes.push([key, value]); saved.set(key, value) } }
  const media = new EventTarget(); media.matches = dark
  const window = new EventTarget(); window.localStorage = storage; window.matchMedia = () => media
  const root = { dataset: {}, classList: { remove: (...items) => items.forEach(item => classes.delete(item)), add: item => classes.add(item) }, style: { removeProperty: key => properties.delete(key), setProperty() { throw Error('CSS owns palette values') } } }
  const meta = { value: '', setAttribute(_key, value) { this.value = value } }
  globalThis.window = window; globalThis.document = { documentElement: root, querySelector: () => meta }
  return {
    root, classes, properties, writes, saved, storage, media, window, meta,
    system(next) { media.matches = next; media.dispatchEvent(new Event('change')) },
    storageEvent(key) { const event = new Event('storage'); Object.defineProperties(event, { key: { value: key }, storageArea: { value: storage } }); window.dispatchEvent(event) },
    close() { globalThis.window = previous.window; globalThis.document = previous.document },
  }
}

test('first load follows system without freezing its resolved mode into storage', () => {
  const f = fixture({ dark: true })
  try {
    assert.equal(initializeTheme(), 'dark')
    assert.deepEqual(getThemePreferences(), { mode: 'system', palette: 'ocean' })
    assert.deepEqual(f.writes, [])
    f.system(false); assert.deepEqual([...f.classes], ['light'])
    assert.equal(getThemeSnapshot(), 'system:ocean:light')
  } finally { f.close() }
})

test('legacy explicit light/dark preferences and saved palettes survive initialization', () => {
  for (const mode of ['light', 'dark']) for (const palette of THEME_PALETTES) {
    const f = fixture({ mode, palette: palette.id, dark: mode === 'light' })
    try { initializeTheme(); assert.deepEqual(getThemePreferences(), { mode, palette: palette.id }); assert.deepEqual([...f.classes], [mode]); assert.equal(f.writes.length, 0) } finally { f.close() }
  }
})

test('mode and palette are independent, explicit mode ignores OS changes, and System resumes live updates', () => {
  const f = fixture()
  try {
    initializeTheme(); setThemePreferences({ palette: 'plum' }); applyTheme('dark')
    assert.equal(getThemeSnapshot(), 'dark:plum:dark')
    f.system(false); assert.equal(getThemeSnapshot(), 'dark:plum:dark')
    setThemePreferences({ mode: 'system' }); f.system(true)
    assert.equal(getThemeSnapshot(), 'system:plum:dark')
    assert.equal(f.saved.get(THEME_STORAGE_KEY), 'system'); assert.equal(f.saved.get(PALETTE_STORAGE_KEY), 'plum')
    setThemePreferences({ mode: undefined, palette: undefined }); assert.equal(getThemeSnapshot(), 'system:plum:dark')
    assert.deepEqual(f.writes, [[PALETTE_STORAGE_KEY, 'plum'], [THEME_STORAGE_KEY, 'dark'], [THEME_STORAGE_KEY, 'system']])
  } finally { f.close() }
})

test('invalid and blocked storage defaults safely; blocked writes preserve session-only choices', () => {
  for (const options of [{ mode: 'invalid', palette: 'url(attack)' }, { blocked: true, dark: true }]) {
    const f = fixture(options)
    try { initializeTheme(); assert.deepEqual(getThemePreferences(), { mode: 'system', palette: 'ocean' }); setThemePreferences({ mode: 'dark', palette: 'forest' }); assert.equal(getThemeSnapshot(), 'dark:forest:dark') } finally { f.close() }
  }
  const f = fixture()
  try { initializeTheme(); assert.throws(() => setThemePreferences({ mode: 'auto' }), /Invalid/); assert.throws(() => setThemePreferences({ palette: 'unknown' }), /Invalid/) } finally { f.close() }
})

test('browser tabs synchronize preferences, cleared storage resets defaults, unrelated keys do nothing', () => {
  const f = fixture(); let updates = 0
  try {
    initializeTheme(); const stop = subscribeTheme(() => updates++)
    f.saved.set(THEME_STORAGE_KEY, 'dark'); f.saved.set(PALETTE_STORAGE_KEY, 'graphite'); f.storageEvent(PALETTE_STORAGE_KEY)
    assert.equal(getThemeSnapshot(), 'dark:graphite:dark'); assert.equal(updates, 1); assert.equal(f.writes.length, 0)
    f.storageEvent('zhin_api_token'); assert.equal(updates, 1)
    f.saved.clear(); f.storageEvent(null); assert.equal(getThemeSnapshot(), 'system:ocean:light')
    stop(); setThemePreferences({ palette: 'plum' }); assert.equal(updates, 2)
  } finally { f.close() }
})

test('reinitialization replaces runtime listeners, and every UI subscriber sees mode/palette changes', () => {
  const f = fixture(); let first = 0, second = 0
  try {
    initializeTheme(); initializeTheme()
    const stopFirst = subscribeTheme(() => first++), stopSecond = subscribeTheme(() => second++)
    f.system(true); assert.equal(first, 1); assert.equal(second, 1)
    stopFirst(); setThemePreferences({ palette: 'forest' }); assert.equal(first, 1); assert.equal(second, 2)
    stopSecond()
  } finally { f.close() }
})

test('legacy inline overrides are removed without writing palette variables or deleting extension styles', () => {
  const f = fixture()
  try {
    applyTheme('dark'); assert.deepEqual([...f.classes], ['dark'])
    assert.equal(f.properties.has('--primary'), false); assert.equal(f.properties.has('--background'), false)
    assert.equal(f.properties.get('--host-extension-color'), 'keep')
    applyTheme('light'); assert.deepEqual([...f.classes], ['light'])
    assert.deepEqual(f.writes, [[THEME_STORAGE_KEY, 'dark'], [THEME_STORAGE_KEY, 'light']])
  } finally { f.close() }
})

test('early HTML bootstrap and runtime select the same palette/mode without persisting defaults', async () => {
  const html = await readFile(new URL('../client/index.html', import.meta.url), 'utf8')
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]
  assert.ok(script); assert.ok(html.indexOf('<script>') < html.indexOf('src="./main.tsx"'))
  for (const mode of [...THEME_MODES, 'invalid']) for (const palette of THEME_PALETTES) for (const dark of [true, false]) {
    const f = fixture({ mode, palette: palette.id, dark })
    try {
      vm.runInNewContext(script, { document, window, localStorage: f.storage })
      const early = { ...f.root.dataset }, earlyClass = [...f.classes]
      initializeTheme(); assert.deepEqual(f.root.dataset, early); assert.deepEqual([...f.classes], earlyClass); assert.equal(f.writes.length, 0)
    } finally { f.close() }
  }
  const blocked = fixture({ blocked: true, dark: true })
  try { vm.runInNewContext(script, { document, window, localStorage: blocked.storage }); assert.equal(blocked.root.dataset.themeMode, 'system'); assert.deepEqual([...blocked.classes], ['dark']) } finally { blocked.close() }
})

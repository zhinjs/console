import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { applyTheme, initializeTheme, getThemePreferences, getThemeSnapshot, setThemePreferences, subscribeTheme, THEME_COLORS, THEME_MODES, THEME_STORAGE_KEY, LEGACY_PALETTE_STORAGE_KEY } from '../console-ui/src/theme/index.ts'

function fixture({ mode, palette, dark = false, blocked = false } = {}) {
  const previous = { window: globalThis.window, document: globalThis.document }
  const saved = new Map(), writes = [], removed = [], classes = new Set(), properties = new Map([['--primary', '154 54% 40%'], ['--background', '150 30% 97%'], ['--host-extension-color', 'keep']])
  if (mode !== undefined) saved.set(THEME_STORAGE_KEY, mode)
  if (palette !== undefined) saved.set(LEGACY_PALETTE_STORAGE_KEY, palette)
  const storage = {
    getItem(key) { if (blocked) throw Error('blocked'); return saved.get(key) ?? null },
    setItem(key, value) { if (blocked) throw Error('blocked'); writes.push([key, value]); saved.set(key, value) },
    removeItem(key) { if (blocked) throw Error('blocked'); removed.push(key); saved.delete(key) },
  }
  const media = new EventTarget(); media.matches = dark
  const window = new EventTarget(); window.localStorage = storage; window.matchMedia = () => media
  const root = { dataset: {}, classList: { remove: (...items) => items.forEach(item => classes.delete(item)), add: item => classes.add(item) }, style: { removeProperty: key => properties.delete(key), setProperty() { throw Error('CSS owns palette values') } } }
  const meta = { value: '', setAttribute(_key, value) { this.value = value } }
  globalThis.window = window; globalThis.document = { documentElement: root, querySelector: () => meta }
  return {
    root, classes, properties, writes, removed, saved, storage, media, window, meta,
    system(next) { media.matches = next; media.dispatchEvent(new Event('change')) },
    storageEvent(key) { const event = new Event('storage'); Object.defineProperties(event, { key: { value: key }, storageArea: { value: storage } }); window.dispatchEvent(event) },
    close() { globalThis.window = previous.window; globalThis.document = previous.document },
  }
}

test('first load follows the system with data-theme="system" and does not freeze its resolved mode into storage', () => {
  const f = fixture({ dark: true })
  try {
    assert.equal(initializeTheme(), 'dark')
    assert.deepEqual(getThemePreferences(), { mode: 'system' })
    assert.equal(f.root.dataset.theme, 'system', 'console-ui 1.3.0 follows the system only with data-theme="system"')
    assert.deepEqual([...f.classes], ['dark'], 'the resolved class stays for the Console’s own .dark rules')
    assert.deepEqual(f.writes, [])
    f.system(false); assert.deepEqual([...f.classes], ['light'])
    assert.equal(getThemeSnapshot(), 'system:light')
  } finally { f.close() }
})

test('explicit light / dark are a class only: no data-theme, so the library’s system rule never applies', () => {
  for (const mode of ['light', 'dark']) {
    const f = fixture({ mode, dark: mode === 'light' })
    try {
      initializeTheme()
      assert.deepEqual(getThemePreferences(), { mode }); assert.deepEqual([...f.classes], [mode]); assert.equal(f.writes.length, 0)
      assert.equal('theme' in f.root.dataset, false)
    } finally { f.close() }
  }
})

test('the palette is gone: a saved palette is removed once and never written to the page', () => {
  const f = fixture({ mode: 'dark', palette: 'plum' })
  try {
    f.root.dataset.palette = 'plum'
    initializeTheme()
    assert.deepEqual(f.removed, [LEGACY_PALETTE_STORAGE_KEY])
    assert.equal('palette' in f.root.dataset, false)
    assert.equal(getThemeSnapshot(), 'dark:dark')
    assert.equal(f.meta.value, THEME_COLORS.dark)
  } finally { f.close() }
})

test('theme-color is the soft-card page background: #F7F5F3 light, #121010 dark', () => {
  assert.deepEqual(THEME_COLORS, { light: '#F7F5F3', dark: '#121010' })
  const f = fixture()
  try {
    initializeTheme(); assert.equal(f.meta.value, '#F7F5F3')
    applyTheme('dark'); assert.equal(f.meta.value, '#121010')
  } finally { f.close() }
})

test('explicit mode ignores OS changes, and System resumes live updates', () => {
  const f = fixture()
  try {
    initializeTheme(); applyTheme('dark')
    assert.equal(getThemeSnapshot(), 'dark:dark')
    f.system(false); assert.equal(getThemeSnapshot(), 'dark:dark')
    setThemePreferences({ mode: 'system' }); f.system(true)
    assert.equal(getThemeSnapshot(), 'system:dark'); assert.equal(f.root.dataset.theme, 'system')
    assert.equal(f.saved.get(THEME_STORAGE_KEY), 'system')
    setThemePreferences({ mode: undefined }); assert.equal(getThemeSnapshot(), 'system:dark')
    assert.deepEqual(f.writes, [[THEME_STORAGE_KEY, 'dark'], [THEME_STORAGE_KEY, 'system']])
  } finally { f.close() }
})

test('invalid and blocked storage defaults safely; blocked writes preserve session-only choices', () => {
  for (const options of [{ mode: 'invalid' }, { blocked: true, dark: true }]) {
    const f = fixture(options)
    try { initializeTheme(); assert.deepEqual(getThemePreferences(), { mode: 'system' }); setThemePreferences({ mode: 'dark' }); assert.equal(getThemeSnapshot(), 'dark:dark') } finally { f.close() }
  }
  const f = fixture()
  try { initializeTheme(); assert.throws(() => setThemePreferences({ mode: 'auto' }), /Invalid/) } finally { f.close() }
})

test('browser tabs synchronize the mode, cleared storage resets the default, unrelated keys do nothing', () => {
  const f = fixture(); let updates = 0
  try {
    initializeTheme(); const stop = subscribeTheme(() => updates++)
    f.saved.set(THEME_STORAGE_KEY, 'dark'); f.storageEvent(THEME_STORAGE_KEY)
    assert.equal(getThemeSnapshot(), 'dark:dark'); assert.equal(updates, 1); assert.equal(f.writes.length, 0)
    f.storageEvent('zhin_api_token'); assert.equal(updates, 1)
    f.storageEvent(LEGACY_PALETTE_STORAGE_KEY); assert.equal(updates, 1, 'the old palette key changes nothing')
    f.saved.clear(); f.storageEvent(null); assert.equal(getThemeSnapshot(), 'system:light')
    stop(); setThemePreferences({ mode: 'light' }); assert.equal(updates, 2)
  } finally { f.close() }
})

test('reinitialization replaces runtime listeners, and every UI subscriber sees mode changes', () => {
  const f = fixture(); let first = 0, second = 0
  try {
    initializeTheme(); initializeTheme()
    const stopFirst = subscribeTheme(() => first++), stopSecond = subscribeTheme(() => second++)
    f.system(true); assert.equal(first, 1); assert.equal(second, 1)
    stopFirst(); setThemePreferences({ mode: 'dark' }); assert.equal(first, 1); assert.equal(second, 2)
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

test('early HTML bootstrap and runtime select the same mode without persisting defaults', async () => {
  const html = await readFile(new URL('../client/index.html', import.meta.url), 'utf8')
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]
  assert.ok(script); assert.ok(html.indexOf('<script>') < html.indexOf('src="./main.tsx"'))
  assert.match(html, /<meta name="theme-color" content="#F7F5F3" \/>/)
  assert.doesNotMatch(html, /palette/)
  for (const mode of [...THEME_MODES, 'invalid']) for (const dark of [true, false]) {
    const f = fixture({ mode, dark })
    try {
      vm.runInNewContext(script, { document, window, localStorage: f.storage })
      const early = { ...f.root.dataset }, earlyClass = [...f.classes], earlyMeta = f.meta.value || '#F7F5F3'
      initializeTheme(); assert.deepEqual(f.root.dataset, early); assert.deepEqual([...f.classes], earlyClass); assert.equal(f.writes.length, 0)
      assert.equal(f.meta.value, earlyMeta)
    } finally { f.close() }
  }
  const blocked = fixture({ blocked: true, dark: true })
  try { vm.runInNewContext(script, { document, window, localStorage: blocked.storage }); assert.equal(blocked.root.dataset.themeMode, 'system'); assert.equal(blocked.root.dataset.theme, 'system'); assert.deepEqual([...blocked.classes], ['dark']) } finally { blocked.close() }
})

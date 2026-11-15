import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { translate } from '../console-ui/src/i18n/locale.mjs'

const source = readFileSync(new URL('../console-ui/src/pages/introspection/GalleryPreview.tsx', import.meta.url), 'utf8')

test('the target preview line translates its parent and thread parts', () => {
  const line = source.split('\n').find(row => row.includes('目标预览：{0} / {1}'))
  assert.ok(line, 'the target preview line exists')
  assert.doesNotMatch(line, /`[^`]*[㐀-鿿][^`]*`/u, 'no Chinese template literal is passed as a value')
  assert.match(line, /i18n\.t\(" · 父级 \{0\}", \[target\.parent\.id\]\)/)
  assert.match(line, /i18n\.t\(" · 线程 \{0\}", \[target\.threadId\]\)/)
})

test('in English the whole target line reads without Chinese', () => {
  const t = (message, values) => translate('en', message, values)
  const text = t('目标预览：{0} / {1} · {2} {3}{4}{5}', ['icqq', 'bot', t('群聊'), '20001', t(' · 父级 {0}', ['g1']), t(' · 线程 {0}', ['t9'])])
  assert.equal(text, 'Target preview: icqq / bot · Group chat 20001 · Parent g1 · Thread t9')
  assert.equal(translate('zh-CN', ' · 线程 {0}', ['t9']), ' · 线程 t9')
})

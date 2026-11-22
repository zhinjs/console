import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { readSelfChangeCard, readSelfChangeDetail, readSelfChanges } from '../console-ui/src/pages/self-changes-model.mjs'
import { readToolApprovalCard, readToolApprovals } from '../console-ui/src/pages/tool-approvals-model.mjs'

// #64 `model-format-errors-untranslated`: when the Host answered in the wrong shape, the self-change and
// tool-approval readers threw hard-coded Chinese (「Host 未返回……」), and the panels showed that message
// as is, so the English UI got a whole Chinese sentence.
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const CJK = /[一-鿿]/u
const card = {
  id: 'change-1', status: 'pending', contentHash: 'h', configPaths: [], bytes: 1, createdAt: 1, updatedAt: 1,
  submittedAt: null, terminalAt: null, resolvedAt: null, slimmed: false,
}
const detail = {
  change: card, bodiesAvailable: true, baseline: 'disk', files: [], diffBytes: 0, maxDiffBytes: 1, diffTruncated: false,
  usageBytes: 0, configPatch: null, trial: null,
}

function thrown(fn) {
  try { fn() } catch (error) { return error.message }
  assert.fail('expected a throw')
}

test('every shape error of the two readers follows the locale', () => {
  const cases = [
    locale => readSelfChangeCard({}, locale),
    locale => readSelfChanges({}, locale),
    locale => readSelfChanges({ available: true, pending: [{}], recent: [], usageBytes: 0 }, locale),
    locale => readSelfChangeDetail({}, locale),
    locale => readSelfChangeDetail({ ...detail, files: [{}] }, locale),
    locale => readToolApprovalCard({}, locale),
    locale => readToolApprovals({}, locale),
    locale => readToolApprovals({ available: true, pending: [{}] }, locale),
  ]
  const english = new Set()
  for (const make of cases) {
    const zh = thrown(() => make('zh-CN'))
    const en = thrown(() => make('en'))
    assert.match(zh, /^Host 未返回/)
    assert.doesNotMatch(en, CJK, en)
    english.add(en)
  }
  assert.equal(english.size, 6, 'the six messages stay distinct')
  // Without a locale the Chinese default is kept, and valid replies still read.
  assert.match(thrown(() => readToolApprovals(null)), /^Host 未返回/)
  assert.equal(readSelfChanges({ available: true, pending: [card], recent: [card], usageBytes: 0 }, 'en').pending.length, 1)
  assert.equal(readSelfChangeDetail(detail, 'en').change.id, 'change-1')
})

test('the panels pass the locale and show a failed catalog read through StatusState', () => {
  const selfChanges = read('pages/HostSelfChangesPanel.tsx')
  assert.match(selfChanges, /readSelfChanges\(response, localeRef\.current\)/)
  assert.match(selfChanges, /readSelfChangeDetail\(response, i18n\.locale\)/)
  assert.match(selfChanges, /readSelfChangeCard\(response, i18n\.locale\)/)
  assert.match(selfChanges, /<StatusState error=\{readFailure\} compact permissions=\{\['agent\.configure'\]\} onRetry=\{\(\) => void refresh\(\)\} \/>/)
  const approvals = read('pages/HostToolApprovalsPanel.tsx')
  assert.match(approvals, /readToolApprovals\(await pluginRpc\('root', 'tool-approvals'[\s\S]*?\}\), localeRef\.current\)/)
  assert.match(approvals, /readToolApprovalCard\(await pluginRpc\('root', 'resolve-tool-approval'[\s\S]*?\}\), i18n\.locale\)/)
  assert.match(approvals, /<StatusState error=\{readFailure\} compact permissions=\{\['agent\.configure'\]\} onRetry=\{\(\) => void refresh\(\)\} \/>/)
  const overview = read('pages/TaskOverview.tsx')
  assert.match(overview, /\.then\(body => readToolApprovals\(body, i18n\.locale\)\)/)
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { purposeProfileChoices } from '../console-ui/src/pages/inference/model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

// #64 `decision-slot-kinds-unexplained`: the 决策 slots on 用途 list only decision models, with nothing saying
// why ordinary chat models are missing, how to add one, or what 关闭 / 仅评估 / 启用 do.
// (The 旁听 / 旁听参与判断 naming part was resolved by #154, which merged them into 插话判断.)
const purposes = readFileSync(new URL('../console-ui/src/pages/inference/Purposes.tsx', import.meta.url), 'utf8')
const WHY = '这几项交给判断模型（决策模型，如 TypeSafe）来做，所以下拉里只有判断模型，普通对话模型选不进来。'
const HOW = '还没有判断模型：在「模型」页签添加模型时勾选「决策模型」。'
const MODES = '关闭：不用判断模型。仅评估：判断模型给出建议并记录，不影响机器人怎么做。启用：按判断模型的结果执行。'

test('the 决策 card says once why only decision models are listed and what each mode does', () => {
  for (const text of [WHY, MODES]) {
    assert.equal(purposes.split(`i18n.t("${text}")`).length - 1, 1, `${text} appears once`)
    assert.notEqual(translate('en', text), text)
  }
  // Said once for the card, not per slot.
  const card = purposes.slice(purposes.indexOf('<h4 className="font-medium">{i18n.t("决策")}</h4>'))
  assert.ok(card.indexOf(MODES) < card.indexOf('decisionTaskLabels(i18n.t, merged)).map'))
})

test('with no decision model yet, it says where to add one', () => {
  assert.match(purposes, /const decisionChoiceCount = purposeProfileChoices\(view, 'decision', i18n\.locale\)\.length/)
  assert.ok(purposes.includes(`{decisionChoiceCount === 0 ? \` \${i18n.t("${HOW}")}\` : ''}`))
  assert.notEqual(translate('en', HOW), HOW)
  assert.equal(translate('zh-CN', '决策模型'), '决策模型', 'the hint names the checkbox the add-model form shows')
  const view = (kinds) => ({ profiles: { p: { id: 'p', accountId: 'a', model: 'm' } }, accounts: { a: { serviceId: 's' } }, services: { s: { models: { m: { kinds } } } } })
  assert.equal(purposeProfileChoices(view(['language']), 'decision').length, 0)
  assert.equal(purposeProfileChoices(view(['decision']), 'decision').length, 1)
})

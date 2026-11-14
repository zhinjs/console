import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { statusFromError } from '../console-ui/src/components/status-state-model.mjs'

const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const page = read('pages/endpoint-detail/index.tsx')
const hook = read('pages/endpoint-detail/useEndpointConsole.tsx')

for (const [kind, load] of [['Requests', 'loadInboxRequests'], ['Notices', 'loadInboxNotices']]) {
  test(`inbox ${kind.toLowerCase()} history explains failures and slow reads instead of a raw English line`, () => {
    assert.doesNotMatch(page, new RegExp(`<AlertDescription>\\{inbox${kind}Error\\}`), 'the raw error text is no longer the whole message')
    assert.match(page, new RegExp(`\\{inbox${kind}Error \\? <StatusState error=\\{inbox${kind}Error\\} compact onRetry=\\{\\(\\) => void ${load}\\(false\\)\\} /> : null\\}`))
    assert.match(page, new RegExp(`\\{inbox${kind}Loading && inbox${kind}\\.length === 0 && \\(\\s*<StatusState kind="loading" compact onRetry=\\{\\(\\) => void ${load}\\(false\\)\\} />`), 'slow reads turn into 「仍在加载…」')
    // The hook keeps the failure itself so StatusState can classify it (a message string loses the server code).
    assert.match(hook, new RegExp(`const \\[inbox${kind}Error, setInbox${kind}Error\\] = useState<unknown>\\(null\\)`))
    assert.match(hook, new RegExp(`setInbox${kind}Error\\(caught \\?\\? new Error\\(String\\(caught\\)\\)\\)`))
    assert.doesNotMatch(hook, new RegExp(`setInbox${kind}Error\\(caught instanceof Error \\? caught\\.message`))
  })
}

test('the three reported failures are classified with a reason and a next step', () => {
  assert.equal(statusFromError(new Error('Unknown RPC type: inbox.requests')).kind, 'unsupported')
  assert.equal(statusFromError({ success: false, code: 'instance_unavailable', requestOutcome: 'not-dispatched', error: 'The Zhin instance is not running' }).kind, 'instance-unavailable')
  assert.equal(statusFromError(new Error('Forbidden')).kind, 'forbidden')
})

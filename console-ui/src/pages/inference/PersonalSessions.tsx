import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/button'
import { agentSessionsPath } from '../../utils/agent-session'
import { PersonalSessionModelPicker } from '../PersonalSessionModelPicker'
import { readPersonalSessionRows, type PersonalSessionRow } from '../personal-session-model.mjs'
import { inferenceError } from './model.mjs'
import type { InferenceManagement } from './useInferenceManagement'

export function PersonalSessions({
  management: m,
  connectionScope,
}: {
  management: InferenceManagement
  connectionScope?: string
}) {
  const [rows, setRows] = useState<PersonalSessionRow[]>([]),
    [hasMore, setHasMore] = useState(false),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<PersonalSessionRow | null>(null),
    [loading, setLoading] = useState(false),
    sequence = useRef(0)
  const owner = m.owners.find((owner) => owner.id === m.ownerId)?.personal
  async function load(first = false) {
    if (!owner || (!first && loading)) return
    const id = ++sequence.current
    const active = () => id === sequence.current && m.active()
    setLoading(true)
    try {
      const result = await m.request(`/sessions?limit=50&offset=${first ? 0 : offset}`)
      const page = readPersonalSessionRows({ success: true, data: result }, owner)
      if (!active()) return
      setRows((previous) => (first ? page.rows : [...previous, ...page.rows]))
      setHasMore(page.hasMore)
      setOffset((first ? 0 : offset) + page.rows.length)
    } catch (error) {
      if (active()) m.setError(inferenceError(error))
    } finally {
      if (active()) setLoading(false)
    }
  }
  useEffect(() => {
    setRows([])
    setHasMore(false)
    setOffset(0)
    setSelected(null)
    setLoading(false)
    void load(true)
    return () => {
      sequence.current++
    }
  }, [m.ownerId, m.revisionEpoch, connectionScope])
  return (
    <div className="space-y-4">
      <h3 className="font-semibold">个人会话</h3>
      <div className="divide-y rounded-lg border">
        {rows.map((row) => (
          <div key={row.sessionKey} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0 text-sm break-all">
              {row.address.platform} · {row.address.endpoint} · {row.address.conversation.id}
              {row.address.conversation.threadId ? ` / ${row.address.conversation.threadId}` : ''}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelected(row)}>
                选择模型
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link
                  to={`${agentSessionsPath(row.sessionKey)}&personalOwner=${encodeURIComponent(
                    m.ownerId
                  )}`}
                >
                  查看
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
      {!rows.length && !loading ? (
        <p className="text-sm text-muted-foreground">暂无已保存的个人会话。</p>
      ) : null}
      {hasMore ? (
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          加载更多
        </Button>
      ) : null}
      {selected ? (
        <PersonalSessionModelPicker
          key={selected.sessionKey}
          sessionKey={selected.sessionKey}
          address={selected.address}
          models={m.view!}
          ownerId={m.ownerId}
          connectionScope={connectionScope}
        />
      ) : null}
    </div>
  )
}

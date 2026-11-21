/** Display helpers for the Host's read-only Engagement projection (`/api/agent/engagements`). */

export function hasRunningEngagement(engagements) {
  return engagements.some(item => item.status === 'running')
}

/**
 * Sums of the list. A turn or token total no collaboration reports is `null` (shown as 「—」), not 0:
 * the Host's summaries have no turn count yet, and 0 would claim nothing was used.
 */
export function engagementTotals(engagements) {
  const totals = engagements.reduce((sum, item) => ({
    running: sum.running + Number(item.status === 'running'),
    failed: sum.failed + Number(item.status === 'failed'),
    turns: add(sum.turns, item.turns),
    tokens: add(sum.tokens, item.tokensUsed),
  }), { running: 0, failed: 0, turns: null, tokens: null })
  return engagements.length ? totals : { ...totals, turns: 0, tokens: 0 }
}

function add(total, value) {
  if (!(typeof value === 'number' && Number.isFinite(value))) return total
  return (total ?? 0) + value
}

/**
 * A list field the protocol marks required but an older or partial Host may omit (`participants`,
 * `board`, `events`): anything that is not an array reads as empty instead of crashing the page.
 */
export function listOf(value) {
  return Array.isArray(value) ? value : []
}

/** Participant refs of an engagement, as written; blanks and non-strings are dropped. */
export function engagementParticipants(summary) {
  return listOf(summary?.participants).filter(item => typeof item === 'string' && item.trim())
}

/**
 * A venue as text. The protocol says string, but the Host's journal summary carries a `VenueRef`
 * object (`{ kind, id }`); templating that object is what printed `[object Object]` in the list.
 */
export function venueLabel(venue) {
  if (typeof venue === 'string') return venue.trim() || undefined
  if (!venue || typeof venue !== 'object') return undefined
  if (typeof venue.key === 'string' && venue.key) return venue.key
  if (venue.kind != null && venue.id != null) return `${String(venue.kind)}:${String(venue.id)}`
  if (venue.id != null) return String(venue.id)
  return undefined
}

const ENGAGEMENT_STATUS = { running: 'running', open: 'running', completed: 'completed', failed: 'failed', blocked: 'failed', escalated: 'failed', cancelled: 'cancelled' }
const counter = value => typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * Reads an engagement summary in either shape the Host has sent: the protocol's
 * (`venue: string`, `participants`, `hops` / `turns` / `tokensUsed`) or the journal's
 * (`venue: { kind, id }`, `actors`, `status: open | blocked | escalated | …`, `reason`, `hops` as the
 * list of hops, tokens in `consumed.tokens`).
 * Every displayed field ends up a string, a number or undefined.
 */
export function normalizeEngagementSummary(raw) {
  const summary = raw && typeof raw === 'object' ? raw : {}
  const status = ENGAGEMENT_STATUS[summary.status] ?? 'failed'
  const people = engagementParticipants(summary)
  const actors = listOf(summary.actors).filter(item => typeof item === 'string' && item.trim())
  const reason = typeof summary.stopReason === 'string' && summary.stopReason ? summary.stopReason
    : typeof summary.reason === 'string' && summary.reason ? summary.reason
      : status === 'failed' && summary.status !== 'failed' && typeof summary.status === 'string' ? summary.status : undefined
  const consumed = summary.consumed && typeof summary.consumed === 'object' ? summary.consumed : {}
  return {
    ...summary,
    engagementId: String(summary.engagementId ?? ''),
    status,
    venue: venueLabel(summary.venue),
    participants: people.length ? people : actors,
    hops: counter(summary.hops) ?? (Array.isArray(summary.hops) ? summary.hops.length : undefined),
    turns: counter(summary.turns) ?? counter(consumed.turns),
    tokensUsed: counter(summary.tokensUsed) ?? counter(consumed.tokens),
    wallClockMs: counter(summary.wallClockMs) ?? (counter(summary.endedAt) !== undefined && counter(summary.startedAt) !== undefined ? summary.endedAt - summary.startedAt : undefined),
    stopReason: reason,
  }
}

/** Actor refs are protocol values, so they are shown as written rather than translated. */
export function actorLabel(actor) {
  if (typeof actor === 'string' && actor) return actor
  if (!actor || typeof actor !== 'object') return 'unknown'
  if (actor.kind === 'agent') return `agent:${String(actor.name ?? '')}`
  if (actor.kind === 'external') return `external:${String(actor.peer ?? '')}`
  if (actor.kind === 'human') return `human:${String(actor.principalId ?? '')}`
  return JSON.stringify(actor)
}

/**
 * An event's kind as written: protocol events carry `kind`, the Host journal's events carry `type`
 * (`mail_denied`, `budget_exceeded`, …).
 */
export function engagementEventKind(event) {
  const kind = event?.kind ?? event?.type
  return typeof kind === 'string' && kind ? kind : 'event'
}

const ACCOUNT_NUMBER = /^\d{5,}$/
const maskNumber = digits => `${digits.slice(0, 2)}***${digits.slice(-2)}`

/**
 * Masks platform account numbers (QQ numbers, group numbers: 5+ digits) where they appear as an id: a
 * whole value, or a segment of a ref such as `qq:group:987654321`. Counts (`tokens=18400`) stay.
 */
export function maskPlatformIds(text) {
  const value = String(text ?? '')
  if (ACCOUNT_NUMBER.test(value)) return maskNumber(value)
  return value.replace(/([:/])(\d{5,})(?!\d)/g, (_, separator, digits) => `${separator}${maskNumber(digits)}`)
}

const TIMESTAMP_KEY = /^(at|ts|time|timestamp)$|At$/

/**
 * An event the Console has no summary for, as `key=value` of its top-level scalars. Nested objects
 * (sender records, payloads) and timestamps are left to the raw view; a value that is an account
 * number on its own is masked.
 */
function readableFields(event) {
  return Object.entries(event ?? {})
    .filter(([key, value]) => key !== 'kind' && key !== 'type' && !TIMESTAMP_KEY.test(key)
      && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') && value !== '')
    .map(([key, value]) => `${key}=${typeof value === 'string' ? maskPlatformIds(value) : String(value)}`)
    .join(' ')
}

/**
 * One-line summary of a collaboration event for the readable timeline. Kinds the Console does not know
 * show their scalar fields; the full JSON is only in 「原始事件」.
 */
export function collaborationEventSummary(event) {
  switch (event?.kind) {
    case 'engagement.started':
      return `initiator=${actorLabel(event.initiator)}${venueLabel(event.venue) ? ` venue=${venueLabel(event.venue)}` : ''}`
    case 'mail.sent': {
      const envelope = event.envelope ?? {}
      return `${actorLabel(envelope.from)} -> ${actorLabel(envelope.to)} [${String(envelope.kind ?? 'mail')}]`
    }
    case 'mail.delivered':
      return `${String(event.messageId ?? '')} -> ${actorLabel(event.recipient)} (${String(event.outcome ?? '')})`
    case 'board.updated': {
      const entry = event.entry ?? {}
      return `${String(entry.key ?? '')} (v${String(entry.version ?? 1)}) by ${actorLabel(entry.updatedBy)}`
    }
    case 'floor.granted':
      return `${venueLabel(event.venue) ?? ''}: speaker=${actorLabel(event.speaker)}`
    case 'budget.recorded':
      return `hops=${String(event.hops ?? 0)} turns=${String(event.turns ?? 0)} tokens=${String(event.tokensUsed ?? 0)}`
    case 'engagement.stopped':
      return `status=${String(event.status ?? '')}${event.reason ? ` reason=${String(event.reason)}` : ''}`
    default:
      return readableFields(event)
  }
}

export function venueChannelLabel(venue) {
  const { endpoint, kind, id } = venue.channel
  return `${endpoint.adapter}:${endpoint.id}/${kind}:${id}`
}

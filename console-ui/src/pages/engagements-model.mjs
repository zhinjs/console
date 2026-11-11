/** Display helpers for the Host's read-only Engagement projection (`/api/agent/engagements`). */

export function hasRunningEngagement(engagements) {
  return engagements.some(item => item.status === 'running')
}

export function engagementTotals(engagements) {
  return engagements.reduce((sum, item) => ({
    running: sum.running + Number(item.status === 'running'),
    failed: sum.failed + Number(item.status === 'failed'),
    turns: sum.turns + item.turns,
    tokens: sum.tokens + item.tokensUsed,
  }), { running: 0, failed: 0, turns: 0, tokens: 0 })
}

/** Actor refs are protocol values, so they are shown as written rather than translated. */
export function actorLabel(actor) {
  if (!actor || typeof actor !== 'object') return 'unknown'
  if (actor.kind === 'agent') return `agent:${String(actor.name ?? '')}`
  if (actor.kind === 'external') return `external:${String(actor.peer ?? '')}`
  if (actor.kind === 'human') return `human:${String(actor.principalId ?? '')}`
  return JSON.stringify(actor)
}

/** One-line protocol summary of a collaboration event; unknown kinds fall back to their JSON. */
export function collaborationEventSummary(event) {
  switch (event?.kind) {
    case 'engagement.started':
      return `initiator=${actorLabel(event.initiator)}${event.venue ? ` venue=${String(event.venue)}` : ''}`
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
      return `${String(event.venue ?? '')}: speaker=${actorLabel(event.speaker)}`
    case 'budget.recorded':
      return `hops=${String(event.hops ?? 0)} turns=${String(event.turns ?? 0)} tokens=${String(event.tokensUsed ?? 0)}`
    case 'engagement.stopped':
      return `status=${String(event.status ?? '')}${event.reason ? ` reason=${String(event.reason)}` : ''}`
    default:
      return JSON.stringify(event)
  }
}

export function venueChannelLabel(venue) {
  const { endpoint, kind, id } = venue.channel
  return `${endpoint.adapter}:${endpoint.id}/${kind}:${id}`
}

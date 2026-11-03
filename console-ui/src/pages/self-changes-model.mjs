/**
 * Host self-change approvals (zhin ADR 0040, #1142 F3).
 * The list (`self-changes`) is metadata only; bodies and config values come from `self-change-detail` (`ops:approve`).
 */

const STATUSES = ['draft', 'trialing', 'ready', 'pending', 'approved', 'applying', 'verifying', 'applied',
  'trial_failed', 'rejected', 'expired', 'rolled_back', 'failed']
const FILE_KINDS = ['create', 'modify', 'delete']

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNullableNumber = value => value === null || Number.isFinite(value)

export function readSelfChangeCard(value) {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !STATUSES.includes(value.status)
    || typeof value.contentHash !== 'string' || !Array.isArray(value.configPaths)
    || !Number.isFinite(value.bytes) || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)
    || !isNullableNumber(value.submittedAt) || !isNullableNumber(value.terminalAt) || !isNullableNumber(value.resolvedAt)
    || typeof value.slimmed !== 'boolean') {
    throw new Error('Host 未返回完整的自我变更记录')
  }
  return value
}

export function readSelfChanges(value) {
  if (!isRecord(value) || typeof value.available !== 'boolean' || !Array.isArray(value.pending) || !Array.isArray(value.recent)
    || !Number.isFinite(value.usageBytes)) {
    throw new Error('Host 未返回有效的自我变更目录')
  }
  return {
    available: value.available,
    pending: value.pending.map(readSelfChangeCard).filter(change => change.status === 'pending'),
    recent: value.recent.map(readSelfChangeCard),
    usageBytes: value.usageBytes,
  }
}

function readDetailFile(value) {
  if (!isRecord(value) || typeof value.path !== 'string' || !FILE_KINDS.includes(value.kind)
    || (value.diff !== null && typeof value.diff !== 'string') || typeof value.truncated !== 'boolean'
    || (value.unavailableReason !== null && typeof value.unavailableReason !== 'string')) {
    throw new Error('Host 未返回有效的变更 diff')
  }
  return value
}

export function readSelfChangeDetail(value) {
  if (!isRecord(value) || typeof value.bodiesAvailable !== 'boolean' || !['disk', 'snapshot'].includes(value.baseline)
    || !Array.isArray(value.files) || !Number.isFinite(value.diffBytes) || !Number.isFinite(value.maxDiffBytes)
    || typeof value.diffTruncated !== 'boolean' || !Number.isFinite(value.usageBytes)
    || (value.configPatch !== null && (!isRecord(value.configPatch) || !Array.isArray(value.configPatch.operations)))
    || (value.trial !== null && (!isRecord(value.trial) || !Array.isArray(value.trial.checks) || !Array.isArray(value.trial.skippedChecks)))) {
    throw new Error('Host 未返回有效的自我变更详情')
  }
  return { ...value, change: readSelfChangeCard(value.change), files: value.files.map(readDetailFile) }
}

/** Summary line from the stored preview, falling back to the change id. */
export function selfChangeSummary(change) {
  const summary = isRecord(change.preview) && typeof change.preview.summary === 'string' ? change.preview.summary.trim() : ''
  return summary || change.id
}

/** `{ path, kind, added, removed }` from the preview, or the bare file entries when no preview was stored. */
export function selfChangeFiles(change) {
  const previewFiles = isRecord(change.preview) && Array.isArray(change.preview.files) ? change.preview.files : null
  if (previewFiles) {
    return previewFiles.filter(isRecord).map(file => ({
      path: String(file.path ?? ''), kind: String(file.kind ?? 'modify'),
      added: Number.isFinite(file.added) ? file.added : 0, removed: Number.isFinite(file.removed) ? file.removed : 0,
    }))
  }
  const files = Array.isArray(change.files) ? change.files : []
  return files.filter(isRecord).map(file => ({
    path: String(file.path ?? ''), kind: file.op === 'delete' ? 'delete' : 'write', added: 0, removed: 0,
  }))
}

/** Names of skipped trial checks from the list card (the detail carries `trial.skippedChecks`). */
export function skippedCheckNames(trial) {
  const checks = isRecord(trial) && Array.isArray(trial.checks) ? trial.checks : []
  const names = checks.filter(check => isRecord(check) && check.status === 'skipped')
    .map(check => [typeof check.check === 'string' && check.check ? check.check : 'unknown', typeof check.path === 'string' ? check.path : '']
      .filter(Boolean).join(' '))
  return [...new Set(names)]
}

/** A failed (emergency-stopped) change still waiting for a person to mark it handled. */
export function needsHandling(change) {
  return change.status === 'failed' && change.resolvedAt === null
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Line class for a unified diff line: added, removed, hunk header, or context. */
export function diffLineTone(line) {
  if (line.startsWith('+++ ') || line.startsWith('--- ')) return 'header'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'added'
  if (line.startsWith('-')) return 'removed'
  return 'context'
}

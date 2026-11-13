/**
 * The one Host restart in flight for this page load (立即重启 from any save, 重启 on 首页 and the
 * environment page). A module store, so every surface that offered the restart sees the same
 * progress and a second restart cannot start while one is running.
 *
 * `deps` (injected so tests drive it without a Host):
 * - `request()`        sends the restart (`system:restart`)
 * - `readStatus()`     the gateway's `instance.status` (run facts), or rejects / resolves null without one
 * - `probe()`          whether the instance answers (`probeInstance`)
 * - `isConnected()`    whether the Console event stream is connected
 * - `mayHaveRun(err)`  whether a failed request may still have restarted (no trustworthy answer)
 * - `now()`, `setTimer(fn, ms)`, `clearTimer(id)`
 */
import { IDLE_RESTART, RESTART_POLL_MS, restartInProgress, restartReducer } from './apply-outcome-model.mjs'

export function createRestartTracker(deps) {
  let state = IDLE_RESTART
  let timer = null
  let polling = false
  const listeners = new Set()

  const emit = () => { for (const listener of [...listeners]) listener() }
  const dispatch = event => {
    const next = restartReducer(state, event)
    if (next === state) return state
    state = next
    if (!restartInProgress(state)) stop()
    emit()
    return state
  }
  const stop = () => {
    if (timer !== null) deps.clearTimer(timer)
    timer = null
  }
  const schedule = (ms = RESTART_POLL_MS) => {
    stop()
    if (state.phase === 'waiting') timer = deps.setTimer(() => { timer = null; void poll() }, ms)
  }
  const readStatus = async () => {
    try {
      const status = await deps.readStatus()
      return status && typeof status === 'object' && typeof status.state === 'string' ? status : null
    } catch {
      return null
    }
  }
  async function poll() {
    if (state.phase !== 'waiting' || polling) return
    polling = true
    try {
      const status = await readStatus()
      let probeOk
      try { probeOk = (await deps.probe()) === true } catch { probeOk = false }
      dispatch({ type: 'observe', status, probeOk, connected: deps.isConnected(), now: deps.now() })
    } finally {
      polling = false
    }
    schedule()
  }

  return Object.freeze({
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Sends the restart once; resolves when it was sent (or refused). */
    async start() {
      if (restartInProgress(state)) return state
      dispatch({ type: 'start', now: deps.now() })
      // The run facts before the restart: a changed generation / pid / start time proves it happened.
      const before = await readStatus()
      try {
        await deps.request()
      } catch (error) {
        if (!deps.mayHaveRun(error)) return dispatch({ type: 'refused', error })
      }
      dispatch({ type: 'sent', before })
      schedule()
      return state
    },
    /** A reconnect signal (event stream up / down): check at once instead of at the next poll. */
    nudge(connected) {
      if (state.phase !== 'waiting') return
      if (connected === false) dispatch({ type: 'observe', connected: false, now: deps.now() })
      schedule(connected ? 0 : RESTART_POLL_MS)
    },
    /** Waits another full window after a timeout. */
    keepWaiting() {
      if (state.phase !== 'timeout') return
      dispatch({ type: 'keep-waiting', now: deps.now() })
      schedule(0)
    },
    dismiss() { dispatch({ type: 'dismiss' }) },
    /** Tests only: back to idle and no timers. */
    reset() { stop(); state = IDLE_RESTART; emit() },
  })
}

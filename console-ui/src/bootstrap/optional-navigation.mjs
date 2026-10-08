export function createOptionalNavigation() {
  let current
  return {
    bind(session, route, available) {
      const record = {session, route, available}
      current = record
      record.report = next => {
        if (current !== record || !session.active() || record.available === next) return
        record.available = next
        session.addRoute({...route, meta:{...route.meta, hideInMenu:!next}})
      }
      session.addRoute({...route, meta:{...route.meta, hideInMenu:!available}})
    },
    capture() { return current?.report ?? (() => {}) },
    reset() { current = undefined },
  }
}

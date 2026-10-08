/** Host registrations live only as long as their captured connection epoch. */
export function createHostRegistration({ addRoute, removeRoute, readRoutes, addTool, removeTool }) {
  let epoch = 0
  const routes = new Map()
  const tools = new Set()
  return {
    capture() {
      const captured = epoch
      const active = () => captured === epoch
      return {
        active,
        addRoute(input) {
          if (!active()) return
          if (!routes.has(input.path)) routes.set(input.path, readRoutes().find(r => r.path === input.path))
          addRoute(input)
        },
        addTool(input) {
          if (!active()) throw new Error('Host connection changed; stale tool registration ignored')
          const id = addTool(input)
          tools.add(id)
          return id
        },
      }
    },
    reset() {
      epoch += 1
      for (const [path, previous] of routes) {
        removeRoute(path)
        if (previous) addRoute(previous)
      }
      routes.clear()
      if (removeTool) {
        for (const id of tools) removeTool(id)
        tools.clear()
      }
    },
  }
}

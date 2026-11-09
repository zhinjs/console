import assert from 'node:assert/strict'
// Run the real nested page components with keyed hook instances. Record each render
// before effects so an effect-only reset cannot hide a stale interactive frame.
export function pageRuntime() {
  const instances = new Map(), frames = []
  let current, cursor, effects = [], dirty = false, root, value
  const api = {
    useState(initial) {
      const slot = cursor++, instance = current
      if (!(slot in instance.slots)) instance.slots[slot] = typeof initial === 'function' ? initial() : initial
      return [instance.slots[slot], next => {
        if (!instance.live) return
        instance.slots[slot] = typeof next === 'function' ? next(instance.slots[slot]) : next
        dirty = true
      }]
    },
    useRef(initial) { const slot = cursor++; return current.slots[slot] ?? (current.slots[slot] = { current: initial }) },
    useEffect(fn, deps) {
      const slot = cursor++, instance = current, old = instance.slots[slot]
      if (old && deps.every((item, i) => Object.is(item, old.deps[i]))) return
      instance.slots[slot] = { deps, cleanup: old?.cleanup }
      effects.push(() => { old?.cleanup?.(); instance.slots[slot].cleanup = fn() })
    },
  }
  function visit(node, path, seen) {
    if (Array.isArray(node)) return node.map((child, i) => visit(child, `${path}/${i}`, seen))
    if (!node || typeof node !== 'object') return node
    const id = `${path}/${node.key ?? ''}`
    if (typeof node.type === 'function') {
      seen.add(id)
      let instance = instances.get(id)
      if (!instance || instance.type !== node.type) {
        instance = { type: node.type, slots: [], live: true }; instances.set(id, instance)
      }
      current = instance; cursor = 0
      return visit(node.type(node.props), `${id}/child`, seen)
    }
    return { ...node, props: { ...node.props, children: visit(node.props.children, `${id}/children`, seen) } }
  }
  function dispose(instance) { instance.live = false; for (const slot of instance.slots) slot?.cleanup?.() }
  function render() {
    let count = 0
    do {
      assert.ok(++count < 40); dirty = false
      const seen = new Set()
      value = visit(root(), 'root', seen); frames.push(value)
      for (const [id, instance] of instances) if (!seen.has(id)) { dispose(instance); instances.delete(id) }
      const pending = effects; effects = []; pending.forEach(fn => fn())
    } while (dirty)
    return value
  }
  return { api, frames, mount(fn) { root = fn; return render() }, render,
    async settle() { for (let i = 0; i < 20; i++) { await Promise.resolve(); if (dirty) render() } return value },
    get value() { return value }, unmount() { for (const instance of instances.values()) dispose(instance) },
  }
}
export function nodes(node) {
  return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object'
    ? [node, ...nodes(node.props?.children)] : []
}

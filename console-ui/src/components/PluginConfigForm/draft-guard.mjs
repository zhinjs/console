/** Prevent asynchronous reads from replacing a user-owned dirty form. */
export function createConfigDraftGuard() {
 let identity
 let dirty = false
 let snapshot
 return {
   edited() { dirty = true },
   saved() { dirty = false },
   get dirty() { return dirty },
   get snapshot() { return snapshot },
   receive(key, value, sourceSnapshot) {
     if (identity !== key) { identity = key; dirty = false }
     const accepted = !dirty
     if (accepted) snapshot = sourceSnapshot
     return accepted
   },
 }
}

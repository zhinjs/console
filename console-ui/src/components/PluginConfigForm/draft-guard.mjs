/** Prevent asynchronous reads from replacing a user-owned dirty form. */
export function createConfigDraftGuard() {
 let identity
 let dirty = false
 return {
   edited() { dirty = true },
   saved() { dirty = false },
   receive(key, value) {
     if (identity !== key) { identity = key; dirty = false }
     return value != null && !dirty
   },
 }
}

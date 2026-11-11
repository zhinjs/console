export function startVisiblePolling(
  poll: () => void,
  intervalMs: number,
  env?: { document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>; setInterval: typeof setInterval; clearInterval: typeof clearInterval },
): () => void

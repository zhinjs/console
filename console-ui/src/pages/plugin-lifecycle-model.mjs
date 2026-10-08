const pause = (ms, signal) => new Promise(resolve => {
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
  const timer = setTimeout(finish, ms); signal.addEventListener('abort', finish, { once: true });
  if (signal.aborted) finish();
});
export async function waitForPluginStatus(read, status, signal, options = {}) {
  const attempts = options.attempts ?? 20;
  const deadline = Date.now() + 30000;
  for (let index = 0; index < attempts && Date.now() < deadline && !signal.aborted; index++) {
    try { const plugin = await read(); if (!signal.aborted && plugin.status === status) return plugin; } catch { /* A restarting Host may be temporarily unavailable. */ }
    if (index + 1 < attempts && !signal.aborted) await (options.pause ?? pause)(1500, signal);
  }
  return null;
}

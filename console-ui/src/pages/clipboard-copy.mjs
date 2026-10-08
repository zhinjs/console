export async function copyText(text, clipboard, document) {
  try {
    if (clipboard?.writeText) { await clipboard.writeText(text); return true; }
  } catch { /* Try the compatibility path after a denied Clipboard API request. */ }
  let textarea;
  const previousFocus = document.activeElement;
  try {
    textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand('copy') === true;
  } catch { return false; }
  finally {
    if (textarea?.parentNode) textarea.parentNode.removeChild(textarea);
    previousFocus?.focus?.();
  }
}

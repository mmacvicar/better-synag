export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

export async function withButtonFeedback(button, action) {
  if (!button) return action();
  if (button.dataset.busy === '1') return;
  button.dataset.busy = '1';
  button.disabled = true;
  button.classList.add('is-busy');
  button.classList.remove('is-done', 'is-error');
  try {
    const out = await action();
    button.classList.add('is-done');
    setTimeout(() => button.classList.remove('is-done'), 700);
    return out;
  } catch (err) {
    button.classList.add('is-error');
    setTimeout(() => button.classList.remove('is-error'), 1200);
    throw err;
  } finally {
    button.classList.remove('is-busy');
    button.disabled = false;
    button.dataset.busy = '0';
  }
}

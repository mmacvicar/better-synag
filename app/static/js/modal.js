export function createModal({
  modal,
  title,
  text,
  input,
  cancel,
  ok,
}) {
  let resolver = null;

  const closeModal = (result) => {
    if (modal) modal.classList.add('is-hidden');
    if (resolver) resolver(result);
    resolver = null;
  };

  const askText = (modalTitle, message, initialValue = '') => new Promise((resolve) => {
    resolver = resolve;
    title.textContent = modalTitle;
    text.textContent = message;
    input.classList.remove('is-hidden');
    input.value = initialValue;
    ok.textContent = 'Save';
    modal.classList.remove('is-hidden');
    setTimeout(() => input.focus(), 0);
  });

  const askConfirm = (modalTitle, message) => new Promise((resolve) => {
    resolver = resolve;
    title.textContent = modalTitle;
    text.textContent = message;
    input.classList.add('is-hidden');
    input.value = '';
    ok.textContent = 'Confirm';
    modal.classList.remove('is-hidden');
    setTimeout(() => ok.focus(), 0);
  });

  const bindEvents = () => {
    if (cancel) cancel.addEventListener('click', () => closeModal(null));
    if (ok) {
      ok.addEventListener('click', () => {
        if (!input.classList.contains('is-hidden')) {
          closeModal(input.value.trim());
        } else {
          closeModal(true);
        }
      });
    }
    if (modal) {
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeModal(null);
      });
    }
    document.addEventListener('keydown', (ev) => {
      if (!modal || modal.classList.contains('is-hidden')) return;
      if (ev.key === 'Escape') closeModal(null);
      if (ev.key === 'Enter') {
        if (!input.classList.contains('is-hidden')) closeModal(input.value.trim());
        else closeModal(true);
      }
    });
  };

  return {
    askText,
    askConfirm,
    bindEvents,
    closeModal,
  };
}

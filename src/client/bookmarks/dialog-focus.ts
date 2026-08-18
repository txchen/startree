const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const trapDialogFocus = (event: KeyboardEvent) => {
  if (event.key !== 'Tab' || !(event.currentTarget instanceof HTMLElement)) return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (control) => !control.hidden,
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

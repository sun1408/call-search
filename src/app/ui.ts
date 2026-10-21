import { h, type Child } from './dom';

let toastHost: HTMLElement | null = null;

function host(): HTMLElement {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  return toastHost;
}

export function toast(message: string, action?: { label: string; run: () => void }, ms = 2600): HTMLElement {
  const el = h('div', { class: 'toast', role: 'status' }, message, action ? h('button', { class: 'btn', type: 'button', onclick: action.run }, action.label) : null);
  host().replaceChildren(el);
  if (ms > 0) setTimeout(() => el.remove(), ms);
  return el;
}

export interface SheetAction {
  label: string;
  value: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}

export interface SheetResult {
  value: string;
  form: HTMLFormElement;
}

let sheetCount = 0;

export function openSheet(title: string, body: Child[], actions: SheetAction[]): Promise<SheetResult> {
  return new Promise((resolve) => {
    const titleId = `sheet-title-${++sheetCount}`;
    const form = h(
      'form',
      { method: 'dialog', class: 'sheet-body' },
      h('h2', { id: titleId }, title),
      body,
      h(
        'div',
        { class: 'sheet-actions' },
        actions.map((a) =>
          h('button', { class: `btn btn-${a.variant ?? 'secondary'}`, type: 'submit', value: a.value, formnovalidate: a.value === 'cancel' }, a.label),
        ),
      ),
    );
    const dialog = h('dialog', { class: 'sheet', 'aria-labelledby': titleId }, form);
    dialog.addEventListener('close', () => {
      resolve({ value: dialog.returnValue || 'cancel', form });
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export async function confirmSheet(title: string, message: string, confirmLabel: string, danger = false): Promise<boolean> {
  const { value } = await openSheet(title, [h('p', null, message)], [
    { label: '취소', value: 'cancel' },
    { label: confirmLabel, value: 'ok', variant: danger ? 'danger' : 'primary' },
  ]);
  return value === 'ok';
}

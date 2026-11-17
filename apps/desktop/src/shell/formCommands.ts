/** Save means Apply where available. Restrict it to the topmost dialog in the focused document. */
export function currentSaveButton(documents: Document[]): HTMLButtonElement | null {
  const focused = documents.find((doc) => doc.hasFocus()) ?? documents[0];
  const ordered = focused ? [focused, ...documents.filter((doc) => doc !== focused)] : documents;
  for (const doc of ordered) {
    const dialogs = [...doc.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [data-ek-editor]')]
      .filter((element) => element.getClientRects().length > 0);
    const scope = dialogs.at(-1) ?? doc;
    const button = scope.querySelector<HTMLButtonElement>("[data-ek-save]");
    if (button && !button.matches(":disabled") && button.getClientRects().length > 0) return button;
    if (dialogs.length) return null;
  }
  return null;
}

export function hasOpenForm(documents: Document[]): boolean {
  return documents.some((doc) => [...doc.querySelectorAll("[data-ek-save], [data-ek-editor]")]
    .some((element) => element.getClientRects().length > 0));
}

export function applyCurrentForm(documents: Document[]) {
  for (const doc of documents) {
    const active = doc.activeElement as HTMLElement | null;
    if (active && active.tagName !== "BODY") active.blur();
  }
  queueMicrotask(() => currentSaveButton(documents)?.click());
}

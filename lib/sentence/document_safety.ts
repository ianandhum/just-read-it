export function canAnnotateDocument(doc: Document): boolean {
  if (doc.designMode?.toLowerCase() === 'on') return false;

  const active = doc.activeElement;
  if (active instanceof HTMLElement && active.isContentEditable) return false;

  // Whole-page editors are unsafe to alter because sentence wrappers become
  // application data for the editor's reconciliation and serialization logic.
  return (
    !doc.body?.isContentEditable &&
    doc.querySelector('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') === null
  );
}

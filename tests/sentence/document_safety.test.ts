import { describe, expect, it } from 'vitest';
import { canAnnotateDocument } from '../../lib/sentence/document_safety';

function setupDoc(html: string): Document {
  const doc = document.implementation.createHTMLDocument('test');
  doc.body.innerHTML = html;
  return doc;
}

describe('canAnnotateDocument', () => {
  it('allows regular reading content', () => {
    expect(canAnnotateDocument(setupDoc('<article><p>Readable content.</p></article>'))).toBe(true);
  });

  it('rejects design-mode documents', () => {
    const doc = setupDoc('<p>Editor content.</p>');
    doc.designMode = 'on';
    expect(canAnnotateDocument(doc)).toBe(false);
  });

  it('rejects contenteditable editors', () => {
    const doc = setupDoc('<div contenteditable="true">Editor content.</div>');
    expect(canAnnotateDocument(doc)).toBe(false);
  });
});

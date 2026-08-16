import { describe, expect, it } from 'vitest';
import { pageMetadata } from '../../../lib/web/reader/page_metadata';

describe('page metadata', () => {
  it('reads an Open Graph preview and a relative favicon', () => {
    document.head.innerHTML = `
      <meta property="og:image" content="/article-preview.jpg" />
      <link rel="icon" href="/images/favicon.png" />
    `;

    expect(pageMetadata(document)).toMatchObject({
      previewImageUrl: expect.stringContaining('/article-preview.jpg'),
      faviconUrl: expect.stringContaining('/images/favicon.png'),
    });
  });
});

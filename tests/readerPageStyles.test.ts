import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'assets/reader-page.css'), 'utf8');

describe('reader page styles', () => {
  it('uses consistent reader spacing without padding sentence and word boxes', () => {
    expect(styles).toMatch(/\.jri-sentence\s*\{[^}]*line-height:\s*var\(--jri-reader-line-height, 1\.65\);/s);
    expect(styles).toMatch(/\.jri-sentence\s*\{[^}]*padding:\s*0;/s);
    expect(styles).toMatch(/\.jri-word\s*\{[^}]*padding:\s*0;/s);
    expect(styles).toMatch(/\.jri-word\s*\{[^}]*box-decoration-break:\s*clone;/s);
    expect(styles).toMatch(/\.jri-word\.jri-word-current\s*\{[^}]*0 0 0 0\.09em[^,]+,\s*0 0\.3em 0\.4em/s);
  });

  it('renders consistent decoration for wrapped sentence fragments', () => {
    expect(styles).toMatch(/\.jri-sentence\s*\{[^}]*box-decoration-break:\s*clone;/s);
    expect(styles).toMatch(/\.jri-sentence\.jri-current\s*\{[^}]*text-decoration-line:\s*underline;/s);
    expect(styles).toMatch(/\.jri-sentence\.jri-current\s*\{[^}]*text-underline-offset:\s*0\.18em;/s);
    expect(styles).not.toMatch(/body\.jri-lights-out-mode \.jri-sentence\.jri-current\s*\{[^}]*text-shadow:/s);
  });

  it('renders the completion celebration as crisp firework sparks', () => {
    expect(styles).toMatch(/#jri-party \.jri-party-trail\s*\{[^}]*animation:\s*jri-party-launch/s);
    expect(styles).toMatch(/#jri-party \.jri-party-trail\s*\{[^}]*clip-path:\s*polygon/s);
    expect(styles).toMatch(/#jri-party \.jri-party-trail::before\s*\{[^}]*border-radius:\s*50%/s);
    expect(styles).toMatch(/@keyframes jri-party-launch\s*\{[\s\S]*var\(--jri-launch-y\)/s);
    expect(styles).toMatch(/#jri-party \.jri-party-spark\s*\{[^}]*height:\s*4px;/s);
    expect(styles).toMatch(/#jri-party \.jri-party-spark\s*\{[^}]*animation:\s*jri-party-spark/s);
    expect(styles).toMatch(/@keyframes jri-party-spark\s*\{[\s\S]*var\(--jri-spark-x\)/s);
    expect(styles).toMatch(/#jri-party \.jri-party-flash\s*\{[^}]*animation:\s*jri-party-flash/s);
  });
});

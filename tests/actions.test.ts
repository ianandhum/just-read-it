import { describe, expect, it } from 'vitest';
import { withDisabled } from '../lib/actions';

describe('withDisabled', () => {
  it('disables the button while the action runs and restores it afterwards', async () => {
    const button = document.createElement('button');
    let wasDisabledDuringAction = false;

    await withDisabled(button, async () => {
      wasDisabledDuringAction = button.disabled;
    });

    expect(wasDisabledDuringAction).toBe(true);
    expect(button.disabled).toBe(false);
  });

  it('restores the button when the action fails', async () => {
    const button = document.createElement('button');

    await expect(
      withDisabled(button, async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');

    expect(button.disabled).toBe(false);
  });
});

/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import homeHtml from '../entrypoints/home/index.html?raw';
import { importData, loadSettings, saveSettings } from '../lib/storage';
import { DEFAULT_SETTINGS, type JriSettings } from '../lib/types';

vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  importData: vi.fn(),
  loadAllPageStates: vi.fn(async () => []),
}));

let stored: JriSettings;
let storageChanged: (changes: Record<string, unknown>, area: string) => void;

function input(id: string, value: string): void {
  const element = document.getElementById(id) as HTMLInputElement;
  element.value = value;
  element.dispatchEvent(new Event('input'));
}

function value(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value;
}

function save(): void {
  document.getElementById('save-settings')!.dispatchEvent(new Event('click'));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function refresh(patch: Partial<JriSettings>, area = 'sync'): Promise<void> {
  stored = { ...stored, ...patch };
  storageChanged({ 'jri:settings': { newValue: stored } }, area);
  await vi.advanceTimersByTimeAsync(0);
}

function importSettings(settings: JriSettings, text = Promise.resolve(JSON.stringify({ settings }))): void {
  const element = document.getElementById('import-data') as HTMLInputElement;
  Object.defineProperty(element, 'files', { configurable: true, value: [{ text: () => text }] });
  element.dispatchEvent(new Event('change'));
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  stored = { ...DEFAULT_SETTINGS };
  vi.mocked(loadSettings)
    .mockReset()
    .mockImplementation(async () => ({ ...stored }));
  vi.mocked(saveSettings)
    .mockReset()
    .mockImplementation(async (patch) => {
      stored = { ...stored, ...patch };
      return { ...stored };
    });
  vi.mocked(importData)
    .mockReset()
    .mockImplementation(async (data) => {
      stored = { ...(data as { settings: JriSettings }).settings };
    });
  vi.stubGlobal('browser', {
    storage: { onChanged: { addListener: vi.fn((listener) => (storageChanged = listener)) } },
  });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  vi.stubGlobal('speechSynthesis', { addEventListener: vi.fn(), getVoices: vi.fn(() => []) });
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
  vi.stubGlobal('Option', function (text: string, value: string) {
    const option = document.createElement('option');
    option.textContent = text;
    option.value = value;
    return option;
  });
  const template = document.createElement('template');
  template.innerHTML = homeHtml;
  for (const resource of template.content.querySelectorAll('link, script')) resource.remove();
  document.documentElement.innerHTML = template.innerHTML;
  await import('../entrypoints/home/home');
  await vi.advanceTimersByTimeAsync(0);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.innerHTML = '';
});

describe('Home settings', () => {
  it('shows Save changes for edits and does not write before it is clicked', async () => {
    input('dim-opacity', '40');
    const button = document.getElementById('save-settings') as HTMLButtonElement;
    expect(button.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saveSettings).not.toHaveBeenCalled();

    save();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ dimOpacity: 0.4 });
    expect(button.hidden).toBe(true);
  });

  it('saves only accumulated edited fields, preserving unrelated remote changes', async () => {
    input('dim-opacity', '40');
    input('font-scale', '1.4');
    // The remote write need not have reached the Home storage listener yet.
    stored = { ...stored, rate: 1.8, readingHistoryEnabled: true };
    save();
    await vi.advanceTimersByTimeAsync(0);

    expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ dimOpacity: 0.4, fontScale: 1.4 });
    expect(stored).toMatchObject({ dimOpacity: 0.4, fontScale: 1.4, rate: 1.8, readingHistoryEnabled: true });
    expect(value('rate')).toBe('1.8');
  });

  it('shows sync settings changes in the form, preview and tracking UI', async () => {
    await refresh({ dimOpacity: 0.7, rate: 1.5, readingHistoryEnabled: true });

    expect(value('dim-opacity')).toBe('70');
    expect(document.getElementById('dim-opacity-value')!.textContent).toBe('70%');
    expect(value('rate')).toBe('1.5');
    expect(document.getElementById('article-preview')!.style.getPropertyValue('--preview-dim-opacity')).toBe('0.7');
    expect(document.getElementById('overview-tracking-prompt')!.hidden).toBe(true);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it.each(['local', 'sync'])('preserves pending input during a %s storage refresh', async (area) => {
    input('dim-opacity', '40');
    await refresh({ dimOpacity: 0.8, rate: 1.5 }, area);

    expect(value('dim-opacity')).toBe('40');
    expect(value('rate')).toBe('1.5');
    save();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ dimOpacity: 0.4 });
    expect(stored).toMatchObject({ dimOpacity: 0.4, rate: 1.5 });
  });

  it('preserves new input through storage events and an older in-flight save completion', async () => {
    const saving = deferred<JriSettings>();
    vi.mocked(saveSettings).mockImplementationOnce(() => saving.promise);
    input('dim-opacity', '40');
    save();
    await vi.advanceTimersByTimeAsync(0);
    input('dim-opacity', '60');
    input('font-scale', '1.4');
    await refresh({ dimOpacity: 0.4, rate: 1.7 });
    expect(value('dim-opacity')).toBe('60');

    saving.resolve({ ...DEFAULT_SETTINGS, dimOpacity: 0.4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(value('dim-opacity')).toBe('60');
    expect(value('font-scale')).toBe('1.4');
    expect(value('rate')).toBe('1.7');
    save();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveSettings).toHaveBeenNthCalledWith(2, { dimOpacity: 0.6, fontScale: 1.4 });
    expect(stored).toMatchObject({ dimOpacity: 0.6, fontScale: 1.4, rate: 1.7 });
  });

  it('does not let an older storage read replace a newer refresh', async () => {
    const loading = deferred<JriSettings>();
    vi.mocked(loadSettings).mockImplementationOnce(() => loading.promise);
    storageChanged({ 'jri:settings': {} }, 'sync');
    await refresh({ rate: 1.7 });
    loading.resolve({ ...DEFAULT_SETTINGS, rate: 1.2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(value('rate')).toBe('1.7');
  });

  it('stages reset values until Save changes and keeps later input pending', async () => {
    const saving = deferred<JriSettings>();
    vi.mocked(saveSettings).mockImplementationOnce(() => saving.promise);
    input('dim-opacity', '80');
    document.getElementById('reset-settings')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveSettings).not.toHaveBeenCalled();
    input('font-scale', '1.4');
    save();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveSettings).mock.calls[0]![0].dimOpacity).toBe(DEFAULT_SETTINGS.dimOpacity);
    saving.resolve({ ...DEFAULT_SETTINGS, fontScale: 1.4 });
    await vi.advanceTimersByTimeAsync(0);

    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ dimOpacity: DEFAULT_SETTINGS.dimOpacity, fontScale: 1.4 }));
    expect(stored.dimOpacity).toBe(DEFAULT_SETTINGS.dimOpacity);
  });

  it('resets after an in-flight save instead of allowing it to overwrite defaults', async () => {
    const saving = deferred<JriSettings>();
    vi.mocked(saveSettings).mockImplementationOnce(async (patch) => {
      await saving.promise;
      stored = { ...stored, ...patch };
      return stored;
    });
    input('dim-opacity', '80');
    save();
    await vi.advanceTimersByTimeAsync(0);
    document.getElementById('reset-settings')!.click();
    save();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    saving.resolve(stored);
    await vi.advanceTimersByTimeAsync(0);
    expect(stored.dimOpacity).toBe(DEFAULT_SETTINGS.dimOpacity);
    expect(value('dim-opacity')).toBe(String(Math.round(DEFAULT_SETTINGS.dimOpacity * 100)));
  });

  it('asks to save pending preferences before switching tabs', async () => {
    document.getElementById('preferences-tab')!.dispatchEvent(new Event('click'));
    await vi.advanceTimersByTimeAsync(0);
    input('dim-opacity', '40');
    document.getElementById('history-tab')!.dispatchEvent(new Event('click'));
    await vi.advanceTimersByTimeAsync(0);

    expect(confirm).toHaveBeenCalledWith('Save preference changes before leaving?');
    expect(saveSettings).toHaveBeenCalledWith({ dimOpacity: 0.4 });
    expect(document.getElementById('history-panel')!.hidden).toBe(false);
  });

  it('discards pending preferences when leaving without saving', async () => {
    vi.mocked(confirm).mockReturnValueOnce(false);
    document.getElementById('preferences-tab')!.dispatchEvent(new Event('click'));
    await vi.advanceTimersByTimeAsync(0);
    input('dim-opacity', '40');
    document.getElementById('history-tab')!.dispatchEvent(new Event('click'));
    await vi.advanceTimersByTimeAsync(0);

    expect(saveSettings).not.toHaveBeenCalled();
    expect(value('dim-opacity')).toBe('42');
    expect(document.getElementById('history-panel')!.hidden).toBe(false);
  });

  it('cancels the pre-import debounce even when reading the file takes longer', async () => {
    const imported = { ...DEFAULT_SETTINGS, dimOpacity: 0.7, rate: 1.6 };
    const text = deferred<string>();
    input('dim-opacity', '40');
    importSettings(imported, text.promise);
    await vi.advanceTimersByTimeAsync(300);
    expect(saveSettings).not.toHaveBeenCalled();
    text.resolve(JSON.stringify({ settings: imported }));
    await vi.advanceTimersByTimeAsync(300);
    expect(stored).toEqual(imported);
    expect(value('dim-opacity')).toBe('70');
    expect(value('rate')).toBe('1.6');
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('waits for an in-flight save before import and preserves input entered after import starts', async () => {
    const saving = deferred<JriSettings>();
    vi.mocked(saveSettings).mockImplementationOnce(async (patch) => {
      await saving.promise;
      stored = { ...stored, ...patch };
      return stored;
    });
    input('dim-opacity', '40');
    save();
    await vi.advanceTimersByTimeAsync(0);
    input('rate', '1.2');
    save();
    await vi.advanceTimersByTimeAsync(0);
    importSettings({ ...DEFAULT_SETTINGS, dimOpacity: 0.7, rate: 1.6 });
    input('font-scale', '1.4');
    expect(importData).not.toHaveBeenCalled();
    saving.resolve(stored);
    await vi.advanceTimersByTimeAsync(0);

    expect(importData).toHaveBeenCalledTimes(1);
    save();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveSettings).toHaveBeenLastCalledWith({ fontScale: 1.4 });
    expect(stored).toMatchObject({ dimOpacity: 0.7, rate: 1.6, fontScale: 1.4 });
    expect(value('dim-opacity')).toBe('70');
    expect(value('font-scale')).toBe('1.4');
  });
});

export const CLEAR_READING_DATA_CONFIRMATION = 'Delete all saved reading data? Your reading settings will be kept.';

export async function withDisabled<T extends HTMLButtonElement>(button: T, action: () => Promise<void>): Promise<void> {
  button.disabled = true;
  try {
    await action();
  } finally {
    button.disabled = false;
  }
}

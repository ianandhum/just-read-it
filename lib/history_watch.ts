import { keyFromUrl } from './storage';

export interface UrlWatchOptions {
  pollMs?: number;
  normalize?: (url: string) => string;
}

export function watchUrlChanges(onChange: (url: string) => void, opts?: UrlWatchOptions): () => void {
  const normalize = opts?.normalize ?? keyFromUrl;
  const pollMs = opts?.pollMs ?? 750;
  let seen = normalize(location.href);

  function check(): void {
    const url = location.href;
    const key = normalize(url);
    if (key === seen) return;
    seen = key;
    onChange(url);
  }

  window.addEventListener('popstate', check);
  window.addEventListener('hashchange', check);
  const timer = setInterval(check, pollMs);

  return () => {
    window.removeEventListener('popstate', check);
    window.removeEventListener('hashchange', check);
    clearInterval(timer);
  };
}

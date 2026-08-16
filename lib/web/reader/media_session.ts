export interface ReaderMediaSessionContext {
  play(): void;
  pause(): void;
  stop(): void;
  next(): void;
  previous(): void;
}

export interface ReaderMediaSession {
  update(playing: boolean, title: string, artist: string, artworkUrl: string): void;
  clear(): void;
}

export function createReaderMediaSession(context: ReaderMediaSessionContext): ReaderMediaSession {
  const mediaSession = navigator.mediaSession;
  if (!mediaSession) {
    return { update() {}, clear() {} };
  }

  const handlers: Array<[MediaSessionAction, () => void]> = [
    ['play', context.play],
    ['pause', context.pause],
    ['stop', context.stop],
    ['nexttrack', context.next],
    ['previoustrack', context.previous],
    // These are the standard actions desktop players expose for 15-second
    // skips. Speech cannot seek inside an utterance reliably, so they move
    // one sentence instead.
    ['seekforward', context.next],
    ['seekbackward', context.previous],
  ];
  for (const [action, handler] of handlers) {
    try {
      mediaSession.setActionHandler(action, () => handler());
    } catch {
      // Browsers can expose Media Session without supporting every action.
    }
  }

  let metadataTitle = '';
  let metadataArtist = '';
  let metadataArtworkUrl = '';
  const setMetadata = (title: string, artist: string, artworkUrl: string): void => {
    if (title === metadataTitle && artist === metadataArtist && artworkUrl === metadataArtworkUrl) return;
    metadataTitle = title;
    metadataArtist = artist;
    metadataArtworkUrl = artworkUrl;
    if (typeof MediaMetadata === 'undefined') return;
    mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      artwork: artworkUrl ? [{ src: artworkUrl, sizes: '128x128', type: 'image/png' }] : [],
    });
  };

  return {
    update(playing, title, artist, artworkUrl) {
      setMetadata(title, artist, artworkUrl);
      mediaSession.playbackState = playing ? 'playing' : 'paused';
    },
    clear() {
      metadataTitle = '';
      metadataArtist = '';
      metadataArtworkUrl = '';
      mediaSession.metadata = null;
      mediaSession.playbackState = 'none';
    },
  };
}

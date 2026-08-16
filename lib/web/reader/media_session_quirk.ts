// Firefox on Linux may not expose speech synthesis to MPRIS. Keep this
// inaudible audio transport alive so the existing Media Session remains visible.
export interface MediaSessionQuirk {
  play(durationMs: number, positionMs: number): Promise<void>;
  pause(): void;
  seek(positionMs: number): void;
  stop(): void;
}

const LONG_NARRATION_MS = 10 * 60 * 60 * 1000;
const LOOP_DURATION_MS = 10 * 1000;

function writeString(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
}

async function createSilentWavUrl(durationMs: number): Promise<string> {
  // Standard unsigned 8-bit PCM keeps the source small and broadly decodable.
  const sampleRate = 1000;
  // Keep ten seconds as a safe minimum for Firefox's Media Session transport.
  const duration = Math.max(LOOP_DURATION_MS / 1000, Math.ceil(durationMs / 1000));
  const numSamples = sampleRate * duration;
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeString(view, 36, 'data');
  view.setUint32(40, numSamples, true);

  // 128 is digital silence, which Firefox ignores for Media Session activation.
  // A one-step DC bias is non-silent to Firefox but is filtered out by normal
  // audio paths, unlike a low-frequency pulse that people can hear.
  new Uint8Array(buffer, 44).fill(129);

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

export function createMediaSessionQuirk(): MediaSessionQuirk {
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  let audioCreation: Promise<HTMLAudioElement> | null = null;
  let lifecycle = 0;
  let sourceDurationMs = 0;

  function transportDuration(durationMs: number): number {
    return durationMs > LONG_NARRATION_MS ? LOOP_DURATION_MS : durationMs;
  }

  function transportPosition(durationMs: number, positionMs: number): number {
    const duration = transportDuration(durationMs);
    return Math.max(0, positionMs % duration);
  }

  async function ensureAudio(durationMs: number): Promise<HTMLAudioElement> {
    if (audio) return audio;
    if (audioCreation) return audioCreation;
    const creationLifecycle = lifecycle;
    audioCreation = (async () => {
      const nextAudio = new Audio();
      const nextUrl = await createSilentWavUrl(transportDuration(durationMs));
      if (creationLifecycle !== lifecycle) {
        URL.revokeObjectURL(nextUrl);
        throw new Error('Faux audio creation was cancelled.');
      }
      nextAudio.loop = durationMs > LONG_NARRATION_MS;
      // Setting volume to zero prevents Firefox from registering Media Session.
      // Use an inaudible DC-biased PCM source so the transport cannot be heard.
      nextAudio.setAttribute('aria-hidden', 'true');
      nextAudio.style.display = 'none';
      nextAudio.src = nextUrl;
      document.body?.appendChild(nextAudio);
      audio = nextAudio;
      url = nextUrl;
      sourceDurationMs = transportDuration(durationMs);
      return nextAudio;
    })();
    try {
      return await audioCreation;
    } finally {
      audioCreation = null;
    }
  }

  return {
    async play(durationMs, positionMs): Promise<void> {
      const playLifecycle = lifecycle;
      try {
        const transport = await ensureAudio(durationMs);
        if (playLifecycle !== lifecycle) return;
        transport.currentTime = transportPosition(durationMs, positionMs) / 1000;
        await transport.play();
      } catch {
        // This is only a Media Session enhancement; narration must continue without it.
      }
    },
    pause(): void {
      // Invalidate a pending play so an asynchronously created audio element
      // cannot begin playing after speech has been paused.
      lifecycle++;
      try {
        audio?.pause();
      } catch {
        // The faux transport is optional.
      }
    },
    seek(positionMs): void {
      try {
        if (audio) audio.currentTime = Math.max(0, positionMs % sourceDurationMs) / 1000;
      } catch {
        // The faux transport is optional.
      }
    },
    stop(): void {
      lifecycle++;
      try {
        audio?.pause();
        audio?.remove();
        if (url) URL.revokeObjectURL(url);
      } catch {
        // The faux transport is optional.
      }
      audio = null;
      url = null;
      sourceDurationMs = 0;
    },
  };
}

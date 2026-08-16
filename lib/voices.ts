const VOICE_LIMIT = 200;

export function getReadableVoices(selectedURI?: string | null): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined' || typeof speechSynthesis.getVoices !== 'function') return [];
  const all = speechSynthesis.getVoices();
  const seen = new Set<string>();
  const unique: SpeechSynthesisVoice[] = [];
  for (const voice of all) {
    if (seen.has(voice.voiceURI)) continue;
    seen.add(voice.voiceURI);
    unique.push(voice);
  }
  let result = unique;
  if (selectedURI) {
    const selected = unique.find((voice) => voice.voiceURI === selectedURI);
    if (selected && !result.includes(selected)) result = [selected, ...result];
  }
  return result.slice(0, VOICE_LIMIT);
}

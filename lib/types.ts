export type SentenceState = 'unread' | 'current' | 'read';

export type ReadRange = [start: number, length: number];

export interface PageState {
  url: string;
  title?: string;
  faviconUrl?: string;
  previewImageUrl?: string;
  total: number;
  readRanges: ReadRange[];
  currentId: number | null;
  updatedAt: number;
  timeSpentMs?: number;
  listenTimeSpentMs?: number;
  estimatedUnreadMs?: number;
  dailyTimeSpentMs?: Record<string, number>;
  dailyListenTimeSpentMs?: Record<string, number>;
  starred?: boolean;
}

export interface ReadingProgressSummary {
  pagesTracked: number;
  pagesCompleted: number;
  pagesInProgress: number;
  sentencesRead: number;
  sentencesTotal: number;
  timeSpentMs: number;
  completionPercent: number;
}

export interface DailyReadingTime {
  date: string;
  timeSpentMs: number;
}

export interface JriSettings {
  readingHistoryEnabled: boolean;
  guidedReading: boolean;
  rsvpEnabled: boolean;
  ttsEnabled: boolean;
  voiceURI: string | null;
  rate: number;
  guidedRate: number;
  guidedAdvanceDelay: number;
  guidedManualPause: number;
  mouseIdleDelay: number;
  dimOpacity: number;
  fontScale: number;
  currentHighlightColor: string;
  readHighlightColor: string;
  darkCurrentHighlightColor: string;
  darkReadHighlightColor: string;
  currentWordBackgroundColor: string;
  darkCurrentWordBackgroundColor: string;
}

export const DEFAULT_SETTINGS: JriSettings = {
  readingHistoryEnabled: false,
  guidedReading: false,
  rsvpEnabled: false,
  ttsEnabled: false,
  voiceURI: null,
  rate: 1,
  guidedRate: 1,
  guidedAdvanceDelay: 600,
  guidedManualPause: 600,
  mouseIdleDelay: 300,
  dimOpacity: 0.42,
  fontScale: 1,
  currentHighlightColor: '#f5cd18',
  readHighlightColor: '#58c05b',
  darkCurrentHighlightColor: '#f5ab18',
  darkReadHighlightColor: '#86efac',
  currentWordBackgroundColor: '#fac278',
  darkCurrentWordBackgroundColor: '#fbce86',
};

export interface TabState {
  enabled: boolean;
  state: PageState | null;
  settings: JriSettings;
  contentCandidates: ContentCandidateInfo[];
}

export interface ContentCandidateInfo {
  id: string;
  label: string;
  confidence: number;
  selected: boolean;
}

export interface ToggleResult {
  ok: boolean;
  enabled: boolean;
  error?: 'restricted' | 'no-tab' | 'no-content' | 'unknown';
}

/**
 * Runtime messages are named by the direction they travel. Each prefix names
 * the sender, which is what makes the direction unambiguous:
 *
 *   UI: extension pages (popup, home) -> background worker.
 *   CS: page content script -> background worker.
 *   BG: background worker -> page content script.
 */

/** Extension page (popup, home) -> background worker. */
export type UiToBackgroundMessage =
  | { type: 'UI_GET_STATE' } // request the state of the active tab
  | { type: 'UI_SET_READING_MODE'; enabled: boolean } // toggle the active tab's reader
  | { type: 'UI_SELECT_CANDIDATE'; candidateId: string } // Select a candidate
  | { type: 'UI_OPEN_READING_PAGE'; url: string }; // open a saved page and enable reading mode

/** Page content script -> background worker. */
export type ContentToBackgroundMessage =
  | { type: 'CS_READING_MODE_STATE'; enabled: boolean; token: string } // report the reader state after activation / deactivation
  | { type: 'CS_SENTENCE_HOVER'; hovered: boolean } // report sentence hover (for Read From Here context menu)
  | { type: 'CS_CONTENT_CANDIDATES'; candidates: ContentCandidateInfo[] } // report content candidate info
  | { type: 'CS_SET_READING_MODE'; enabled: boolean } // reader requests a state change (e.g. close button)
  | { type: 'CS_OPEN_HOME' } // open the reading home in a new tab
  | { type: 'CS_TTS_STATUS' }
  | { type: 'CS_TTS_SPEAK'; text: string; rate: number; voiceURI: string | null; requestId: number }
  | { type: 'CS_TTS_STOP' };

/** Background worker -> page content script. */
export type BackgroundToContentMessage =
  | { type: 'BG_PROBE' } // confirm that the injected content script is alive
  | { type: 'BG_PING_STATE' } // probe whether the reader is active (and cache candidates)
  | { type: 'BG_SET_SESSION'; token: string }
  | { type: 'BG_TEARDOWN' }
  | { type: 'BG_SELECT_CANDIDATE'; candidateId: string }
  | { type: 'BG_MARK_PREVIOUS_READ' }
  | { type: 'BG_TTS_EVENT'; event: 'end' | 'error' | 'word'; requestId?: number; charIndex?: number; error?: string };

export type RuntimeMessage = UiToBackgroundMessage | ContentToBackgroundMessage | BackgroundToContentMessage;

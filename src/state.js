
/** @type {PlaybackState} */
const playback = {
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  playbackRate: 1.0,
  isSeekDragging: false,
  bufferedEnd: 0,
  chapters: [],
  isMSEMode: false   // T06: true when playing via MSE pipeline
};

/** @type {SettingsState} */
const settings = {
  rotate: 0,
  flipH: false,
  flipV: false,
  scale: 100,
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hueRotate: 0,
  blur: 0,
  subDelay: 0
};

/** @type {UIState} */
const ui = {
  controlsVisible: true,
  currentVideoId: '',
  sidebarFilter: 'all',    // 'all' | 'recent' | 'favorites'
  favFilterActive: false,  // Quick toggle for favorites-only in sidebar
  rightPanelOpen: false,
  rightPanelTab: 'history',
  settingsOpen: false,
  settingsTab: 'playback', // 'playback' | 'display' | 'about'
  addVideoModalOpen: false,
  searchQuery: '',
  miniMode: false           // T05: mini mode active
};

/** @type {VideoItem[]} */
let playlist = [];

/** @type {VideoItem[]} */
let favorites = [];

/** @type {string} */
let currentVideoId = '';

/** Flag: suppress thumbnail generation during auto-play sequence.
 *  Prevents generateThumbnails() from seeking the video while
 *  video.play() is about to start (avoids fast-playback bug). */
let _pendingAutoPlay = false;

/**
 * Unified state update entry point.
 * Merges partial state into the corresponding state object,
 * then triggers sync and render.
 */
function setState(partial) {
  if (partial.playback) {
    Object.assign(playback, partial.playback);
    syncVideo();
  }
  if (partial.settings) {
    Object.assign(settings, partial.settings);
    applyVideoFilter();
  }
  if (partial.ui) {
    Object.assign(ui, partial.ui);
  }
  renderUI();
}

/** Sync PlaybackState to the <video> element */
function syncVideo() {
  const v = DOM.video;
  if (!v) return;

  if (partial_has(playback, 'volume')) {
    v.volume = playback.volume;
  }
  if (partial_has(playback, 'muted')) {
    v.muted = playback.muted;
  }
  if (partial_has(playback, 'playbackRate')) {
    v.playbackRate = playback.playbackRate;
  }
}

/** Check if an object has a specific key (helper for syncVideo) */
function partial_has(obj, key) {
  return obj.hasOwnProperty(key);
}


const STORAGE_KEY = 'prism-player';

/** Auto-save timer for playback position */
let _autoSaveTimer = null;
const AUTO_SAVE_INTERVAL = 5000; // 5 seconds

function storageSave(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // Silent fail on quota exceeded
  }
}

function storageLoad() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/** Save current playback position for the active video */
function savePlaybackPosition() {
  if (!currentVideoId || playback.duration <= 0) return;
  const item = playlist.find(function(v) { return v.id === currentVideoId; });
  if (item) {
    item.lastPosition = playback.currentTime;
    item.progress = clamp(playback.currentTime / playback.duration, 0, 1);
    item.duration = playback.duration;
  }
}

/** Start auto-save interval for playback position */
function startAutoSave() {
  if (_autoSaveTimer) return;
  _autoSaveTimer = setInterval(function() {
    savePlaybackPosition();
  }, AUTO_SAVE_INTERVAL);
}

/** Stop auto-save interval */
function stopAutoSave() {
  if (_autoSaveTimer) {
    clearInterval(_autoSaveTimer);
    _autoSaveTimer = null;
  }
}


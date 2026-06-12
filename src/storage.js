
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
    if (!raw) return null;
    var data = JSON.parse(raw);
    var changed = stripStoredThumbnails(data);
    if (changed) storageSave(data);
    return data;
  } catch (e) {
    return null;
  }
}

function stripStoredThumbnails(data) {
  var changed = false;
  ['videos', 'favorites'].forEach(function(key) {
    if (!data || !Array.isArray(data[key])) return;
    data[key].forEach(function(item) {
      if (item && item.thumbnail) {
        item.thumbnail = '';
        changed = true;
      }
    });
  });
  return changed;
}

/** Save current playback position for the active video */
function savePlaybackPosition() {
  if (!currentVideoId || playback.duration <= 0) return;
  const item = playlist.find(function(v) { return v.id === currentVideoId; }) ||
    favorites.find(function(v) { return v.id === currentVideoId; });
  if (item) {
    item.lastPosition = playback.currentTime;
    item.progress = clamp(playback.currentTime / playback.duration, 0, 1);
    item.duration = playback.duration;
    var fav = findFavoriteByItem(item);
    if (fav && fav !== item) {
      fav.lastPosition = item.lastPosition;
      fav.progress = item.progress;
      fav.duration = item.duration;
    }
  }
}

/** Start auto-save interval for playback position */
function startAutoSave() {
  if (_autoSaveTimer) return;
  _autoSaveTimer = setInterval(function() {
    if (typeof persistAppState === 'function') {
      persistAppState();
    } else {
      savePlaybackPosition();
    }
  }, AUTO_SAVE_INTERVAL);
}

/** Stop auto-save interval */
function stopAutoSave() {
  if (_autoSaveTimer) {
    clearInterval(_autoSaveTimer);
    _autoSaveTimer = null;
  }
}

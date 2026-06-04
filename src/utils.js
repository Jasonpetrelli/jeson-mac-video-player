
/** Detect Electron environment */
const IS_ELECTRON = !!(window.electronAPI);

/** Format seconds to human-readable time string */
function formatTime(totalSeconds) {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}

/** Clamp a number between min and max */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/** Debounce a function */
function debounce(fn, delay) {
  let timer = null;
  return function() {
    const args = arguments;
    const ctx = this;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, delay);
  };
}

/** Generate a random 8-character ID */
function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** Truncate a string in the middle with ellipsis */
function truncateMiddle(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  const frontLen = Math.ceil(maxLen * 0.6);
  const backLen = maxLen - frontLen - 3;
  return str.substring(0, frontLen) + '...' + str.substring(str.length - backLen);
}


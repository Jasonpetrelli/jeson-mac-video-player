
/** @type {Array<string>} Cached thumbnail data URLs keyed by time offset */
let thumbnailCache = [];

/** @type {number} Interval between thumbnails in seconds */
let thumbnailInterval = 10;

/** @type {boolean} Whether thumbnail generation is in progress */
let thumbnailGenerating = false;

/** @type {HTMLCanvasElement} Offscreen canvas for frame capture */
let thumbCanvas = null;
let thumbCtx = null;

/** @type {HTMLVideoElement|null} Dedicated hidden video for thumbnail seeking (never touches DOM.video) */
let _thumbVideoEl = null;

let hoverThumbnailCache = {};
let hoverThumbnailPending = {};
let thumbnailSource = '';
let hoverThumbnailVideo = null;
let hoverThumbnailRequestId = 0;

function getThumbnailSource() {
  return DOM.video ? (DOM.video.currentSrc || DOM.video.src || '') : '';
}

function syncThumbnailSource() {
  var src = getThumbnailSource();
  if (src !== thumbnailSource) {
    thumbnailSource = src;
    thumbnailCache = [];
    hoverThumbnailCache = {};
    hoverThumbnailPending = {};
    cleanupHoverThumbnailVideo();
  }
  return src;
}

function cleanupHoverThumbnailVideo() {
  if (hoverThumbnailVideo) {
    hoverThumbnailVideo.removeAttribute('src');
    if (hoverThumbnailVideo.parentNode) hoverThumbnailVideo.parentNode.removeChild(hoverThumbnailVideo);
    hoverThumbnailVideo = null;
  }
}

/** Initialize thumbnail canvas */
function initThumbCanvas() {
  thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 160;
  thumbCanvas.height = 90;
  thumbCtx = thumbCanvas.getContext('2d');
}

/** Start generating thumbnails using a SEPARATE hidden video element.
 *  CRITICAL: Never seek DOM.video directly — that disrupts playback.
 *  Uses a dedicated _thumbVideoEl cloned from the same source. */
function generateThumbnails() {
  if (thumbnailGenerating) return;
  if (!DOM.video || !playback.duration || playback.duration <= 0) return;

  // If video is playing, defer — will retry on pause/ended
  if (playback.playing) return;

  var currentSrc = syncThumbnailSource();
  if (!currentSrc || playback.isMSEMode) {
    // MSE mode: cannot clone src into separate video, skip thumbnails
    return;
  }

  thumbnailCache = [];
  initThumbCanvas();

  // Calculate interval: aim for ~60 frames max
  thumbnailInterval = Math.max(10, Math.ceil(playback.duration / 60));

  thumbnailGenerating = true;

  // Create a dedicated hidden video element for seeking — never touch DOM.video
  var tv = document.createElement('video');
  tv.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
  tv.muted = true;
  tv.preload = 'auto';
  tv.src = currentSrc;
  document.body.appendChild(tv);
  _thumbVideoEl = tv;

  var index = 0;
  var total = Math.floor(playback.duration / thumbnailInterval);

  function captureNext() {
    if (!thumbnailGenerating || !_thumbVideoEl) return;
    if (index >= total) {
      // Done
      thumbnailGenerating = false;
      if (_thumbVideoEl) {
        _thumbVideoEl.src = '';
        if (_thumbVideoEl.parentNode) _thumbVideoEl.parentNode.removeChild(_thumbVideoEl);
        _thumbVideoEl = null;
      }
      return;
    }

    var targetTime = index * thumbnailInterval;
    _thumbVideoEl.currentTime = targetTime;

    _thumbVideoEl.addEventListener('seeked', function onSeeked() {
      _thumbVideoEl.removeEventListener('seeked', onSeeked);
      if (!thumbnailGenerating || !_thumbVideoEl) return;

      try {
        thumbCtx.drawImage(_thumbVideoEl, 0, 0, 160, 90);
        thumbnailCache.push(thumbCanvas.toDataURL('image/jpeg', 0.5));
      } catch (e) {
        thumbnailCache.push(null);
      }

      index++;
      if (thumbnailGenerating) {
        setTimeout(captureNext, 50);
      }
    });

    // Timeout guard: if seeked doesn't fire within 3s, skip this frame
    setTimeout(function() {
      if (thumbnailGenerating && _thumbVideoEl) {
        _thumbVideoEl.removeEventListener('seeked', function(){});
        index++;
        captureNext();
      }
    }, 3000);
  }

  // Wait for the hidden video to be ready before seeking
  tv.addEventListener('loadedmetadata', function() {
    if (thumbnailGenerating) captureNext();
  });
  // Also handle case where metadata loads immediately (cached)
  if (tv.readyState >= 1) {
    if (thumbnailGenerating) captureNext();
  }
}

/** Stop thumbnail generation and clean up the hidden video element */
function stopThumbnailGeneration() {
  thumbnailGenerating = false;
  if (_thumbVideoEl) {
    _thumbVideoEl.src = '';
    if (_thumbVideoEl.parentNode) _thumbVideoEl.parentNode.removeChild(_thumbVideoEl);
    _thumbVideoEl = null;
  }
}

/** Get thumbnail image for a given time position */
function getThumbnailAtTime(time) {
  syncThumbnailSource();

  var hoverKey = getHoverThumbnailKey(time);
  if (hoverThumbnailCache[hoverKey]) return hoverThumbnailCache[hoverKey];

  if (thumbnailCache.length === 0) return null;

  var index = Math.floor(time / thumbnailInterval);
  if (index < 0) index = 0;
  if (index >= thumbnailCache.length) index = thumbnailCache.length - 1;

  return thumbnailCache[index];
}

function getHoverThumbnailKey(time) {
  return String(Math.max(0, Math.floor(time)));
}

function requestThumbnailAtTime(time, callback) {
  if (!DOM.video || !playback.duration || playback.duration <= 0) return;
  if (playback.isMSEMode) return;

  var src = syncThumbnailSource();
  if (!src) return;

  var key = getHoverThumbnailKey(time);
  if (hoverThumbnailCache[key]) {
    callback(hoverThumbnailCache[key], time);
    return;
  }

  hoverThumbnailRequestId++;
  var requestId = hoverThumbnailRequestId;
  hoverThumbnailPending = {};
  hoverThumbnailPending[key] = true;
  cleanupHoverThumbnailVideo();

  var tv = document.createElement('video');
  hoverThumbnailVideo = tv;
  tv.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
  tv.muted = true;
  tv.preload = 'auto';
  tv.src = src;

  function cleanup() {
    hoverThumbnailPending[key] = false;
    if (requestId === hoverThumbnailRequestId) {
      cleanupHoverThumbnailVideo();
    }
  }

  function capture() {
    if (requestId !== hoverThumbnailRequestId) return;
    tv.currentTime = clamp(time, 0, playback.duration);
  }

  tv.addEventListener('loadedmetadata', capture, { once: true });
  tv.addEventListener('seeked', function() {
    if (requestId !== hoverThumbnailRequestId) {
      cleanup();
      return;
    }
    try {
      if (!thumbCanvas || !thumbCtx) initThumbCanvas();
      thumbCtx.drawImage(tv, 0, 0, 160, 90);
      var dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.5);
      hoverThumbnailCache[key] = dataUrl;
      callback(dataUrl, time);
    } catch (e) {
      // Some sources cannot be drawn to canvas; keep the time-only preview.
    }
    cleanup();
  }, { once: true });
  tv.addEventListener('error', cleanup, { once: true });

  document.body.appendChild(tv);
  if (tv.readyState >= 1) capture();
  setTimeout(function() {
    if (requestId === hoverThumbnailRequestId && hoverThumbnailPending[key]) {
      cleanup();
    }
  }, 3000);
}

function generateItemThumbnail(item) {
  if (!item || item.thumbnail || playback.isMSEMode) return;
  var src = DOM.video ? (DOM.video.currentSrc || DOM.video.src || '') : '';
  if (!src || item.id !== currentVideoId || !playback.duration || playback.duration <= 0) return;

  var tv = document.createElement('video');
  tv.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
  tv.muted = true;
  tv.preload = 'auto';
  tv.src = src;

  function cleanup() {
    tv.removeAttribute('src');
    if (tv.parentNode) tv.parentNode.removeChild(tv);
  }

  function capture() {
    tv.currentTime = clamp(playback.duration / 2, 0, playback.duration);
  }

  tv.addEventListener('loadedmetadata', capture, { once: true });
  tv.addEventListener('seeked', function() {
    try {
      if (!thumbCanvas || !thumbCtx) initThumbCanvas();
      thumbCtx.drawImage(tv, 0, 0, 160, 90);
      item.thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.6);
      var fav = findFavoriteByItem(item);
      if (fav) fav.thumbnail = item.thumbnail;
      renderSidebar();
    } catch (e) {
      // Keep generated gradient thumbnail fallback.
    }
    cleanup();
  }, { once: true });
  tv.addEventListener('error', cleanup, { once: true });

  document.body.appendChild(tv);
  if (tv.readyState >= 1) capture();
}


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

  var currentSrc = DOM.video.currentSrc || DOM.video.src;
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
  if (thumbnailCache.length === 0) return null;

  var index = Math.floor(time / thumbnailInterval);
  if (index < 0) index = 0;
  if (index >= thumbnailCache.length) index = thumbnailCache.length - 1;

  return thumbnailCache[index];
}


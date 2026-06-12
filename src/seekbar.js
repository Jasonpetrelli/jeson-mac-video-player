
let seekbarDragging = false;
let lastSeekHoverTime = 0;
let seekbarDragTargetTime = 0;

function initSeekbar() {
  DOM.seekbar.addEventListener('mousedown', onSeekbarMouseDown);
  DOM.seekbar.addEventListener('click', onSeekbarClick);
  document.addEventListener('mousemove', onSeekbarMouseMove);
  document.addEventListener('mouseup', onSeekbarMouseUp);
}

function onSeekbarMouseDown(e) {
  if (playback.duration <= 0) return;
  e.preventDefault();
  seekbarDragging = true;
  playback.isSeekDragging = true;
  seekbarDragTargetTime = updateSeekFromMouse(e);
}

function onSeekbarMouseMove(e) {
  if (!seekbarDragging) return;
  e.preventDefault();
  seekbarDragTargetTime = updateSeekFromMouse(e);
}

function onSeekbarMouseUp(e) {
  if (!seekbarDragging) return;
  seekbarDragging = false;
  playback.isSeekDragging = false;

  // Apply the seek
  videoSeek(seekbarDragTargetTime);

  renderSeekBar();
  renderTimeBadge();
}

function onSeekbarClick(e) {
  if (playback.duration <= 0) return;
  if (seekbarDragging) return;
}

function updateSeekFromMouse(e) {
  const pct = getSeekPctFromEvent(e);
  DOM.seekFill.style.width = (pct * 100) + '%';
  DOM.currentTime.textContent = formatTime(pct * playback.duration) + ' / ' + formatTime(playback.duration);
  playback.currentTime = pct * playback.duration;
  return playback.currentTime;
}

function getSeekPctFromEvent(e) {
  const r = DOM.seekbar.getBoundingClientRect();
  return clamp((e.clientX - r.left) / r.width, 0, 1);
}

/** Render chapter markers on seekbar */
function renderChapterMarkers() {
  // Remove existing markers
  DOM.seekbar.querySelectorAll('.seek-chapter').forEach(function(el) { el.remove(); });

  if (!playback.chapters || playback.chapters.length === 0 || playback.duration <= 0) return;

  playback.chapters.forEach(function(ch) {
    var pct = (ch.time / playback.duration) * 100;
    if (pct < 0 || pct > 100) return;
    var marker = document.createElement('div');
    marker.className = 'seek-chapter';
    marker.style.left = pct + '%';
    marker.setAttribute('data-title', ch.title || '');
    DOM.seekbar.appendChild(marker);
  });
}

/** Hover preview on seekbar — enhanced with thumbnail */
function seekHover(e) {
  if (playback.duration <= 0) return;
  var r = DOM.seekbar.getBoundingClientRect();
  var pct = clamp((e.clientX - r.left) / r.width, 0, 1);
  var targetTime = pct * playback.duration;
  lastSeekHoverTime = targetTime;

  // Update seek line position
  DOM.seekLine.style.left = (pct * 100) + '%';

  // Build thumbnail preview
  var thumbHtml = '';
  var thumbData = getThumbnailAtTime(targetTime);
  if (thumbData) {
    thumbHtml = '<img class="seek-thumb-img" src="' + thumbData + '" alt="">';
  } else {
    thumbHtml = '<div class="seek-thumb-placeholder"></div>';
  }

  DOM.seekPreview.innerHTML = thumbHtml + '<div class="seek-preview-time">' + formatTime(targetTime) + '</div>';
  DOM.seekPreview.style.left = (pct * 100) + '%';

  if (!thumbData) {
    requestThumbnailAtTime(targetTime, function(dataUrl, capturedTime) {
      if (Math.abs(lastSeekHoverTime - capturedTime) > 1) return;
      DOM.seekPreview.innerHTML = '<img class="seek-thumb-img" src="' + dataUrl + '" alt="">' +
        '<div class="seek-preview-time">' + formatTime(capturedTime) + '</div>';
    });
  }

  // Check chapter hover
  var chapterTooltip = DOM.seekbar.querySelector('.seek-chapter-tooltip');
  if (playback.chapters && playback.chapters.length > 0) {
    var hoveredChapter = null;
    for (var i = 0; i < playback.chapters.length; i++) {
      var chPct = (playback.chapters[i].time / playback.duration) * 100;
      if (Math.abs(pct * 100 - chPct) < 1.5) {
        hoveredChapter = playback.chapters[i];
        break;
      }
    }
    if (hoveredChapter) {
      if (!chapterTooltip) {
        chapterTooltip = document.createElement('div');
        chapterTooltip.className = 'seek-chapter-tooltip';
        DOM.seekbar.appendChild(chapterTooltip);
      }
      chapterTooltip.textContent = hoveredChapter.title || '';
      chapterTooltip.style.left = (hoveredChapter.time / playback.duration * 100) + '%';
      chapterTooltip.style.opacity = '1';
    } else if (chapterTooltip) {
      chapterTooltip.style.opacity = '0';
    }
  }
}

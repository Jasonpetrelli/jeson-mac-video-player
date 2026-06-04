
function initVideoEngine() {
  const v = DOM.video;

  // Bind video events
  v.addEventListener('timeupdate', onTimeUpdate);
  v.addEventListener('durationchange', onDurationChange);
  v.addEventListener('ended', onEnded);
  v.addEventListener('error', onError);
  v.addEventListener('loadedmetadata', onLoadedMetadata);
  v.addEventListener('progress', onProgress);
  v.addEventListener('play', onPlay);
  v.addEventListener('pause', onPause);
  v.addEventListener('volumechange', onVolumeChange);
  v.addEventListener('seeked', onSeeked);

  // Set initial volume
  v.volume = playback.volume;
  v.muted = playback.muted;

  // Start auto-save for playback position
  startAutoSave();
}

/** video timeupdate event handler */
function onTimeUpdate() {
  if (playback.isSeekDragging) return;

  playback.currentTime = DOM.video.currentTime;

  // Update playlist progress (throttled — only update sidebar every 2 seconds)
  if (currentVideoId && playback.duration > 0) {
    if (!onTimeUpdate._lastSidebarUpdate || Date.now() - onTimeUpdate._lastSidebarUpdate > 2000) {
      updateVideoProgress(currentVideoId, playback.currentTime, playback.duration);
      onTimeUpdate._lastSidebarUpdate = Date.now();
    }
  }

  // Render subtitle for current time
  renderSubtitle();

  // Check A-B loop
  checkABLoop();

  renderSeekBar();
  renderTimeBadge();
}
onTimeUpdate._lastSidebarUpdate = 0;

/** video durationchange event handler */
function onDurationChange() {
  playback.duration = DOM.video.duration || 0;
  renderTimeBadge();
  renderABMarkers();
}

/** video ended event handler */
function onEnded() {
  playback.playing = false;
  renderPlayBtn();
  // Generate thumbnails after video ends
  generateThumbnails();
  // Check if sleep timer should fire after current video
  checkSleepAfterVideoEnd();
  // Auto next video
  const curIdx = playlist.findIndex(function(item) { return item.id === currentVideoId; });
  if (curIdx >= 0 && curIdx < playlist.length - 1) {
    switchToVideo(playlist[curIdx + 1].id);
  } else {
    // No more videos, show controls
    showControls();
  }
}

/** video error event handler */
function onError() {
  const error = DOM.video.error;
  let msg = '视频加载失败';
  if (error) {
    switch (error.code) {
      case MediaError.MEDIA_ERR_ABORTED: msg = '视频加载已取消'; break;
      case MediaError.MEDIA_ERR_NETWORK: msg = '网络错误，无法加载视频'; break;
      case MediaError.MEDIA_ERR_DECODE: msg = '视频解码失败'; break;
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = '不支持的视频格式'; break;
    }
  }
  toast(msg);
  playback.playing = false;
  _pendingAutoPlay = false;
  renderPlayBtn();
}
function onLoadedMetadata() {
  playback.duration = DOM.video.duration || 0;
  playback.currentTime = DOM.video.currentTime;
  renderSeekBar();
  renderTimeBadge();

  // Show video, hide empty state
  DOM.emptyState.classList.add('hidden');
  DOM.filmGrain.classList.add('video-active');

  // Update duration in playlist item
  if (currentVideoId) {
    updateVideoDuration(currentVideoId, playback.duration);
  }

  // Update titlebar
  updateTitlebar();

  // Start thumbnail generation (only if NOT about to auto-play,
  // otherwise thumbnail seeking conflicts with playback start)
  if (!_pendingAutoPlay) {
    generateThumbnails();
  }

  // Render chapter markers
  renderChapterMarkers();
}

/** video progress event handler — update buffer indicator */
function onProgress() {
  const v = DOM.video;
  if (v.buffered.length > 0) {
    playback.bufferedEnd = v.buffered.end(v.buffered.length - 1);
    renderBufferBar();
  }
}

/** video play event handler */
function onPlay() {
  playback.playing = true;
  _pendingAutoPlay = false; // Clear flag — playback has started
  renderPlayBtn();
  scheduleAutoHide();
  // Stop thumbnail generation while playing
  stopThumbnailGeneration();
}

/** video pause event handler */
function onPause() {
  playback.playing = false;
  renderPlayBtn();
  showControls();
  // Resume thumbnail generation if needed
  if (thumbnailCache.length === 0 && playback.duration > 0) {
    generateThumbnails();
  }
}

/** video volumechange event handler */
function onVolumeChange() {
  playback.volume = DOM.video.volume;
  playback.muted = DOM.video.muted;
  renderVolumeUI();
}

/** video seeked event handler */
function onSeeked() {
  playback.currentTime = DOM.video.currentTime;
  renderSeekBar();
  renderTimeBadge();
}

/* ── Video Engine proxy functions ── */

function videoPlay() {
  if (DOM.video.src || DOM.video.currentSrc || playback.isMSEMode) {
    DOM.video.play().catch(function() {
      _pendingAutoPlay = false;
      toast('播放失败');
    });
  } else {
    _pendingAutoPlay = false;
  }
}

function videoPause() {
  DOM.video.pause();
}

function videoSeek(time) {
  if (playback.isMSEMode && _msePipeline) {
    _msePipeline.seek(clamp(time, 0, playback.duration || 0));
  } else {
    DOM.video.currentTime = clamp(time, 0, playback.duration || 0);
  }
}

function videoSetVolume(vol) {
  playback.volume = clamp(vol, 0, 1);
  DOM.video.volume = playback.volume;
  renderVolumeUI();
}

function videoSetMuted(muted) {
  playback.muted = muted;
  DOM.video.muted = muted;
  renderVolumeUI();
}

function videoSetRate(rate) {
  playback.playbackRate = rate;
  DOM.video.playbackRate = rate;
}


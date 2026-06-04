
function initState() {
  // Try to restore state from localStorage
  const saved = storageLoad();
  if (saved) {
    if (saved.volume !== undefined) {
      playback.volume = saved.volume;
    }
    if (saved.muted !== undefined) {
      playback.muted = saved.muted;
    }
    if (saved.playbackRate !== undefined) {
      playback.playbackRate = saved.playbackRate;
    }
    if (saved.settings) {
      Object.assign(settings, saved.settings);
      // Ensure new properties have defaults
      if (settings.hueRotate === undefined) settings.hueRotate = 0;
      if (settings.blur === undefined) settings.blur = 0;
      if (settings.subDelay === undefined) settings.subDelay = 0;
    }
    if (saved.videos) {
      saved.videos.forEach(function(v) {
        var wasFavorite = v.favorite === true;
        v.favorite = false;
        if (v.type === 'network') {
          // Network videos can be reloaded from their URL
          v.unavailable = false;
          playlist.push(v);
        } else if (v.type === 'local') {
          // In Electron, if we have a saved _filePath, the file is still accessible
          if (IS_ELECTRON && v._filePath) {
            v.url = getLocalFileURL(v._filePath);
            v.unavailable = false;
            var fileExt = (v._filePath || v.title || '').split('.').pop().toLowerCase();
            v._needsMSE = (fileExt === 'mkv' || fileExt === 'webm');
            v._fileRef = null; // No File object on reload, but _filePath suffices
          } else {
            // Browser: Local videos had blob URLs which are invalid after page reload.
            // Keep them in the list but mark as unavailable.
            v.url = '';
            v._blobUrl = null;
            v.unavailable = true;
          }
          v._fileName = v._fileName || null;
          v._fileSize = v._fileSize || null;
          v._fileLastModified = v._fileLastModified || null;
          v._mseUnsupported = v._mseUnsupported === true;
          playlist.push(v);
        }
        if (wasFavorite && !findFavoriteByItem(v)) {
          favorites.push(cloneVideoForFavorite(v));
        }
      });
    }
    if (saved.favorites) {
      saved.favorites.forEach(function(v) {
        v.favorite = true;
        if (v.type === 'local' && IS_ELECTRON && v._filePath) {
          v.url = getLocalFileURL(v._filePath);
          v.unavailable = false;
          var fileExt = (v._filePath || v.title || '').split('.').pop().toLowerCase();
          v._needsMSE = (fileExt === 'mkv' || fileExt === 'webm');
          v._fileRef = null;
        }
        if (!findFavoriteByItem(v)) {
          favorites.push(v);
        }
      });
    }
    // Restore favorites filter state
    if (saved.favFilterActive) {
      ui.favFilterActive = true;
    }
    if (saved.settingsTab) {
      ui.settingsTab = saved.settingsTab;
    }
  }
}

function bindEvents() {
  // Stage events
  DOM.videoFrame.addEventListener('mousemove', onMouseMove);
  DOM.videoFrame.addEventListener('click', onStageClick);
  DOM.videoFrame.addEventListener('dblclick', onStageDblClick);
  DOM.controlsOverlay.addEventListener('mouseenter', onControlsMouseEnter);
  DOM.controlsOverlay.addEventListener('mouseleave', onControlsMouseLeave);

  // Volume slider
  DOM.volSlider.addEventListener('click', function(e) {
    const r = DOM.volSlider.getBoundingClientRect();
    const pct = clamp((e.clientX - r.left) / r.width, 0, 1);
    videoSetVolume(pct);
  });

  // Close context menu and speed popup on outside click
  document.addEventListener('click', function(e) {
    closeCtx();
    closeCardCtx();
    if (!e.target.closest('#speedBadge') && !e.target.closest('.speed-popup')) {
      DOM.speedPopup.style.display = 'none';
    }
  });

  // Search input
  document.getElementById('searchInput').addEventListener('input', debounce(function(e) {
    ui.searchQuery = e.target.value.trim();
    renderSidebar();
  }, 200));

  // Beforeunload — save state
  window.addEventListener('beforeunload', onBeforeUnload);

  // Fullscreen change
  document.addEventListener('fullscreenchange', function() {
    if (!document.fullscreenElement) {
      DOM.app.classList.remove('fullscreen-mode');
    }
  });
}

function initVideo() {
  // Set initial video element state
  DOM.video.volume = playback.volume;
  DOM.video.muted = playback.muted;
  DOM.video.playbackRate = playback.playbackRate;
}

function onBeforeUnload() {
  // Save current video's playback position
  savePlaybackPosition();

  // Serialize all videos (including local ones) so that on reload
  // we can show them as "unavailable" with their metadata.
  const serializedVideos = playlist.map(function(v) {
    return {
      id: v.id,
      title: v.title,
      url: v.type === 'network' ? v.url : '', // don't save blob URLs
      type: v.type,
      duration: v.duration,
      progress: v.progress,
      favorite: false,
      thumbnail: v.thumbnail || '',
      lastPlayedAt: v.lastPlayedAt,
      addedAt: v.addedAt,
      lastPosition: v.lastPosition || 0,
      _filePath: v._filePath || null,  // Electron: persist absolute file path
      _fileName: v._fileName || null,
      _fileSize: v._fileSize || null,
      _fileLastModified: v._fileLastModified || null,
      _mseUnsupported: v._mseUnsupported === true
    };
  });
  const serializedFavorites = favorites.map(function(v) {
    return {
      id: v.id,
      title: v.title,
      url: v.type === 'network' ? v.url : '',
      type: v.type,
      duration: v.duration,
      progress: v.progress,
      favorite: true,
      thumbnail: v.thumbnail || '',
      lastPlayedAt: v.lastPlayedAt,
      addedAt: v.addedAt,
      lastPosition: v.lastPosition || 0,
      _filePath: v._filePath || null,
      _fileName: v._fileName || null,
      _fileSize: v._fileSize || null,
      _fileLastModified: v._fileLastModified || null,
      _mseUnsupported: v._mseUnsupported === true
    };
  });

  const data = {
    version: 2,
    volume: playback.volume,
    muted: playback.muted,
    playbackRate: playback.playbackRate,
    settings: {
      rotate: settings.rotate,
      flipH: settings.flipH,
      flipV: settings.flipV,
      scale: settings.scale,
      brightness: settings.brightness,
      contrast: settings.contrast,
      saturate: settings.saturate,
      hueRotate: settings.hueRotate,
      blur: settings.blur,
      subDelay: settings.subDelay || 0
    },
    videos: serializedVideos,
    favorites: serializedFavorites,
    currentVideoId: currentVideoId,
    favFilterActive: ui.favFilterActive,
    settingsTab: ui.settingsTab,
    lastPlayback: currentVideoId ? {
      videoId: currentVideoId,
      currentTime: playback.currentTime,
      playbackRate: playback.playbackRate
    } : null
  };
  storageSave(data);
}

/* ── Boot ── */

document.addEventListener('DOMContentLoaded', function() {
  initDOMCache();
  initState();
  initVideoEngine();
  initSeekbar();
  initKeyboard();
  initDragDrop();
  bindEvents();
  initVideo();
  initElectronIntegration();

  // Initial renders
  renderPlayBtn();
  renderVolumeUI();
  renderSpeedUI();
  renderSeekBar();
  renderTimeBadge();
  renderSidebar();
  renderFavBtns();
  renderSubtitle();
  applyVideoFilter();

  // Restore favorites filter button state
  if (ui.favFilterActive) {
    var btn = document.getElementById('favFilterBtn');
    if (btn) {
      btn.classList.add('active');
      btn.textContent = '★';
    }
  }

  // Show empty state
  DOM.emptyState.classList.remove('hidden');
  DOM.filmGrain.classList.remove('video-active');

  // Check mp4box.js CDN load status
  if (window._mp4boxLoadFailed) {
    console.warn('[Prism] mp4box.js CDN failed to load — MKV remux unavailable');
  }
});

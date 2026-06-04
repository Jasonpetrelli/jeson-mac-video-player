
/** Master render function — called after any state change */
function renderUI() {
  // Individual render functions are called directly by their triggers
  // This is a placeholder for batch rendering if needed
}

/** Update seekbar fill position */
function renderSeekBar() {
  if (playback.isSeekDragging) return;
  const pct = playback.duration > 0 ? (playback.currentTime / playback.duration) * 100 : 0;
  DOM.seekFill.style.width = pct + '%';
}

/** Update buffer bar */
function renderBufferBar() {
  if (playback.duration > 0) {
    const pct = (playback.bufferedEnd / playback.duration) * 100;
    DOM.seekBuf.style.width = pct + '%';
  }
}

/** Update time badge */
function renderTimeBadge() {
  DOM.currentTime.textContent = formatTime(playback.currentTime) + ' / ' + formatTime(playback.duration);
}

/** Update play button icon */
function renderPlayBtn() {
  if (playback.playing) {
    DOM.playIco.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
  } else {
    DOM.playIco.innerHTML = '<path d="M8 5v14l11-7z"/>';
  }
}

/** Update volume UI */
function renderVolumeUI() {
  const displayVol = playback.muted ? 0 : playback.volume;
  DOM.volFill.style.width = (displayVol * 100) + '%';

  // Update speaker icon
  if (playback.muted || playback.volume === 0) {
    DOM.volWave.setAttribute('d', 'M23 9l-4.5 4.5M18.5 9 23 13.5');
  } else if (playback.volume < 0.5) {
    DOM.volWave.setAttribute('d', 'M15.54 8.46a5 5 0 0 1 0 7.07');
  } else {
    DOM.volWave.setAttribute('d', 'M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14');
  }
}

/** Update speed UI */
function renderSpeedUI() {
  const rate = playback.playbackRate;
  // Display fine-grained speed (e.g. 1.3×) vs. whole number (1×)
  var display;
  if (rate === 1) {
    display = '1×';
  } else if (rate === Math.floor(rate)) {
    display = rate + '×';
  } else {
    display = rate.toFixed(1).replace(/\.0$/, '') + '×';
  }
  DOM.speedBadge.textContent = display;

  // Update speed popup active state
  document.querySelectorAll('.speed-opt').forEach(function(el) {
    el.classList.toggle('active', parseFloat(el.textContent) === rate);
  });
}

/** Render sidebar video list */
function renderSidebar() {
  const list = DOM.videoList;
  list.innerHTML = '';
  var sourceItems = ui.sidebarFilter === 'favorites' ? favorites : playlist;

  // ── Empty state ──
  if (sourceItems.length === 0) {
    list.innerHTML =
      '<div class="sb-empty">' +
        '<div class="sb-empty-icon">🎬</div>' +
        '<div class="sb-empty-text">' + (ui.sidebarFilter === 'favorites' ? '暂无收藏' : '暂无视频') + '</div>' +
        '<div class="sb-empty-hint">' + (ui.sidebarFilter === 'favorites' ? '收藏的视频会显示在这里' : '拖放文件到窗口，或点击 + 添加') + '</div>' +
        (ui.sidebarFilter === 'favorites' ? '' : '<button class="sb-empty-add" onclick="openAddVideoModal()">+ 添加视频</button>') +
      '</div>';
    return;
  }

  // Apply search filter
  let items = sourceItems.slice();
  let filteredIndices = []; // maps filtered index → playlist index
  if (ui.searchQuery) {
    const q = ui.searchQuery.toLowerCase();
    items = items.filter(function(v) { return v.title.toLowerCase().includes(q); });
    // Build filtered index map
    sourceItems.forEach(function(v, i) {
      if (v.title.toLowerCase().includes(ui.searchQuery.toLowerCase())) {
        filteredIndices.push(i);
      }
    });
  } else {
    for (let i = 0; i < sourceItems.length; i++) filteredIndices.push(i);
  }

  // Apply nav filter
  if (ui.sidebarFilter === 'recent') {
    items = items.filter(function(v) { return v.lastPlayedAt > 0; });
    items.sort(function(a, b) { return b.lastPlayedAt - a.lastPlayedAt; });
  }

  // ── No search results ──
  if (items.length === 0) {
    list.innerHTML =
      '<div class="sb-no-results">' +
        '<div class="sb-no-results-icon">🔍</div>' +
        '未找到匹配视频' +
      '</div>';
    return;
  }

  // Build a map from item.id → playlist index for reordering
  const idToPlaylistIdx = {};
  sourceItems.forEach(function(v, i) { idToPlaylistIdx[v.id] = i; });

  items.forEach(function(item, displayIdx) {
    const playlistIdx = idToPlaylistIdx[item.id] !== undefined ? idToPlaylistIdx[item.id] : displayIdx;
    const isActive = item.id === currentVideoId;
    const isUnavailable = item.unavailable === true;

    const card = document.createElement('div');
    card.className = 'video-card' +
      (isActive ? ' active' : '') +
      (isUnavailable ? ' unavailable' : '');
    card.setAttribute('data-id', item.id);
    card.setAttribute('data-idx', String(playlistIdx));
    card.setAttribute('draggable', ui.sidebarFilter === 'favorites' ? 'false' : 'true');
    card.style.position = 'relative';

    // Click to switch
    card.onclick = function(e) {
      if (e.target.closest('.card-ctx')) return;
      switchToVideo(item.id);
    };

    // Right-click context menu
    card.oncontextmenu = function(e) { showCardCtx(e, item.id); };

    // ── Drag-and-drop reorder ──
    card.addEventListener('dragstart', function(e) {
      if (ui.sidebarFilter === 'favorites') return;
      _dragSrcId = item.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.id);
    });
    card.addEventListener('dragend', function() {
      card.classList.remove('dragging');
      _dragSrcId = null;
      // Clean up all drag-over classes
      list.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(function(el) {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    });
    card.addEventListener('dragover', function(e) {
      if (ui.sidebarFilter === 'favorites') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (_dragSrcId === item.id) return;

      // Determine top/bottom half
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      if (e.clientY < midY) {
        card.classList.add('drag-over-top');
      } else {
        card.classList.add('drag-over-bottom');
      }
    });
    card.addEventListener('dragleave', function() {
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    card.addEventListener('drop', function(e) {
      if (ui.sidebarFilter === 'favorites') return;
      e.preventDefault();
      card.classList.remove('drag-over-top', 'drag-over-bottom');

      if (!_dragSrcId || _dragSrcId === item.id) return;

      const fromIdx = playlist.findIndex(function(v) { return v.id === _dragSrcId; });
      let toIdx = playlist.findIndex(function(v) { return v.id === item.id; });
      if (fromIdx < 0 || toIdx < 0) return;

      // If dropping on bottom half, insert after
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY >= midY && toIdx < playlist.length - 1) {
        toIdx = toIdx + 1;
      }
      // Adjust for removal
      if (fromIdx < toIdx) toIdx--;

      reorderPlaylist(fromIdx, toIdx);
    });

    // ── Build card HTML ──
    const sceneClasses = ['scene-1', 'scene-2', 'scene-3', 'scene-4'];
    const sceneIdx = playlistIdx % sceneClasses.length;

    const progressPct = item.duration > 0 ? Math.round(item.progress * 100) : 0;
    const progressLabel = progressPct > 0 ? (progressPct >= 100 ? '已看完' : progressPct + '%') : '未观看';
    const durationStr = item.duration > 0 ? formatTime(item.duration) : '--:--';
    const typeLabel = item.type === 'network' ? '网络' : '本地';

    // Truncate long titles in the middle
    const displayTitle = truncateMiddle(item.title, 36);

    card.innerHTML =
      '<div class="video-thumb ' + sceneClasses[sceneIdx] + '">' +
        (item.thumbnail ? '<img class="video-thumb-img" src="' + item.thumbnail + '" alt="">' : '') +
        '<span class="thumb-idx">' + (playlistIdx + 1) + '</span>' +
        '<div class="thumb-duration">' + durationStr + '</div>' +
        '<div class="thumb-progress" style="width:' + progressPct + '%"></div>' +
        (item.favorite ? '<div class="card-fav">★</div>' : '') +
        (isUnavailable ? '<div class="card-unavail-badge">需重新添加</div>' : '') +
      '</div>' +
      '<div class="video-meta">' +
        '<div class="video-title" title="' + escapeHtml(item.title) + '">' + escapeHtml(displayTitle) + '</div>' +
        '<div class="video-info-row">' +
          '<span>' + typeLabel + '</span>' +
          '<span>' + progressLabel + '</span>' +
        '</div>' +
      '</div>';

    list.appendChild(card);
  });
}

/** Escape HTML entities */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Update titlebar with current video title */
function updateTitlebar() {
  const item = playlist.find(function(v) { return v.id === currentVideoId; }) ||
    favorites.find(function(v) { return v.id === currentVideoId; });
  if (item) {
    DOM.titlebarTitle.textContent = 'Prism · ' + item.title;
  } else {
    DOM.titlebarTitle.textContent = 'Prism';
  }
}

/** Apply scene style (transform + filter) — unified as applyVideoFilter */
function applySceneStyle() {
  const video = DOM.video;
  if (!video) return;

  const scaleX = settings.flipH ? -1 : 1;
  const scaleY = settings.flipV ? -1 : 1;
  const s = settings.scale / 100;

  const transforms = [];
  if (settings.rotate !== 0) transforms.push('rotate(' + settings.rotate + 'deg)');
  transforms.push('scale(' + (scaleX * s) + ', ' + (scaleY * s) + ')');

  video.style.transform = transforms.join(' ');
  video.style.transition = 'transform 0.3s var(--ease-expo)';

  // Apply CSS filters: brightness, contrast, saturate, hue-rotate, blur
  const filters = [];
  if (settings.brightness !== 100) filters.push('brightness(' + (settings.brightness / 100) + ')');
  if (settings.contrast !== 100) filters.push('contrast(' + (settings.contrast / 100) + ')');
  if (settings.saturate !== 100) filters.push('saturate(' + (settings.saturate / 100) + ')');
  if (settings.hueRotate !== 0) filters.push('hue-rotate(' + settings.hueRotate + 'deg)');
  if (settings.blur > 0) filters.push('blur(' + (settings.blur / 10) + 'px)');

  video.style.filter = filters.length > 0 ? filters.join(' ') : '';
}

/** Alias — both names point to the same function */
var applyVideoFilter = applySceneStyle;

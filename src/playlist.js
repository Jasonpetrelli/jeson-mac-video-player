
// ── Drag-and-drop reorder state ──
let _dragSrcId = null;

function getLocalFilePath(file) {
  return (IS_ELECTRON && file.path) ? file.path : null;
}

function findLocalDuplicate(filePath, file) {
  for (var i = 0; i < playlist.length; i++) {
    var item = playlist[i];
    if (item.type !== 'local') continue;
    if (filePath && item._filePath === filePath) return item;
    if (!filePath && file && item._fileName === file.name && item._fileSize === file.size && item._fileLastModified === file.lastModified) {
      return item;
    }
  }
  return null;
}

/** Create a VideoItem from a local File object */
function addLocalFile(file) {
  var filePath = getLocalFilePath(file);
  var duplicate = findLocalDuplicate(filePath, file);
  if (duplicate) {
    duplicate.unavailable = false;
    if (filePath) duplicate._filePath = filePath;
    duplicate._fileRef = duplicate._needsMSE ? file : null;
    toast('已在队列中：' + duplicate.title);
    renderSidebar();
    return duplicate;
  }

  const url = URL.createObjectURL(file);
  var fileExt = file.name.split('.').pop().toLowerCase();
  var isMKV = (fileExt === 'mkv' || fileExt === 'webm');

  const item = {
    id: generateId(),
    title: file.name.replace(/\.[^.]+$/, ''),
    url: url,
    type: 'local',
    duration: 0,
    progress: 0,
    favorite: false,
    thumbnail: '',
    lastPlayedAt: Date.now(),
    addedAt: Date.now(),
    lastPosition: 0,
    unavailable: false,
    _blobUrl: url,
    _needsMSE: isMKV,
    _fileRef: isMKV ? file : null,
    _filePath: filePath,
    _fileName: file.name,
    _fileSize: file.size,
    _fileLastModified: file.lastModified
  };
  playlist.push(item);
  renderSidebar();
  return item;
}

/** Create a VideoItem from a network URL */
function addNetworkUrl(url, title) {
  const item = {
    id: generateId(),
    title: title || url.split('/').pop() || '网络视频',
    url: url,
    type: 'network',
    duration: 0,
    progress: 0,
    favorite: false,
    thumbnail: '',
    lastPlayedAt: Date.now(),
    addedAt: Date.now(),
    lastPosition: 0,
    unavailable: false,
    _blobUrl: null
  };
  playlist.push(item);
  renderSidebar();
  return item;
}

/** Remove a video by ID — cleans up blob URL and syncs localStorage */
function removeVideo(id) {
  const idx = playlist.findIndex(function(v) { return v.id === id; });
  if (idx < 0) return;

  const item = playlist[idx];

  // Revoke blob URL for local files
  if (item._blobUrl) {
    try { URL.revokeObjectURL(item._blobUrl); } catch (e) { /* ignore */ }
  }

  // If removing current video, stop playback
  if (currentVideoId === id) {
    destroyMSEPipeline();
    DOM.video.pause();
    DOM.video.removeAttribute('src');
    DOM.video.load();
    currentVideoId = '';
    ui.currentVideoId = '';
    playback.playing = false;
    playback.currentTime = 0;
    playback.duration = 0;
    playback.isMSEMode = false;
    DOM.mseBadge.classList.remove('visible');
    renderPlayBtn();
    renderSeekBar();
    renderTimeBadge();
    DOM.emptyState.classList.remove('hidden');
    DOM.filmGrain.classList.remove('video-active');
    updateTitlebar();
    renderFavBtns();
  }

  playlist.splice(idx, 1);
  renderSidebar();
  toast('🗑 已移除：' + item.title);
}

function clearPlaylist() {
  if (playlist.length === 0) return;
  if (!window.confirm('确定清空播放队列？')) return;

  for (var i = 0; i < playlist.length; i++) {
    if (playlist[i]._blobUrl) {
      try { URL.revokeObjectURL(playlist[i]._blobUrl); } catch (e) { /* ignore */ }
    }
  }

  destroyMSEPipeline();
  DOM.video.pause();
  DOM.video.removeAttribute('src');
  DOM.video.load();
  playlist = [];
  currentVideoId = '';
  ui.currentVideoId = '';
  playback.playing = false;
  playback.currentTime = 0;
  playback.duration = 0;
  playback.isMSEMode = false;
  DOM.mseBadge.classList.remove('visible');
  renderPlayBtn();
  renderSeekBar();
  renderTimeBadge();
  renderSidebar();
  DOM.emptyState.classList.remove('hidden');
  DOM.filmGrain.classList.remove('video-active');
  updateTitlebar();
  renderFavBtns();
  toast('播放队列已清空');
}

/** Switch to a video by ID */
function switchToVideo(id) {
  const item = playlist.find(function(v) { return v.id === id; });
  if (!item) return;

  // If item is unavailable (blob URL expired), notify user
  if (item.unavailable) {
    toast('⚠ 该视频需重新添加：' + truncateMiddle(item.title, 24));
    return;
  }

  // Save current video's position before switching
  if (currentVideoId) {
    savePlaybackPosition();
  }

  // Clean up any existing MSE pipeline
  destroyMSEPipeline();

  // Clear A-B loop state when switching videos
  abLoopA = null;
  abLoopB = null;

  currentVideoId = id;
  ui.currentVideoId = id;

  // Determine if this file needs MSE playback (MKV/WebM via demux)
  if (item._needsMSE && (item._fileRef || (IS_ELECTRON && item._filePath))) {
    // MSE path — load MKV via demux + fMP4 remux pipeline
    loadViaMSE(item);
    return;
  }

  // Native path — standard HTML5 video
  playback.isMSEMode = false;
  DOM.mseBadge.classList.remove('visible');

  // Set flag to prevent thumbnail generation from seeking during auto-play
  _pendingAutoPlay = true;

  // In Electron, if we have a _filePath but no valid URL, reconstruct it
  if (IS_ELECTRON && item._filePath && (!item.url || item.unavailable)) {
    item.url = 'file://' + item._filePath;
    item.unavailable = false;
  }

  DOM.video.src = item.url;
  DOM.video.load();

  // Try to seek to last position — prompt user via toast
  var seekTarget = null;
  if (item.lastPosition && item.lastPosition > 2 && item.duration > 0) {
    seekTarget = item.lastPosition;
    // Show resume toast with clickable action
    var seekId = id; // capture in closure
    setTimeout(function() {
      toast('⏩ 从上次位置继续？' + formatTime(seekTarget), 4000, function() {
        var it = playlist.find(function(v) { return v.id === seekId; });
        if (it && it.lastPosition) {
          DOM.video.currentTime = it.lastPosition;
        }
      });
    }, 300);
  } else if (item.progress > 0 && item.duration > 0) {
    // Fallback to progress percentage
    seekTarget = item.progress * item.duration;
    if (seekTarget > 2) {
      DOM.video.addEventListener('loadedmetadata', function onMeta() {
        DOM.video.currentTime = seekTarget;
        DOM.video.removeEventListener('loadedmetadata', onMeta);
      });
    }
  }

  // Update last played
  item.lastPlayedAt = Date.now();

  // Update UI
  updateTitlebar();
  renderSidebar();
  renderFavBtns();

  // Auto play
  videoPlay();
}

/** Update a video item's duration after metadata loads */
function updateVideoDuration(id, duration) {
  const item = playlist.find(function(v) { return v.id === id; });
  if (item && duration > 0 && item.duration !== duration) {
    item.duration = duration;
    renderSidebar();
  }
}

/** Update a video item's progress (0-1) */
function updateVideoProgress(id, currentTime, duration) {
  const item = playlist.find(function(v) { return v.id === id; });
  if (item && duration > 0) {
    item.progress = clamp(currentTime / duration, 0, 1);
  }
}

/** Toggle favorite for a video by ID */
function toggleFavoriteById(id) {
  const item = playlist.find(function(v) { return v.id === id; });
  if (!item) return;
  item.favorite = !item.favorite;
  renderSidebar();
  renderFavBtns();
}

/** Navigate to next video */
function nextVideo() {
  if (playlist.length === 0) return;
  const curIdx = playlist.findIndex(function(item) { return item.id === currentVideoId; });
  const nextIdx = (curIdx + 1) % playlist.length;
  switchToVideo(playlist[nextIdx].id);
  toast('▶ ' + playlist[nextIdx].title);
}

/** Navigate to previous video */
function prevVideo() {
  if (playlist.length === 0) return;
  const curIdx = playlist.findIndex(function(item) { return item.id === currentVideoId; });
  const prevIdx = (curIdx - 1 + playlist.length) % playlist.length;
  switchToVideo(playlist[prevIdx].id);
  toast('▶ ' + playlist[prevIdx].title);
}

/** Reorder playlist by moving an item from one index to another */
function reorderPlaylist(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const item = playlist.splice(fromIdx, 1)[0];
  playlist.splice(toIdx, 0, item);
  renderSidebar();
}

/* ── Card Context Menu ── */

let _cardCtxTargetId = null;

/** Show card context menu on right-click */
function showCardCtx(e, id) {
  e.preventDefault();
  e.stopPropagation();
  _cardCtxTargetId = id;

  const m = DOM.cardCtxMenu;
  m.style.display = 'block';

  // Position
  let x = e.clientX, y = e.clientY;
  if (x + 200 > window.innerWidth) x = window.innerWidth - 210;
  if (y + 180 > window.innerHeight) y = window.innerHeight - 190;
  m.style.left = x + 'px';
  m.style.top  = y + 'px';
}

function closeCardCtx() {
  DOM.cardCtxMenu.style.display = 'none';
  _cardCtxTargetId = null;
}

function cardCtxPlay() {
  if (_cardCtxTargetId) switchToVideo(_cardCtxTargetId);
  closeCardCtx();
}

function cardCtxFav() {
  if (_cardCtxTargetId) toggleFavoriteById(_cardCtxTargetId);
  closeCardCtx();
}

function cardCtxReveal() {
  const item = playlist.find(function(v) { return v.id === _cardCtxTargetId; });
  if (!item) { closeCardCtx(); return; }

  // Electron: show file in Finder using native shell API
  if (IS_ELECTRON && item._filePath) {
    window.electronAPI.showInFolder(item._filePath);
    closeCardCtx();
    return;
  }

  // Fallback: show path info in toast
  if (item.type === 'local') {
    toast('📂 文件路径：' + (item._filePath || item.title));
  } else if (item.type === 'network') {
    toast('🌐 网络地址：' + item.url);
  }
  closeCardCtx();
}

function cardCtxRemove() {
  if (_cardCtxTargetId) removeVideo(_cardCtxTargetId);
  closeCardCtx();
}

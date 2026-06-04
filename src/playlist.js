
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

function getLocalFileURL(filePath) {
  if (!filePath) return '';
  return 'file://' + filePath.split('/').map(function(part) {
    return encodeURIComponent(part);
  }).join('/');
}

function getVideoKey(item) {
  if (!item) return '';
  return item._filePath || item.url || item.id;
}

function findFavoriteByItem(item) {
  var key = getVideoKey(item);
  return favorites.find(function(v) { return getVideoKey(v) === key; }) || null;
}

function isFavoriteItem(item) {
  return !!findFavoriteByItem(item);
}

function cloneVideoForFavorite(item) {
  var copy = Object.assign({}, item);
  copy.favorite = true;
  copy._blobUrl = null;
  copy._fileRef = null;
  return copy;
}

function ensurePlaylistItemFromFavorite(item) {
  var key = getVideoKey(item);
  var existing = playlist.find(function(v) { return getVideoKey(v) === key; });
  if (existing) {
    existing.favorite = true;
    existing.duration = item.duration || existing.duration;
    existing.progress = item.progress || existing.progress;
    existing.lastPosition = item.lastPosition || existing.lastPosition;
    existing.lastPlayedAt = item.lastPlayedAt || existing.lastPlayedAt;
    return existing;
  }

  var copy = Object.assign({}, item);
  copy.id = generateId();
  copy.favorite = true;
  copy._blobUrl = null;
  copy._fileRef = null;
  playlist.push(copy);
  return copy;
}

/** Create a VideoItem from a local File object */
function addLocalFile(file) {
  var filePath = getLocalFilePath(file);
  var duplicate = findLocalDuplicate(filePath, file);
  if (duplicate) {
    duplicate.unavailable = false;
    if (filePath) duplicate._filePath = filePath;
    duplicate._fileRef = duplicate._needsMSE ? file : null;
    duplicate.favorite = isFavoriteItem(duplicate);
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
    _fileLastModified: file.lastModified,
    _mseUnsupported: false
  };
  item.favorite = isFavoriteItem(item);
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
  item.favorite = isFavoriteItem(item);
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
  if (!window.confirm('确定清空播放队列？收藏不会受影响。')) return;

  for (var i = 0; i < playlist.length; i++) {
    if (playlist[i]._blobUrl) {
      try { URL.revokeObjectURL(playlist[i]._blobUrl); } catch (e) { /* ignore */ }
    }
  }

  var removedCurrent = currentVideoId && playlist.some(function(v) { return v.id === currentVideoId; });
  playlist = [];

  if (removedCurrent) {
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
  }

  renderSidebar();
  updateTitlebar();
  renderFavBtns();
  toast('播放队列已清空');
}

function getVideoResumeTime(item) {
  if (!item) return null;
  if (item.lastPosition && item.lastPosition > 2) {
    return item.lastPosition;
  }
  if (item.progress > 0 && item.duration > 0) {
    return item.progress * item.duration;
  }
  return null;
}

function restoreVideoPositionWhenReady(item) {
  var seekTarget = getVideoResumeTime(item);
  if (!seekTarget || seekTarget <= 2) return;

  DOM.video.addEventListener('loadedmetadata', function onMeta() {
    DOM.video.currentTime = seekTarget;
    DOM.video.removeEventListener('loadedmetadata', onMeta);
  });
}

/** Switch to a video by ID */
function switchToVideo(id) {
  var item = playlist.find(function(v) { return v.id === id; });
  if (!item) {
    var favoriteItem = favorites.find(function(v) { return v.id === id; });
    if (favoriteItem) {
      item = ensurePlaylistItemFromFavorite(favoriteItem);
    }
  }
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
  if (IS_ELECTRON && item._filePath) {
    item.url = getLocalFileURL(item._filePath);
    item.unavailable = !item.url;
  }

  if (!item.url) {
    toast('⚠ 无法读取文件路径：' + truncateMiddle(item.title, 24));
    _pendingAutoPlay = false;
    return;
  }

  DOM.video.src = item.url;
  DOM.video.load();

  // Restore last playback position automatically
  restoreVideoPositionWhenReady(item);

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
  const item = playlist.find(function(v) { return v.id === id; }) ||
    favorites.find(function(v) { return v.id === id; });
  if (item && duration > 0 && item.duration !== duration) {
    item.duration = duration;
    var fav = findFavoriteByItem(item);
    if (fav && fav !== item) fav.duration = duration;
    renderSidebar();
  }
}

/** Update a video item's progress (0-1) */
function updateVideoProgress(id, currentTime, duration) {
  const item = playlist.find(function(v) { return v.id === id; }) ||
    favorites.find(function(v) { return v.id === id; });
  if (item && duration > 0) {
    item.progress = clamp(currentTime / duration, 0, 1);
    var fav = findFavoriteByItem(item);
    if (fav && fav !== item) fav.progress = item.progress;
  }
}

/** Toggle favorite for a video by ID */
function toggleFavoriteById(id) {
  const item = playlist.find(function(v) { return v.id === id; }) ||
    favorites.find(function(v) { return v.id === id; });
  if (!item) return;
  var fav = findFavoriteByItem(item);
  if (fav) {
    favorites = favorites.filter(function(v) { return getVideoKey(v) !== getVideoKey(item); });
    item.favorite = false;
  } else {
    item.favorite = true;
    favorites.push(cloneVideoForFavorite(item));
  }

  for (var i = 0; i < playlist.length; i++) {
    if (getVideoKey(playlist[i]) === getVideoKey(item)) {
      playlist[i].favorite = item.favorite;
    }
  }
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
  if (_cardCtxTargetId) {
    if (ui.sidebarFilter === 'favorites') {
      toggleFavoriteById(_cardCtxTargetId);
      toast('♡ 已取消收藏');
    } else {
      removeVideo(_cardCtxTargetId);
    }
  }
  closeCardCtx();
}


/* ── Play/Pause ── */

function togglePlay() {
  if (!DOM.video.src && !DOM.video.currentSrc) {
    toast('请先添加视频');
    return;
  }

  var willPlay = !playback.playing;
  if (playback.playing) {
    videoPause();
  } else {
    videoPlay();
  }

  // Show play overlay ring
  DOM.playRing.textContent = willPlay ? '▶' : '⏸';
  DOM.playOverlay.classList.add('show');
  setTimeout(function() { DOM.playOverlay.classList.remove('show'); }, 700);

  showKbd(willPlay ? '▶' : '⏸');
}

/** Click on video frame (250ms delay for double-click prevention) */
let clickTimer = null;
function onStageClick(e) {
  if (e.target.closest('.right-panel') || e.target.closest('.controls-overlay') ||
      e.target.closest('.speed-popup') || e.target.closest('.empty-state')) return;
  if (clickTimer) {
    // Second click came too fast — this is a double-click, swallow
    clearTimeout(clickTimer);
    clickTimer = null;
    return;
  }
  clickTimer = setTimeout(function() {
    clickTimer = null;
    togglePlay();
  }, 250);
}

/** Double click on video frame → toggle fullscreen */
function onStageDblClick(e) {
  if (e.target.closest('.right-panel') || e.target.closest('.controls-overlay') ||
      e.target.closest('.speed-popup')) return;
  toggleFull();
}

/* ── Skip forward/backward ── */

function skip(delta) {
  if (playback.duration <= 0) return;
  const newTime = clamp(playback.currentTime + delta, 0, playback.duration);
  videoSeek(newTime);
  showKbd(delta > 0 ? ('+' + delta + 's') : (delta + 's'));
}

/* ── Volume ── */

function toggleMute() {
  videoSetMuted(!playback.muted);
  if (playback.muted) {
    toast('🔇 已静音');
  } else {
    toast('🔊 取消静音');
  }
  showKbd(playback.muted ? '🔇 已静音' : '🔊 ' + Math.round(playback.volume * 100) + '%');
}

function setVol(e) {
  const s = DOM.volSlider;
  const r = s.getBoundingClientRect();
  const pct = clamp((e.clientX - r.left) / r.width, 0, 1);
  videoSetVolume(pct);
  e.stopPropagation();
}

/* ── Speed ── */

function toggleSpeedPop(e) {
  DOM.speedPopup.style.display = DOM.speedPopup.style.display === 'block' ? 'none' : 'block';
  if (e) e.stopPropagation();
}

function setSpeed(s) {
  videoSetRate(s);
  renderSpeedUI();
  DOM.speedPopup.style.display = 'none';
  toast('⏩ 播放速度 ' + s + '×');
}

/* ── Panel ── */

function togglePanel() {
  ui.rightPanelOpen = !ui.rightPanelOpen;
  DOM.rightPanel.classList.toggle('open', ui.rightPanelOpen);
  DOM.panelBtn.classList.toggle('active', ui.rightPanelOpen);
}

function switchTab(el, panel) {
  document.querySelectorAll('.rp-tab').forEach(function(t) { t.classList.remove('active'); });
  el.classList.add('active');
  document.getElementById('panelHistory').style.display = panel === 'history' ? '' : 'none';
  document.getElementById('panelSubs').style.display    = panel === 'subs'     ? '' : 'none';
  document.getElementById('panelInfo').style.display    = panel === 'info'    ? '' : 'none';
  ui.rightPanelTab = panel;
  if (panel === 'info') updateRightPanelInfo();
}

/* ── Full screen ── */

function toggleFull() {
  if (IS_ELECTRON) {
    // Electron: use native macOS fullscreen toggle
    window.electronAPI.toggleFullscreen();
    return;
  }
  // Browser fallback
  if (document.fullscreenElement) {
    document.exitFullscreen();
    DOM.app.classList.remove('fullscreen-mode');
  } else {
    document.documentElement.requestFullscreen().catch(function() {
      toast('↕ 无法进入全屏');
    });
    DOM.app.classList.add('fullscreen-mode');
  }
}

// Listen for fullscreen change to sync sidebar visibility
document.addEventListener('fullscreenchange', function() {
  if (document.fullscreenElement) {
    DOM.app.classList.add('fullscreen-mode');
  } else {
    DOM.app.classList.remove('fullscreen-mode');
  }
});

/* ── Favorites ── */

function toggleFav() {
  const item = playlist.find(function(v) { return v.id === currentVideoId; }) ||
    favorites.find(function(v) { return v.id === currentVideoId; });
  if (!item) {
    toast('请先选择视频');
    return;
  }
  var wasFav = isFavoriteItem(item);
  toggleFavoriteById(currentVideoId);
  toast(!wasFav ? '★ 已收藏：' + item.title : '♡ 已取消收藏');
  showKbd(!wasFav ? '★ 已收藏' : '☆ 取消收藏');
}

/* ── Sidebar nav ── */

function setNav(el) {
  document.querySelectorAll('.nav-item').forEach(function(i) { i.classList.remove('active'); });
  el.classList.add('active');

  // Determine filter from the clicked nav item
  const text = el.textContent.trim();
  if (text.includes('全部')) ui.sidebarFilter = 'all';
  else if (text.includes('最近')) ui.sidebarFilter = 'recent';
  else if (text.includes('收藏')) ui.sidebarFilter = 'favorites';
  ui.favFilterActive = ui.sidebarFilter === 'favorites';
  var favFilterBtn = document.getElementById('favFilterBtn');
  if (favFilterBtn) {
    favFilterBtn.classList.toggle('active', ui.favFilterActive);
    favFilterBtn.textContent = ui.favFilterActive ? '★' : '☆';
  }

  renderSidebar();
}

function toggleCtrl(btn, label) {
  btn.classList.toggle('active');
  toast((btn.classList.contains('active') ? '✓ ' : '✗ ') + label);
}

/* ── Kbd hint ── */

let kbdTimer;
function showKbd(text) {
  const el = DOM.kbdHint;
  el.textContent = text;
  el.classList.remove('fading');
  el.classList.add('show');
  clearTimeout(kbdTimer);
  kbdTimer = setTimeout(function() {
    el.classList.remove('show');
    el.classList.add('fading');
  }, 600);
}

/* ── Toast ── */

let toastTimer;
function toast(msg, duration, actionFn) {
  clearTimeout(toastTimer);
  const el = DOM.toastEl;

  // Build toast content with optional action button
  if (actionFn) {
    el.innerHTML = '<span>' + escapeHtml(msg) + '</span> <span class="toast-action" id="toastAction">跳转</span>';
    var actionEl = document.getElementById('toastAction');
    if (actionEl) {
      actionEl.onclick = function(e) {
        e.stopPropagation();
        actionFn();
        el.classList.remove('show');
      };
    }
  } else {
    el.innerHTML = escapeHtml(msg);
  }

  el.classList.add('show');
  toastTimer = setTimeout(function() { el.classList.remove('show'); }, duration || 1800);
}

/* ── Context Menu ── */

function showCtx(e) {
  e.preventDefault();
  const m = document.getElementById('ctxMenu');
  m.style.display = 'block';
  let x = e.clientX, y = e.clientY;
  if (x + 220 > window.innerWidth) x = window.innerWidth - 230;
  if (y + 280 > window.innerHeight) y = window.innerHeight - 290;
  m.style.left = x + 'px';
  m.style.top  = y + 'px';
}

function closeCtx() {
  document.getElementById('ctxMenu').style.display = 'none';
}

/* ── Settings Modal ── */

function openSettings() {
  ui.settingsOpen = true;
  document.getElementById('settingsOverlay').classList.add('open');
  syncSettingsToModal();
}

function closeSettings() {
  ui.settingsOpen = false;
  document.getElementById('settingsOverlay').classList.remove('open');
}

/** Switch settings tab */
function switchSettingsTab(tabEl, tabName) {
  document.querySelectorAll('.settings-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.settings-tab-content').forEach(function(c) { c.classList.remove('active'); });
  tabEl.classList.add('active');
  var tabMap = { playback: 'settingsTabPlayback', display: 'settingsTabDisplay', about: 'settingsTabAbout' };
  var panel = document.getElementById(tabMap[tabName]);
  if (panel) panel.classList.add('active');
  ui.settingsTab = tabName;
}

function syncSettingsToModal() {
  document.getElementById('volRange').value = Math.round(playback.volume * 100);
  document.getElementById('volVal').textContent = Math.round(playback.volume * 100) + '%';
  document.getElementById('muteToggle').classList.toggle('on', playback.muted);
  document.getElementById('speedRange').value = Math.round(playback.playbackRate * 100);
  document.getElementById('speedVal').textContent = playback.playbackRate + 'x';
  document.getElementById('scaleRange').value = settings.scale;
  document.getElementById('scaleVal').textContent = settings.scale + '%';
  document.getElementById('brightnessRange').value = settings.brightness;
  document.getElementById('brightnessVal').textContent = settings.brightness + '%';
  document.getElementById('contrastRange').value = settings.contrast;
  document.getElementById('contrastVal').textContent = settings.contrast + '%';
  document.getElementById('saturateRange').value = settings.saturate;
  document.getElementById('saturateVal').textContent = settings.saturate + '%';
  document.getElementById('hueRotateRange').value = settings.hueRotate;
  document.getElementById('hueRotateVal').textContent = settings.hueRotate + '°';
  document.getElementById('blurRange').value = settings.blur;
  document.getElementById('blurVal').textContent = (settings.blur / 10).toFixed(1) + 'px';

  // Restore active tab
  document.querySelectorAll('.settings-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.settings-tab-content').forEach(function(c) { c.classList.remove('active'); });
  var tabMap = { playback: 'settingsTabPlayback', display: 'settingsTabDisplay', about: 'settingsTabAbout' };
  var tabIdxMap = { playback: 0, display: 1, about: 2 };
  var tabs = document.querySelectorAll('.settings-tab');
  var panel = document.getElementById(tabMap[ui.settingsTab]);
  if (tabs[tabIdxMap[ui.settingsTab]]) tabs[tabIdxMap[ui.settingsTab]].classList.add('active');
  if (panel) panel.classList.add('active');

  // Sync subtitle delay
  var subDelayEl = document.getElementById('subDelayRange');
  if (subDelayEl) {
    subDelayEl.value = (settings.subDelay || 0);
    document.getElementById('subDelayVal').textContent = (settings.subDelay || 0) + 'ms';
  }
}

function setRotate(deg) {
  settings.rotate = deg;
  document.querySelectorAll('.rotate-btn').forEach(function(b) { b.classList.remove('active'); });
  var btn = document.getElementById('rotate' + deg);
  if (btn) btn.classList.add('active');
  applyVideoFilter();
  showKbd(deg === 0 ? '0°' : deg + '°');
}

function toggleFlip(axis) {
  if (axis === 'h') {
    settings.flipH = !settings.flipH;
    document.getElementById('flipHBtn').classList.toggle('active', settings.flipH);
  }
  if (axis === 'v') {
    settings.flipV = !settings.flipV;
    document.getElementById('flipVBtn').classList.toggle('active', settings.flipV);
  }
  applyVideoFilter();
}

function setScale(val) {
  settings.scale = parseInt(val);
  document.getElementById('scaleVal').textContent = settings.scale + '%';
  applyVideoFilter();
}

function setFilter() {
  settings.brightness = parseInt(document.getElementById('brightnessRange').value);
  settings.contrast    = parseInt(document.getElementById('contrastRange').value);
  settings.saturate    = parseInt(document.getElementById('saturateRange').value);
  settings.hueRotate   = parseInt(document.getElementById('hueRotateRange').value);
  settings.blur         = parseInt(document.getElementById('blurRange').value);
  document.getElementById('brightnessVal').textContent = settings.brightness + '%';
  document.getElementById('contrastVal').textContent   = settings.contrast + '%';
  document.getElementById('saturateVal').textContent    = settings.saturate + '%';
  document.getElementById('hueRotateVal').textContent   = settings.hueRotate + '°';
  document.getElementById('blurVal').textContent        = (settings.blur / 10).toFixed(1) + 'px';
  applyVideoFilter();
}

/** Reset all video filters to defaults */
function resetVideoFilters() {
  settings.brightness = 100;
  settings.contrast = 100;
  settings.saturate = 100;
  settings.hueRotate = 0;
  settings.blur = 0;
  settings.rotate = 0;
  settings.flipH = false;
  settings.flipV = false;
  settings.scale = 100;

  // Reset rotate buttons
  document.querySelectorAll('.rotate-btn').forEach(function(b) { b.classList.remove('active'); });
  document.getElementById('rotate0').classList.add('active');

  // Reset flip buttons
  document.getElementById('flipHBtn').classList.remove('active');
  document.getElementById('flipVBtn').classList.remove('active');

  // Sync sliders
  syncSettingsToModal();
  applyVideoFilter();
  toast('↺ 画面已重置');
}

/** Adjust brightness by a delta (e.g. +10 or -10) */
function adjustBrightness(delta) {
  settings.brightness = clamp(settings.brightness + delta, 50, 150);
  applyVideoFilter();
  showKbd('☀️ ' + settings.brightness + '%');
  // Sync slider if settings modal is open
  if (ui.settingsOpen) {
    document.getElementById('brightnessRange').value = settings.brightness;
    document.getElementById('brightnessVal').textContent = settings.brightness + '%';
  }
}

function setVolSlider(val) {
  const pct = parseInt(val);
  videoSetVolume(pct / 100);
  document.getElementById('volVal').textContent = pct + '%';
}

function setSpeedSlider(val) {
  const speed = parseFloat((parseInt(val) / 100).toFixed(2));
  videoSetRate(speed);
  const display = speed.toFixed(2).replace(/\.?0+$/, '') + 'x';
  document.getElementById('speedVal').textContent = display;
  DOM.speedBadge.textContent = display;
}

function toggleMuteSetting() {
  const btn = document.getElementById('muteToggle');
  videoSetMuted(!playback.muted);
  btn.classList.toggle('on', playback.muted);
  showKbd(playback.muted ? '🔇 已静音' : '🔊 ' + Math.round(playback.volume * 100) + '%');
}

/** Set subtitle delay from settings slider */
function setSubDelay(val) {
  settings.subDelay = parseInt(val);
  document.getElementById('subDelayVal').textContent = settings.subDelay + 'ms';
}

/** Toggle favorites-only filter in sidebar */
function toggleFavFilter() {
  ui.favFilterActive = !ui.favFilterActive;
  var btn = document.getElementById('favFilterBtn');
  btn.classList.toggle('active', ui.favFilterActive);
  btn.textContent = ui.favFilterActive ? '★' : '☆';

  // If fav filter is active, also set sidebarFilter to favorites
  if (ui.favFilterActive) {
    ui.sidebarFilter = 'favorites';
    // Highlight the nav item too
    document.querySelectorAll('.nav-item').forEach(function(i) { i.classList.remove('active'); });
    document.querySelectorAll('.nav-item').forEach(function(i) {
      if (i.textContent.trim().includes('收藏')) i.classList.add('active');
    });
  } else {
    ui.sidebarFilter = 'all';
    document.querySelectorAll('.nav-item').forEach(function(i) { i.classList.remove('active'); });
    document.querySelectorAll('.nav-item').forEach(function(i) {
      if (i.textContent.trim().includes('全部')) i.classList.add('active');
    });
  }

  renderSidebar();
}


/* ── Picture-in-Picture ── */

function togglePiP() {
  var video = DOM.video;
  if (!video.src && !video.currentSrc) {
    toast('请先添加视频');
    return;
  }
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().then(function() {
      showMainWindowAfterPiP();
      showKbd('⧉ 退出画中画');
      toast('⧉ 已退出画中画');
    }).catch(function() {
      toast('⧉ 退出画中画失败');
    });
  } else {
    video.requestPictureInPicture().then(function() {
      hideMainWindowForPiP();
      showKbd('⧉ 画中画');
      toast('⧉ 画中画模式');
    }).catch(function() {
      toast('⧉ 画中画不可用');
    });
  }
}

function hideMainWindowForPiP() {
  if (IS_ELECTRON && window.electronAPI && window.electronAPI.hide) {
    window.electronAPI.hide();
  }
}

function showMainWindowAfterPiP() {
  if (IS_ELECTRON && window.electronAPI && window.electronAPI.show) {
    window.electronAPI.show();
  }
}

document.addEventListener('leavepictureinpicture', function() {
  showMainWindowAfterPiP();
});

/* ── A-B Loop ── */

/** @type {number|null} A point in seconds, null if not set */
let abLoopA = null;
/** @type {number|null} B point in seconds, null if not set */
let abLoopB = null;

/** Set A or B point for A-B loop */
function setABPoint(point) {
  if (playback.duration <= 0) {
    toast('请先播放视频');
    return;
  }
  var t = playback.currentTime;

  if (point === 'a') {
    if (abLoopA !== null && abLoopB === null) {
      // Pressed [ again with only A set → clear both
      abLoopA = null;
      abLoopB = null;
      renderABMarkers();
      showKbd('A-B 循环已清除');
      return;
    }
    abLoopA = t;
    abLoopB = null; // Reset B when setting new A
    renderABMarkers();
    showKbd('A-B 循环: ' + formatTime(abLoopA) + ' - …');
  } else if (point === 'b') {
    if (abLoopA === null) {
      toast('请先按 [ 设置 A 点');
      return;
    }
    if (t <= abLoopA) {
      toast('B 点必须在 A 点之后');
      return;
    }
    if (abLoopB !== null && Math.abs(abLoopB - t) < 0.5) {
      // Pressed ] again near B → clear loop
      abLoopA = null;
      abLoopB = null;
      renderABMarkers();
      showKbd('A-B 循环已清除');
      return;
    }
    abLoopB = t;
    renderABMarkers();
    showKbd('A-B 循环: ' + formatTime(abLoopA) + ' - ' + formatTime(abLoopB));
    toast('🔁 A-B 循环: ' + formatTime(abLoopA) + ' → ' + formatTime(abLoopB));
  }
}

/** Check A-B loop during playback (called from timeupdate handler) */
function checkABLoop() {
  if (abLoopA === null || abLoopB === null) return;
  if (playback.currentTime >= abLoopB || playback.currentTime < abLoopA) {
    videoSeek(abLoopA);
  }
}

/** Render A-B loop visual markers on the seekbar */
function renderABMarkers() {
  var markerA = DOM.abMarkerA;
  var markerB = DOM.abMarkerB;
  var rangeFill = DOM.abRangeFill;

  if (abLoopA === null || abLoopB === null || playback.duration <= 0) {
    markerA.style.display = 'none';
    markerB.style.display = 'none';
    rangeFill.style.display = 'none';
    return;
  }

  var pctA = (abLoopA / playback.duration) * 100;
  var pctB = (abLoopB / playback.duration) * 100;

  markerA.style.display = 'block';
  markerA.style.left = pctA + '%';
  markerB.style.display = 'block';
  markerB.style.left = pctB + '%';
  rangeFill.style.display = 'block';
  rangeFill.style.left = pctA + '%';
  rangeFill.style.width = (pctB - pctA) + '%';
}

/* ── Screenshot ── */

/** Take a screenshot of the current video frame */
function takeScreenshot() {
  var video = DOM.video;
  if (!video.src && !video.currentSrc) {
    toast('请先播放视频');
    return;
  }
  if (video.readyState < 2) {
    toast('视频尚未就绪');
    return;
  }

  // Create offscreen canvas
  var canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1920;
  canvas.height = video.videoHeight || 1080;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Play flash animation
  var flash = DOM.screenshotFlash;
  flash.className = '';
  flash.style.display = 'block';
  // Force reflow
  void flash.offsetWidth;
  flash.className = 'screenshot-flash';
  setTimeout(function() { flash.style.display = 'none'; }, 350);

  // Generate filename
  var now = new Date();
  var dateStr = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  var filename = 'Prism_截图_' + dateStr + '.png';

  // Download via blob
  canvas.toBlob(function(blob) {
    if (!blob) {
      toast('⚠ 截图失败');
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    showKbd('📸 截图已保存');
    toast('📸 截图已保存: ' + filename);
  }, 'image/png');
}

/* ── Playback Speed Fine-tuning ── */

/** Adjust playback speed by delta (e.g. +0.1 or -0.1) */
function adjustSpeed(delta) {
  var newRate = Math.round((playback.playbackRate + delta) * 10) / 10;
  newRate = clamp(newRate, 0.1, 5.0);
  videoSetRate(newRate);
  renderSpeedUI();
  showKbd('⏩ ' + newRate.toFixed(1) + '×');

  // Sync speed slider in settings modal if open
  if (ui.settingsOpen) {
    document.getElementById('speedRange').value = Math.round(newRate * 100);
    document.getElementById('speedVal').textContent = newRate.toFixed(1).replace(/\.0$/, '') + 'x';
  }
}

/** Reset playback speed to 1× */
function resetSpeed() {
  videoSetRate(1.0);
  renderSpeedUI();
  showKbd('⏩ 1×');
  if (ui.settingsOpen) {
    document.getElementById('speedRange').value = 100;
    document.getElementById('speedVal').textContent = '1.0x';
  }
}

/* ── Video Info Panel ── */

let videoInfoTimer = null;

/** Show video info panel for 3 seconds */
function showVideoInfoPanel() {
  var panel = DOM.videoInfoPanel;
  var video = DOM.video;
  var titleEl = document.getElementById('vinfoTitle');
  var bodyEl = document.getElementById('vinfoBody');

  // Get current video item
  var item = playlist.find(function(v) { return v.id === currentVideoId; });
  var title = item ? item.title : (video.src || video.currentSrc || '未知');

  titleEl.textContent = truncateMiddle(title, 40);

  // Build info rows
  var rows = [];
  rows.push(['分辨率', (video.videoWidth || '?') + ' × ' + (video.videoHeight || '?')]);
  rows.push(['时长', formatTime(playback.duration)]);
  rows.push(['播放进度', playback.duration > 0 ? (playback.currentTime / playback.duration * 100).toFixed(1) + '%' : '0%']);
  rows.push(['播放速度', playback.playbackRate.toFixed(1).replace(/\.0$/, '') + '×']);
  rows.push(['音量', Math.round(playback.volume * 100) + '%' + (playback.muted ? ' (静音)' : '')]);

  // MSE mode indicator
  if (playback.isMSEMode) {
    rows.push(['模式', '<span class="info-mse">MSE</span>']);
  }

  // File size (if available from video item)
  if (item && item.fileSize) {
    var sizeMB = (item.fileSize / (1024 * 1024)).toFixed(1);
    rows.push(['文件大小', sizeMB + ' MB']);
  }

  var html = '';
  rows.forEach(function(row) {
    html += '<div class="info-row"><span class="info-key">' + row[0] + '</span><span class="info-val">' + row[1] + '</span></div>';
  });
  bodyEl.innerHTML = html;

  panel.classList.add('show');

  // Auto-dismiss after 3 seconds
  clearTimeout(videoInfoTimer);
  videoInfoTimer = setTimeout(function() {
    panel.classList.remove('show');
  }, 3000);
}

/** Hide video info panel (called on any key press) */
function hideVideoInfoPanel() {
  clearTimeout(videoInfoTimer);
  DOM.videoInfoPanel.classList.remove('show');
}

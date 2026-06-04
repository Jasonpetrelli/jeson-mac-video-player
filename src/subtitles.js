
/** @type {boolean} Whether subtitles are enabled */
let subOn = false;

/** @type {Array} Parsed subtitle entries: {id, start, end, text} */
let subtitleTracks = [];

/** @type {string} Current subtitle size: 'small' | 'medium' | 'large' */
let subSize = 'medium';

/** Toggle subtitle on/off */
function subToggle() {
  if (subtitleTracks.length === 0 && !subOn) {
    // No subtitles loaded — open file picker
    DOM.subFileInput.click();
    return;
  }
  subOn = !subOn;
  if (!subOn) {
    DOM.subtitleText.textContent = '';
    DOM.subtitleBar.style.opacity = '0';
  }
  DOM.subBtn.classList.toggle('active', subOn);
  var toggleEl = document.getElementById('subToggle');
  if (toggleEl) toggleEl.classList.toggle('on', subOn);
  toast(subOn ? '💬 字幕已开启' : '字幕已关闭');
  showKbd(subOn ? '💬 字幕 ON' : '💬 字幕 OFF');
}

/** Set subtitle font size */
function setSubSize(size) {
  subSize = size;
  DOM.subtitleText.className = 'subtitle-text sub-size-' + size;
  document.querySelectorAll('.sub-size-btn').forEach(function(b) { b.classList.remove('active'); });
  var btnMap = { small: 'subSizeSmall', medium: 'subSizeMedium', large: 'subSizeLarge' };
  var btn = document.getElementById(btnMap[size]);
  if (btn) btn.classList.add('active');
  showKbd('🔤 字幕 ' + size.toUpperCase());
}

/** Handle subtitle file selection from file input */
function handleSubFileSelect(fileList) {
  if (!fileList || fileList.length === 0) return;
  var file = fileList[0];
  loadSubtitleFile(file);
}

/** Load a subtitle file */
function loadSubtitleFile(file) {
  var ext = file.name.split('.').pop().toLowerCase();
  var reader = new FileReader();
  reader.onload = function(e) {
    var text = e.target.result;
    var parsed = [];
    if (ext === 'srt') {
      parsed = parseSRT(text);
    } else if (ext === 'vtt') {
      parsed = parseVTT(text);
    } else if (ext === 'ass' || ext === 'ssa') {
      parsed = parseASS(text);
    } else {
      toast('⚠ 不支持的字幕格式：.' + ext);
      return;
    }

    if (parsed.length === 0) {
      toast('⚠ 未识别到字幕内容');
      return;
    }

    subtitleTracks = parsed;
    subOn = true;
    DOM.subBtn.classList.add('active');
    var toggleEl = document.getElementById('subToggle');
    if (toggleEl) toggleEl.classList.add('on');
    toast('💬 已加载字幕：' + file.name + '（' + parsed.length + ' 条）');
    updateSubtitlePanel();
  };
  reader.readAsText(file, 'utf-8');
}

/** Parse SRT subtitle text */
function parseSRT(text) {
  var result = [];
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var blocks = text.split(/\n\n+/);
  var idCounter = 0;

  blocks.forEach(function(block) {
    var lines = block.trim().split('\n');
    if (lines.length < 2) return;

    // Find the timestamp line (contains -->)
    var tsLineIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('-->') !== -1) { tsLineIdx = i; break; }
    }
    if (tsLineIdx < 0) return;

    var tsParts = lines[tsLineIdx].split('-->');
    if (tsParts.length < 2) return;
    var start = parseTimestamp(tsParts[0].trim());
    var end = parseTimestamp(tsParts[1].trim());
    if (start === null || end === null) return;

    var textLines = lines.slice(tsLineIdx + 1);
    var content = textLines.join('\n').replace(/<[^>]+>/g, '').trim();
    if (!content) return;

    result.push({ id: 'sub_' + (idCounter++), start: start, end: end, text: content });
  });

  return result;
}

/** Parse VTT subtitle text */
function parseVTT(text) {
  // Remove WEBVTT header and any metadata
  text = text.replace(/^WEBVTT[^\n]*\n/, '');
  // Also remove any NOTE blocks
  text = text.replace(/NOTE\s*\n[^]*?\n\n/g, '');
  return parseSRT(text); // VTT uses same format as SRT after header removal
}

/** Parse ASS/SSA subtitle text */
function parseASS(text) {
  var result = [];
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var idCounter = 0;

  var lines = text.split('\n');
  lines.forEach(function(line) {
    if (line.indexOf('Dialogue:') !== 0) return;

    // Format: Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    var parts = line.substring(9).split(',');
    if (parts.length < 10) return;

    var start = parseASSTimestamp(parts[1].trim());
    var end = parseASSTimestamp(parts[2].trim());
    if (start === null || end === null) return;

    // Re-join the text portion (everything after the 9th comma)
    var rawText = parts.slice(9).join(',');
    // Remove override tags {...}
    rawText = rawText.replace(/\{[^}]*\}/g, '');
    // Replace \N with newline
    rawText = rawText.replace(/\\N/g, '\n');
    // Remove any remaining backslash commands
    rawText = rawText.replace(/\\[a-zA-Z0-9]+(\([^)]*\))?/g, '');
    rawText = rawText.trim();
    if (!rawText) return;

    result.push({ id: 'sub_' + (idCounter++), start: start, end: end, text: rawText });
  });

  return result;
}

/** Parse SRT/VTT timestamp "HH:MM:SS,mmm" or "HH:MM:SS.mmm" → seconds */
function parseTimestamp(ts) {
  if (!ts) return null;
  // Handle both comma and period for milliseconds
  ts = ts.replace(',', '.');
  var match = ts.match(/(\d+):(\d+):(\d+)[\.](\d+)/);
  if (!match) {
    // Try MM:SS format
    match = ts.match(/(\d+):(\d+)[\.]?(\d*)/);
    if (!match) return null;
    var m = parseInt(match[1], 10);
    var s = parseInt(match[2], 10);
    var ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
    return m * 60 + s + ms / 1000;
  }
  var h = parseInt(match[1], 10);
  var m = parseInt(match[2], 10);
  var s = parseInt(match[3], 10);
  var ms = parseInt(match[4].padEnd(3, '0'), 10);
  return h * 3600 + m * 60 + s + ms / 1000;
}

/** Parse ASS timestamp "H:MM:SS.cc" → seconds */
function parseASSTimestamp(ts) {
  if (!ts) return null;
  var match = ts.match(/(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return null;
  var h = parseInt(match[1], 10);
  var m = parseInt(match[2], 10);
  var s = parseInt(match[3], 10);
  var cs = parseInt(match[4].padEnd(2, '0'), 10); // centiseconds
  return h * 3600 + m * 60 + s + cs / 100;
}

/** Update the subtitle panel in the right panel */
function updateSubtitlePanel() {
  var panel = document.getElementById('panelSubs');
  if (!panel) return;
  var html = '<div style="font-size:11px; color:var(--t-3); margin-bottom: 10px; padding: 0 2px;">字幕轨道</div>';
  if (subtitleTracks.length > 0) {
    html += '<div class="sub-item active" onclick="selectSub(this, \'on\')">';
    html += '<span class="sub-check">✓</span> 已加载（' + subtitleTracks.length + ' 条）';
    html += '</div>';
  }
  html += '<div class="sub-item' + (subtitleTracks.length === 0 ? ' active' : '') + '" onclick="selectSub(this, \'off\')">';
  html += '<span class="sub-check">✓</span> 关闭字幕';
  html += '</div>';
  html += '<div style="margin-top:12px;">';
  html += '<button class="filter-reset-btn" onclick="document.getElementById(\'subFileInput\').click()">📂 加载字幕文件</button>';
  html += '</div>';
  panel.innerHTML = html;
}

/** Select subtitle track from panel */
function selectSub(el, lang) {
  document.querySelectorAll('.sub-item').forEach(function(i) { i.classList.remove('active'); });
  el.classList.add('active');
  if (lang === 'off') {
    subOn = false;
    DOM.subtitleText.textContent = '';
    DOM.subtitleBar.style.opacity = '0';
    DOM.subBtn.classList.remove('active');
  } else {
    subOn = true;
    DOM.subBtn.classList.add('active');
    toast('💬 字幕已开启');
  }
}

/** Render subtitle text for the current playback time */
function renderSubtitle() {
  if (!subOn || subtitleTracks.length === 0) {
    if (DOM.subtitleBar.style.opacity !== '0') {
      DOM.subtitleBar.style.opacity = '0';
    }
    return;
  }

  var currentTime = playback.currentTime + (settings.subDelay || 0) / 1000;

  // Binary search for efficiency
  var found = null;
  for (var i = 0; i < subtitleTracks.length; i++) {
    var sub = subtitleTracks[i];
    if (currentTime >= sub.start && currentTime <= sub.end) {
      found = sub;
      break;
    }
  }

  if (found) {
    DOM.subtitleText.textContent = found.text;
    DOM.subtitleText.className = 'subtitle-text sub-size-' + subSize;
    DOM.subtitleBar.style.opacity = '1';
  } else {
    DOM.subtitleText.textContent = '';
    DOM.subtitleBar.style.opacity = '0';
  }
}


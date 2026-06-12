
let arrowHoldTimer = null;
let arrowHoldDelta = 0;
let arrowHoldSpeed = 10;
let arrowHoldActive = false;

function initKeyboard() {
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
}

function onKeyDown(e) {
  // Don't handle keyboard when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // Dismiss video info panel on any key (unless it's the I key which toggles it)
  if (e.key !== 'i' && e.key !== 'I') {
    hideVideoInfoPanel();
  }

  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlay();
      break;

    case 'ArrowLeft':
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+Left: subtitle delay -0.5s
        settings.subDelay = (settings.subDelay || 0) - 500;
        var sdrEl = document.getElementById('subDelayRange');
        if (sdrEl) sdrEl.value = settings.subDelay;
        var sdvEl = document.getElementById('subDelayVal');
        if (sdvEl) sdvEl.textContent = settings.subDelay + 'ms';
        showKbd('💬 延迟 ' + settings.subDelay + 'ms');
        return;
      }
      if (!arrowHoldActive) {
        arrowHoldActive = true;
        arrowHoldSpeed = 10;
        skip(-10);
        arrowHoldTimer = setTimeout(function hold() {
          arrowHoldSpeed = Math.min(arrowHoldSpeed + 5, 60);
          skip(-arrowHoldSpeed);
          arrowHoldTimer = setTimeout(hold, 150);
        }, 400);
      }
      break;

    case 'ArrowRight':
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+Right: subtitle delay +0.5s
        settings.subDelay = (settings.subDelay || 0) + 500;
        var sdrRightEl = document.getElementById('subDelayRange');
        if (sdrRightEl) sdrRightEl.value = settings.subDelay;
        var sdvRightEl = document.getElementById('subDelayVal');
        if (sdvRightEl) sdvRightEl.textContent = settings.subDelay + 'ms';
        showKbd('💬 字幕延迟 ' + settings.subDelay + 'ms');
        return;
      }
      if (!arrowHoldActive) {
        arrowHoldActive = true;
        arrowHoldSpeed = 10;
        skip(10);
        arrowHoldTimer = setTimeout(function hold() {
          arrowHoldSpeed = Math.min(arrowHoldSpeed + 5, 60);
          skip(arrowHoldSpeed);
          arrowHoldTimer = setTimeout(hold, 150);
        }, 400);
      }
      break;

    case 'ArrowUp':
      e.preventDefault();
      if (e.shiftKey) {
        adjustBrightness(10);
      } else {
        videoSetVolume(playback.volume + 0.05);
        showKbd('🔊 ' + Math.round(playback.volume * 100) + '%');
      }
      break;

    case 'ArrowDown':
      e.preventDefault();
      if (e.shiftKey) {
        adjustBrightness(-10);
      } else {
        videoSetVolume(playback.volume - 0.05);
        showKbd('🔈 ' + Math.round(playback.volume * 100) + '%');
      }
      break;

    case 'p': case 'P':
      if (e.shiftKey) {
        togglePiP();
      } else {
        prevVideo();
      }
      break;

    case 'l': case 'L':
      togglePiP();
      break;

    case '[':
      setABPoint('a');
      break;

    case ']':
      setABPoint('b');
      break;

    case 's': case 'S':
      if (!e.shiftKey) {
        takeScreenshot();
      }
      break;

    case 'd':
      adjustSpeed(-0.1);
      break;

    case 'D':
      adjustSpeed(0.1);
      break;

    case '1':
      resetSpeed();
      break;

    case 'i': case 'I':
      showVideoInfoPanel();
      break;

    case 'm': case 'M':
      if (e.shiftKey) {
        toggleMiniMode();
      } else {
        toggleMute();
      }
      break;

    case 'c': case 'C':
      subToggle();
      break;

    case 'f': case 'F':
      toggleFull();
      break;

    case 'b': case 'B':
      toggleFav();
      break;

    case 'n': case 'N':
      nextVideo();
      break;

    case 'Escape':
      closeCtx();
      closeSettings();
      if (ui.addVideoModalOpen) closeAddVideoModal();
      if (ui.rightPanelOpen) togglePanel();
      break;
  }
}

function onKeyUp(e) {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    clearTimeout(arrowHoldTimer);
    arrowHoldActive = false;
    arrowHoldSpeed = 10;
  }
}

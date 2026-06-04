
let hideTimer = null;
const AUTO_HIDE_DELAY = 2500;

function onMouseMove() {
  showControls();
  if (isMouseInControls()) {
    clearTimeout(hideTimer);
    return;
  }
  scheduleAutoHide();
}

function onControlsMouseEnter() {
  showControls();
  clearTimeout(hideTimer);
}

function onControlsMouseLeave() {
  scheduleAutoHide();
}

function showControls() {
  DOM.videoFrame.classList.remove('cursor-hide');
  DOM.controlsOverlay.classList.remove('hidden');
  ui.controlsVisible = true;
}

function scheduleAutoHide() {
  clearTimeout(hideTimer);
  if (playback.playing) {
    hideTimer = setTimeout(function() {
      DOM.controlsOverlay.classList.add('hidden');
      DOM.videoFrame.classList.add('cursor-hide');
      ui.controlsVisible = false;
    }, AUTO_HIDE_DELAY);
  }
}

function isMouseInControls() {
  return DOM.controlsOverlay && DOM.controlsOverlay.matches(':hover');
}

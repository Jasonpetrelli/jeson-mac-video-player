
/** @type {number|null} Sleep timer interval ID */
let sleepTimerInterval = null;
/** @type {number|null} Sleep timer target timestamp (ms), null if off */
let sleepTimerTarget = null;
/** @type {string} Sleep timer mode: 'off' | '15' | '30' | '45' | '60' | 'current' */
let sleepTimerMode = 'off';

/** Set sleep timer from settings dropdown value */
function setSleepTimer(value) {
  cancelSleepTimer();
  if (value === '0' || value === 'off') {
    sleepTimerMode = 'off';
    return;
  }
  sleepTimerMode = value;

  if (value === 'current') {
    // Sleep after current video ends
    // We'll check in the 'ended' event handler
    toast('⏱ 当前视频结束后暂停');
    showKbd('⏱ 当前视频结束后暂停');
    DOM.sleepTimerBadge.style.display = '';
    DOM.sleepTimerBadge.textContent = '⏱ 片尾停';
    return;
  }

  // Timed sleep: value in minutes
  var minutes = parseInt(value);
  sleepTimerTarget = Date.now() + minutes * 60 * 1000;

  toast('⏱ ' + minutes + ' 分钟后暂停');
  showKbd('⏱ ' + minutes + ' 分钟后暂停');

  DOM.sleepTimerBadge.style.display = '';

  sleepTimerInterval = setInterval(function() {
    var remaining = sleepTimerTarget - Date.now();
    if (remaining <= 0) {
      fireSleepTimer();
      return;
    }
    var rSec = Math.ceil(remaining / 1000);
    var rMin = Math.floor(rSec / 60);
    var rS = rSec % 60;
    DOM.sleepTimerBadge.textContent = '⏱ ' + rMin + ':' + String(rS).padStart(2, '0');
  }, 1000);
}

/** Fire the sleep timer — pause and notify */
function fireSleepTimer() {
  cancelSleepTimer();
  videoPause();
  toast('⏱ 定时停止 — 已暂停播放', 4000);
  showKbd('⏱ 定时停止');
}

/** Cancel sleep timer */
function cancelSleepTimer() {
  if (sleepTimerInterval) {
    clearInterval(sleepTimerInterval);
    sleepTimerInterval = null;
  }
  sleepTimerTarget = null;
  if (sleepTimerMode !== 'off') {
    sleepTimerMode = 'off';
  }
  DOM.sleepTimerBadge.style.display = 'none';
  DOM.sleepTimerBadge.textContent = '⏱ --:--';
  // Reset settings dropdown
  var sel = document.getElementById('sleepTimerSelect');
  if (sel) sel.value = '0';
}

/** Check if sleep timer should fire after video ends (for 'current' mode) */
function checkSleepAfterVideoEnd() {
  if (sleepTimerMode === 'current') {
    fireSleepTimer();
  }
}


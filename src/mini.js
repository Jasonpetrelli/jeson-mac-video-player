
/** Toggle mini mode */
function toggleMiniMode() {
  ui.miniMode = !ui.miniMode;
  DOM.app.classList.toggle('mini-mode', ui.miniMode);
  showKbd(ui.miniMode ? '🪟 迷你模式' : '🪟 退出迷你模式');
  toast(ui.miniMode ? '🪟 迷你模式 (Shift+M 还原)' : '🪟 已退出迷你模式');
}



function openAddVideoModal() {
  ui.addVideoModalOpen = true;
  DOM.addVideoOverlay.classList.add('open');
  // Reset to URL tab
  switchAddTab(document.getElementById('addTabUrl'), 'url');
  document.getElementById('addUrlInput').value = '';
  document.getElementById('addTitleInput').value = '';
}

function closeAddVideoModal() {
  ui.addVideoModalOpen = false;
  DOM.addVideoOverlay.classList.remove('open');
}

function switchAddTab(el, tab) {
  document.querySelectorAll('.avm-tab').forEach(function(t) { t.classList.remove('active'); });
  el.classList.add('active');
  document.getElementById('addPanelUrl').style.display = tab === 'url' ? '' : 'none';
  document.getElementById('addPanelFile').style.display = tab === 'file' ? '' : 'none';
}

function addNetworkVideo() {
  const url = document.getElementById('addUrlInput').value.trim();
  if (!url) {
    toast('请输入视频地址');
    return;
  }

  // Basic URL validation
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    toast('请输入有效的 HTTP/HTTPS 地址');
    return;
  }

  const title = document.getElementById('addTitleInput').value.trim() || url.split('/').pop() || '网络视频';
  const item = addNetworkUrl(url, title);
  closeAddVideoModal();
  switchToVideo(item.id);
}


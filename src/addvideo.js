
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

function getLocalPathFromAddress(input) {
  if (!input || !IS_ELECTRON) return '';
  if (input.startsWith('file://')) {
    try {
      return decodeURIComponent(input.slice(7));
    } catch (err) {
      return input.slice(7);
    }
  }
  if (input.startsWith('/')) return input;
  return '';
}

function addNetworkVideo() {
  const url = document.getElementById('addUrlInput').value.trim();
  if (!url) {
    toast('请输入视频地址');
    return;
  }

  var localPath = getLocalPathFromAddress(url);
  if (localPath) {
    var localItem = addLocalFileFromPath(localPath);
    closeAddVideoModal();
    switchToVideo(localItem.id);
    return;
  }

  if (/^(smb|afp|nfs):\/\//i.test(url)) {
    toast('请将 NAS 挂载到 Finder 后，复制 /Volumes 下的路径粘贴');
    return;
  }

  // Basic URL validation
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    toast('请输入 HTTP/HTTPS 地址，或粘贴 /Volumes 下的本地路径');
    return;
  }

  const title = document.getElementById('addTitleInput').value.trim() || url.split('/').pop() || '网络视频';
  const item = addNetworkUrl(url, title);
  closeAddVideoModal();
  switchToVideo(item.id);
}

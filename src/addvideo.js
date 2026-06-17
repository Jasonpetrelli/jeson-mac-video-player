
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
  if (input.indexOf('file://') === 0) {
    try {
      return decodeURIComponent(input.replace(/^file:\/\//, ''));
    } catch (err) {
      return input.replace(/^file:\/\//, '');
    }
  }
  if (input.charAt(0) === '/') return input;
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
    toast('请先在 Finder 挂载 NAS，再选择 /Volumes 下的视频文件');
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

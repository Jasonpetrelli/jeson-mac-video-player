/*    Bridges Electron APIs into the player. All Electron features */
/*    are guarded by IS_ELECTRON — browser fallbacks are unchanged. */
/** Add a video from an absolute file path (Electron only).
 * Unlike addLocalFile(), this doesn't need a File/Blob object —
 * the file is accessed via its filesystem path.
 * @param {string} filePath - Absolute path to the video file
 * @returns {object} The created playlist item
 */
function addLocalFileFromPath(filePath) {
  var duplicate = findLocalDuplicate(filePath, null);
  if (duplicate) {
    duplicate.unavailable = false;
    duplicate._filePath = filePath;
    duplicate.url = getLocalFileURL(filePath);
    duplicate._mseUnsupported = false;
    duplicate._transcodedPath = null;
    duplicate.favorite = isFavoriteItem(duplicate);
    toast('已在队列中：' + duplicate.title);
    renderSidebar();
    return duplicate;
  }

  var fileName = filePath.split('/').pop() || filePath;
  var fileExt = fileName.split('.').pop().toLowerCase();
  var isMKV = (fileExt === 'mkv' || fileExt === 'webm');
  var title = fileName.replace(/\.[^.]+$/, '');

  var item = {
    id: generateId(),
    title: title,
    url: getLocalFileURL(filePath),
    type: 'local',
    duration: 0,
    progress: 0,
    favorite: false,
    thumbnail: '',
    lastPlayedAt: Date.now(),
    addedAt: Date.now(),
    lastPosition: 0,
    unavailable: false,
    _blobUrl: null,
    _needsMSE: isMKV,
    _fileRef: null,
    _filePath: filePath,
    _fileName: fileName,
    _mseUnsupported: false
  };
  item.favorite = isFavoriteItem(item);
  playlist.push(item);
  renderSidebar();
  return item;
}

/**
 * Open a native file dialog for selecting video files (Electron only).
 * Replaces the browser's <input type="file"> with full filesystem access.
 */
async function electronOpenFileDialog() {
  if (!IS_ELECTRON) return;
  try {
    var result = await window.electronAPI.openFileDialog();
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

    var firstAddedId = null;
    for (var i = 0; i < result.filePaths.length; i++) {
      var fp = result.filePaths[i];
      var item = addLocalFileFromPath(fp);
      if (!firstAddedId) firstAddedId = item.id;
    }
    if (firstAddedId) {
      switchToVideo(firstAddedId);
    }
    closeAddVideoModal();
  } catch (err) {
    console.error('[Prism] File dialog error:', err);
    toast('⚠ 文件选择失败');
  }
}

/**
 * Open a native folder dialog and add all video files from it (Electron only).
 * Supports scanning SMB/NAS mounted volumes.
 */
async function electronOpenFolderDialog() {
  if (!IS_ELECTRON) return;
  try {
    var result = await window.electronAPI.openFolderDialog();
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

    toast('📂 正在扫描文件夹…');
    for (var d = 0; d < result.filePaths.length; d++) {
      var dirPath = result.filePaths[d];
      var videos = await window.electronAPI.scanDirectory(dirPath);
      var firstAddedId = null;
      var addedCount = 0;

      for (var i = 0; i < videos.length; i++) {
        var v = videos[i];
        var beforeCount = playlist.length;
        var item = addLocalFileFromPath(v.path);
        if (playlist.length > beforeCount) addedCount++;
        if (!firstAddedId) firstAddedId = item.id;
      }

      if (firstAddedId) {
        switchToVideo(firstAddedId);
        toast('📂 已添加 ' + addedCount + ' 个视频');
      } else {
        toast('📂 该文件夹下未找到视频文件');
      }
    }
  } catch (err) {
    console.error('[Prism] Folder dialog error:', err);
    toast('⚠ 文件夹选择失败');
  }
}

/**
 * Initialize Electron integration.
 * Sets up IPC listeners for: file-open events, menu actions, window controls,
 * and handles the initial file passed at app launch.
 */
function initElectronIntegration() {
  if (!IS_ELECTRON) return;

  // ── Handle file open events (double-click in Finder, `open -a`, etc.) ──
  window.electronAPI.onOpenFile(function (filePath) {
    var ext = filePath.split('.').pop().toLowerCase();
    var videoExts = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'ts', 'm2ts', 'm4v', '3gp'];
    var subExts = ['srt', 'vtt', 'ass', 'ssa'];

    if (videoExts.indexOf(ext) >= 0) {
      var item = addLocalFileFromPath(filePath);
      switchToVideo(item.id);
      toast('📂 已打开：' + item.title);
    } else if (subExts.indexOf(ext) >= 0) {
      // Load subtitle file via Electron's file system access
      window.electronAPI.readFileAsBuffer(filePath).then(function (buffer) {
        var decoder = new TextDecoder('utf-8');
        var text = decoder.decode(new Uint8Array(buffer));
        var subs = [];
        if (ext === 'srt') subs = parseSRT(text);
        else if (ext === 'vtt') subs = parseVTT(text);
        else if (ext === 'ass' || ext === 'ssa') subs = parseASS(text);
        if (subs.length > 0) {
          subtitleTracks = subtitleTracks.concat(subs);
          subtitleTracks.sort(function (a, b) { return a.start - b.start; });
          subOn = true;
          DOM.subBtn.classList.add('active');
          updateSubtitlePanel();
          toast('💬 字幕已加载（' + subs.length + ' 条）');
        }
      }).catch(function () {
        toast('⚠ 字幕文件读取失败');
      });
    } else {
      toast('⚠ 不支持的文件格式：.' + ext);
    }
  });

  if (window.electronAPI.rendererReady) {
    window.electronAPI.rendererReady();
  }

  // ── Handle menu bar actions ──
  window.electronAPI.onMenuAction(function (action) {
    switch (action) {
      case 'about':
        toast('Prism Player v0.9.0 — macOS 视频播放器');
        break;
      case 'settings':
        openSettings();
        break;
      case 'open-file':
        electronOpenFileDialog();
        break;
      case 'open-folder':
        electronOpenFolderDialog();
        break;
      case 'open-network-url':
        openAddVideoModal();
        switchAddTab(document.getElementById('addTabUrl'), 'url');
        break;
      case 'open-subtitle':
        DOM.subFileInput.click();
        break;
      case 'shortcuts':
        toast('⌨ 空格=播放/暂停  F=全屏  ←→=快进/退  ↑↓=音量  M=静音  C=字幕  Esc=退出');
        break;
    }
  });

  // ── Handle initial file passed at launch (command-line arg or double-click) ──
  window.electronAPI.getInitialFile().then(function (filePath) {
    if (filePath) {
      var ext = filePath.split('.').pop().toLowerCase();
      var videoExts = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'ts', 'm2ts', 'm4v', '3gp'];
      if (videoExts.indexOf(ext) >= 0) {
        var item = addLocalFileFromPath(filePath);
        switchToVideo(item.id);
      }
    }
  });

  // ── Enhance file zone click in Add Video Modal to use native dialog ──
  var avmFileZone = document.querySelector('.avm-file-zone');
  if (avmFileZone) {
    avmFileZone.onclick = function (e) {
      e.preventDefault();
      electronOpenFileDialog();
    };
  }

  // ── Electron fullscreen state tracking ──
  window.addEventListener('resize', function () {
    if (!IS_ELECTRON) return;
    window.electronAPI.isFullscreen().then(function (isFS) {
      DOM.app.classList.toggle('fullscreen-mode', isFS);
      if (isFS) {
        DOM.sidebar.style.display = 'none';
      } else {
        DOM.sidebar.style.display = '';
      }
    });
  });

  console.log('[Prism] Electron integration initialized');
}

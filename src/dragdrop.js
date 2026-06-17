
let dragCounter = 0;

function initDragDrop() {
  document.addEventListener('dragenter', onDragEnter);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('dragleave', onDragLeave);
  document.addEventListener('drop', onDrop);
}

function onDragEnter(e) {
  e.preventDefault();
  dragCounter++;
  DOM.dropZoneOverlay.classList.add('show');
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
}

function onDragLeave(e) {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    DOM.dropZoneOverlay.classList.remove('show');
  }
}

function onDrop(e) {
  e.preventDefault();
  dragCounter = 0;
  DOM.dropZoneOverlay.classList.remove('show');

  const files = e.dataTransfer.files;
  if (!files || files.length === 0) return;

  let firstAddedId = null;
  let hasSubtitles = false;

  var subExts = ['srt', 'vtt', 'ass', 'ssa'];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    var fileExt = file.name.split('.').pop().toLowerCase();

    // Check if it's a subtitle file
    if (subExts.indexOf(fileExt) >= 0) {
      loadSubtitleFile(file);
      hasSubtitles = true;
      continue;
    }

    // Validate video file type (accept standard video + known containers)
    var isVideoType = file.type.startsWith('video/');
    if (!isVideoType && !isSupportedVideoExt(fileExt)) {
      toast('⚠ 不支持的文件格式：' + file.name);
      continue;
    }

    const item = addLocalFile(file);
    if (!firstAddedId) firstAddedId = item.id;

    // In Electron, also store file.path for persistent access
    if (IS_ELECTRON && file.path && !item._filePath) {
      item._filePath = file.path;
    }
  }

  // Auto-play the first dropped video
  if (firstAddedId) {
    switchToVideo(firstAddedId);
  }

  // Close add modal if open
  if (ui.addVideoModalOpen) {
    closeAddVideoModal();
  }

  // If only subtitles were dropped, just show a notification
  if (!firstAddedId && hasSubtitles) {
    toast('💬 字幕文件已加载');
  }
}

/** Handle file input selection */
function handleFileSelect(fileList) {
  if (!fileList || fileList.length === 0) return;

  let firstAddedId = null;

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    var fileExt = file.name.split('.').pop().toLowerCase();
    var isVideoType = file.type.startsWith('video/');
    if (!isVideoType && !isSupportedVideoExt(fileExt)) {
      toast('⚠ 不支持的文件格式：' + file.name);
      continue;
    }
    const item = addLocalFile(file);
    if (!firstAddedId) firstAddedId = item.id;
  }

  closeAddVideoModal();

  if (firstAddedId) {
    switchToVideo(firstAddedId);
  }
}

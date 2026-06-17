const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const VIDEO_EXTS = [
  'mp4', 'm4v', 'mov', 'qt',
  'mkv', 'webm',
  'avi', 'divx',
  'flv', 'f4v',
  'wmv', 'asf',
  'ts', 'm2ts', 'mts',
  '3gp', '3g2',
  'mpg', 'mpeg', 'mpe', 'vob',
  'ogv', 'ogg', 'ogm',
  'rm', 'rmvb',
  'mxf'
];

// ── Globals ──

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** File path passed via command-line or open-file event */
let initialFilePath = null;

/** Pending open-file event that fires before app is ready */
let pendingFilePath = null;

/** Whether renderer has registered IPC listeners */
let rendererReady = false;

/** In-flight audio transcode jobs keyed by source file metadata */
let transcodeAudioJobs = {};
const MAX_AUDIO_CACHE_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_MSE_READ_BYTES = 2 * 1024 * 1024 * 1024;

function getFfmpegPath() {
  return ffmpeg.path.replace('app.asar', 'app.asar.unpacked');
}

function mapProbeVideoCodec(codec) {
  if (codec === 'hevc' || codec === 'h265') return 'V_MPEGH/ISO/HEVC';
  if (codec === 'h264') return 'V_MPEG4/ISO/AVC';
  if (codec === 'vp9') return 'V_VP9';
  if (codec === 'vp8') return 'V_VP8';
  if (codec === 'av1') return 'V_AV1';
  return codec || '';
}

function mapProbeAudioCodec(codec) {
  if (codec === 'eac3') return 'A_EAC3';
  if (codec === 'ac3') return 'A_AC3';
  if (codec === 'aac') return 'A_AAC';
  if (codec === 'mp3') return 'A_MPEG/L3';
  if (codec === 'opus') return 'A_OPUS';
  if (codec === 'vorbis') return 'A_VORBIS';
  if (codec === 'flac') return 'A_FLAC';
  return codec || '';
}

async function probeMedia(filePath) {
  return await new Promise(function (resolve, reject) {
    var child = spawn(getFfmpegPath(), ['-hide_banner', '-i', filePath]);
    var stderr = '';

    child.stderr.on('data', function (chunk) {
      stderr += chunk.toString();
      if (stderr.length > 200000) stderr = stderr.slice(0, 200000);
    });
    child.on('error', reject);
    child.on('close', function () {
      var videoMatch = stderr.match(/Stream #\d+:\d+[^:]*: Video: ([^,\s]+)/);
      var audioMatch = stderr.match(/Stream #\d+:\d+[^:]*: Audio: ([^,\s]+)/);
      var durationMatch = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      var duration = 0;
      if (durationMatch) {
        duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
      }
      resolve({
        videoCodec: videoMatch ? mapProbeVideoCodec(videoMatch[1].toLowerCase()) : '',
        audioCodec: audioMatch ? mapProbeAudioCodec(audioMatch[1].toLowerCase()) : '',
        duration: duration
      });
    });
  });
}

async function getTranscodedAudioPath(filePath) {
  var stats = await fs.promises.stat(filePath);
  var key = crypto
    .createHash('sha1')
    .update(filePath + ':' + stats.size + ':' + stats.mtime.getTime())
    .digest('hex');
  var outDir = path.join(app.getPath('userData'), 'audio-transcode-cache');
  var outPath = path.join(outDir, key + '.mp4');
  var tmpPath = path.join(outDir, key + '.part.mp4');

  try {
    var outStats = await fs.promises.stat(outPath);
    if (outStats.size > 0) return outPath;
  } catch (err) {}

  if (!transcodeAudioJobs[key]) {
    transcodeAudioJobs[key] = (async function () {
      await fs.promises.mkdir(outDir, { recursive: true });
      try { await fs.promises.unlink(tmpPath); } catch (err) {}

      await new Promise(function (resolve, reject) {
        var args = [
          '-y',
          '-i', filePath,
          '-map', '0:v:0',
          '-map', '0:a:0',
          '-c:v', 'copy',
          '-tag:v', 'hvc1',
          '-c:a', 'aac',
          '-ac', '2',
          '-b:a', '192k',
          '-map_metadata', '0',
          '-movflags', '+faststart',
          tmpPath
        ];
        var child = spawn(getFfmpegPath(), args);
        var stderr = '';

        child.stderr.on('data', function (chunk) {
          stderr += chunk.toString();
          if (stderr.length > 4000) stderr = stderr.slice(-4000);
        });
        child.on('error', reject);
        child.on('close', function (code) {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(stderr || ('ffmpeg exited with code ' + code)));
          }
        });
      });

      await fs.promises.rename(tmpPath, outPath);
      await cleanupAudioCache(outDir, outPath);
      return outPath;
    })().finally(function () {
      delete transcodeAudioJobs[key];
    });
  }

  return transcodeAudioJobs[key];
}

async function cleanupAudioCache(outDir, keepPath) {
  var entries;
  try {
    entries = await fs.promises.readdir(outDir);
  } catch (err) {
    return;
  }

  var files = [];
  var total = 0;
  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].endsWith('.mp4')) continue;
    var filePath = path.join(outDir, entries[i]);
    try {
      var stats = await fs.promises.stat(filePath);
      files.push({ path: filePath, size: stats.size, mtime: stats.mtime.getTime() });
      total += stats.size;
    } catch (err) {}
  }

  if (total <= MAX_AUDIO_CACHE_BYTES) return;
  files.sort(function (a, b) { return a.mtime - b.mtime; });
  for (var j = 0; j < files.length && total > MAX_AUDIO_CACHE_BYTES; j++) {
    if (files[j].path === keepPath) continue;
    try {
      await fs.promises.unlink(files[j].path);
      total -= files[j].size;
    } catch (err) {}
  }
}

// ── Window Creation ──

/**
 * Create the main application window.
 * Frameless for custom titlebar, dark background for seamless feel.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1a1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false // Show after ready-to-show for smooth appearance
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Graceful show after content loads
  mainWindow.once('ready-to-show', function () {
    showMainWindow();

    // If a file was passed at launch, send it to the renderer
    if (pendingFilePath) {
      openFileInRenderer(pendingFilePath);
    } else if (initialFilePath) {
      openFileInRenderer(initialFilePath);
    }
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
    rendererReady = false;
  });
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function openFileInRenderer(filePath) {
  if (!filePath) return;

  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingFilePath = filePath;
    if (app.isReady()) {
      createWindow();
      buildMenu();
    }
    return;
  }

  showMainWindow();

  if (mainWindow.webContents.isLoading() || !rendererReady) {
    pendingFilePath = filePath;
    mainWindow.webContents.once('did-finish-load', function () {
      flushPendingFileOpen();
    });
    return;
  }

  mainWindow.webContents.send('open-file', filePath);
}

function flushPendingFileOpen() {
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady || !pendingFilePath) return;
  var fp = pendingFilePath;
  pendingFilePath = null;
  if (initialFilePath === fp) initialFilePath = null;
  mainWindow.webContents.send('open-file', fp);
}

// ── App Lifecycle ──

app.whenReady().then(function () {
  createWindow();
  buildMenu();

  // Dock click behavior — macOS: re-show window when clicking Dock icon
  app.on('activate', function () {
    if (mainWindow) {
      showMainWindow();
    } else {
      createWindow();
    }
  });

  // macOS: re-create window if all windows are closed
  app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
});

// macOS: handle file open events (double-click, `open -a` etc.)
app.on('open-file', function (event, filePath) {
  event.preventDefault();
  openFileInRenderer(filePath);
});

// Capture file path from command-line arguments (e.g., `prism-player /path/to/video.mkv`)
for (var argIndex = 1; argIndex < process.argv.length; argIndex++) {
  var candidatePath = process.argv[argIndex];
  if (!candidatePath || candidatePath.startsWith('-')) continue;

  try {
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
      initialFilePath = candidatePath;
      break;
    }
  } catch (err) {}
}

// ── IPC Handlers ──

/** Open a file dialog for selecting video files */
ipcMain.handle('open-file-dialog', async function () {
  if (!mainWindow) return { canceled: true, filePaths: [] };

  var result = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '视频文件', extensions: VIDEO_EXTS },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  return result;
});

/** Open a folder dialog (for NAS directory selection) */
ipcMain.handle('open-folder-dialog', async function () {
  if (!mainWindow) return { canceled: true, filePaths: [] };

  var result = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频文件夹',
    properties: ['openDirectory']
  });

  return result;
});

/** Read a file as ArrayBuffer — used for MKV MSE pipeline in Electron */
ipcMain.handle('read-file-buffer', async function (event, filePath) {
  try {
    var stats = await fs.promises.stat(filePath);
    if (stats.size > MAX_MSE_READ_BYTES) {
      throw new Error('文件过大，已改用原生播放');
    }
    var data = await fs.promises.readFile(filePath);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  } catch (err) {
    console.error('[Prism] Failed to read file:', filePath, err.message);
    throw new Error('Failed to read file: ' + err.message);
  }
});

/** Get a file:// URL for a local file path */
ipcMain.handle('get-file-url', function (event, filePath) {
  try {
    return pathToFileURL(filePath).href;
  } catch (err) {
    return null;
  }
});

/** Get the initial file path passed at app launch */
ipcMain.handle('get-initial-file', function () {
  if (rendererReady) return null;
  var fp = initialFilePath || pendingFilePath;
  initialFilePath = null;
  pendingFilePath = null;
  return fp || null;
});

ipcMain.handle('renderer-ready', function () {
  rendererReady = true;
  if (initialFilePath && !pendingFilePath) {
    pendingFilePath = initialFilePath;
    initialFilePath = null;
  }
  flushPendingFileOpen();
});

/** Convert unsupported local audio to AAC while copying video stream */
ipcMain.handle('transcode-audio-for-playback', async function (event, filePath) {
  try {
    return await getTranscodedAudioPath(filePath);
  } catch (err) {
    console.error('[Prism] audio transcode failed:', err.message);
    throw new Error('音频转换失败');
  }
});

/** Probe media streams without loading the full file into renderer memory */
ipcMain.handle('probe-media', async function (event, filePath) {
  try {
    return await probeMedia(filePath);
  } catch (err) {
    console.error('[Prism] media probe failed:', err.message);
    return null;
  }
});

/** Show file in Finder / Explorer */
ipcMain.handle('show-in-folder', function (event, filePath) {
  try {
    shell.showItemInFolder(filePath);
    return true;
  } catch (err) {
    console.error('[Prism] showItemInFolder failed:', err.message);
    return false;
  }
});

/** Window control: minimize */
ipcMain.handle('window-minimize', function () {
  if (mainWindow) mainWindow.minimize();
});

/** Window control: maximize / unmaximize */
ipcMain.handle('window-maximize', function () {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow.maximize();
    return true;
  }
});

/** Window control: close */
ipcMain.handle('window-close', function () {
  if (mainWindow) mainWindow.close();
});

/** Window control: hide */
ipcMain.handle('window-hide', function () {
  if (mainWindow) mainWindow.hide();
});

/** Window control: show */
ipcMain.handle('window-show', function () {
  showMainWindow();
});

/** Check if window is maximized */
ipcMain.handle('window-is-maximized', function () {
  return mainWindow ? mainWindow.isMaximized() : false;
});

/** Toggle native macOS fullscreen */
ipcMain.handle('window-toggle-fullscreen', function () {
  if (!mainWindow) return false;
  var isFullScreen = mainWindow.isFullScreen();
  mainWindow.setFullScreen(!isFullScreen);
  return !isFullScreen;
});

/** Check if window is in fullscreen */
ipcMain.handle('window-is-fullscreen', function () {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

/** Get file stats (size, modified time) */
ipcMain.handle('get-file-stats', async function (event, filePath) {
  try {
    var stats = await fs.promises.stat(filePath);
    return {
      size: stats.size,
      mtime: stats.mtime.getTime(),
      isFile: stats.isFile()
    };
  } catch (err) {
    return null;
  }
});

/** Scan a directory for video files */
ipcMain.handle('scan-directory', async function (event, dirPath) {
  var maxVideos = 2000;
  var maxDirs = 500;
  var dirCount = 0;
  var videos = [];

  async function scan(currentDir) {
    if (videos.length >= maxVideos || dirCount >= maxDirs) return;
    dirCount++;

    var entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      if (videos.length >= maxVideos || dirCount >= maxDirs) return;
      var entry = entries[i];
      if (entry.name.charAt(0) === '.') continue;
      var entryPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await scan(entryPath);
        continue;
      }

      if (!entry.isFile()) continue;
      var ext = path.extname(entry.name).toLowerCase().replace('.', '');
      if (VIDEO_EXTS.indexOf(ext) >= 0) {
        videos.push({
          name: entry.name,
          path: entryPath
        });
      }
    }
  }

  try {
    await scan(dirPath);
    return videos;
  } catch (err) {
    console.error('[Prism] scan-directory failed:', err.message);
    return [];
  }
});

// ── Menu Bar ──

function buildMenu() {
  var menuTemplate = [
    {
      label: 'Prism Player',
      submenu: [
        { label: '关于 Prism Player', click: showAbout },
        { type: 'separator' },
        { label: '偏好设置...', accelerator: 'Cmd+,', click: openSettingsFromMenu },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: '文件',
      submenu: [
        { label: '打开文件...', accelerator: 'Cmd+O', click: openFileDialogFromMenu },
        { label: '打开文件夹...', accelerator: 'Cmd+Shift+O', click: openFolderDialogFromMenu },
        { label: '打开网络地址...', accelerator: 'Cmd+Shift+U', click: openNetworkUrlFromMenu },
        { type: 'separator' },
        { label: '添加字幕文件...', click: openSubtitleFileFromMenu }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '进入全屏', accelerator: 'Ctrl+Cmd+F', click: toggleFullscreenFromMenu },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'Alt+Cmd+I', click: toggleDevTools }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '关闭窗口', accelerator: 'Cmd+W', click: closeWindowFromMenu },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '快捷键一览', click: showShortcuts },
        { type: 'separator' },
        { label: '项目主页', click: function () { shell.openExternal('https://github.com/prism-player'); } }
      ]
    }
  ];

  var menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

// ── Menu Action Handlers ──

function showAbout() {
  if (mainWindow) {
    mainWindow.webContents.send('menu-action', 'about');
  }
}

function openSettingsFromMenu() {
  if (mainWindow) {
    mainWindow.webContents.send('menu-action', 'settings');
  }
}

function openFileDialogFromMenu() {
  if (mainWindow) {
    mainWindow.webContents.send('menu-action', 'open-file');
  }
}

function openFolderDialogFromMenu() {
  if (mainWindow) {
    mainWindow.webContents.send('menu-action', 'open-folder');
  }
}

function openNetworkUrlFromMenu() {
  if (mainWindow) {
    mainWindow.webContents.send('menu-action', 'open-network-url');
  }
}

function openSubtitleFileFromMenu() {
  if (mainWindow) {
    mainWindow.webContents.send('menu-action', 'open-subtitle');
  }
}

function toggleFullscreenFromMenu() {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
}

function closeWindowFromMenu() {
  if (mainWindow) {
    mainWindow.close();
  }
}

function toggleDevTools() {
  if (mainWindow) {
    mainWindow.webContents.toggleDevTools();
  }
}

function showShortcuts() {
  if (mainWindow) {
    mainWindow.webContents.send('menu-action', 'shortcuts');
  }
}

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// ── Globals ──

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** File path passed via command-line or open-file event */
let initialFilePath = null;

/** Pending open-file event that fires before app is ready */
let pendingFilePath = null;

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
    mainWindow.show();

    // If a file was passed at launch, send it to the renderer
    if (pendingFilePath) {
      mainWindow.webContents.send('open-file', pendingFilePath);
      pendingFilePath = null;
    } else if (initialFilePath) {
      mainWindow.webContents.send('open-file', initialFilePath);
      initialFilePath = null;
    }
  });

  // Dock click behavior — macOS: re-show window when clicking Dock icon
  app.on('activate', function () {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
    }
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// ── App Lifecycle ──

app.whenReady().then(function () {
  createWindow();
  buildMenu();

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

  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('open-file', filePath);
  } else {
    // Window not ready yet — store for later
    pendingFilePath = filePath;
  }
});

// Capture file path from command-line arguments (e.g., `prism-player /path/to/video.mkv`)
if (process.argv.length > 1) {
  var candidatePath = process.argv[1];
  if (candidatePath && !candidatePath.startsWith('-')) {
    initialFilePath = candidatePath;
  }
}

// ── IPC Handlers ──

/** Open a file dialog for selecting video files */
ipcMain.handle('open-file-dialog', async function () {
  if (!mainWindow) return { canceled: true, filePaths: [] };

  var result = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '视频文件', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'ts', 'm2ts', 'm4v', '3gp'] },
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
  if (initialFilePath) {
    var fp = initialFilePath;
    initialFilePath = null;
    return fp;
  }
  return null;
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
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
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
  var videoExts = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'ts', 'm2ts', 'm4v', '3gp'];

  try {
    var entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    var videos = [];

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry.isFile()) continue;
      var ext = path.extname(entry.name).toLowerCase().replace('.', '');
      if (videoExts.indexOf(ext) >= 0) {
        videos.push({
          name: entry.name,
          path: path.join(dirPath, entry.name)
        });
      }
    }

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

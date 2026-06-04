/**
 * Prism Player — Preload Script
 *
 * Exposes a safe, limited API from Electron to the renderer process
 * via contextBridge. All Node.js / Electron APIs are accessed here
 * only — the renderer never gets direct access.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ── File Dialogs ──

  /**
   * Open a native file dialog for selecting video files.
   * @returns {Promise<{canceled: boolean, filePaths: string[]}>}
   */
  openFileDialog: function () {
    return ipcRenderer.invoke('open-file-dialog');
  },

  /**
   * Open a native folder dialog (for NAS directory selection).
   * @returns {Promise<{canceled: boolean, filePaths: string[]}>}
   */
  openFolderDialog: function () {
    return ipcRenderer.invoke('open-folder-dialog');
  },

  // ── File System ──

  /**
   * Read a file as ArrayBuffer — used for MKV MSE pipeline in Electron.
   * This bypasses the browser's File API restrictions and allows reading
   * files by absolute path (e.g., SMB/NAS mounts).
   * @param {string} filePath - Absolute path to the file
   * @returns {Promise<ArrayBuffer>}
   */
  readFileAsBuffer: function (filePath) {
    return ipcRenderer.invoke('read-file-buffer', filePath);
  },

  /**
   * Get a file:// URL for a local file path.
   * @param {string} filePath - Absolute path to the file
   * @returns {Promise<string|null>}
   */
  getFileURL: function (filePath) {
    return ipcRenderer.invoke('get-file-url', filePath);
  },

  /**
   * Get file stats (size, modified time).
   * @param {string} filePath - Absolute path to the file
   * @returns {Promise<{size: number, mtime: number, isFile: boolean}|null>}
   */
  getFileStats: function (filePath) {
    return ipcRenderer.invoke('get-file-stats', filePath);
  },

  /**
   * Scan a directory for video files.
   * @param {string} dirPath - Absolute path to the directory
   * @returns {Promise<Array<{name: string, path: string}>>}
   */
  scanDirectory: function (dirPath) {
    return ipcRenderer.invoke('scan-directory', dirPath);
  },

  /**
   * Show a file in Finder / Explorer.
   * @param {string} filePath - Absolute path to the file
   * @returns {Promise<boolean>}
   */
  showInFolder: function (filePath) {
    return ipcRenderer.invoke('show-in-folder', filePath);
  },

  // ── App Launch ──

  /**
   * Get the file path passed at app launch (via command-line or double-click).
   * @returns {Promise<string|null>}
   */
  getInitialFile: function () {
    return ipcRenderer.invoke('get-initial-file');
  },

  /** Notify main process that renderer listeners are ready */
  rendererReady: function () {
    return ipcRenderer.invoke('renderer-ready');
  },

  // ── Event Listeners ──

  /**
   * Listen for file-open events (macOS double-click, `open -a`, etc.).
   * @param {function(string): void} callback - Called with the file path
   */
  onOpenFile: function (callback) {
    ipcRenderer.on('open-file', function (_, filePath) {
      callback(filePath);
    });
  },

  /**
   * Listen for menu actions from the macOS menu bar.
   * @param {function(string): void} callback - Called with action name
   */
  onMenuAction: function (callback) {
    ipcRenderer.on('menu-action', function (_, action) {
      callback(action);
    });
  },

  // ── Window Controls ──

  /** Minimize the window */
  minimize: function () {
    return ipcRenderer.invoke('window-minimize');
  },

  /** Toggle maximize / restore */
  maximize: function () {
    return ipcRenderer.invoke('window-maximize');
  },

  /** Close the window */
  close: function () {
    return ipcRenderer.invoke('window-close');
  },

  /** Hide the window */
  hide: function () {
    return ipcRenderer.invoke('window-hide');
  },

  /** Show the window */
  show: function () {
    return ipcRenderer.invoke('window-show');
  },

  /** Check if the window is currently maximized */
  isMaximized: function () {
    return ipcRenderer.invoke('window-is-maximized');
  },

  /** Toggle native macOS fullscreen */
  toggleFullscreen: function () {
    return ipcRenderer.invoke('window-toggle-fullscreen');
  },

  /** Check if the window is in fullscreen */
  isFullscreen: function () {
    return ipcRenderer.invoke('window-is-fullscreen');
  }
});

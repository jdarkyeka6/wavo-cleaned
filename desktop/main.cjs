'use strict'

const { app, BrowserWindow, shell, session } = require('electron')
const { autoUpdater } = require('electron-updater')

const HOME = 'https://wavo.lol/'
const TRUSTED_HOSTS = new Set(['wavo.lol', 'www.wavo.lol'])
const ALLOWED_PERMISSIONS = new Set(['media', 'notifications', 'fullscreen'])
let mainWindow

function parseHttpsUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

function isWavoUrl(value) {
  const url = parseHttpsUrl(value)
  return !!url && TRUSTED_HOSTS.has(url.hostname) && !url.port
}

function openInBrowser(rawUrl) {
  const url = parseHttpsUrl(rawUrl)
  if (url) shell.openExternal(url.href).catch(() => {})
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1230,
    height: 800,
    minWidth: 440,
    minHeight: 580,
    show: false,
    title: 'Wavo',
    autoHideMenuBar: true,
    backgroundColor: '#14131f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      devTools: !app.isPackaged
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) console.error('[Wavo desktop] Page load failed:', description, url)
  })

  // Keep remote web content away from arbitrary navigation and OS APIs.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isWavoUrl(url)) return
    event.preventDefault()
    openInBrowser(url)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isWavoUrl(url)) mainWindow?.loadURL(url).catch(() => {})
    else openInBrowser(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.loadURL(HOME).catch((error) => {
    console.error('[Wavo desktop] Cannot open Wavo:', error)
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('lol.wavo.desktop')

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = details?.requestingUrl || contents.getURL()
    callback(isWavoUrl(origin) && ALLOWED_PERMISSIONS.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return isWavoUrl(requestingOrigin) && ALLOWED_PERMISSIONS.has(permission)
  })

  createWindow()

  // Check official published releases. Update download hashes are handled
  // by electron-updater; sign installers before a wide public rollout.
  if (app.isPackaged) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('error', (error) => console.warn('[Wavo desktop] Update check:', error.message))
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 20_000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

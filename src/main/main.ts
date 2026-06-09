import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import {
  getAnchorConfigFromStore,
  resetAnchorConfigInStore,
  saveAnchorConfigToStore,
} from './store'

const isDev = process.env.NODE_ENV === 'development'

let mainWindow: BrowserWindow | null = null
let ipcRegistered = false

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

function registerIpcHandlers() {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle('dialog:openExcel', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const result = await dialog.showOpenDialog(win!, {
      title: '选择 Excel 文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Excel 文件', extensions: ['xlsx', 'xls'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })

    return {
      canceled: result.canceled,
      filePaths: result.filePaths,
    }
  })

  ipcMain.handle('excel:readFile', async (_event, filePath: string) => {
    const buffer = fs.readFileSync(filePath)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })

  ipcMain.handle('config:getAnchorConfig', () => getAnchorConfigFromStore())

  ipcMain.handle('config:saveAnchorConfig', (_event, config: unknown) => {
    saveAnchorConfigToStore(config as ReturnType<typeof getAnchorConfigFromStore>)
    return { ok: true }
  })

  ipcMain.handle('config:resetAnchorConfig', () => resetAnchorConfigInStore())
}

function createMainWindow() {
  const preloadPath = path.join(__dirname, 'preload.js')

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 760,
    title: '直播订单经营看板',
    backgroundColor: '#fdf8f5',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  mainWindow.center()

  if (isDev) {
    void mainWindow.loadURL('http://localhost:5173').catch((err) => {
      console.error('Failed to load dev URL:', err)
    })
  } else {
    const indexHtml = path.join(__dirname, '../renderer/index.html')
    mainWindow.loadFile(indexHtml)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  } else {
    createMainWindow()
  }
})

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    registerIpcHandlers()
    createMainWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  }
})

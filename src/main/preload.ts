import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dashboardAPI', {
  version: '0.1.0',
  openExcelDialog: () => ipcRenderer.invoke('dialog:openExcel'),
  readExcelFile: (filePath: string) => ipcRenderer.invoke('excel:readFile', filePath),
  getAnchorConfig: () => ipcRenderer.invoke('config:getAnchorConfig'),
  saveAnchorConfig: (config: unknown) => ipcRenderer.invoke('config:saveAnchorConfig', config),
  resetAnchorConfig: () => ipcRenderer.invoke('config:resetAnchorConfig'),
})

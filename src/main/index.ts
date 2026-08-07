import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  safeStorage,
  shell,
  Tray
} from 'electron'
import { basename, join, resolve } from 'path'
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'fs'
import {
  bambuGetUserId,
  bambuListDevices,
  bambuLogin,
  bambuLoginWithCode,
  bambuSendVerifyCode,
  type BambuRegion
} from './bambu/cloud'
import { createBambuMqttBridge, type BambuMqttConnectOpts } from './bambu/mqtt'
import { grabBambuJpegFrame, parseBambuCameraUrl } from './bambu/camera'
import { fetchBambuPrintUsageGrams } from './bambu/printUsage'
import { createMoonrakerWsBridge, type MoonrakerWsConnectOpts } from './moonraker/ws'
import { createCrealityNativeBridge, type CrealityNativeConnectOpts } from './creality/ws'
import {
  createCrealityCloudBridge,
  crealityFetchDevices,
  crealityOpenLoginWindow,
  type CrealityCloudRegion
} from './creality/cloud'
import { createElegooSdcpBridge, type ElegooSdcpConnectOpts } from './elegoo/sdcp'
import { createAnycubicLanBridge, type AnycubicLanConnectOpts } from './anycubic/lan'
import {
  createAnycubicCloudBridge,
  anycubicListDevices,
  anycubicValidateToken,
  type AnycubicAuthMode
} from './anycubic/cloud'
import { createFlashforgeBridge, type FlashforgeConnectOpts, flashforgeProbe } from './flashforge/lan'
import {
  cancelLanDiscover,
  scanLanPrinters,
  type LanDiscoverOpts
} from './discover/lanScan'
import { createSnapmakerBridge, type SnapmakerConnectOpts, snapmakerProbe } from './snapmaker/lan'
import {
  createCameraProxyServer,
  discoverCameras,
  fetchSnapshot,
  type CameraDiscoverOpts,
  type CameraProxy
} from './camera/proxy'
import {
  ApiServer,
  defaultSettings,
  normalizeSettings,
  resolveDeviceRefreshMs,
  buildFrpcToml,
  type AppSettings,
  type ApiStatus,
  type HskFwType
} from './api/server'
import { setDevicePollMsGetter } from './pollInterval'
import { fetchHskMeta, syncHskMapping } from './api/hskClient'
import { randomUUID } from 'crypto'
import { newJwtSecret } from './auth/jwt'
import { UserStore } from './auth/users'
import { PrintRequestStore } from './auth/printRequests'
import { resolveAppRole, type AppRole } from '../shared/appRole'

/** Electron 固定配置目录（存放数据根路径指针） */
const APP_HOME = app.getPath('userData')
const LOCATION_FILE = join(APP_HOME, 'data-location.json')

const DATA_FILE_NAMES = [
  'secrets.bin',
  'devices.json',
  'filament-spools.json',
  'monitor-zones.json',
  'app-settings.json',
  'operation-logs.jsonl',
  'users.json',
  'print-requests.json'
] as const
const DATA_DIR_NAMES = ['downloads', 'frpc'] as const

const APP_ROLE: AppRole = resolveAppRole()

let userStore: UserStore | null = null
let printRequestStore: PrintRequestStore | null = null

function ensureAuthStores(): void {
  ensureDirs()
  if (!userStore) {
    userStore = new UserStore(DATA_ROOT, newJwtSecret())
  } else {
    userStore.reloadFromDiskIfNeeded()
  }
  if (!printRequestStore) {
    printRequestStore = new PrintRequestStore(DATA_ROOT)
  }
}

let DATA_ROOT = APP_HOME
let SECRETS_PATH = join(DATA_ROOT, 'secrets.bin')
let DEVICES_PATH = join(DATA_ROOT, 'devices.json')
let FILAMENT_PATH = join(DATA_ROOT, 'filament-spools.json')
let MONITOR_ZONES_PATH = join(DATA_ROOT, 'monitor-zones.json')
let SETTINGS_PATH = join(DATA_ROOT, 'app-settings.json')
let LOGS_PATH = join(DATA_ROOT, 'operation-logs.jsonl')
let LOCAL_FILES_DIR = join(DATA_ROOT, 'downloads')

function refreshDataPaths(): void {
  SECRETS_PATH = join(DATA_ROOT, 'secrets.bin')
  DEVICES_PATH = join(DATA_ROOT, 'devices.json')
  FILAMENT_PATH = join(DATA_ROOT, 'filament-spools.json')
  MONITOR_ZONES_PATH = join(DATA_ROOT, 'monitor-zones.json')
  SETTINGS_PATH = join(DATA_ROOT, 'app-settings.json')
  LOGS_PATH = join(DATA_ROOT, 'operation-logs.jsonl')
  LOCAL_FILES_DIR = join(DATA_ROOT, 'downloads')
}

function readDataLocation(): string {
  try {
    if (!existsSync(LOCATION_FILE)) return APP_HOME
    const raw = JSON.parse(readFileSync(LOCATION_FILE, 'utf8')) as { root?: string }
    const root = typeof raw.root === 'string' ? raw.root.trim() : ''
    if (!root) return APP_HOME
    return resolve(root)
  } catch {
    return APP_HOME
  }
}

function writeDataLocation(root: string): void {
  if (!existsSync(APP_HOME)) mkdirSync(APP_HOME, { recursive: true })
  writeFileSync(LOCATION_FILE, JSON.stringify({ root }, null, 2), 'utf8')
}

function applyDataRoot(root: string): void {
  DATA_ROOT = resolve(root)
  refreshDataPaths()
  ensureDirs()
}

function migrateDataTo(newRoot: string): { copied: string[]; skipped: string[] } {
  const dest = resolve(newRoot)
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
  const copied: string[] = []
  const skipped: string[] = []
  for (const name of DATA_FILE_NAMES) {
    const from = join(DATA_ROOT, name)
    const to = join(dest, name)
    if (!existsSync(from)) {
      skipped.push(name)
      continue
    }
    try {
      copyFileSync(from, to)
      copied.push(name)
    } catch {
      skipped.push(name)
    }
  }
  for (const name of DATA_DIR_NAMES) {
    const from = join(DATA_ROOT, name)
    const to = join(dest, name)
    if (!existsSync(from)) {
      skipped.push(name)
      continue
    }
    try {
      cpSync(from, to, { recursive: true })
      copied.push(name)
    } catch {
      skipped.push(name)
    }
  }
  return { copied, skipped }
}

let mainWindow: BrowserWindow | null = null
let appTray: Tray | null = null
let isQuitting = false
let appSettings: AppSettings = defaultSettings()
setDevicePollMsGetter(() => resolveDeviceRefreshMs(appSettings))
let statusSnapshot: Record<string, unknown> = {}
const pendingControls = new Map<
  string,
  {
    resolve: (v: { ok: boolean; message?: string }) => void
    timer: ReturnType<typeof setTimeout>
  }
>()
const pendingDeviceOps = new Map<
  string,
  {
    resolve: (v: Record<string, unknown>) => void
    timer: ReturnType<typeof setTimeout>
  }
>()

type LanDiscoverState = {
  phase: 'idle' | 'scanning' | 'done' | 'cancelled' | 'error'
  scanned: number
  total: number
  found: number
  message?: string
  hits: unknown[]
}
let lanDiscoverState: LanDiscoverState = {
  phase: 'idle',
  scanned: 0,
  total: 0,
  found: 0,
  hits: []
}
let lanDiscoverRunning = false

const bambuMqtt = createBambuMqttBridge(() => mainWindow)
const moonrakerWs = createMoonrakerWsBridge(() => mainWindow)
const crealityNative = createCrealityNativeBridge(() => mainWindow)
const crealityCloud = createCrealityCloudBridge(() => mainWindow)
const elegooSdcp = createElegooSdcpBridge(() => mainWindow)
const anycubicLan = createAnycubicLanBridge(() => mainWindow)
const anycubicCloud = createAnycubicCloudBridge(() => mainWindow)
const flashforgeLan = createFlashforgeBridge(() => mainWindow)
const snapmakerLan = createSnapmakerBridge(() => mainWindow)
let cameraProxy: CameraProxy | null = null
let cameraProxyPromise: Promise<CameraProxy> | null = null

async function getCameraProxy(): Promise<CameraProxy> {
  if (cameraProxy) return cameraProxy
  if (!cameraProxyPromise) {
    cameraProxyPromise = createCameraProxyServer()
      .then((p) => {
        cameraProxy = p
        return p
      })
      .catch((err) => {
        cameraProxyPromise = null
        throw err
      })
  }
  return cameraProxyPromise
}

function ensureDirs(): void {
  if (!existsSync(APP_HOME)) mkdirSync(APP_HOME, { recursive: true })
  if (!existsSync(DATA_ROOT)) mkdirSync(DATA_ROOT, { recursive: true })
  if (!existsSync(LOCAL_FILES_DIR)) mkdirSync(LOCAL_FILES_DIR, { recursive: true })
}

// 尽早解析自定义数据目录
applyDataRoot(readDataLocation())


function loadAppSettings(): AppSettings {
  ensureDirs()
  if (!existsSync(SETTINGS_PATH)) {
    const s = defaultSettings()
    writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8')
    return s
  }
  try {
    return normalizeSettings(JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')))
  } catch {
    return defaultSettings()
  }
}

function saveAppSettings(settings: AppSettings): void {
  ensureDirs()
  appSettings = normalizeSettings(settings)
  writeFileSync(SETTINGS_PATH, JSON.stringify(appSettings, null, 2), 'utf8')
}

async function requestRendererControl(
  deviceId: string,
  payload: unknown
): Promise<{ ok: boolean; message?: string }> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, message: 'Renderer unavailable' }
  }
  const requestId = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingControls.delete(requestId)
      resolve({ ok: false, message: 'Control timed out' })
    }, 30000)
    pendingControls.set(requestId, { resolve, timer })
    mainWindow!.webContents.send('api:control-request', { requestId, deviceId, payload })
  })
}

const pendingReconnects = new Map<
  string,
  { resolve: (v: { ok: boolean; message?: string }) => void; timer: NodeJS.Timeout }
>()

async function requestRendererReconnect(): Promise<{ ok: boolean; message?: string }> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, message: 'Renderer unavailable — 请保持服务端主窗口运行' }
  }
  const requestId = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingReconnects.delete(requestId)
      resolve({ ok: false, message: 'Reconnect timed out' })
    }, 60000)
    pendingReconnects.set(requestId, { resolve, timer })
    mainWindow!.webContents.send('api:reconnect-request', { requestId })
  })
}

async function requestRendererDeviceOp(req: {
  deviceId: string
  op: 'listFiles' | 'uploadFile' | 'downloadFile'
  filename?: string
  contentBase64?: string
  remotePath?: string
}): Promise<{
  ok: boolean
  message?: string
  files?: Array<{ path: string; size: number; modified?: number }>
  filename?: string
  contentBase64?: string
  contentType?: string
}> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, message: 'Renderer unavailable — open the desktop app window' }
  }
  const requestId = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingDeviceOps.delete(requestId)
      resolve({ ok: false, message: 'Device file operation timed out' })
    }, 120000)
    pendingDeviceOps.set(requestId, {
      resolve: (v) => resolve(v as Awaited<ReturnType<typeof requestRendererDeviceOp>>),
      timer
    })
    mainWindow!.webContents.send('api:device-op-request', { requestId, ...req })
  })
}

async function requestRendererBatchPrint(payload: {
  deviceIds: string[]
  filename: string
  contentBase64?: string
}): Promise<{
  ok: boolean
  results: Array<{ deviceId: string; deviceName: string; ok: boolean; message?: string }>
}> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return {
      ok: false,
      results: payload.deviceIds.map((deviceId) => ({
        deviceId,
        deviceName: deviceId,
        ok: false,
        message: 'Renderer unavailable — open the desktop app window'
      }))
    }
  }
  const requestId = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingDeviceOps.delete(requestId)
      resolve({
        ok: false,
        results: payload.deviceIds.map((deviceId) => ({
          deviceId,
          deviceName: deviceId,
          ok: false,
          message: 'Batch print timed out'
        }))
      })
    }, 300000)
    pendingDeviceOps.set(requestId, {
      resolve: (v) =>
        resolve(
          v as {
            ok: boolean
            results: Array<{ deviceId: string; deviceName: string; ok: boolean; message?: string }>
          }
        ),
      timer
    })
    mainWindow!.webContents.send('api:batch-print-request', { requestId, ...payload })
  })
}

function readDevicesFile(): Array<Record<string, unknown>> {
  if (!existsSync(DEVICES_PATH)) return []
  try {
    const raw = JSON.parse(readFileSync(DEVICES_PATH, 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function deviceHost(d: Record<string, unknown>): string {
  if (typeof d.bambuHost === 'string' && d.bambuHost.trim()) return d.bambuHost.trim()
  const base = typeof d.baseUrl === 'string' ? d.baseUrl : ''
  if (!base) return ''
  try {
    return new URL(base.includes('://') ? base : `http://${base}`).hostname
  } catch {
    return base.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
  }
}

async function listCamerasForDeviceRow(d: Record<string, unknown>) {
  const id = String(d.id || '')
  const secretKey = typeof d.secretKey === 'string' ? d.secretKey : ''
  const apiKey = secretKey ? readSecrets()[secretKey] : undefined
  const cameras = await discoverCameras({
    brand: String(d.brand || ''),
    baseUrl: typeof d.baseUrl === 'string' ? d.baseUrl : undefined,
    host: deviceHost(d) || undefined,
    apiKey
  })
  return {
    deviceId: id,
    name: String(d.name || id),
    brand: String(d.brand || ''),
    cameras: cameras.map((c) => ({
      id: c.id,
      name: c.name,
      streamUrl: c.streamUrl,
      snapshotUrl: c.snapshotUrl
    }))
  }
}

async function listWallCamerasForApi() {
  const devices = readDevicesFile()
  const out: Awaited<ReturnType<typeof listCamerasForDeviceRow>>[] = []
  for (const d of devices) {
    if (!d?.id) continue
    try {
      const row = await listCamerasForDeviceRow(d)
      if (row.cameras.length > 0) out.push(row)
    } catch {
      /* skip device */
    }
  }
  return out
}

async function listDeviceCamerasForApi(deviceId: string) {
  const d = readDevicesFile().find((x) => String(x.id) === deviceId)
  if (!d) return null
  return listCamerasForDeviceRow(d)
}

async function takeCameraSnapshotForApi(url: string, apiKey?: string) {
  let target = url
  try {
    const u = new URL(url)
    if (u.hostname === '127.0.0.1' && u.searchParams.get('url')) {
      target = u.searchParams.get('url') || target
    }
  } catch {
    /* ignore */
  }
  const bambu = parseBambuCameraUrl(target)
  if (bambu) return grabBambuJpegFrame(bambu.host, bambu.code, 12000)
  return fetchSnapshot(target, apiKey)
}

function getDeviceApiKeyForApi(deviceId: string): string | null {
  const d = readDevicesFile().find((x) => String(x.id) === deviceId)
  if (!d || typeof d.secretKey !== 'string' || !d.secretKey) return null
  return readSecrets()[d.secretKey] ?? null
}

const apiServer = new ApiServer({
  getDevicesPath: () => DEVICES_PATH,
  getFilamentPath: () => FILAMENT_PATH,
  getMonitorZonesPath: () => MONITOR_ZONES_PATH,
  getSettings: () => appSettings,
  getStatuses: () => statusSnapshot,
  onControl: requestRendererControl,
  onFilamentChanged: () => {
    mainWindow?.webContents.send('filament:changed')
  },
  onMonitorZonesChanged: () => {
    mainWindow?.webContents.send('monitor:changed')
  },
  onDevicesChanged: () => {
    mainWindow?.webContents.send('devices:changed')
  },
  listWallCameras: listWallCamerasForApi,
  listDeviceCameras: listDeviceCamerasForApi,
  takeCameraSnapshot: takeCameraSnapshotForApi,
  getDeviceApiKey: getDeviceApiKeyForApi,
  setDeviceSecret: (secretKey, value) => {
    const all = readSecrets()
    all[secretKey] = value
    writeSecrets(all)
  },
  deleteDeviceSecret: (secretKey) => {
    const all = readSecrets()
    delete all[secretKey]
    writeSecrets(all)
  },
  onDeviceOp: requestRendererDeviceOp,
  onBatchPrint: requestRendererBatchPrint,
  startLanDiscover: async (opts) => {
    if (lanDiscoverRunning) {
      return { ok: false, message: 'LAN discover already running' }
    }
    lanDiscoverRunning = true
    lanDiscoverState = {
      phase: 'scanning',
      scanned: 0,
      total: 0,
      found: 0,
      hits: [],
      message: 'Scanning…'
    }
    void scanLanPrinters(
      { brands: opts?.brands as LanDiscoverOpts['brands'] },
      (progress) => {
        lanDiscoverState = {
          ...lanDiscoverState,
          phase: progress.phase === 'scanning' ? 'scanning' : progress.phase,
          scanned: progress.scanned,
          total: progress.total,
          found: progress.found,
          message: progress.message
        }
        mainWindow?.webContents.send('discover:lan:progress', progress)
      }
    )
      .then((result) => {
        const hits = result.hits || []
        lanDiscoverState = {
          phase: result.ok ? 'done' : 'error',
          scanned: lanDiscoverState.scanned,
          total: lanDiscoverState.total,
          found: hits.length,
          hits,
          message: result.message || (result.ok ? `Found ${hits.length}` : 'Scan failed')
        }
      })
      .catch((err) => {
        lanDiscoverState = {
          ...lanDiscoverState,
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
          hits: []
        }
      })
      .finally(() => {
        lanDiscoverRunning = false
      })
    return { ok: true }
  },
  getLanDiscover: () => ({ ...lanDiscoverState }),
  cancelLanDiscover: () => {
    cancelLanDiscover()
    lanDiscoverState = { ...lanDiscoverState, phase: 'cancelled', message: 'Cancelled' }
    lanDiscoverRunning = false
  },
  getLogs: (opts) => {
    ensureDirs()
    if (!existsSync(LOGS_PATH)) return []
    const limit = opts?.limit ?? 100
    const deviceId = opts?.deviceId
    const lines = readFileSync(LOGS_PATH, 'utf8').split('\n').filter(Boolean)
    const parsed = lines
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean) as Array<Record<string, unknown>>
    const filtered = deviceId
      ? parsed.filter((e) => String(e.deviceId || '') === deviceId)
      : parsed
    return filtered.reverse().slice(0, limit)
  },
  clearLogs: () => {
    ensureDirs()
    writeFileSync(LOGS_PATH, '', 'utf8')
  },
  patchSettings: async (patch) => {
    try {
      const next = normalizeSettings({ ...appSettings, ...patch })
      const prev = appSettings
      saveAppSettings(next)
      applyLoginItem()
      const needRestart =
        appSettings.apiEnabled !== prev.apiEnabled ||
        appSettings.apiPort !== prev.apiPort ||
        appSettings.apiMode !== prev.apiMode ||
        appSettings.apiKey !== prev.apiKey
      if (APP_ROLE !== 'server' || !appSettings.apiEnabled) {
        await apiServer.stop()
      } else if (needRestart || !apiServer.status().running) {
        await apiServer.start()
      }
      mainWindow?.webContents.send('settings:changed', appSettings)
      return { ok: true, settings: appSettings }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  },
  version: '0.3.0',
  getUserStore: () => {
    ensureAuthStores()
    return userStore
  },
  getPrintRequestStore: () => {
    ensureAuthStores()
    return printRequestStore
  },
  allowLocalAdmin: APP_ROLE === 'server',
  onReconnectDevices: () => requestRendererReconnect(),
  onStartPrintJob: async ({ deviceId, filename, contentBase64 }) => {
    if (contentBase64) {
      const up = await requestRendererDeviceOp({
        deviceId,
        op: 'uploadFile',
        filename,
        contentBase64
      })
      if (!up.ok) return { ok: false, message: up.message || '上传失败' }
    }
    return requestRendererControl(deviceId, { action: 'print_file', filename })
  },
  onApprovedPrint: async ({ deviceId, filename, contentBase64 }) => {
    if (contentBase64) {
      const up = await requestRendererDeviceOp({
        deviceId,
        op: 'uploadFile',
        filename,
        contentBase64
      })
      if (!up.ok) return { ok: false, message: up.message || '上传失败' }
    }
    return requestRendererControl(deviceId, { action: 'print_file', filename })
  }
})

function toBuffer(data: ArrayBuffer | Uint8Array): Buffer {
  if (data instanceof Uint8Array) return Buffer.from(data)
  return Buffer.from(new Uint8Array(data))
}

function sanitizeFileName(name: string): string {
  const base = basename(name || 'download.bin').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  return base || 'download.bin'
}

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(__dirname, '../../resources/icon.png'),
    join(app.getAppPath(), 'resources/icon.png'),
    join(process.cwd(), 'resources/icon.png')
  ]
  return candidates.find((p) => existsSync(p))
}

function applyLoginItem(): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(appSettings.openAtLogin),
      path: process.execPath
    })
  } catch {
    /* ignore */
  }
}

function setupTray(): void {
  if (appTray) return
  const iconPath = resolveAppIcon()
  if (!iconPath) return
  try {
    appTray = new Tray(iconPath)
  } catch {
    return
  }
  appTray.setToolTip('hanye-3D打印机监控台')
  const rebuild = () => {
    appTray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '显示主窗口',
          click: () => {
            if (!mainWindow) mainWindow = createWindow()
            mainWindow.show()
            mainWindow.focus()
          }
        },
        {
          label: 'API 服务',
          enabled: false,
          sublabel: appSettings.apiEnabled ? `端口 ${appSettings.apiPort}` : '未启用'
        },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            isQuitting = true
            app.quit()
          }
        }
      ])
    )
  }
  rebuild()
  appTray.on('double-click', () => {
    if (!mainWindow) mainWindow = createWindow()
    mainWindow.show()
    mainWindow.focus()
  })
}

function createWindow(): BrowserWindow {
  const iconPath = resolveAppIcon()
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: APP_ROLE === 'client' ? 'hanye-3D打印机监控台（客户端）' : 'hanye-3D打印机监控台（服务端）',
    backgroundColor: '#101218',
    icon: iconPath,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // LAN printer APIs (Fluidd/Moonraker/Bambu) often lack CORS headers
      webSecurity: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.on('close', (e) => {
    if (!isQuitting && appSettings.minimizeToTray && appTray) {
      e.preventDefault()
      win.hide()
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function setupAppMenu(): void {
  // Windows/Linux: hide unused default menu bar
  Menu.setApplicationMenu(null)
}

function readSecrets(): Record<string, string> {
  ensureDirs()
  if (!existsSync(SECRETS_PATH)) return {}
  try {
    const buf = readFileSync(SECRETS_PATH)
    if (!safeStorage.isEncryptionAvailable()) {
      return JSON.parse(buf.toString('utf8')) as Record<string, string>
    }
    const plain = safeStorage.decryptString(buf)
    return JSON.parse(plain) as Record<string, string>
  } catch {
    return {}
  }
}

function writeSecrets(data: Record<string, string>): void {
  ensureDirs()
  const json = JSON.stringify(data)
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(SECRETS_PATH, safeStorage.encryptString(json))
  } else {
    writeFileSync(SECRETS_PATH, Buffer.from(json, 'utf8'))
  }
}

function registerIpc(): void {
  ipcMain.handle('app:getRole', () => APP_ROLE)

  ipcMain.handle('auth:localUsers', () => {
    if (APP_ROLE !== 'server') return { ok: false, message: '仅服务端可本地管理用户' }
    ensureAuthStores()
    return { ok: true, users: userStore!.list() }
  })

  ipcMain.handle('auth:localUpsertUser', (_e, payload: unknown) => {
    if (APP_ROLE !== 'server') return { ok: false, message: '仅服务端可本地管理用户' }
    ensureAuthStores()
    try {
      const body = (payload || {}) as Record<string, unknown>
      if (typeof body.id === 'string' && body.id) {
        const user = userStore!.update(body.id, {
          displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
          level: body.level as import('../shared/permissions').UserLevel | undefined,
          enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
          permissions: Array.isArray(body.permissions) ? (body.permissions as string[]) : undefined,
          deviceAcl:
            body.deviceAcl && typeof body.deviceAcl === 'object'
              ? (body.deviceAcl as Record<string, string[]>)
              : undefined,
          password: typeof body.password === 'string' ? body.password : undefined,
          ssoProvider: body.ssoProvider as import('../shared/sso').SsoProviderId | 'none' | undefined,
          ssoExternalId: typeof body.ssoExternalId === 'string' ? body.ssoExternalId : undefined
        })
        return { ok: true, user }
      }
      const user = userStore!.create({
        username: String(body.username || ''),
        password: String(body.password || ''),
        displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
        level: (body.level as import('../shared/permissions').UserLevel) || 'viewer',
        permissions: Array.isArray(body.permissions) ? (body.permissions as string[]) : undefined,
        deviceAcl:
          body.deviceAcl && typeof body.deviceAcl === 'object'
            ? (body.deviceAcl as Record<string, string[]>)
            : undefined,
        ssoProvider: body.ssoProvider as import('../shared/sso').SsoProviderId | 'none' | undefined,
        ssoExternalId: typeof body.ssoExternalId === 'string' ? body.ssoExternalId : undefined
      })
      return { ok: true, user }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('auth:localDeleteUser', (_e, id: string) => {
    if (APP_ROLE !== 'server') return { ok: false, message: '仅服务端可本地管理用户' }
    ensureAuthStores()
    try {
      userStore!.remove(String(id || ''))
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('auth:localPrintRequests', (_e, filter?: { status?: string; deviceId?: string }) => {
    ensureAuthStores()
    const status = filter?.status
      ? (filter.status.split(',').map((s) => s.trim()) as import('./auth/printRequests').PrintRequestStatus[])
      : undefined
    return {
      ok: true,
      requests: printRequestStore!.list({
        deviceId: filter?.deviceId,
        status
      })
    }
  })

  ipcMain.handle(
    'auth:localReviewPrint',
    async (_e, payload: { id: string; action: 'approve' | 'reject' | 'start' | 'cancel'; note?: string }) => {
      ensureAuthStores()
      try {
        const starter = { id: 'local', name: '本机管理' }
        if (payload.action === 'approve') {
          const row = printRequestStore!.approve(payload.id, starter, payload.note)
          return { ok: true, request: row }
        }
        if (payload.action === 'reject') {
          const row = printRequestStore!.reject(payload.id, starter, payload.note)
          return { ok: true, request: row }
        }
        if (payload.action === 'cancel') {
          const row = printRequestStore!.cancel(payload.id, starter.id, true)
          return { ok: true, request: row }
        }
        if (payload.action === 'start') {
          const full = printRequestStore!.markPrinting(payload.id, starter)
          if (full.contentBase64) {
            const up = await requestRendererDeviceOp({
              deviceId: full.deviceId,
              op: 'uploadFile',
              filename: full.filename,
              contentBase64: full.contentBase64
            })
            if (!up.ok) {
              const failed = printRequestStore!.markFailed(payload.id, up.message || '上传失败')
              return { ok: false, message: up.message || '上传失败', request: failed }
            }
          }
          const result = await requestRendererControl(full.deviceId, {
            action: 'print_file',
            filename: full.filename
          })
          if (!result.ok) {
            const failed = printRequestStore!.markFailed(payload.id, result.message || '下发打印失败')
            return { ok: false, message: result.message || '下发打印失败', request: failed }
          }
          const done = printRequestStore!.markDone(payload.id)
          return { ok: true, request: done }
        }
        return { ok: false, message: '未知操作' }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'auth:localSubmitPrint',
    async (
      _e,
      payload: {
        deviceId: string
        deviceName?: string
        filename: string
        contentBase64: string
        note?: string
        /** server local always queues directly */
        status?: 'pending' | 'queued'
      }
    ) => {
      if (APP_ROLE !== 'server') return { ok: false, message: '仅服务端可本地提交' }
      ensureAuthStores()
      try {
        if (!payload.deviceId || !payload.filename || !payload.contentBase64) {
          return { ok: false, message: '需要 deviceId、filename、contentBase64' }
        }
        if (!/\.gcode$/i.test(String(payload.filename))) {
          return { ok: false, message: '仅支持 .gcode 文件' }
        }
        const row = printRequestStore!.create({
          requesterId: 'local',
          requesterName: '本机管理',
          deviceId: payload.deviceId,
          deviceName: payload.deviceName || payload.deviceId,
          filename: payload.filename,
          contentBase64: payload.contentBase64,
          note: payload.note,
          status: payload.status || 'queued'
        })
        return { ok: true, request: row, queued: true, queuePosition: row.queuePosition }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('secrets:get', (_e, key: string) => {
    const all = readSecrets()
    return all[key] ?? null
  })

  ipcMain.handle('secrets:set', (_e, key: string, value: string) => {
    const all = readSecrets()
    all[key] = value
    writeSecrets(all)
    return true
  })

  ipcMain.handle('secrets:delete', (_e, key: string) => {
    const all = readSecrets()
    delete all[key]
    writeSecrets(all)
    return true
  })

  ipcMain.handle('window:minimize', () => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow()
    win?.minimize()
    return true
  })

  ipcMain.handle('window:maximize', () => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow()
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.handle('window:close', () => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow()
    win?.close()
    return true
  })

  ipcMain.handle('window:isMaximized', () => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow()
    return win?.isMaximized() ?? false
  })

  ipcMain.handle('devices:load', () => {
    ensureDirs()
    if (!existsSync(DEVICES_PATH)) return []
    try {
      return JSON.parse(readFileSync(DEVICES_PATH, 'utf8'))
    } catch {
      return []
    }
  })

  ipcMain.handle('devices:save', (_e, devices: unknown) => {
    ensureDirs()
    writeFileSync(DEVICES_PATH, JSON.stringify(devices, null, 2), 'utf8')
    return true
  })

  ipcMain.handle('filament:load', () => {
    ensureDirs()
    if (!existsSync(FILAMENT_PATH)) return []
    try {
      return JSON.parse(readFileSync(FILAMENT_PATH, 'utf8'))
    } catch {
      return []
    }
  })

  ipcMain.handle('filament:save', (_e, spools: unknown) => {
    ensureDirs()
    writeFileSync(FILAMENT_PATH, JSON.stringify(spools, null, 2), 'utf8')
    return true
  })

  ipcMain.handle('monitor:load', () => {
    ensureDirs()
    if (!existsSync(MONITOR_ZONES_PATH)) return []
    try {
      return JSON.parse(readFileSync(MONITOR_ZONES_PATH, 'utf8'))
    } catch {
      return []
    }
  })

  ipcMain.handle('monitor:save', (_e, zones: unknown) => {
    ensureDirs()
    writeFileSync(MONITOR_ZONES_PATH, JSON.stringify(zones, null, 2), 'utf8')
    return true
  })

  ipcMain.handle('settings:pickBackgroundImage', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择背景图片',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false as const, message: '已取消' }
    }
    const file = result.filePaths[0]
    try {
      const buf = readFileSync(file)
      if (buf.length > 1_800_000) {
        return { ok: false as const, message: '图片过大（请小于约 1.5MB）' }
      }
      const ext = basename(file).split('.').pop()?.toLowerCase() || 'png'
      const mime =
        ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'gif'
              ? 'image/gif'
              : ext === 'bmp'
                ? 'image/bmp'
                : 'image/png'
      return {
        ok: true as const,
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`
      }
    } catch (err) {
      return {
        ok: false as const,
        message: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('settings:load', () => {
    appSettings = loadAppSettings()
    return appSettings
  })

  ipcMain.handle('settings:save', async (_e, next: unknown) => {
    const prev = appSettings
    saveAppSettings(normalizeSettings(next))
    applyLoginItem()
    const needRestart =
      appSettings.apiEnabled !== prev.apiEnabled ||
      appSettings.apiPort !== prev.apiPort ||
      appSettings.apiMode !== prev.apiMode ||
      appSettings.apiKey !== prev.apiKey
    let status: ApiStatus
    if (APP_ROLE !== 'server' || !appSettings.apiEnabled) {
      status = await apiServer.stop()
    } else if (needRestart || !apiServer.status().running) {
      status = await apiServer.start()
    } else {
      status = apiServer.status()
    }
    return { settings: appSettings, status }
  })

  ipcMain.handle('api:status', () => apiServer.status())

  ipcMain.handle('api:start', async () => {
    if (APP_ROLE !== 'server') {
      return { ...apiServer.status(), running: false, lastError: '仅服务端可启动 API' }
    }
    appSettings = { ...appSettings, apiEnabled: true }
    saveAppSettings(appSettings)
    return apiServer.start()
  })

  ipcMain.handle('api:stop', async () => {
    if (APP_ROLE !== 'server') {
      return apiServer.stop()
    }
    appSettings = { ...appSettings, apiEnabled: false }
    saveAppSettings(appSettings)
    return apiServer.stop()
  })

  ipcMain.handle('api:pushStatuses', (_e, statuses: unknown) => {
    if (statuses && typeof statuses === 'object') {
      statusSnapshot = statuses as Record<string, unknown>
      apiServer.publishStatuses(statusSnapshot)
    }
    return true
  })

  ipcMain.handle('hsk:fetchMeta', async (_e, apiKey?: string) => {
    const key = (typeof apiKey === 'string' && apiKey.trim() ? apiKey : appSettings.hskApiKey) || ''
    return fetchHskMeta(key)
  })

  ipcMain.handle(
    'hsk:syncMapping',
    async (
      _e,
      payload?: {
        apiKey?: string
        domain?: string
        fwType?: number
        memo?: string
      }
    ) => {
      const key =
        (typeof payload?.apiKey === 'string' && payload.apiKey.trim()
          ? payload.apiKey
          : appSettings.hskApiKey) || ''
      const domain =
        (typeof payload?.domain === 'string' && payload.domain.trim()
          ? payload.domain
          : appSettings.hskDomain) || ''
      const fwRaw = Number(payload?.fwType ?? appSettings.hskFwType ?? 2)
      const fwType: HskFwType = fwRaw === 1 || fwRaw === 3 ? fwRaw : 2
      if (!appSettings.apiEnabled) {
        return { ok: false as const, message: '请先启用本软件 API 服务并保存' }
      }
      const result = await syncHskMapping({
        apiKey: key,
        domain,
        servicePort: appSettings.apiPort,
        fwType,
        memo: typeof payload?.memo === 'string' ? payload.memo : appSettings.hskMemo
      })
      if (!result.ok) return result
      appSettings = normalizeSettings({
        ...appSettings,
        apiAccessMode: 'sunlogin',
        hskEnabled: true,
        hskApiKey: key,
        hskDomain: result.hskDomain,
        hskExternalPort: result.hskExternalPort,
        hskFwType: result.hskFwType
      })
      saveAppSettings(appSettings)
      return {
        ...result,
        settings: appSettings,
        status: apiServer.status()
      }
    }
  )

  ipcMain.handle('shell:openExternal', async (_e, url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle('frpc:exportConfig', async () => {
    ensureDirs()
    const dir = join(DATA_ROOT, 'frpc')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const confPath = join(dir, 'frpc.toml')
    writeFileSync(confPath, buildFrpcToml(appSettings), 'utf8')
    await shell.openPath(dir)
    return { ok: true as const, path: confPath }
  })

  ipcMain.handle('frpc:getToml', () => buildFrpcToml(appSettings))

  ipcMain.on(
    'api:control-result',
    (
      _e,
      result: { requestId: string; ok: boolean; message?: string }
    ) => {
      const pending = pendingControls.get(result.requestId)
      if (!pending) return
      clearTimeout(pending.timer)
      pendingControls.delete(result.requestId)
      pending.resolve({ ok: result.ok, message: result.message })
    }
  )

  ipcMain.on(
    'api:reconnect-result',
    (_e, result: { requestId: string; ok: boolean; message?: string }) => {
      const pending = pendingReconnects.get(result.requestId)
      if (!pending) return
      clearTimeout(pending.timer)
      pendingReconnects.delete(result.requestId)
      pending.resolve({ ok: result.ok, message: result.message })
    }
  )

  ipcMain.on('api:device-op-result', (_e, result: { requestId: string } & Record<string, unknown>) => {
    const pending = pendingDeviceOps.get(result.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingDeviceOps.delete(result.requestId)
    pending.resolve(result)
  })

  ipcMain.on(
    'api:batch-print-result',
    (
      _e,
      result: {
        requestId: string
        ok: boolean
        results: Array<{ deviceId: string; deviceName: string; ok: boolean; message?: string }>
      }
    ) => {
      const pending = pendingDeviceOps.get(result.requestId)
      if (!pending) return
      clearTimeout(pending.timer)
      pendingDeviceOps.delete(result.requestId)
      pending.resolve(result)
    }
  )

  ipcMain.handle('notify:show', (_e, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
    return true
  })

  ipcMain.handle('tray:setStatus', (_e, payload: { errorCount?: number; printingCount?: number }) => {
    if (!appTray) return false
    const err = Number(payload?.errorCount) || 0
    const printing = Number(payload?.printingCount) || 0
    const tip =
      err > 0
        ? `hanye-3D打印机监控台 · ${err} 台异常`
        : printing > 0
          ? `hanye-3D打印机监控台 · ${printing} 台打印中`
          : 'hanye-3D打印机监控台'
    appTray.setToolTip(tip)
    return true
  })

  ipcMain.handle(
    'logs:append',
    (
      _e,
      entry: {
        time: string
        deviceId: string
        deviceName: string
        action: string
        result: string
        detail?: string
      }
    ) => {
      ensureDirs()
      appendFileSync(LOGS_PATH, `${JSON.stringify(entry)}\n`, 'utf8')
      return true
    }
  )

  ipcMain.handle('logs:read', () => {
    ensureDirs()
    if (!existsSync(LOGS_PATH)) return []
    const lines = readFileSync(LOGS_PATH, 'utf8').split('\n').filter(Boolean)
    return lines
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .reverse()
      .slice(0, 500)
  })

  ipcMain.handle('logs:export', async () => {
    ensureDirs()
    if (!existsSync(LOGS_PATH)) return { ok: false, path: null }
    const dest = join(app.getPath('documents'), `printer-monitor-logs-${Date.now()}.jsonl`)
    writeFileSync(dest, readFileSync(LOGS_PATH))
    return { ok: true, path: dest }
  })

  ipcMain.handle('bambu:checkPlugin', () => {
    const candidates = [
      join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Bambu Studio'),
      join(process.env['ProgramFiles'] || 'C:\\Program Files', 'BambuLab', 'Bambu Studio'),
      join(process.env['LOCALAPPDATA'] || '', 'BambuStudio')
    ]
    const installed = candidates.some((p) => existsSync(p))
    return {
      installed,
      hint: installed
        ? '检测到 Bambu Studio 相关目录'
        : '未检测到 Bambu Studio；局域网 MQTT 仍可直连打印机（需开启开发者模式/局域网模式）'
    }
  })

  ipcMain.handle(
    'bambu:login',
    async (_e, payload: { region: BambuRegion; account: string; password: string }) => {
      return bambuLogin(payload.region, payload.account, payload.password)
    }
  )

  ipcMain.handle(
    'bambu:loginWithCode',
    async (_e, payload: { region: BambuRegion; account: string; code: string }) => {
      return bambuLoginWithCode(payload.region, payload.account, payload.code)
    }
  )

  ipcMain.handle(
    'bambu:sendCode',
    async (_e, payload: { region: BambuRegion; account: string }) => {
      return bambuSendVerifyCode(payload.region, payload.account)
    }
  )

  ipcMain.handle(
    'bambu:fetchDevices',
    async (_e, payload: { region: BambuRegion; token: string }) => {
      const uidRes = await bambuGetUserId(payload.region, payload.token)
      if (!uidRes.ok || !uidRes.uid) {
        return { ok: false, devices: [], uid: null, message: uidRes.message || '获取用户失败' }
      }
      const list = await bambuListDevices(payload.region, payload.token)
      return { ...list, uid: uidRes.uid }
    }
  )

  ipcMain.handle('bambu:mqtt:connect', async (_e, opts: BambuMqttConnectOpts) => {
    return bambuMqtt.connect(opts)
  })

  ipcMain.handle('bambu:mqtt:disconnect', async (_e, connectionId: string) => {
    await bambuMqtt.disconnect(connectionId)
    return true
  })

  ipcMain.handle(
    'bambu:mqtt:control',
    async (
      _e,
      payload: {
        connectionId: string
        action: string
        temperature?: number
        heater?: string
        percent?: number
        filename?: string
        slot?: number
        fan?: 'part' | 'chamber'
      }
    ) => {
      await bambuMqtt.control(payload.connectionId, payload.action, payload)
      return true
    }
  )

  ipcMain.handle(
    'bambu:printUsage',
    async (
      _e,
      opts: { host: string; accessCode: string; gcodeFile?: string; filename?: string }
    ) => {
      return fetchBambuPrintUsageGrams(opts || { host: '', accessCode: '' })
    }
  )

  ipcMain.handle('moonraker:ws:connect', async (_e, opts: MoonrakerWsConnectOpts) => {
    return moonrakerWs.connect(opts)
  })

  ipcMain.handle('moonraker:ws:disconnect', async (_e, connectionId: string) => {
    await moonrakerWs.disconnect(connectionId)
    return true
  })

  ipcMain.handle('creality:native:connect', async (_e, opts: CrealityNativeConnectOpts) => {
    return crealityNative.connect(opts)
  })

  ipcMain.handle('creality:native:disconnect', async (_e, connectionId: string) => {
    await crealityNative.disconnect(connectionId)
    return true
  })

  ipcMain.handle('elegoo:sdcp:connect', async (_e, opts: ElegooSdcpConnectOpts) => {
    return elegooSdcp.connect(opts)
  })

  ipcMain.handle('elegoo:sdcp:disconnect', async (_e, connectionId: string) => {
    await elegooSdcp.disconnect(connectionId)
    return true
  })

  ipcMain.handle(
    'elegoo:sdcp:control',
    async (
      _e,
      payload: {
        connectionId: string
        action: string
        percent?: number
        fan?: 'part' | 'chamber'
      }
    ) => {
      await elegooSdcp.control(payload.connectionId, payload.action, payload)
      return true
    }
  )

  ipcMain.handle('anycubic:lan:connect', async (_e, opts: AnycubicLanConnectOpts) => {
    return anycubicLan.connect(opts)
  })

  ipcMain.handle('anycubic:lan:disconnect', async (_e, connectionId: string) => {
    await anycubicLan.disconnect(connectionId)
    return true
  })

  ipcMain.handle(
    'anycubic:lan:control',
    async (
      _e,
      payload: {
        connectionId: string
        action: string
        temperature?: number
        heater?: string
        percent?: number
      }
    ) => {
      await anycubicLan.control(payload.connectionId, payload.action, payload)
      return true
    }
  )

  ipcMain.handle(
    'anycubic:cloud:validate',
    async (_e, payload: { token: string; mode: AnycubicAuthMode }) => {
      return anycubicValidateToken(payload.token, payload.mode)
    }
  )

  ipcMain.handle(
    'anycubic:cloud:listDevices',
    async (_e, payload: { token: string; mode: AnycubicAuthMode }) => {
      return anycubicListDevices(payload.token, payload.mode)
    }
  )

  ipcMain.handle(
    'anycubic:cloud:connect',
    async (
      _e,
      opts: {
        connectionId: string
        token: string
        printerId: string
        mode?: AnycubicAuthMode
      }
    ) => {
      return anycubicCloud.connect(opts)
    }
  )

  ipcMain.handle('anycubic:cloud:disconnect', async (_e, connectionId: string) => {
    await anycubicCloud.disconnect(connectionId)
    return true
  })

  ipcMain.handle(
    'anycubic:cloud:control',
    async (_e, payload: { connectionId: string; action: string }) => {
      await anycubicCloud.control(payload.connectionId, payload.action)
      return true
    }
  )

  ipcMain.handle('creality:cloud:openLogin', async (_e, region: CrealityCloudRegion) => {
    return crealityOpenLoginWindow(region || 'china')
  })

  ipcMain.handle(
    'creality:cloud:listDevices',
    async (
      _e,
      payload: { region: CrealityCloudRegion; token: string; userId: string }
    ) => {
      return crealityFetchDevices(payload.region || 'china', payload.token, payload.userId)
    }
  )

  ipcMain.handle(
    'creality:cloud:connect',
    async (
      _e,
      opts: {
        connectionId: string
        token: string
        userId: string
        deviceId: string
        region?: CrealityCloudRegion
        host?: string
      }
    ) => {
      return crealityCloud.connect(opts)
    }
  )

  ipcMain.handle('creality:cloud:disconnect', async (_e, connectionId: string) => {
    await crealityCloud.disconnect(connectionId)
    return true
  })

  ipcMain.handle(
    'creality:cloud:control',
    async (_e, payload: { connectionId: string; action: string }) => {
      await crealityCloud.control(payload.connectionId, payload.action)
      return true
    }
  )

  ipcMain.handle('flashforge:lan:probe', async (_e, opts: FlashforgeConnectOpts) => {
    return flashforgeProbe(opts.host, opts.serial, opts.checkCode)
  })

  ipcMain.handle('discover:lan:scan', async (_e, opts?: LanDiscoverOpts) => {
    return scanLanPrinters(opts || {}, (progress) => {
      mainWindow?.webContents.send('discover:lan:progress', progress)
    })
  })

  ipcMain.handle('discover:lan:cancel', () => {
    cancelLanDiscover()
    return true
  })

  ipcMain.handle('flashforge:lan:connect', async (_e, opts: FlashforgeConnectOpts) => {
    return flashforgeLan.connect(opts)
  })

  ipcMain.handle('flashforge:lan:disconnect', async (_e, connectionId: string) => {
    await flashforgeLan.disconnect(connectionId)
    return true
  })

  ipcMain.handle(
    'flashforge:lan:control',
    async (_e, payload: { connectionId: string; action: string }) => {
      await flashforgeLan.control(payload.connectionId, payload.action)
      return true
    }
  )

  ipcMain.handle('snapmaker:lan:probe', async (_e, opts: SnapmakerConnectOpts) => {
    return snapmakerProbe(opts.host, opts.token)
  })

  ipcMain.handle('snapmaker:lan:connect', async (_e, opts: SnapmakerConnectOpts) => {
    return snapmakerLan.connect(opts)
  })

  ipcMain.handle('snapmaker:lan:disconnect', async (_e, connectionId: string) => {
    await snapmakerLan.disconnect(connectionId)
    return true
  })

  ipcMain.handle(
    'snapmaker:lan:control',
    async (_e, payload: { connectionId: string; action: string }) => {
      await snapmakerLan.control(payload.connectionId, payload.action)
      return true
    }
  )

  ipcMain.handle(
    'localFiles:save',
    (
      _e,
      payload: { fileName: string; data: ArrayBuffer | Uint8Array; subdir?: string }
    ) => {
      ensureDirs()
      const dir = payload.subdir
        ? join(LOCAL_FILES_DIR, sanitizeFileName(payload.subdir))
        : LOCAL_FILES_DIR
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const fileName = sanitizeFileName(payload.fileName)
      const dest = join(dir, fileName)
      writeFileSync(dest, toBuffer(payload.data))
      return { ok: true, path: dest }
    }
  )

  ipcMain.handle(
    'localFiles:saveAs',
    async (
      _e,
      payload: { fileName: string; data: ArrayBuffer | Uint8Array }
    ) => {
      const fileName = sanitizeFileName(payload.fileName)
      const result = await dialog.showSaveDialog({
        title: '保存文件',
        defaultPath: join(app.getPath('documents'), fileName),
        filters: [
          { name: 'Excel', extensions: ['xlsx'] },
          { name: 'G-code', extensions: ['gcode', 'gco', 'nc', 'bgcode'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePath) return { ok: false, path: null }
      writeFileSync(result.filePath, toBuffer(payload.data))
      return { ok: true, path: result.filePath }
    }
  )

  ipcMain.handle('localFiles:list', () => {
    ensureDirs()
    try {
      const results: Array<{ name: string; path: string; size: number; modified: number }> = []
      const walk = (dir: string, prefix = '') => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name)
          const st = statSync(full)
          if (st.isDirectory()) {
            walk(full, prefix ? `${prefix}/${name}` : name)
          } else if (st.isFile()) {
            results.push({
              name: prefix ? `${prefix}/${name}` : name,
              path: full,
              size: st.size,
              modified: Math.floor(st.mtimeMs / 1000)
            })
          }
        }
      }
      walk(LOCAL_FILES_DIR)
      return results.sort((a, b) => b.modified - a.modified)
    } catch {
      return []
    }
  })

  ipcMain.handle('localFiles:getDir', () => {
    ensureDirs()
    return LOCAL_FILES_DIR
  })

  ipcMain.handle('localFiles:openDir', async () => {
    ensureDirs()
    await shell.openPath(LOCAL_FILES_DIR)
    return true
  })

  ipcMain.handle('dataRoot:get', () => {
    ensureDirs()
    return {
      root: DATA_ROOT,
      defaultRoot: APP_HOME,
      downloads: LOCAL_FILES_DIR,
      isCustom: resolve(DATA_ROOT) !== resolve(APP_HOME)
    }
  })

  ipcMain.handle('dataRoot:open', async () => {
    ensureDirs()
    await shell.openPath(DATA_ROOT)
    return true
  })

  ipcMain.handle('dataRoot:choose', async () => {
    const opts = {
      title: '选择数据目录',
      properties: ['openDirectory', 'createDirectory'] as Array<
        'openDirectory' | 'createDirectory'
      >
    }
    const res = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return { ok: false as const, cancelled: true as const }
    return { ok: true as const, path: res.filePaths[0] }
  })

  ipcMain.handle(
    'dataRoot:set',
    async (_e, payload: { path?: string; migrate?: boolean; reset?: boolean }) => {
      try {
        const nextRoot = payload?.reset
          ? APP_HOME
          : typeof payload?.path === 'string'
            ? resolve(payload.path.trim())
            : ''
        if (!nextRoot) return { ok: false as const, message: '路径无效' }
        if (resolve(nextRoot) === resolve(DATA_ROOT)) {
          return {
            ok: true as const,
            root: DATA_ROOT,
            message: '已是当前数据目录',
            migrated: false
          }
        }

        let migrated = false
        let copied: string[] = []
        if (payload?.migrate !== false && !payload?.reset) {
          const result = migrateDataTo(nextRoot)
          copied = result.copied
          migrated = copied.length > 0
        } else if (payload?.reset && payload?.migrate) {
          const result = migrateDataTo(nextRoot)
          copied = result.copied
          migrated = copied.length > 0
        }

        if (!existsSync(nextRoot)) mkdirSync(nextRoot, { recursive: true })
        writeDataLocation(nextRoot)
        applyDataRoot(nextRoot)
        // Drop in-memory auth stores so they reopen under the new data root
        userStore = null
        printRequestStore = null
        ensureAuthStores()
        appSettings = loadAppSettings()
        applyLoginItem()

        return {
          ok: true as const,
          root: DATA_ROOT,
          defaultRoot: APP_HOME,
          downloads: LOCAL_FILES_DIR,
          migrated,
          copied,
          settings: appSettings,
          message: migrated
            ? '已切换数据目录并迁移现有数据'
            : '已切换数据目录（未迁移旧数据）'
        }
      } catch (err) {
        return {
          ok: false as const,
          message: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )

  ipcMain.handle('camera:discover', async (_e, opts: CameraDiscoverOpts) => {
    try {
      const found = await discoverCameras(opts)
      console.log(
        '[camera:discover]',
        opts.brand,
        opts.baseUrl || opts.host,
        `→ ${found.length} candidate(s)`
      )
      let proxy: CameraProxy | null = null
      try {
        proxy = await getCameraProxy()
      } catch (err) {
        console.error('[camera:proxy] init failed, using remote URLs', err)
      }
      const key = opts.apiKey
      return found.map((c) => {
        const stream = c.streamUrl || c.snapshotUrl || ''
        const snapTarget = c.snapshotUrl || c.streamUrl || stream
        const isBambuCam = stream.startsWith('bambu-cam://') || snapTarget.startsWith('bambu-cam://')
        return {
          id: c.id,
          name: c.name,
          remoteStreamUrl: c.streamUrl,
          remoteSnapshotUrl: c.snapshotUrl,
          streamUrl: isBambuCam || !proxy ? stream : proxy.streamUrlFor(stream, key),
          snapshotUrl: isBambuCam || !proxy ? snapTarget : proxy.snapshotUrlFor(snapTarget, key)
        }
      })
    } catch (err) {
      console.error('[camera:discover] failed', err)
      return []
    }
  })

  ipcMain.handle(
    'camera:snapshot',
    async (_e, payload: { url: string; apiKey?: string }) => {
      let target = payload.url
      try {
        const u = new URL(payload.url)
        if (u.hostname === '127.0.0.1' && u.searchParams.get('url')) {
          target = u.searchParams.get('url') || target
        }
      } catch {
        // ignore
      }

      const bambu = parseBambuCameraUrl(target)
      if (bambu) {
        return grabBambuJpegFrame(bambu.host, bambu.code, 12000)
      }

      return fetchSnapshot(target, payload.apiKey)
    }
  )
}

app.whenReady().then(async () => {
  ensureDirs()
  ensureAuthStores()
  setupAppMenu()
  appSettings = loadAppSettings()
  if (APP_ROLE === 'server') {
    // Server always hosts API for clients
    appSettings = normalizeSettings({
      ...appSettings,
      apiEnabled: true,
      apiMode: 'control'
    })
    saveAppSettings(appSettings)
  }
  applyLoginItem()
  registerIpc()
  setupTray()
  mainWindow = createWindow()
  if (APP_ROLE === 'server' && appSettings.apiEnabled) {
    await apiServer.start()
  } else if (APP_ROLE !== 'server') {
    // Client must never host API — shared settings may have apiEnabled=true
    await apiServer.stop()
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  void apiServer.stop()
  void bambuMqtt.disconnectAll()
  void moonrakerWs.disconnectAll()
  void crealityNative.disconnectAll()
  void crealityCloud.disconnectAll()
  void elegooSdcp.disconnectAll()
  void anycubicLan.disconnectAll()
  void anycubicCloud.disconnectAll()
  void flashforgeLan.disconnectAll()
  void snapmakerLan.disconnectAll()
  cameraProxy?.close()
  cameraProxy = null
  if (process.platform !== 'darwin') {
    if (appSettings.minimizeToTray && appTray && !isQuitting) {
      // keep process for tray
      return
    }
    app.quit()
  }
})

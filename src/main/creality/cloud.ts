import axios from 'axios'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import type { BrowserWindow as BW } from 'electron'
import { getDevicePollMs } from '../pollInterval'

export type CrealityCloudRegion = 'china' | 'global'

export type CrealityCloudDevice = {
  id: string
  name: string
  model?: string
  online: boolean
  /** LAN IP if cloud returns one — can fall back to local WS */
  host?: string
}

export type CrealityLivePatch = {
  connectionId: string
  health: 'online' | 'offline' | 'warning' | 'error' | 'connecting'
  state: string
  progress: number
  remainingSeconds?: number
  layer?: number
  layerTotal?: number
  extruder?: { actual: number; target: number }
  bed?: { actual: number; target: number }
  fanSpeed?: number
  printSpeed?: number
  filename?: string
  message?: string
  updatedAt: string
}

type Session = {
  token: string
  userId: string
  region: CrealityCloudRegion
  deviceId: string
  host?: string
  timer: ReturnType<typeof setInterval> | null
}

const sessions = new Map<string, Session>()

function cloudBase(region: CrealityCloudRegion): string {
  // model-admin.crealitygroup.com cert expired; official web app uses api.crealitycloud.*
  return region === 'china' ? 'https://api.crealitycloud.cn' : 'https://api.crealitycloud.com'
}

function webBase(region: CrealityCloudRegion): string {
  return region === 'china' ? 'https://www.crealitycloud.cn' : 'https://www.crealitycloud.com'
}

function headers(token: string, userId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    __CXY_APP_ID_: 'creality_model',
    __CXY_OS_LANG_: '0',
    __CXY_DUID_: randomUUID().replace(/-/g, ''),
    __CXY_OS_VER_: 'Windows',
    __CXY_PLATFORM_: '14',
    __CXY_REQUESTID_: randomUUID(),
    __CXY_UID_: userId,
    __CXY_TOKEN_: token
  }
}

async function postJson(
  region: CrealityCloudRegion,
  path: string,
  token: string,
  userId: string,
  body: unknown = {}
): Promise<Record<string, unknown>> {
  const { data } = await axios.post(`${cloudBase(region)}${path}`, body, {
    headers: headers(token, userId),
    timeout: 20000
  })
  return data as Record<string, unknown>
}

/** User-bound printers (Creality Print deviceMgr). NOT /device/deviceList (that is model catalog). */
const DEVICE_LIST_PATHS = [
  '/api/rest/print/cluster/devices/getDevices',
  '/api/cxy/v2/device/user/deviceList',
  '/api/cxy/v2/device/list'
]

function flattenDevices(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return []
  const p = payload as Record<string, unknown>
  const candidates = [p.result, p.data, p]
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Record<string, unknown>[]
    if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>
      for (const key of ['list', 'deviceList', 'devices', 'printerList', 'rows']) {
        if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[]
      }
    }
  }
  return []
}

/** Catalog rows (HALOT-X1 / K2 SE …) and ephemeral getToken ghosts must not appear as printers. */
function isBoundPrinter(raw: Record<string, unknown>): boolean {
  if (Array.isArray(raw.deviceMethod) || Array.isArray(raw.deviceItems)) return false
  if (raw.thumbnail && !raw.tbId && !raw.macAddress && !raw.deviceName) return false
  const tbId = String(raw.tbId || '').trim()
  const mac = String(raw.macAddress || raw.mac || '').trim()
  const numericId = Number(raw.deviceId)
  const state = Number(raw.deviceState)
  if (state === -2) return false
  if (tbId) return true
  if (mac && Number.isFinite(numericId) && numericId > 0) return true
  if (Number.isFinite(numericId) && numericId > 0 && (raw.model || raw.deviceType)) return true
  return false
}

function mapDevice(raw: Record<string, unknown>): CrealityCloudDevice {
  const numericId = Number(raw.deviceId)
  const id = String(
    (Number.isFinite(numericId) && numericId > 0 ? numericId : '') ||
      raw.tbId ||
      raw.id ||
      raw.printerId ||
      raw.iotId ||
      raw.device_id ||
      raw.deviceName ||
      ''
  )
  const deviceType =
    raw.deviceType && typeof raw.deviceType === 'object'
      ? (raw.deviceType as Record<string, unknown>)
      : null
  const name = String(
    raw.aliasName || raw.deviceName || raw.name || raw.nickname || raw.nickName || raw.modelName || id
  )
  const model = String(
    deviceType?.name || raw.modelName || raw.model || raw.printerType || deviceType?.internalName || ''
  )
  const host =
    String(raw.ip || raw.wanip || raw.localIp || raw.deviceIp || raw.netIP || '').trim() || undefined
  const online =
    raw.online === true ||
    raw.isOnline === true ||
    Number(raw.onlineStatus) === 1 ||
    Number(raw.deviceState) === 1 ||
    String(raw.state) === 'online' ||
    Number(raw.status) === 1
  return { id, name, model: model || undefined, online, host }
}

export async function crealityFetchDevices(
  region: CrealityCloudRegion,
  token: string,
  userId: string
): Promise<{ ok: boolean; devices: CrealityCloudDevice[]; message?: string }> {
  const errors: string[] = []
  for (const path of DEVICE_LIST_PATHS) {
    try {
      const body = path.includes('getDevices') ? { page: 1, pageSize: 100 } : {}
      const data = await postJson(region, path, token, userId, body)
      const code = Number(data.code)
      // getDevices may omit code; treat missing code + result.list as success
      const hasResultList =
        data.result &&
        typeof data.result === 'object' &&
        Array.isArray((data.result as Record<string, unknown>).list)
      if (!Number.isNaN(code) && code !== 0 && code !== 200 && !hasResultList) {
        errors.push(`${path}: ${String(data.msg || data.message || code)}`)
        continue
      }
      const devices = flattenDevices(data)
        .filter(isBoundPrinter)
        .map(mapDevice)
        .filter((d) => d.id)
      // Prefer real printer endpoint; skip catalog-style empty/false positives
      if (path.includes('getDevices') || devices.length) {
        return {
          ok: true,
          devices,
          message: devices.length ? undefined : '账号下暂无绑定设备'
        }
      }
      if (code === 0 || code === 200) {
        // Successful but not printer-shaped (e.g. old catalog API) — try next path
        continue
      }
    } catch (err) {
      errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return {
    ok: false,
    devices: [],
    message: errors.slice(0, 3).join('；') || '无法获取设备列表，请确认 Token 有效'
  }
}

/**
 * Official account SSO. Creality Cloud SPA no longer serves /login or /user/login
 * (both show in-app 404); login is hosted on id.creality.cn / id.creality.com.
 */
function ssoLoginUrl(region: CrealityCloudRegion): string {
  if (region === 'china') {
    const redirect = encodeURIComponent(`${webBase('china')}/`)
    return (
      'https://id.creality.cn/connect' +
      '?lang=zh-CN&client_id=8ea5010984fa52a298f12110af8b05d0' +
      `&app_id=creality_model&redirect_uri=${redirect}&platform=2`
    )
  }
  const redirect = encodeURIComponent(`${webBase('global')}/`)
  return (
    'https://id.creality.com/connect' +
    '?lang=en-US&client_id=f9c302ecc29c59a0a6e921ff39a073ca' +
    `&app_id=creality_model&redirect_uri=${redirect}&platform=2`
  )
}

/**
 * Open Creality Cloud SSO login; capture token from id.* cookies even if redirect stalls.
 */
export function crealityOpenLoginWindow(
  region: CrealityCloudRegion
): Promise<{ ok: true; token: string; userId: string } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setInterval> | null = null
    let safety: ReturnType<typeof setTimeout> | null = null

    const done = (
      result: { ok: true; token: string; userId: string } | { ok: false; message: string }
    ) => {
      if (settled) return
      settled = true
      if (timer) clearInterval(timer)
      if (safety) clearTimeout(safety)
      try {
        if (!win.isDestroyed()) win.close()
      } catch {
        // ignore
      }
      resolve(result)
    }

    const win = new BrowserWindow({
      width: 520,
      height: 780,
      title: '创想云账号登录',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: 'persist:creality-cloud-login'
      }
    })

    win.webContents.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    )

    // SSO uses window.open(url, '_self') after login — ensure Electron navigates instead of blocking
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url && /^https?:/i.test(url)) {
        void win.loadURL(url)
      }
      return { action: 'deny' }
    })

    void win.loadURL(ssoLoginUrl(region))

    const scrapeAuth = `
      (() => {
        const cookieMap = {};
        try {
          document.cookie.split(';').forEach((part) => {
            const i = part.indexOf('=');
            if (i < 0) return;
            const k = part.slice(0, i).trim();
            const v = part.slice(i + 1).trim();
            if (!k) return;
            try { cookieMap[k] = decodeURIComponent(v); } catch (_) { cookieMap[k] = v; }
          });
        } catch (_) {}

        const fromStore = (key) => {
          try {
            return localStorage.getItem(key) || sessionStorage.getItem(key) || cookieMap[key] || '';
          } catch (_) {
            return cookieMap[key] || '';
          }
        };

        const pick = (...keys) => {
          for (const k of keys) {
            const v = fromStore(k);
            if (v && String(v).trim()) return String(v).trim();
          }
          return '';
        };

        let token = '';
        let userId = '';

        // Creality ID SSO stores JSON in cookie/local key "id-application"
        for (const raw of [
          fromStore('id-application'),
          fromStore('id-application-user'),
          fromStore('APPLICATION')
        ]) {
          if (!raw) continue;
          try {
            const j = JSON.parse(raw);
            token = token || j.token || j.authToken || j.accessToken || '';
            userId = userId || String(j.userId || j.uid || j.id || '');
          } catch (_) {}
        }

        token =
          token ||
          pick(
            'id-token',
            '__CXY_TOKEN_',
            'token',
            'cxy_token',
            'authToken',
            'accessToken',
            'access_token',
            'Token'
          );
        userId =
          userId ||
          pick('id-user-id', '__CXY_UID_', 'userId', 'uid', 'user_id', 'cxy_uid', 'UserId');

        try {
          const u = pick('id-user-info', 'userInfo', 'user', 'USER_INFO', 'cxy_userInfo');
          if (u) {
            const j = JSON.parse(u);
            const base = j.base || j;
            token = token || j.token || j.authToken || j.accessToken || base.token || '';
            userId = userId || String(j.userId || j.uid || j.id || base.userId || base.uid || '');
          }
        } catch (_) {}

        try {
          const u = new URL(location.href);
          token = token || u.searchParams.get('token') || u.searchParams.get('access_token') || '';
          userId = userId || u.searchParams.get('userId') || u.searchParams.get('uid') || '';
          // oauth callback carries code — not the final token; keep waiting if only code present
        } catch (_) {}

        return {
          token: String(token || ''),
          userId: String(userId || ''),
          href: location.href,
          cookieKeys: Object.keys(cookieMap).slice(0, 40)
        };
      })()
    `

    const tryCapture = async () => {
      if (win.isDestroyed()) return
      try {
        // Prefer Electron session cookies (covers HttpOnly) — Creality ID uses id-application
        const ses = win.webContents.session
        const url = win.webContents.getURL() || ssoLoginUrl(region)
        const cookies = await ses.cookies.get({ url })
        let token = ''
        let userId = ''
        for (const c of cookies) {
          if (c.name === 'id-application' || c.name === 'id-application-user') {
            try {
              const j = JSON.parse(c.value) as Record<string, unknown>
              token = token || String(j.token || j.authToken || j.accessToken || '')
              userId = userId || String(j.userId || j.uid || j.id || '')
            } catch {
              // ignore
            }
          }
          if (c.name === 'id-token' || c.name === '__CXY_TOKEN_' || c.name === 'token') {
            token = token || c.value
          }
          if (c.name === 'id-user-id' || c.name === '__CXY_UID_' || c.name === 'uid') {
            userId = userId || c.value
          }
        }
        if (token && token.length > 8) {
          done({ ok: true, token, userId: userId || '0' })
          return
        }

        const info = (await win.webContents.executeJavaScript(scrapeAuth)) as {
          token: string
          userId: string
          href: string
        }
        if (info.token && info.token.length > 8) {
          done({ ok: true, token: info.token, userId: info.userId || '0' })
        }
      } catch {
        // navigating / not ready
      }
    }

    timer = setInterval(() => {
      void tryCapture()
    }, 800)

    win.webContents.on('will-navigate', (_e, url) => {
      // Allow navigation; capture after load
      void url
    })
    win.webContents.on('did-navigate', () => {
      void tryCapture()
    })
    win.webContents.on('did-navigate-in-page', () => {
      void tryCapture()
    })
    win.webContents.on('did-finish-load', () => {
      void tryCapture()
    })
    win.webContents.on('did-redirect-navigation', () => {
      void tryCapture()
    })

    win.on('closed', () => {
      done({ ok: false, message: '已取消登录' })
    })

    safety = setTimeout(() => {
      done({ ok: false, message: '登录超时，请重试或改用粘贴 Token' })
    }, 5 * 60 * 1000)
  })
}

function mapCloudStatus(connectionId: string, raw: Record<string, unknown>): CrealityLivePatch {
  const progress = Number(raw.printProgress ?? raw.progress ?? raw.print_progress ?? 0)
  const left = Number(raw.printLeftTime ?? raw.leftTime ?? raw.remain_time ?? 0)
  return {
    connectionId,
    health: 'online',
    state: String(raw.state || raw.printState || raw.status || 'online'),
    progress: progress <= 1 ? Math.round(progress * 100) : progress,
    remainingSeconds: left > 0 ? (left > 100000 ? left : left * 60) : undefined,
    layer: (() => {
      const n = Number(raw.layer ?? raw.CurrentLayer ?? raw.currentLayer)
      return Number.isFinite(n) && n > 0 ? n : undefined
    })(),
    layerTotal: (() => {
      const n = Number(raw.TotalLayer ?? raw.totalLayer ?? raw.TotalLayers ?? raw.layerCount)
      if (Number.isFinite(n) && n > 0) return n
      const layer = Number(raw.layer ?? raw.CurrentLayer ?? 0)
      const prog = progress <= 1 ? progress * 100 : progress
      if (layer > 0 && prog >= 1) {
        const est = Math.round(layer / (prog / 100))
        return est >= layer ? est : undefined
      }
      return undefined
    })(),
    fanSpeed: raw.fan != null ? Number(raw.fan) : undefined,
    filename: String(raw.printName || raw.filename || raw.gcodeName || '') || undefined,
    extruder: {
      actual: Number(raw.nozzleTemp ?? raw.nozzle_temp ?? 0),
      target: Number(raw.targetNozzleTemp ?? raw.target_nozzle_temp ?? 0)
    },
    bed: {
      actual: Number(raw.bedTemp ?? raw.bed_temp ?? 0),
      target: Number(raw.targetBedTemp ?? raw.target_bed_temp ?? 0)
    },
    updatedAt: new Date().toISOString()
  }
}

export function createCrealityCloudBridge(getMainWindow: () => BW | null) {
  const emit = (patch: CrealityLivePatch) => {
    getMainWindow()?.webContents.send('creality:cloud:status', patch)
  }

  const disconnect = async (connectionId: string): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) return
    if (s.timer) clearInterval(s.timer)
    sessions.delete(connectionId)
    emit({
      connectionId,
      health: 'offline',
      state: 'offline',
      progress: 0,
      updatedAt: new Date().toISOString()
    })
  }

  const disconnectAll = async (): Promise<void> => {
    for (const id of Array.from(sessions.keys())) await disconnect(id)
  }

  const pollOnce = async (connectionId: string, s: Session): Promise<void> => {
    try {
      const list = await crealityFetchDevices(s.region, s.token, s.userId)
      const mine = list.devices.find((d) => d.id === s.deviceId)
      if (!mine) {
        emit({
          connectionId,
          health: 'warning',
          state: 'unknown',
          progress: 0,
          message: '云端设备列表中未找到该机',
          updatedAt: new Date().toISOString()
        })
        return
      }
      if (mine.host) s.host = mine.host
      emit({
        connectionId,
        health: mine.online ? 'online' : 'offline',
        state: mine.online ? 'online' : 'offline',
        progress: 0,
        message: mine.host ? `云端在线 · LAN ${mine.host}` : mine.online ? '云端在线' : '云端离线',
        filename: mine.name,
        updatedAt: new Date().toISOString()
      })

      // If LAN IP known, enrich via native :9999 briefly is out of scope here;
      // try a few status endpoints
      for (const path of [
        `/api/cxy/v2/device/deviceInfo`,
        `/api/cxy/device/getDeviceInfo`,
        `/api/cxy/v2/printer/status`
      ]) {
        try {
          const data = await postJson(s.region, path, s.token, s.userId, {
            deviceId: s.deviceId,
            id: s.deviceId
          })
          const code = Number(data.code)
          if (code !== 0 && code !== 200) continue
          const detail =
            (data.result as Record<string, unknown>) ||
            (data.data as Record<string, unknown>) ||
            data
          if (detail && typeof detail === 'object') {
            emit(mapCloudStatus(connectionId, detail as Record<string, unknown>))
            return
          }
        } catch {
          // try next
        }
      }
    } catch (err) {
      emit({
        connectionId,
        health: 'warning',
        state: 'warning',
        progress: 0,
        message: err instanceof Error ? err.message : String(err),
        updatedAt: new Date().toISOString()
      })
    }
  }

  const connect = async (opts: {
    connectionId: string
    token: string
    userId: string
    deviceId: string
    region?: CrealityCloudRegion
    host?: string
  }): Promise<{ ok: boolean; message?: string }> => {
    await disconnect(opts.connectionId)
    const region = opts.region || 'china'
    const session: Session = {
      token: opts.token,
      userId: opts.userId || '0',
      region,
      deviceId: opts.deviceId,
      host: opts.host,
      timer: null
    }
    sessions.set(opts.connectionId, session)
    emit({
      connectionId: opts.connectionId,
      health: 'connecting',
      state: 'connecting',
      progress: 0,
      message: '正在连接创想云…',
      updatedAt: new Date().toISOString()
    })
    await pollOnce(opts.connectionId, session)
    session.timer = setInterval(() => {
      void pollOnce(opts.connectionId, session)
    }, Math.max(getDevicePollMs(), 10000))
    return { ok: true }
  }

  const control = async (_connectionId: string, _action: string): Promise<void> => {
    throw new Error('创想云远程控制因机型协议差异，建议改用局域网模式操作')
  }

  return { connect, disconnect, disconnectAll, control, webBase }
}

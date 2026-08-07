import { create } from 'zustand'
import { isClientMode, serverGet, serverSend } from '../api/serverClient'
import {
  defaultSsoSettings,
  normalizeSsoSettings,
  type SsoSettingsBundle
} from '@shared/sso'

export type ApiMode = 'readonly' | 'control'
export type ApiAccessMode = 'local' | 'sunlogin' | 'frpc'
export type HskFwType = 1 | 2 | 3
export type FrpcProxyType = 'tcp' | 'http'
export type UiThemeId = 'midnight' | 'ocean' | 'forest' | 'amber' | 'slate'
export type UiBgMode = 'default' | 'color' | 'image'

export type AppSettings = {
  apiEnabled: boolean
  apiMode: ApiMode
  apiPort: number
  apiKey: string
  apiAccessMode: ApiAccessMode
  publicIp: string
  domain: string
  hskEnabled: boolean
  hskApiKey: string
  hskDomain: string
  hskExternalPort: number
  hskFwType: HskFwType
  hskMemo: string
  frpcServerAddr: string
  frpcServerPort: number
  frpcUser: string
  frpcToken: string
  frpcProxyName: string
  frpcType: FrpcProxyType
  frpcRemotePort: number
  frpcPublicHost: string
  frpcCustomDomain: string
  frpcTlsEnable: boolean
  notifyOnError: boolean
  notifyOnPrintDone: boolean
  notifyOnIdle: boolean
  notifyOnLowFilament: boolean
  /** Bambu AMS remain% delta → local spool deduct on print finish */
  amsAutoDeduct: boolean
  /** Device status refresh interval in seconds (1–60) */
  deviceRefreshSec: number
  openAtLogin: boolean
  minimizeToTray: boolean
  webhookEnabled: boolean
  webhookUrl: string
  uiTheme: UiThemeId
  uiBgMode: UiBgMode
  uiBgColor: string
  uiBgImage: string
  sso: SsoSettingsBundle
}

export function normalizeDeviceRefreshSec(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 3
  return Math.max(1, Math.min(60, n))
}

export function resolveDeviceRefreshMs(settings: { deviceRefreshSec?: number } | null | undefined): number {
  return normalizeDeviceRefreshSec(settings?.deviceRefreshSec) * 1000
}

export type ApiStatus = {
  running: boolean
  port: number
  mode: ApiMode
  localUrls: string[]
  publicUrl: string | null
  domainUrl: string | null
  hskUrl: string | null
  frpcUrl: string | null
  error?: string
}

export type HskDomainItem = {
  domainname: string
  account?: string
  expiredate?: number
}

export type HskMapping = {
  memo?: string
  domain: string
  port: number
  servicehost?: string
  serviceport?: number
  fwtype?: number
  isforbid?: boolean
}

function newApiKey(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

const HSK_DEFAULT_MEMO = 'hanye-3D打印机监控台-API'

const defaults: AppSettings = {
  apiEnabled: false,
  apiMode: 'readonly',
  apiPort: 17890,
  apiKey: '',
  apiAccessMode: 'local',
  publicIp: '',
  domain: '',
  hskEnabled: false,
  hskApiKey: '',
  hskDomain: '',
  hskExternalPort: 0,
  hskFwType: 2,
  hskMemo: HSK_DEFAULT_MEMO,
  frpcServerAddr: '',
  frpcServerPort: 7000,
  frpcUser: '',
  frpcToken: '',
  frpcProxyName: '',
  frpcType: 'tcp',
  frpcRemotePort: 17890,
  frpcPublicHost: '',
  frpcCustomDomain: '',
  frpcTlsEnable: false,
  notifyOnError: true,
  notifyOnPrintDone: true,
  notifyOnIdle: false,
  notifyOnLowFilament: true,
  amsAutoDeduct: true,
  deviceRefreshSec: 3,
  openAtLogin: false,
  minimizeToTray: true,
  webhookEnabled: false,
  webhookUrl: '',
  uiTheme: 'midnight',
  uiBgMode: 'default',
  uiBgColor: '#0f1115',
  uiBgImage: '',
  sso: defaultSsoSettings()
}

function normalizeUiTheme(v: unknown): UiThemeId {
  if (v === 'ocean' || v === 'forest' || v === 'amber' || v === 'slate' || v === 'midnight') return v
  return 'midnight'
}

function normalizeUiBgMode(v: unknown): UiBgMode {
  if (v === 'color' || v === 'image' || v === 'default') return v
  return 'default'
}

function mapSettings(raw: Record<string, unknown> | Partial<AppSettings> | null | undefined): AppSettings {
  const r = (raw || {}) as Partial<AppSettings> & Record<string, unknown>
  const fw = Number(r.hskFwType)
  const apiAccessMode: ApiAccessMode =
    r.apiAccessMode === 'sunlogin' ||
    r.apiAccessMode === 'local' ||
    r.apiAccessMode === 'frpc'
      ? r.apiAccessMode
      : r.hskEnabled
        ? 'sunlogin'
        : 'local'
  return {
    apiEnabled: Boolean(r.apiEnabled),
    apiMode: r.apiMode === 'control' ? 'control' : 'readonly',
    apiPort: Number(r.apiPort) || 17890,
    apiKey: (typeof r.apiKey === 'string' && r.apiKey) || newApiKey(),
    apiAccessMode,
    publicIp: (typeof r.publicIp === 'string' && r.publicIp) || '',
    domain: (typeof r.domain === 'string' && r.domain) || '',
    hskEnabled: apiAccessMode === 'sunlogin',
    hskApiKey: (typeof r.hskApiKey === 'string' && r.hskApiKey) || '',
    hskDomain: (typeof r.hskDomain === 'string' && r.hskDomain) || '',
    hskExternalPort: Number(r.hskExternalPort) || 0,
    hskFwType: fw === 1 || fw === 3 ? fw : 2,
    hskMemo: (typeof r.hskMemo === 'string' && r.hskMemo) || HSK_DEFAULT_MEMO,
    frpcServerAddr: (typeof r.frpcServerAddr === 'string' && r.frpcServerAddr) || '',
    frpcServerPort: Number(r.frpcServerPort) || 7000,
    frpcUser: (typeof r.frpcUser === 'string' && r.frpcUser) || '',
    frpcToken: (typeof r.frpcToken === 'string' && r.frpcToken) || '',
    frpcProxyName: (typeof r.frpcProxyName === 'string' && r.frpcProxyName) || '',
    frpcType: r.frpcType === 'http' ? 'http' : 'tcp',
    frpcRemotePort: Number(r.frpcRemotePort) || 17890,
    frpcPublicHost: (typeof r.frpcPublicHost === 'string' && r.frpcPublicHost) || '',
    frpcCustomDomain: (typeof r.frpcCustomDomain === 'string' && r.frpcCustomDomain) || '',
    frpcTlsEnable: r.frpcTlsEnable === true,
    notifyOnError: r.notifyOnError !== false,
    notifyOnPrintDone: r.notifyOnPrintDone !== false,
    notifyOnIdle: Boolean(r.notifyOnIdle),
    notifyOnLowFilament: r.notifyOnLowFilament !== false,
    amsAutoDeduct: r.amsAutoDeduct !== false,
    deviceRefreshSec: normalizeDeviceRefreshSec(r.deviceRefreshSec),
    openAtLogin: Boolean(r.openAtLogin),
    minimizeToTray: r.minimizeToTray !== false,
    webhookEnabled: Boolean(r.webhookEnabled),
    webhookUrl: (typeof r.webhookUrl === 'string' && r.webhookUrl) || '',
    uiTheme: normalizeUiTheme(r.uiTheme),
    uiBgMode: normalizeUiBgMode(r.uiBgMode),
    uiBgColor:
      typeof r.uiBgColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(r.uiBgColor)
        ? r.uiBgColor
        : '#0f1115',
    uiBgImage:
      typeof r.uiBgImage === 'string' && r.uiBgImage.startsWith('data:image/')
        ? r.uiBgImage
        : '',
    sso: (() => {
      const next = normalizeSsoSettings(r.sso)
      // Public settings strip secrets; keep empty secrets (server disk load has real ones)
      const pub = r.sso as
        | {
            wecom?: { secretSet?: boolean; secret?: string }
            dingtalk?: { appSecretSet?: boolean; appSecret?: string }
            ad?: { bindPasswordSet?: boolean; bindPassword?: string }
          }
        | undefined
      if (pub?.wecom?.secretSet && !next.wecom.secret) next.wecom.secret = ''
      if (pub?.dingtalk?.appSecretSet && !next.dingtalk.appSecret) next.dingtalk.appSecret = ''
      if (pub?.ad?.bindPasswordSet && !next.ad.bindPassword) next.ad.bindPassword = ''
      return next
    })()
  }
}

type SettingsState = {
  settings: AppSettings
  status: ApiStatus | null
  loading: boolean
  saving: boolean
  hskBusy: boolean
  hskDomains: HskDomainItem[]
  hskMappings: HskMapping[]
  init: () => Promise<void>
  refreshFromServer: (opts?: { silent?: boolean }) => Promise<void>
  refreshStatus: () => Promise<void>
  patchLocal: (partial: Partial<AppSettings>) => void
  setAccessMode: (mode: ApiAccessMode) => void
  save: (partial?: Partial<AppSettings>) => Promise<void>
  generateApiKey: () => void
  startApi: () => Promise<void>
  stopApi: () => Promise<void>
  fetchHskMeta: () => Promise<{ ok: boolean; message?: string }>
  syncHskMapping: () => Promise<{ ok: boolean; message?: string }>
  exportFrpcConfig: () => Promise<{ ok: boolean; path?: string; message?: string }>
  getFrpcToml: () => Promise<string>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...defaults },
  status: null,
  loading: true,
  saving: false,
  hskBusy: false,
  hskDomains: [],
  hskMappings: [],

  init: async () => {
    set({ loading: true })
    let raw: Record<string, unknown> | null = null
    if (isClientMode()) {
      try {
        const data = await serverGet<{ settings?: Record<string, unknown> }>('/api/v1/settings')
        raw = (data.settings || null) as Record<string, unknown> | null
      } catch (e) {
        console.error(e)
        raw = null
      }
    } else {
      raw = (await window.electronAPI?.settings?.load()) as Record<string, unknown> | null
    }
    let settings = mapSettings(raw as Record<string, unknown>)
    try {
      const cached = localStorage.getItem('pm:appearance')
      if (cached) {
        const a = JSON.parse(cached) as Partial<AppSettings>
        // 若磁盘尚未写入外观字段，用本地缓存补齐
        const diskMissingTheme =
          !raw ||
          typeof raw !== 'object' ||
          !(raw as { uiTheme?: string }).uiTheme
        if (diskMissingTheme && a.uiTheme) {
          settings = {
            ...settings,
            uiTheme: normalizeUiTheme(a.uiTheme),
            uiBgMode: normalizeUiBgMode(a.uiBgMode),
            uiBgColor:
              typeof a.uiBgColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(a.uiBgColor)
                ? a.uiBgColor
                : settings.uiBgColor,
            uiBgImage:
              typeof a.uiBgImage === 'string' && a.uiBgImage.startsWith('data:image/')
                ? a.uiBgImage
                : settings.uiBgImage
          }
        }
      }
    } catch {
      /* ignore */
    }
    const status = isClientMode()
      ? null
      : (await window.electronAPI?.api?.status()) || null
    set({ settings, status, loading: false })
  },

  refreshFromServer: async (opts?: { silent?: boolean }) => {
    if (!isClientMode()) return
    const silent = Boolean(opts?.silent)
    if (!silent) set({ loading: true })
    try {
      const data = await serverGet<{ settings?: Record<string, unknown> }>('/api/v1/settings')
      const raw = (data.settings || null) as Record<string, unknown> | null
      const settings = mapSettings(raw as Record<string, unknown>)
      const prev = get().settings
      if (JSON.stringify(prev) === JSON.stringify(settings)) {
        if (!silent) set({ loading: false })
        return
      }
      set({ settings, loading: false })
    } catch (e) {
      console.error(e)
      if (!silent) set({ loading: false })
    }
  },

  refreshStatus: async () => {
    if (isClientMode()) {
      set({ status: null })
      return
    }
    const status = (await window.electronAPI?.api?.status()) || null
    set({ status })
  },

  patchLocal: (partial) => {
    set({ settings: { ...get().settings, ...partial } })
  },

  setAccessMode: (mode) => {
    set({
      settings: {
        ...get().settings,
        apiAccessMode: mode,
        hskEnabled: mode === 'sunlogin'
      }
    })
  },

  save: async (partial) => {
    set({ saving: true })
    const next = { ...get().settings, ...partial }
    next.hskEnabled = next.apiAccessMode === 'sunlogin'

    const applyMerged = (mapped: AppSettings, status: ApiStatus | null) => {
      const merged = {
        ...mapped,
        openAtLogin: next.openAtLogin,
        minimizeToTray: next.minimizeToTray,
        notifyOnError: next.notifyOnError,
        notifyOnPrintDone: next.notifyOnPrintDone,
        notifyOnIdle: next.notifyOnIdle,
        notifyOnLowFilament: next.notifyOnLowFilament,
        amsAutoDeduct: next.amsAutoDeduct,
        deviceRefreshSec: next.deviceRefreshSec,
        uiTheme: next.uiTheme,
        uiBgMode: next.uiBgMode,
        uiBgColor: next.uiBgColor,
        uiBgImage: next.uiBgImage,
        sso: next.sso
      }
      try {
        localStorage.setItem(
          'pm:appearance',
          JSON.stringify({
            uiTheme: merged.uiTheme,
            uiBgMode: merged.uiBgMode,
            uiBgColor: merged.uiBgColor,
            uiBgImage: merged.uiBgImage
          })
        )
      } catch {
        /* ignore quota */
      }
      set({ settings: merged, status, saving: false })
    }

    if (isClientMode()) {
      try {
        const patch: Record<string, unknown> = {}
        const keys = [
          'notifyOnError',
          'notifyOnPrintDone',
          'notifyOnIdle',
          'notifyOnLowFilament',
          'amsAutoDeduct',
          'deviceRefreshSec',
          'webhookEnabled',
          'webhookUrl',
          'openAtLogin',
          'minimizeToTray'
        ] as const
        for (const key of keys) {
          if (partial && key in partial) patch[key] = next[key]
        }
        if (Object.keys(patch).length) {
          const data = await serverSend<{ settings?: Record<string, unknown> }>(
            '/api/v1/settings',
            'PATCH',
            patch
          )
          applyMerged(mapSettings(data.settings as Record<string, unknown>), null)
        } else {
          applyMerged(next, null)
        }
      } catch (e) {
        console.error(e)
        set({ saving: false })
      }
      return
    }

    const res = await window.electronAPI?.settings?.save(next)
    if (res) {
      applyMerged(mapSettings(res.settings as Record<string, unknown>), res.status as ApiStatus)
    } else {
      set({ saving: false })
    }
  },

  generateApiKey: () => {
    set({
      settings: {
        ...get().settings,
        apiKey: newApiKey()
      }
    })
  },

  startApi: async () => {
    await get().save({ apiEnabled: true })
  },

  stopApi: async () => {
    await get().save({ apiEnabled: false })
  },

  fetchHskMeta: async () => {
    const { settings } = get()
    if (!settings.hskApiKey.trim()) {
      return { ok: false, message: '请先填写向日葵 / 花生壳 API Key' }
    }
    set({ hskBusy: true })
    await get().save()
    const res = await window.electronAPI?.hsk?.fetchMeta(get().settings.hskApiKey)
    set({ hskBusy: false })
    if (!res) return { ok: false, message: 'IPC 不可用' }
    if (!res.ok) return { ok: false, message: res.message }
    const domains = res.domains || []
    const mappings = res.mappings || []
    const patch: Partial<AppSettings> = {}
    if (!get().settings.hskDomain && domains[0]?.domainname) {
      patch.hskDomain = domains[0].domainname
    }
    set({
      hskDomains: domains,
      hskMappings: mappings,
      settings: { ...get().settings, ...patch }
    })
    return { ok: true }
  },

  syncHskMapping: async () => {
    const { settings } = get()
    if (!settings.hskApiKey.trim()) {
      return { ok: false, message: '请先填写向日葵 / 花生壳 API Key' }
    }
    if (!settings.hskDomain.trim()) {
      return { ok: false, message: '请先选择穿透域名' }
    }
    if (!settings.apiEnabled) {
      return { ok: false, message: '请先启用本软件 API 服务并保存' }
    }
    set({ hskBusy: true })
    await get().save({ apiAccessMode: 'sunlogin', hskEnabled: true })
    const res = await window.electronAPI?.hsk?.syncMapping({
      apiKey: get().settings.hskApiKey,
      domain: get().settings.hskDomain,
      fwType: get().settings.hskFwType,
      memo: get().settings.hskMemo
    })
    set({ hskBusy: false })
    if (!res) return { ok: false, message: 'IPC 不可用' }
    if (!res.ok) return { ok: false, message: res.message }
    set({
      settings: mapSettings(res.settings as Record<string, unknown>),
      status: res.status
    })
    const meta = await window.electronAPI?.hsk?.fetchMeta(get().settings.hskApiKey)
    if (meta?.ok) {
      set({ hskDomains: meta.domains || [], hskMappings: meta.mappings || [] })
    }
    return { ok: true }
  },

  exportFrpcConfig: async () => {
    await get().save({ apiAccessMode: 'frpc' })
    const res = await window.electronAPI?.frpc?.exportConfig()
    if (!res?.ok) return { ok: false, message: '导出失败' }
    return { ok: true, path: res.path }
  },

  getFrpcToml: async () => {
    await get().save()
    return (await window.electronAPI?.frpc?.getToml()) || ''
  }
}))

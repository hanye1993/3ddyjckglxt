import { create } from 'zustand'
import { createAdapter, type PrinterAdapter } from '../adapters'
import type {
  ControlPayload,
  DeviceConfig,
  PrinterLiveStatus,
  PrinterTech
} from '../types/printer'
import { onStatusBatchForAmsDeduct } from '../utils/amsDeduct'

export function deviceTech(device: DeviceConfig): PrinterTech {
  return device.tech || 'fdm'
}

export type BrandFilter =
  | 'all'
  | 'klipper'
  | 'bambu'
  | 'creality'
  | 'elegoo'
  | 'anycubic'
  | 'snapmaker'
  | 'flashforge'
  | 'qidi'

export type AppSection =
  | 'fdm'
  | 'resin'
  | 'filament'
  | 'api'
  | 'tools'
  | 'monitorWall'
  | 'monitorZones'
  | 'models'
  | 'aiModels'
  | 'settings'

/** 每页卡片数；0 = 全部 */
export type DevicePageSize = 10 | 20 | 50 | 100 | 0

export type DeviceStatusKind = import('../utils/statusLabel').DeviceStatusKind

export type BatchPrintResult = {
  deviceId: string
  deviceName: string
  ok: boolean
  message?: string
}

interface DeviceState {
  devices: DeviceConfig[]
  statuses: Record<string, PrinterLiveStatus>
  selectedId: string | null
  /** multi-select for batch print */
  checkedIds: string[]
  section: AppSection
  filter: BrandFilter
  search: string
  pageSize: DevicePageSize
  page: number
  /** empty = show all statuses */
  statusFilters: DeviceStatusKind[]
  loading: boolean
  bambuPluginHint: string | null
  adapters: Record<string, PrinterAdapter>
  init: () => Promise<void>
  setSection: (s: AppSection) => void
  setFilter: (f: BrandFilter) => void
  setSearch: (q: string) => void
  setPageSize: (n: DevicePageSize) => void
  setPage: (n: number) => void
  setStatusFilters: (kinds: DeviceStatusKind[]) => void
  toggleStatusFilter: (kind: DeviceStatusKind) => void
  selectDevice: (id: string | null) => void
  toggleChecked: (id: string) => void
  setCheckedIds: (ids: string[]) => void
  clearChecked: () => void
  addDevice: (device: DeviceConfig, apiKey?: string) => Promise<void>
  removeDevice: (id: string) => Promise<void>
  updateDevice: (device: DeviceConfig) => Promise<void>
  reconnectAll: () => Promise<void>
  control: (deviceId: string, payload: ControlPayload) => Promise<void>
  /** pause / resume / cancel on many devices */
  batchControl: (
    deviceIds: string[],
    action: 'pause' | 'resume' | 'cancel'
  ) => Promise<BatchPrintResult[]>
  /** Upload G-code then start print on each device (1 file→all, or 1:1 file list) */
  batchUploadAndPrint: (
    deviceIds: string[],
    files: File[],
    onProgress?: (done: number, total: number, result: BatchPrintResult) => void
  ) => Promise<BatchPrintResult[]>
}

/** FDM: Moonraker upload+print. Resin file push is brand-specific (not yet). */
export function canBatchPrint(device: DeviceConfig): boolean {
  if (device.connectionMode === 'cloud') return false
  if (deviceTech(device) === 'resin') return false
  return device.brand === 'klipper' || device.brand === 'creality' || device.brand === 'qidi'
}

function persistDevices(devices: DeviceConfig[]): void {
  void window.electronAPI?.devices.save(
    devices.map(({ ...d }) => {
      // never persist raw secrets here
      return d
    })
  )
}

/** 合并同一帧内的多台状态更新，避免 100+ 次 set 卡死 UI */
let pendingStatuses: Record<string, PrinterLiveStatus> = {}
let statusFlushRaf = 0
let statusNotifyDevice: DeviceConfig | null = null
let flushStatusBatch: ((batch: Record<string, PrinterLiveStatus>) => void) | null = null

function queueDeviceStatus(device: DeviceConfig, status: PrinterLiveStatus): void {
  const prev = pendingStatuses[device.id] ?? useDeviceStore.getState().statuses[device.id]
  if (
    status.health === 'error' &&
    status.message &&
    prev?.health !== 'error' &&
    !statusNotifyDevice
  ) {
    statusNotifyDevice = device
  }
  pendingStatuses[status.deviceId] = status
  if (statusFlushRaf) return
  statusFlushRaf = requestAnimationFrame(() => {
    statusFlushRaf = 0
    const batch = pendingStatuses
    pendingStatuses = {}
    const notify = statusNotifyDevice
    statusNotifyDevice = null
    if (notify?.name && batch[notify.id]?.message) {
      void window.electronAPI?.notify.show(notify.name, batch[notify.id].message!)
    }
    flushStatusBatch?.(batch)
  })
}

export const useDeviceStore = create<DeviceState>((set, get) => {
  flushStatusBatch = (batch) => {
    set((s) => {
      // 只在有变化时合并；同引用跳过通知风暴
      let changed = false
      for (const id of Object.keys(batch)) {
        if (s.statuses[id] !== batch[id]) {
          changed = true
          break
        }
      }
      if (!changed) return s
      return { statuses: { ...s.statuses, ...batch } }
    })
    const devices = useDeviceStore.getState().devices
    const byId: Record<string, { id: string; name: string; brand: string }> = {}
    for (const d of devices) {
      byId[d.id] = { id: d.id, name: d.name, brand: d.brand }
    }
    try {
      onStatusBatchForAmsDeduct(batch, byId)
    } catch {
      /* ignore deduct errors */
    }
  }

  return {
  devices: [],
  statuses: {},
  selectedId: null,
  checkedIds: [],
  section: 'fdm',
  filter: 'all',
  search: '',
  pageSize: 20,
  page: 1,
  statusFilters: [],
  loading: true,
  bambuPluginHint: null,
  adapters: {},

  init: async () => {
    set({ loading: true })
    const raw = ((await window.electronAPI?.devices.load()) || []) as DeviceConfig[]
    let loaded = raw
      .filter(
        (d) =>
          !d.id.startsWith('virtual-') &&
          !d.tags?.includes('virtual') &&
          !d.baseUrl?.startsWith('virtual://')
      )
      .map((d) => ({ ...d, tech: d.tech || ('fdm' as const) }))

    // 一次性：清空全部 FDM 设备，并移除非拓竹官方云设备
    const wipeKey = 'pm:migrated:wipe-fdm-and-non-bambu-cloud:v1'
    const alreadyWiped = localStorage.getItem(wipeKey) === '1'
    if (!alreadyWiped) {
      loaded = loaded.filter((d) => {
        if (deviceTech(d) === 'fdm') return false
        if (d.connectionMode === 'cloud' && d.brand !== 'bambu') return false
        return true
      })
      localStorage.setItem(wipeKey, '1')
    } else {
      // 之后仍拒绝非拓竹云设备落盘残留
      loaded = loaded.filter(
        (d) => !(d.connectionMode === 'cloud' && d.brand !== 'bambu')
      )
    }

    if (loaded.length !== raw.length) persistDevices(loaded)
    const plugin = await window.electronAPI?.bambu.checkPlugin()
    set({
      devices: loaded,
      loading: false,
      bambuPluginHint: plugin && !plugin.installed ? plugin.hint : null
    })
    await get().reconnectAll()
  },

  setSection: (section) => {
    const apply = () =>
      set({
        section,
        selectedId: null,
        checkedIds: [],
        filter: 'all',
        search: '',
        page: 1,
        statusFilters: []
      })
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(apply)
    } else {
      apply()
    }
  },
  setFilter: (filter) => set({ filter, page: 1 }),
  setSearch: (search) => set({ search, page: 1 }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),
  setPage: (page) => set({ page: Math.max(1, page) }),
  setStatusFilters: (statusFilters) => set({ statusFilters, page: 1 }),
  toggleStatusFilter: (kind) =>
    set((s) => {
      const has = s.statusFilters.includes(kind)
      const statusFilters = has
        ? s.statusFilters.filter((k) => k !== kind)
        : [...s.statusFilters, kind]
      return { statusFilters, page: 1 }
    }),
  selectDevice: (selectedId) => set({ selectedId }),
  toggleChecked: (id) =>
    set((s) => ({
      checkedIds: s.checkedIds.includes(id)
        ? s.checkedIds.filter((x) => x !== id)
        : [...s.checkedIds, id]
    })),
  setCheckedIds: (checkedIds) => set({ checkedIds }),
  clearChecked: () => set({ checkedIds: [] }),

  addDevice: async (device, apiKey) => {
    if (apiKey && device.secretKey) {
      await window.electronAPI?.secrets.set(device.secretKey, apiKey)
    }
    const devices = [...get().devices, device]
    set({ devices })
    persistDevices(devices)

    const key = device.secretKey
      ? await window.electronAPI?.secrets.get(device.secretKey)
      : null
    const adapter = createAdapter(device, key)
    adapter.subscribe((status) => {
      queueDeviceStatus(device, status)
    })
    try {
      await adapter.connect()
    } catch {
      // status already emitted
    }
    set((s) => ({ adapters: { ...s.adapters, [device.id]: adapter } }))
  },

  removeDevice: async (id) => {
    const { devices, adapters } = get()
    const device = devices.find((d) => d.id === id)
    const adapter = adapters[id]
    await adapter?.disconnect()
    const next = devices.filter((d) => d.id !== id)
    if (device?.secretKey) {
      const stillUsed = next.some((d) => d.secretKey === device.secretKey)
      if (!stillUsed) await window.electronAPI?.secrets.delete(device.secretKey)
    }
    const { [id]: _a, ...restAdapters } = adapters
    const { [id]: _s, ...restStatuses } = get().statuses
    set({
      devices: next,
      adapters: restAdapters,
      statuses: restStatuses,
      selectedId: get().selectedId === id ? null : get().selectedId,
      checkedIds: get().checkedIds.filter((x) => x !== id)
    })
    persistDevices(next)
  },

  updateDevice: async (device) => {
    const devices = get().devices.map((d) => (d.id === device.id ? device : d))
    set({ devices })
    persistDevices(devices)
  },

  reconnectAll: async () => {
    const { devices, adapters: old } = get()
    await Promise.all(Object.values(old).map((a) => a.disconnect().catch(() => undefined)))
    const adapters: Record<string, PrinterAdapter> = {}
    await Promise.all(
      devices.map(async (device) => {
        const key = device.secretKey
          ? await window.electronAPI?.secrets.get(device.secretKey)
          : null
        const adapter = createAdapter(device, key)
        adapter.subscribe((status) => {
          queueDeviceStatus(device, status)
        })
        adapters[device.id] = adapter
        void adapter.connect().catch(() => undefined)
      })
    )
    set({ adapters })
  },

  control: async (deviceId, payload) => {
    const device = get().devices.find((d) => d.id === deviceId)
    const adapter = get().adapters[deviceId]
    if (!device || !adapter) throw new Error('设备未连接')
    try {
      await adapter.control(payload)
      await window.electronAPI?.logs.append({
        time: new Date().toISOString(),
        deviceId,
        deviceName: device.name,
        action: payload.action,
        result: 'ok'
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      await window.electronAPI?.logs.append({
        time: new Date().toISOString(),
        deviceId,
        deviceName: device.name,
        action: payload.action,
        result: 'error',
        detail
      })
      void window.electronAPI?.notify.show(device.name, `控制失败: ${detail}`)
      throw err
    }
  },

  batchControl: async (deviceIds, action) => {
    const results: BatchPrintResult[] = []
    for (const deviceId of deviceIds) {
      const device = get().devices.find((d) => d.id === deviceId)
      const deviceName = device?.name || deviceId
      try {
        await get().control(deviceId, { action })
        results.push({ deviceId, deviceName, ok: true })
      } catch (err) {
        results.push({
          deviceId,
          deviceName,
          ok: false,
          message: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return results
  },

  batchUploadAndPrint: async (deviceIds, files, onProgress) => {
    if (!files.length) throw new Error('请选择 G-code 文件')
    const { devices, adapters } = get()
    const results: BatchPrintResult[] = []
    const total = deviceIds.length

    for (let i = 0; i < deviceIds.length; i++) {
      const deviceId = deviceIds[i]
      const device = devices.find((d) => d.id === deviceId)
      const adapter = adapters[deviceId]
      const file = files.length === 1 ? files[0] : files[i] || files[files.length - 1]
      const deviceName = device?.name || deviceId

      if (!device || !adapter) {
        const r: BatchPrintResult = {
          deviceId,
          deviceName,
          ok: false,
          message: '设备未连接'
        }
        results.push(r)
        onProgress?.(i + 1, total, r)
        continue
      }
      if (!canBatchPrint(device)) {
        const r: BatchPrintResult = {
          deviceId,
          deviceName,
          ok: false,
          message: '该品牌暂不支持批量上传打印（需 Moonraker/Fluidd）'
        }
        results.push(r)
        onProgress?.(i + 1, total, r)
        continue
      }

      try {
        await adapter.uploadFile(file)
        await adapter.printFile(file.name)
        await window.electronAPI?.logs.append({
          time: new Date().toISOString(),
          deviceId,
          deviceName,
          action: 'batch_print',
          result: 'ok',
          detail: file.name
        })
        const r: BatchPrintResult = { deviceId, deviceName, ok: true, message: file.name }
        results.push(r)
        onProgress?.(i + 1, total, r)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        await window.electronAPI?.logs.append({
          time: new Date().toISOString(),
          deviceId,
          deviceName,
          action: 'batch_print',
          result: 'error',
          detail: `${file.name}: ${detail}`
        })
        const r: BatchPrintResult = { deviceId, deviceName, ok: false, message: detail }
        results.push(r)
        onProgress?.(i + 1, total, r)
      }
    }
    return results
  }
}})

export function selectVisibleDevices(state: {
  devices: DeviceConfig[]
  filter: BrandFilter
  search: string
  tech?: PrinterTech
}): DeviceConfig[] {
  const q = state.search.trim().toLowerCase()
  return state.devices.filter((d) => {
    if (state.tech && deviceTech(d) !== state.tech) return false
    if (state.filter !== 'all' && d.brand !== state.filter) return false
    if (!q) return true
    return (
      d.name.toLowerCase().includes(q) ||
      (d.group || '').toLowerCase().includes(q) ||
      (d.tags || []).some((t) => t.toLowerCase().includes(q))
    )
  })
}

import { create } from 'zustand'
import type { MonitorZone, ZoneCamera } from '../types/monitor'

type MonitorState = {
  zones: MonitorZone[]
  loading: boolean
  activeZoneId: string | null
  init: () => Promise<void>
  setActiveZoneId: (id: string | null) => void
  addZone: (name: string) => Promise<MonitorZone>
  renameZone: (id: string, name: string) => Promise<void>
  removeZone: (id: string) => Promise<void>
  addCamera: (
    zoneId: string,
    cam: Omit<ZoneCamera, 'id'>
  ) => Promise<ZoneCamera | null>
  updateCamera: (zoneId: string, cam: ZoneCamera) => Promise<void>
  removeCamera: (zoneId: string, cameraId: string) => Promise<void>
}

function persist(zones: MonitorZone[]): void {
  void window.electronAPI?.monitor?.save(zones)
}

let externalSyncBound = false

export const useMonitorStore = create<MonitorState>((set, get) => ({
  zones: [],
  loading: true,
  activeZoneId: null,

  init: async () => {
    set({ loading: true })
    const raw = ((await window.electronAPI?.monitor?.load()) || []) as MonitorZone[]
    const zones = Array.isArray(raw) ? raw : []
    set({
      zones,
      loading: false,
      activeZoneId: get().activeZoneId || zones[0]?.id || null
    })
    if (!externalSyncBound) {
      externalSyncBound = true
      window.electronAPI?.monitor?.onChanged?.(() => {
        void get().init()
      })
    }
  },

  setActiveZoneId: (activeZoneId) => set({ activeZoneId }),

  addZone: async (name) => {
    const now = new Date().toISOString()
    const zone: MonitorZone = {
      id: crypto.randomUUID(),
      name: name.trim() || '未命名区域',
      cameras: [],
      createdAt: now,
      updatedAt: now
    }
    const zones = [...get().zones, zone]
    set({ zones, activeZoneId: zone.id })
    persist(zones)
    return zone
  },

  renameZone: async (id, name) => {
    const n = name.trim()
    if (!n) return
    const zones = get().zones.map((z) =>
      z.id === id ? { ...z, name: n, updatedAt: new Date().toISOString() } : z
    )
    set({ zones })
    persist(zones)
  },

  removeZone: async (id) => {
    const zones = get().zones.filter((z) => z.id !== id)
    const activeZoneId =
      get().activeZoneId === id ? zones[0]?.id || null : get().activeZoneId
    set({ zones, activeZoneId })
    persist(zones)
  },

  addCamera: async (zoneId, input) => {
    const cam: ZoneCamera = {
      ...input,
      id: crypto.randomUUID(),
      name: input.name.trim() || '摄像头',
      url: input.url.trim()
    }
    if (!cam.url) return null
    const zones = get().zones.map((z) =>
      z.id === zoneId
        ? {
            ...z,
            cameras: [...z.cameras, cam],
            updatedAt: new Date().toISOString()
          }
        : z
    )
    set({ zones })
    persist(zones)
    return cam
  },

  updateCamera: async (zoneId, cam) => {
    const zones = get().zones.map((z) =>
      z.id === zoneId
        ? {
            ...z,
            cameras: z.cameras.map((c) => (c.id === cam.id ? cam : c)),
            updatedAt: new Date().toISOString()
          }
        : z
    )
    set({ zones })
    persist(zones)
  },

  removeCamera: async (zoneId, cameraId) => {
    const zones = get().zones.map((z) =>
      z.id === zoneId
        ? {
            ...z,
            cameras: z.cameras.filter((c) => c.id !== cameraId),
            updatedAt: new Date().toISOString()
          }
        : z
    )
    set({ zones })
    persist(zones)
  }
}))

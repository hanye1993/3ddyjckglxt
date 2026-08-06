import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'

export type ZoneCameraRow = {
  id: string
  name: string
  url: string
  snapshotUrl?: string
}

export type MonitorZoneRow = {
  id: string
  name: string
  cameras: ZoneCameraRow[]
  createdAt: string
  updatedAt?: string
}

export type MonitorCameraInfo = {
  id: string
  name: string
  streamUrl: string
  snapshotUrl?: string
}

export type MonitorWallDevice = {
  deviceId: string
  name: string
  brand: string
  cameras: MonitorCameraInfo[]
}

export type SnapshotResult =
  | { ok: true; contentType: string; base64: string }
  | { ok: false; message: string }

export type MonitorApiDeps = {
  getMonitorZonesPath: () => string
  onMonitorZonesChanged?: () => void
  listWall: () => Promise<MonitorWallDevice[]>
  listDeviceCameras: (deviceId: string) => Promise<MonitorWallDevice | null>
  /** Resolve snapshot for a raw camera URL (HTTP / MJPEG / bambu-cam://) */
  takeSnapshot: (url: string, apiKey?: string) => Promise<SnapshotResult>
  /** Device secret for Moonraker / Bambu LAN access code */
  getDeviceApiKey: (deviceId: string) => string | null
}

type JsonSend = (res: ServerResponse, status: number, body: unknown) => void

function readZones(path: string): MonitorZoneRow[] {
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw.filter((z) => z && typeof z === 'object' && typeof (z as MonitorZoneRow).id === 'string') as MonitorZoneRow[]
  } catch {
    return []
  }
}

function writeZones(path: string, zones: MonitorZoneRow[]): void {
  writeFileSync(path, JSON.stringify(zones, null, 2), 'utf8')
}

function sendImage(
  res: ServerResponse,
  status: number,
  contentType: string,
  buf: Buffer
): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key'
  })
  res.end(buf)
}

async function respondSnapshot(
  res: ServerResponse,
  url: URL,
  result: SnapshotResult,
  sendJson: JsonSend
): Promise<void> {
  if (!result.ok) {
    sendJson(res, 502, { ok: false, message: result.message })
    return
  }
  const format = (url.searchParams.get('format') || 'jpeg').toLowerCase()
  if (format === 'json' || format === 'base64') {
    sendJson(res, 200, {
      ok: true,
      contentType: result.contentType,
      base64: result.base64
    })
    return
  }
  sendImage(res, 200, result.contentType || 'image/jpeg', Buffer.from(result.base64, 'base64'))
}

function normalizeCameraInput(
  body: Record<string, unknown>,
  prev?: ZoneCameraRow
): { cam: ZoneCameraRow } | { error: string } {
  const name = String(body.name ?? prev?.name ?? '').trim() || '摄像头'
  const url = String(body.url ?? prev?.url ?? '').trim()
  if (!url) return { error: 'url is required' }
  const snapshotRaw = body.snapshotUrl ?? prev?.snapshotUrl
  const snapshotUrl =
    snapshotRaw != null && String(snapshotRaw).trim() ? String(snapshotRaw).trim() : undefined
  return {
    cam: {
      id: prev?.id || randomUUID(),
      name,
      url,
      snapshotUrl
    }
  }
}

/**
 * Handle /api/v1/monitor/* and /api/v1/devices/:id/cameras*
 * @returns true if the request was handled
 */
export async function handleMonitorApi(opts: {
  method: string
  path: string
  url: URL
  req: IncomingMessage
  res: ServerResponse
  apiMode: 'readonly' | 'control'
  deps: MonitorApiDeps
  sendJson: JsonSend
  readBody: (req: IncomingMessage) => Promise<string>
}): Promise<boolean> {
  const { method, path, url, req, res, apiMode, deps, sendJson, readBody } = opts
  const requireControl = (): boolean => {
    if (apiMode !== 'control') {
      sendJson(res, 403, { ok: false, message: 'API is in readonly mode' })
      return false
    }
    return true
  }

  // —— 内部监控（打印机舱内摄像头墙）——
  if (method === 'GET' && path === '/api/v1/monitor/wall') {
    const wall = await deps.listWall()
    sendJson(res, 200, { ok: true, devices: wall })
    return true
  }

  const deviceCams = path.match(/^\/api\/v1\/devices\/([^/]+)\/cameras$/)
  if (method === 'GET' && deviceCams) {
    const id = decodeURIComponent(deviceCams[1])
    const row = await deps.listDeviceCameras(id)
    if (!row) {
      sendJson(res, 404, { ok: false, message: 'Device not found' })
      return true
    }
    sendJson(res, 200, { ok: true, ...row })
    return true
  }

  const deviceCamSnap = path.match(/^\/api\/v1\/devices\/([^/]+)\/cameras\/([^/]+)\/snapshot$/)
  if (method === 'GET' && deviceCamSnap) {
    const deviceId = decodeURIComponent(deviceCamSnap[1])
    const cameraId = decodeURIComponent(deviceCamSnap[2])
    const row = await deps.listDeviceCameras(deviceId)
    if (!row) {
      sendJson(res, 404, { ok: false, message: 'Device not found' })
      return true
    }
    const cam = row.cameras.find((c) => c.id === cameraId)
    if (!cam) {
      sendJson(res, 404, { ok: false, message: 'Camera not found' })
      return true
    }
    const target = cam.snapshotUrl || cam.streamUrl
    const apiKey = deps.getDeviceApiKey(deviceId) || undefined
    const shot = await deps.takeSnapshot(target, apiKey)
    await respondSnapshot(res, url, shot, sendJson)
    return true
  }

  // —— 区域监控 ——
  if (method === 'GET' && path === '/api/v1/monitor/zones') {
    sendJson(res, 200, { ok: true, zones: readZones(deps.getMonitorZonesPath()) })
    return true
  }

  if (method === 'POST' && path === '/api/v1/monitor/zones') {
    if (!requireControl()) return true
    const raw = await readBody(req)
    let body: Record<string, unknown> = {}
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
      return true
    }
    const now = new Date().toISOString()
    const zone: MonitorZoneRow = {
      id: randomUUID(),
      name: String(body.name || '').trim() || '未命名区域',
      cameras: [],
      createdAt: now,
      updatedAt: now
    }
    const file = deps.getMonitorZonesPath()
    const zones = readZones(file)
    zones.push(zone)
    writeZones(file, zones)
    deps.onMonitorZonesChanged?.()
    sendJson(res, 200, { ok: true, zone })
    return true
  }

  if (method === 'PUT' && path === '/api/v1/monitor/zones') {
    if (!requireControl()) return true
    const raw = await readBody(req)
    let body: unknown
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
      return true
    }
    const list = Array.isArray(body)
      ? body
      : body && typeof body === 'object' && Array.isArray((body as { zones?: unknown }).zones)
        ? (body as { zones: unknown[] }).zones
        : null
    if (!list) {
      sendJson(res, 400, { ok: false, message: 'Body must be a zones array or { zones: [] }' })
      return true
    }
    writeZones(deps.getMonitorZonesPath(), list as MonitorZoneRow[])
    deps.onMonitorZonesChanged?.()
    sendJson(res, 200, { ok: true, zones: readZones(deps.getMonitorZonesPath()) })
    return true
  }

  const zoneOne = path.match(/^\/api\/v1\/monitor\/zones\/([^/]+)$/)
  if (zoneOne) {
    const zoneId = decodeURIComponent(zoneOne[1])
    const file = deps.getMonitorZonesPath()
    const zones = readZones(file)
    const idx = zones.findIndex((z) => z.id === zoneId)

    if (method === 'GET') {
      if (idx < 0) {
        sendJson(res, 404, { ok: false, message: 'Zone not found' })
        return true
      }
      sendJson(res, 200, { ok: true, zone: zones[idx] })
      return true
    }

    if (method === 'PATCH' || method === 'PUT') {
      if (!requireControl()) return true
      if (idx < 0) {
        sendJson(res, 404, { ok: false, message: 'Zone not found' })
        return true
      }
      const raw = await readBody(req)
      let body: Record<string, unknown> = {}
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      } catch {
        sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
        return true
      }
      const name = String(body.name ?? zones[idx].name).trim()
      if (!name) {
        sendJson(res, 400, { ok: false, message: 'name is required' })
        return true
      }
      const cameras =
        method === 'PUT' && Array.isArray(body.cameras)
          ? (body.cameras as ZoneCameraRow[])
          : zones[idx].cameras
      zones[idx] = {
        ...zones[idx],
        name,
        cameras,
        updatedAt: new Date().toISOString()
      }
      writeZones(file, zones)
      deps.onMonitorZonesChanged?.()
      sendJson(res, 200, { ok: true, zone: zones[idx] })
      return true
    }

    if (method === 'DELETE') {
      if (!requireControl()) return true
      if (idx < 0) {
        sendJson(res, 404, { ok: false, message: 'Zone not found' })
        return true
      }
      zones.splice(idx, 1)
      writeZones(file, zones)
      deps.onMonitorZonesChanged?.()
      sendJson(res, 200, { ok: true })
      return true
    }
  }

  const zoneCams = path.match(/^\/api\/v1\/monitor\/zones\/([^/]+)\/cameras$/)
  if (method === 'POST' && zoneCams) {
    if (!requireControl()) return true
    const zoneId = decodeURIComponent(zoneCams[1])
    const file = deps.getMonitorZonesPath()
    const zones = readZones(file)
    const idx = zones.findIndex((z) => z.id === zoneId)
    if (idx < 0) {
      sendJson(res, 404, { ok: false, message: 'Zone not found' })
      return true
    }
    const raw = await readBody(req)
    let body: Record<string, unknown> = {}
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
      return true
    }
    const created = normalizeCameraInput(body)
    if ('error' in created) {
      sendJson(res, 400, { ok: false, message: created.error })
      return true
    }
    zones[idx] = {
      ...zones[idx],
      cameras: [...zones[idx].cameras, created.cam],
      updatedAt: new Date().toISOString()
    }
    writeZones(file, zones)
    deps.onMonitorZonesChanged?.()
    sendJson(res, 200, { ok: true, camera: created.cam, zone: zones[idx] })
    return true
  }

  const zoneCamOne = path.match(/^\/api\/v1\/monitor\/zones\/([^/]+)\/cameras\/([^/]+)$/)
  if (zoneCamOne) {
    const zoneId = decodeURIComponent(zoneCamOne[1])
    const cameraId = decodeURIComponent(zoneCamOne[2])
    const file = deps.getMonitorZonesPath()
    const zones = readZones(file)
    const zIdx = zones.findIndex((z) => z.id === zoneId)
    if (zIdx < 0) {
      sendJson(res, 404, { ok: false, message: 'Zone not found' })
      return true
    }
    const cIdx = zones[zIdx].cameras.findIndex((c) => c.id === cameraId)

    if (method === 'GET') {
      if (cIdx < 0) {
        sendJson(res, 404, { ok: false, message: 'Camera not found' })
        return true
      }
      sendJson(res, 200, { ok: true, camera: zones[zIdx].cameras[cIdx] })
      return true
    }

    if (method === 'PATCH' || method === 'PUT') {
      if (!requireControl()) return true
      if (cIdx < 0) {
        sendJson(res, 404, { ok: false, message: 'Camera not found' })
        return true
      }
      const raw = await readBody(req)
      let body: Record<string, unknown> = {}
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      } catch {
        sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
        return true
      }
      const next = normalizeCameraInput(body, zones[zIdx].cameras[cIdx])
      if ('error' in next) {
        sendJson(res, 400, { ok: false, message: next.error })
        return true
      }
      zones[zIdx].cameras[cIdx] = next.cam
      zones[zIdx] = { ...zones[zIdx], updatedAt: new Date().toISOString() }
      writeZones(file, zones)
      deps.onMonitorZonesChanged?.()
      sendJson(res, 200, { ok: true, camera: next.cam, zone: zones[zIdx] })
      return true
    }

    if (method === 'DELETE') {
      if (!requireControl()) return true
      if (cIdx < 0) {
        sendJson(res, 404, { ok: false, message: 'Camera not found' })
        return true
      }
      zones[zIdx].cameras.splice(cIdx, 1)
      zones[zIdx] = { ...zones[zIdx], updatedAt: new Date().toISOString() }
      writeZones(file, zones)
      deps.onMonitorZonesChanged?.()
      sendJson(res, 200, { ok: true })
      return true
    }
  }

  const zoneCamSnap = path.match(
    /^\/api\/v1\/monitor\/zones\/([^/]+)\/cameras\/([^/]+)\/snapshot$/
  )
  if (method === 'GET' && zoneCamSnap) {
    const zoneId = decodeURIComponent(zoneCamSnap[1])
    const cameraId = decodeURIComponent(zoneCamSnap[2])
    const zones = readZones(deps.getMonitorZonesPath())
    const zone = zones.find((z) => z.id === zoneId)
    if (!zone) {
      sendJson(res, 404, { ok: false, message: 'Zone not found' })
      return true
    }
    const cam = zone.cameras.find((c) => c.id === cameraId)
    if (!cam) {
      sendJson(res, 404, { ok: false, message: 'Camera not found' })
      return true
    }
    const target = (cam.snapshotUrl || cam.url || '').trim()
    if (!target) {
      sendJson(res, 400, { ok: false, message: 'Camera has no url' })
      return true
    }
    const shot = await deps.takeSnapshot(target)
    await respondSnapshot(res, url, shot, sendJson)
    return true
  }

  return false
}

export function monitorSummaryCounts(zonesPath: string): {
  zones: number
  cameras: number
} {
  const zones = readZones(zonesPath)
  return {
    zones: zones.length,
    cameras: zones.reduce((n, z) => n + (z.cameras?.length || 0), 0)
  }
}

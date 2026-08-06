import type { IncomingMessage, ServerResponse } from 'http'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import {
  addDevice,
  publicSettings,
  removeDevice,
  SETTINGS_PATCH_KEYS,
  updateDevice
} from './deviceMutations'
import { DEVICE_CONTROL_ACTIONS, isControlAction, parseControlExtras } from './controlShared'

export type DeviceOpHandler = (req: {
  deviceId: string
  op: 'listFiles' | 'uploadFile' | 'downloadFile'
  filename?: string
  contentBase64?: string
  remotePath?: string
}) => Promise<{
  ok: boolean
  message?: string
  files?: Array<{ path: string; size: number; modified?: number }>
  filename?: string
  contentBase64?: string
  contentType?: string
}>

export type BatchPrintHandler = (payload: {
  deviceIds: string[]
  filename: string
  contentBase64?: string
}) => Promise<{
  ok: boolean
  results: Array<{ deviceId: string; deviceName: string; ok: boolean; message?: string }>
}>

export type FullApiDeps = {
  getDevicesPath: () => string
  getFilamentPath: () => string
  getSettings: () => Record<string, unknown> & { apiMode?: string; apiKey?: string }
  onControl: (deviceId: string, payload: unknown) => Promise<{ ok: boolean; message?: string }>
  onDevicesChanged?: () => void
  setDeviceSecret: (secretKey: string, value: string) => void
  deleteDeviceSecret: (secretKey: string) => void
  onDeviceOp: DeviceOpHandler
  onBatchPrint: BatchPrintHandler
  startLanDiscover: (opts?: { brands?: string[] }) => Promise<{ ok: boolean; message?: string }>
  getLanDiscover: () => {
    phase: string
    scanned: number
    total: number
    found: number
    message?: string
    hits: unknown[]
  }
  cancelLanDiscover: () => void
  getLogs: (opts?: { limit?: number; deviceId?: string }) => unknown[]
  clearLogs: () => void
  patchSettings: (
    patch: Record<string, unknown>
  ) => Promise<{ ok: boolean; settings?: unknown; message?: string }>
  sanitizeDevice: (d: Record<string, unknown>) => Record<string, unknown>
  onFilamentChanged?: () => void
}

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>

function requireControl(
  settings: { apiMode?: string },
  res: ServerResponse,
  sendJson: SendJson
): boolean {
  if (settings.apiMode !== 'control') {
    sendJson(res, 403, { ok: false, message: 'API is in readonly mode' })
    return false
  }
  return true
}

async function parseJsonBody(
  req: IncomingMessage,
  readBody: ReadBody
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
  const raw = await readBody(req)
  if (!raw) return { ok: true, body: {} }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'Body must be a JSON object' }
    }
    return { ok: true, body: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, message: 'Invalid JSON body' }
  }
}

function safeRemotePath(raw: string): string | null {
  const p = raw.replace(/\\/g, '/').trim()
  if (!p || p.includes('..') || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null
  return p
}

/**
 * Extra full-API routes. Returns true if handled.
 */
export async function handleFullApi(opts: {
  method: string
  path: string
  url: URL
  req: IncomingMessage
  res: ServerResponse
  deps: FullApiDeps
  sendJson: SendJson
  readBody: ReadBody
}): Promise<boolean> {
  const { method, path, url, req, res, deps, sendJson, readBody } = opts
  const settings = deps.getSettings()

  // —— Settings ——
  if (method === 'GET' && path === '/api/v1/settings') {
    sendJson(res, 200, { ok: true, settings: publicSettings(settings as Record<string, unknown>) })
    return true
  }

  if (method === 'PATCH' && path === '/api/v1/settings') {
    if (!requireControl(settings, res, sendJson)) return true
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    const patch: Record<string, unknown> = {}
    for (const key of SETTINGS_PATCH_KEYS) {
      if (key in parsed.body) patch[key] = parsed.body[key]
    }
    if (!Object.keys(patch).length) {
      sendJson(res, 400, { ok: false, message: 'No allowed settings fields in body' })
      return true
    }
    const result = await deps.patchSettings(patch)
    if (!result.ok) {
      sendJson(res, 400, { ok: false, message: result.message || 'Failed to patch settings' })
      return true
    }
    sendJson(res, 200, {
      ok: true,
      settings: publicSettings((result.settings || deps.getSettings()) as Record<string, unknown>)
    })
    return true
  }

  // —— Logs ——
  if (method === 'GET' && path === '/api/v1/logs') {
    const limit = Math.min(500, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 100)))
    const deviceId = url.searchParams.get('deviceId') || undefined
    const logs = deps.getLogs({ limit, deviceId: deviceId || undefined })
    sendJson(res, 200, { ok: true, logs, count: logs.length })
    return true
  }

  if (method === 'DELETE' && path === '/api/v1/logs') {
    if (!requireControl(settings, res, sendJson)) return true
    deps.clearLogs()
    sendJson(res, 200, { ok: true })
    return true
  }

  // —— LAN discover ——
  if (method === 'POST' && path === '/api/v1/discover/lan') {
    if (!requireControl(settings, res, sendJson)) return true
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    const brands = Array.isArray(parsed.body.brands)
      ? parsed.body.brands.map((b) => String(b))
      : undefined
    const started = await deps.startLanDiscover(brands ? { brands } : undefined)
    sendJson(res, started.ok ? 200 : 409, { ok: started.ok, message: started.message, ...deps.getLanDiscover() })
    return true
  }

  if (method === 'GET' && path === '/api/v1/discover/lan') {
    sendJson(res, 200, { ok: true, ...deps.getLanDiscover() })
    return true
  }

  if (method === 'DELETE' && path === '/api/v1/discover/lan') {
    if (!requireControl(settings, res, sendJson)) return true
    deps.cancelLanDiscover()
    sendJson(res, 200, { ok: true, ...deps.getLanDiscover() })
    return true
  }

  // —— Batch ——
  if (method === 'POST' && path === '/api/v1/batch/control') {
    if (!requireControl(settings, res, sendJson)) return true
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    const deviceIds = Array.isArray(parsed.body.deviceIds)
      ? parsed.body.deviceIds.map((id) => String(id)).filter(Boolean)
      : []
    if (!deviceIds.length) {
      sendJson(res, 400, { ok: false, message: 'deviceIds is required' })
      return true
    }
    if (!isControlAction(parsed.body.action)) {
      sendJson(res, 400, {
        ok: false,
        message: `Unknown or missing action. Allowed: ${DEVICE_CONTROL_ACTIONS.join(', ')}`
      })
      return true
    }
    const extras = parseControlExtras(parsed.body)
    const results: Array<{ deviceId: string; ok: boolean; message?: string }> = []
    for (const id of deviceIds) {
      const r = await deps.onControl(id, { action: parsed.body.action, ...extras })
      results.push({ deviceId: id, ok: r.ok, message: r.message })
    }
    sendJson(res, 200, {
      ok: results.every((r) => r.ok),
      results
    })
    return true
  }

  if (method === 'POST' && path === '/api/v1/batch/print') {
    if (!requireControl(settings, res, sendJson)) return true
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    const deviceIds = Array.isArray(parsed.body.deviceIds)
      ? parsed.body.deviceIds.map((id) => String(id)).filter(Boolean)
      : []
    const filename = String(parsed.body.filename || '').trim()
    const contentBase64 =
      typeof parsed.body.contentBase64 === 'string' ? parsed.body.contentBase64 : undefined
    if (!deviceIds.length) {
      sendJson(res, 400, { ok: false, message: 'deviceIds is required' })
      return true
    }
    if (!filename) {
      sendJson(res, 400, { ok: false, message: 'filename is required' })
      return true
    }
    const result = await deps.onBatchPrint({ deviceIds, filename, contentBase64 })
    sendJson(res, result.ok ? 200 : 502, result)
    return true
  }

  // —— Device CRUD ——
  if (method === 'POST' && path === '/api/v1/devices') {
    if (!requireControl(settings, res, sendJson)) return true
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    const created = addDevice(deps.getDevicesPath(), parsed.body)
    if ('error' in created) {
      sendJson(res, 400, { ok: false, message: created.error })
      return true
    }
    if (created.secret && created.device.secretKey) {
      deps.setDeviceSecret(created.device.secretKey, created.secret)
    }
    deps.onDevicesChanged?.()
    sendJson(res, 200, {
      ok: true,
      device: deps.sanitizeDevice(created.device),
      secretSaved: !!created.secret
    })
    return true
  }

  const deviceOnly = path.match(/^\/api\/v1\/devices\/([^/]+)$/)
  if (deviceOnly && (method === 'PATCH' || method === 'PUT' || method === 'DELETE')) {
    if (!requireControl(settings, res, sendJson)) return true
    const id = decodeURIComponent(deviceOnly[1])
    if (method === 'DELETE') {
      const removed = removeDevice(deps.getDevicesPath(), id)
      if ('error' in removed) {
        sendJson(res, 404, { ok: false, message: removed.error })
        return true
      }
      if (removed.removed.secretKey) deps.deleteDeviceSecret(removed.removed.secretKey)
      deps.onDevicesChanged?.()
      sendJson(res, 200, { ok: true })
      return true
    }
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    const updated = updateDevice(deps.getDevicesPath(), id, parsed.body)
    if ('error' in updated) {
      sendJson(res, updated.error === 'Device not found' ? 404 : 400, {
        ok: false,
        message: updated.error
      })
      return true
    }
    if (updated.clearSecret && updated.prevSecretKey) {
      deps.deleteDeviceSecret(updated.prevSecretKey)
    }
    if (updated.secret && updated.device.secretKey) {
      deps.setDeviceSecret(updated.device.secretKey, updated.secret)
    }
    deps.onDevicesChanged?.()
    sendJson(res, 200, {
      ok: true,
      device: deps.sanitizeDevice(updated.device),
      secretSaved: !!updated.secret
    })
    return true
  }

  // —— Device files ——
  const filesList = path.match(/^\/api\/v1\/devices\/([^/]+)\/files$/)
  if (filesList && method === 'GET') {
    const id = decodeURIComponent(filesList[1])
    const result = await deps.onDeviceOp({ deviceId: id, op: 'listFiles' })
    sendJson(res, result.ok ? 200 : 502, {
      ok: result.ok,
      files: result.files || [],
      message: result.message
    })
    return true
  }

  if (filesList && method === 'POST') {
    if (!requireControl(settings, res, sendJson)) return true
    const id = decodeURIComponent(filesList[1])
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    const filename = String(parsed.body.filename || '').trim()
    const contentBase64 = String(parsed.body.contentBase64 || '')
    if (!filename || !contentBase64) {
      sendJson(res, 400, { ok: false, message: 'filename and contentBase64 are required' })
      return true
    }
    const result = await deps.onDeviceOp({
      deviceId: id,
      op: 'uploadFile',
      filename,
      contentBase64
    })
    sendJson(res, result.ok ? 200 : 502, result)
    return true
  }

  const fileContent = path.match(/^\/api\/v1\/devices\/([^/]+)\/files\/content$/)
  if (fileContent && method === 'GET') {
    const id = decodeURIComponent(fileContent[1])
    const remote = safeRemotePath(String(url.searchParams.get('path') || ''))
    if (!remote) {
      sendJson(res, 400, { ok: false, message: 'Query path is required and must be relative' })
      return true
    }
    const result = await deps.onDeviceOp({
      deviceId: id,
      op: 'downloadFile',
      remotePath: remote
    })
    if (!result.ok) {
      sendJson(res, 502, result)
      return true
    }
    const format = (url.searchParams.get('format') || 'json').toLowerCase()
    if (format === 'binary' || format === 'raw') {
      const buf = Buffer.from(result.contentBase64 || '', 'base64')
      const name = result.filename || remote.split('/').pop() || 'download.bin'
      res.writeHead(200, {
        'Content-Type': result.contentType || 'application/octet-stream',
        'Content-Length': buf.length,
        'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key'
      })
      res.end(buf)
      return true
    }
    sendJson(res, 200, {
      ok: true,
      filename: result.filename || remote,
      contentBase64: result.contentBase64,
      contentType: result.contentType || 'application/octet-stream'
    })
    return true
  }

  if (fileContent && method === 'DELETE') {
    if (!requireControl(settings, res, sendJson)) return true
    sendJson(res, 501, {
      ok: false,
      message: 'Device file delete is not supported via API yet'
    })
    return true
  }

  // —— Filament bind helpers ——
  const filamentBind = path.match(/^\/api\/v1\/filament\/([^/]+)\/(bind|unbind)$/)
  if (filamentBind && method === 'POST') {
    if (!requireControl(settings, res, sendJson)) return true
    const spoolId = decodeURIComponent(filamentBind[1])
    const kind = filamentBind[2] as 'bind' | 'unbind'
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    const deviceId = String(parsed.body.deviceId || '').trim()
    const slotId = Math.floor(Number(parsed.body.slotId))
    if (!deviceId || !Number.isFinite(slotId) || slotId < 0) {
      sendJson(res, 400, { ok: false, message: 'deviceId and slotId (>=0) are required' })
      return true
    }
    const file = deps.getFilamentPath()
    let spools: Array<Record<string, unknown>> = []
    try {
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, 'utf8'))
        spools = Array.isArray(raw) ? raw : []
      }
      const idx = spools.findIndex((s) => String(s.id) === spoolId)
      if (idx < 0) {
        sendJson(res, 404, { ok: false, message: 'Spool not found' })
        return true
      }
      const spool = spools[idx]
      const rolls = Math.max(1, Math.min(99, Math.floor(Number(spool.rolls) || 1)))

      // Clear this slot on all spools; bind/unbind on target
      for (const s of spools) {
        let list: Array<{ deviceId: string; slotId: number }> = []
        if (Array.isArray(s.amsBindings)) {
          list = [...(s.amsBindings as Array<{ deviceId: string; slotId: number }>)]
        } else if (s.amsBinding && typeof s.amsBinding === 'object') {
          const b = s.amsBinding as { deviceId?: string; slotId?: number }
          if (b.deviceId) list = [{ deviceId: b.deviceId, slotId: Number(b.slotId) }]
        }
        list = list.filter(
          (b) => !(b.deviceId === deviceId && Number(b.slotId) === slotId)
        )
        if (String(s.id) === spoolId && kind === 'bind') {
          if (!list.some((b) => b.deviceId === deviceId && Number(b.slotId) === slotId)) {
            if (list.length >= rolls) {
              sendJson(res, 409, {
                ok: false,
                message: `Spool only has ${rolls} roll(s); binding full`
              })
              return true
            }
            list.push({ deviceId, slotId })
          }
        }
        s.amsBindings = list
        s.amsBinding = list[0] || null
        if (String(s.id) === spoolId) s.rolls = rolls
        s.updatedAt = new Date().toISOString()
      }
      writeFileSync(file, JSON.stringify(spools, null, 2), 'utf8')
      deps.onFilamentChanged?.()
      const next = spools.find((s) => String(s.id) === spoolId)
      sendJson(res, 200, { ok: true, spool: next })
      return true
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      })
      return true
    }
  }

  return false
}

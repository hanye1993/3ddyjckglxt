import type { HskFwType } from './server'
import { HSK_DEFAULT_MEMO } from './server'

const HSK_BASE = 'https://hsk-api.oray.com'

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
  basebandwidth?: number
  userid?: number
}

export type HskFetchMetaResult =
  | { ok: true; domains: HskDomainItem[]; mappings: HskMapping[] }
  | { ok: false; message: string }

export type HskSyncResult =
  | {
      ok: true
      mapping: HskMapping
      hskDomain: string
      hskExternalPort: number
      hskFwType: HskFwType
    }
  | { ok: false; message: string }

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `apikey ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
}

function explainHttpError(status: number, bodyText: string): string {
  if (status === 401) return '花生壳 API Key 无效或已过期'
  if (status === 404) return '花生壳资源不存在，请检查域名或映射'
  if (status === 400) {
    try {
      const j = JSON.parse(bodyText) as { message?: string; error?: string }
      return j.message || j.error || '花生壳请求参数错误'
    } catch {
      return '花生壳请求参数错误'
    }
  }
  if (status >= 500) return '花生壳服务器异常，请稍后重试'
  return `花生壳请求失败（HTTP ${status}）`
}

async function hskRequest(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  const key = apiKey.trim()
  if (!key) return { ok: false, message: '请先填写花生壳 API Key' }
  try {
    const res = await fetch(`${HSK_BASE}${path}`, {
      method,
      headers: authHeaders(key),
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, message: explainHttpError(res.status, text) }
    }
    if (!text || res.status === 204) return { ok: true, data: null }
    try {
      return { ok: true, data: JSON.parse(text) as unknown }
    } catch {
      return { ok: true, data: text }
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '无法连接花生壳 API' }
  }
}

function parseDomains(data: unknown): HskDomainItem[] {
  if (!data || typeof data !== 'object') return []
  const actived = (data as { actived?: unknown }).actived
  if (!Array.isArray(actived)) return []
  const out: HskDomainItem[] = []
  for (const d of actived) {
    if (!d || typeof d !== 'object') continue
    const o = d as Record<string, unknown>
    const name = typeof o.domainname === 'string' ? o.domainname : ''
    if (!name) continue
    out.push({
      domainname: name,
      account: typeof o.account === 'string' ? o.account : undefined,
      expiredate: typeof o.expiredate === 'number' ? o.expiredate : undefined
    })
  }
  return out
}

function parseMappings(data: unknown): HskMapping[] {
  if (!Array.isArray(data)) return []
  const out: HskMapping[] = []
  for (const m of data) {
    if (!m || typeof m !== 'object') continue
    const o = m as Record<string, unknown>
    const domain = typeof o.domain === 'string' ? o.domain : ''
    const port = Number(o.port)
    if (!domain || !Number.isFinite(port)) continue
    out.push({
      memo: typeof o.memo === 'string' ? o.memo : undefined,
      domain,
      port: Math.floor(port),
      servicehost: typeof o.servicehost === 'string' ? o.servicehost : undefined,
      serviceport: Number.isFinite(Number(o.serviceport))
        ? Math.floor(Number(o.serviceport))
        : undefined,
      fwtype: Number.isFinite(Number(o.fwtype)) ? Math.floor(Number(o.fwtype)) : undefined,
      isforbid: Boolean(o.isforbid),
      basebandwidth: Number.isFinite(Number(o.basebandwidth))
        ? Number(o.basebandwidth)
        : undefined,
      userid: Number.isFinite(Number(o.userid)) ? Number(o.userid) : undefined
    })
  }
  return out
}

export async function fetchHskMeta(apiKey: string): Promise<HskFetchMetaResult> {
  const domainsRes = await hskRequest(apiKey, 'GET', '/openapi/api/domain/list')
  if (!domainsRes.ok) return domainsRes
  const mappingsRes = await hskRequest(apiKey, 'GET', '/openapi/v2/mapping/list')
  if (!mappingsRes.ok) return mappingsRes
  return {
    ok: true,
    domains: parseDomains(domainsRes.data),
    mappings: parseMappings(mappingsRes.data)
  }
}

function findExisting(
  mappings: HskMapping[],
  opts: { memo: string; domain?: string; servicePort: number; fwType: HskFwType }
): HskMapping | undefined {
  const byMemo = mappings.find((m) => m.memo === opts.memo)
  if (byMemo) return byMemo
  if (opts.domain) {
    const same =
      mappings.find(
        (m) =>
          m.domain === opts.domain &&
          m.serviceport === opts.servicePort &&
          (m.fwtype === opts.fwType || !m.fwtype)
      ) ||
      mappings.find((m) => m.domain === opts.domain && m.serviceport === opts.servicePort)
    if (same) return same
  }
  return mappings.find((m) => m.serviceport === opts.servicePort && m.fwtype === opts.fwType)
}

function asHskFwType(v: number | undefined, fallback: HskFwType): HskFwType {
  if (v === 1 || v === 2 || v === 3) return v
  return fallback
}

export async function syncHskMapping(opts: {
  apiKey: string
  domain: string
  servicePort: number
  fwType: HskFwType
  memo?: string
}): Promise<HskSyncResult> {
  const memo = (opts.memo || HSK_DEFAULT_MEMO).trim() || HSK_DEFAULT_MEMO
  const domain = opts.domain.trim()
  if (!domain) return { ok: false, message: '请先选择花生壳域名' }
  if (!opts.servicePort || opts.servicePort < 1 || opts.servicePort > 65535) {
    return { ok: false, message: '本机 API 端口无效' }
  }

  const meta = await fetchHskMeta(opts.apiKey)
  if (!meta.ok) return meta

  const existing = findExisting(meta.mappings, {
    memo,
    domain,
    servicePort: opts.servicePort,
    fwType: opts.fwType
  })

  if (existing) {
    const fw = asHskFwType(existing.fwtype, opts.fwType)
    const put = await hskRequest(
      opts.apiKey,
      'PUT',
      `/openapi/v2/mappings/${encodeURIComponent(existing.domain)}/${existing.port}/${fw}`,
      {
        memo,
        fwtype: opts.fwType,
        servicehost: '127.0.0.1',
        serviceport: opts.servicePort
      }
    )
    if (!put.ok) return put
    const mapping: HskMapping = {
      ...existing,
      memo,
      domain: existing.domain,
      port: existing.port,
      fwtype: opts.fwType,
      servicehost: '127.0.0.1',
      serviceport: opts.servicePort
    }
    return {
      ok: true,
      mapping,
      hskDomain: mapping.domain,
      hskExternalPort: mapping.port,
      hskFwType: opts.fwType
    }
  }

  // HTTP/HTTPS 优先尝试 80/443；失败则 port=0 由系统分配
  const preferredPort = opts.fwType === 3 ? 443 : opts.fwType === 2 ? 80 : 0
  const createBody = {
    memo,
    domain,
    fwtype: opts.fwType,
    type: opts.fwType,
    port: preferredPort,
    servicehost: '127.0.0.1',
    serviceport: opts.servicePort,
    bandwidth: 1,
    logoid: 0
  }

  let created = await hskRequest(opts.apiKey, 'POST', '/openapi/v2/mapping/create', createBody)
  if (!created.ok && preferredPort !== 0) {
    created = await hskRequest(opts.apiKey, 'POST', '/openapi/v2/mapping/create', {
      ...createBody,
      port: 0
    })
  }
  if (!created.ok) return created

  // 再拉列表定位新建项
  const after = await fetchHskMeta(opts.apiKey)
  if (!after.ok) return after
  const mapping =
    findExisting(after.mappings, {
      memo,
      domain,
      servicePort: opts.servicePort,
      fwType: opts.fwType
    }) ||
    after.mappings.find((m) => m.domain === domain && m.serviceport === opts.servicePort)

  if (!mapping) {
    return {
      ok: false,
      message: '映射已提交，但未能读取到外网地址，请到花生壳管理平台确认后点「拉取账号信息」'
    }
  }

  const fw = asHskFwType(mapping.fwtype, opts.fwType)
  return {
    ok: true,
    mapping,
    hskDomain: mapping.domain,
    hskExternalPort: mapping.port,
    hskFwType: fw
  }
}

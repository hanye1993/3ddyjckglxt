/* global window, EventSource */
;(function (global) {
  var STORAGE_KEY = 'hanye_monitor_client_v2'
  var LEGACY_KEY = 'hanye_monitor_client'

  function uid() {
    return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  }

  function normalizeBase(host, port) {
    var h = String(host || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
    // allow pasting full URL into host field
    if (/:\d+$/.test(h) && !port) {
      var parts = h.split(':')
      port = parts.pop()
      h = parts.join(':')
    }
    // strip path if pasted
    h = h.split('/')[0]
    var p = String(port || '17890').trim() || '17890'
    return { host: h, port: p, apiBase: 'http://' + h + ':' + p }
  }

  function emptyStore() {
    return { currentId: '', servers: [] }
  }

  function migrateLegacy() {
    try {
      var raw = localStorage.getItem(LEGACY_KEY)
      if (!raw) return null
      var o = JSON.parse(raw)
      var base = String(o.apiBase || '').replace(/\/$/, '')
      if (!base) return null
      var m = base.match(/^https?:\/\/([^/:]+)(?::(\d+))?/i)
      var host = m ? m[1] : base
      var port = m && m[2] ? m[2] : '17890'
      var id = uid()
      var server = {
        id: id,
        name: host + ':' + port,
        host: host,
        port: port,
        apiKey: String(o.apiKey || ''),
        apiBase: 'http://' + host + ':' + port,
        lastUsed: Date.now()
      }
      return { currentId: id, servers: [server] }
    } catch (e) {
      return null
    }
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        var o = JSON.parse(raw)
        return {
          currentId: String(o.currentId || ''),
          servers: Array.isArray(o.servers) ? o.servers : []
        }
      }
    } catch (e) {
      /* ignore */
    }
    var migrated = migrateLegacy()
    if (migrated) {
      saveStore(migrated)
      return migrated
    }
    return emptyStore()
  }

  function saveStore(store) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        currentId: store.currentId || '',
        servers: store.servers || []
      })
    )
  }

  function getCurrentServer(store) {
    store = store || loadStore()
    if (!store.currentId) return null
    for (var i = 0; i < store.servers.length; i++) {
      if (store.servers[i].id === store.currentId) return store.servers[i]
    }
    return null
  }

  function upsertServer(input) {
    var store = loadStore()
    var norm = normalizeBase(input.host, input.port)
    var apiKey = String(input.apiKey || '').trim()
    var name = String(input.name || '').trim() || norm.host + ':' + norm.port
    var existing = null
    for (var i = 0; i < store.servers.length; i++) {
      var s = store.servers[i]
      if (s.apiBase === norm.apiBase && s.apiKey === apiKey) {
        existing = s
        break
      }
      if (input.id && s.id === input.id) {
        existing = s
        break
      }
    }
    if (existing) {
      existing.name = name
      existing.host = norm.host
      existing.port = norm.port
      existing.apiBase = norm.apiBase
      existing.apiKey = apiKey
      existing.lastUsed = Date.now()
      store.currentId = existing.id
    } else {
      var row = {
        id: uid(),
        name: name,
        host: norm.host,
        port: norm.port,
        apiBase: norm.apiBase,
        apiKey: apiKey,
        lastUsed: Date.now()
      }
      store.servers.unshift(row)
      store.currentId = row.id
    }
    saveStore(store)
    return getCurrentServer(store)
  }

  function setCurrent(id) {
    var store = loadStore()
    store.currentId = id || ''
    var cur = getCurrentServer(store)
    if (cur) cur.lastUsed = Date.now()
    saveStore(store)
    return cur
  }

  function deleteServer(id) {
    var store = loadStore()
    store.servers = store.servers.filter(function (s) {
      return s.id !== id
    })
    if (store.currentId === id) {
      store.currentId = store.servers[0] ? store.servers[0].id : ''
    }
    saveStore(store)
    return store
  }

  function clearCurrent() {
    var store = loadStore()
    store.currentId = ''
    saveStore(store)
  }

  /** @deprecated compat — returns { apiBase, apiKey } for current */
  function loadConfig() {
    var cur = getCurrentServer()
    if (!cur) return { apiBase: '', apiKey: '' }
    return { apiBase: cur.apiBase, apiKey: cur.apiKey }
  }

  function saveConfig(cfg) {
    if (!cfg || !cfg.apiBase) return
    var m = String(cfg.apiBase).match(/^https?:\/\/([^/:]+)(?::(\d+))?/i)
    upsertServer({
      host: m ? m[1] : cfg.apiBase,
      port: m && m[2] ? m[2] : '17890',
      apiKey: cfg.apiKey || '',
      name: cfg.name
    })
  }

  function headers(cfg, json) {
    var h = { 'X-Api-Key': (cfg && cfg.apiKey) || '' }
    if (json) h['Content-Type'] = 'application/json'
    return h
  }

  function cfgOrCurrent(cfg) {
    if (cfg && cfg.apiBase) return cfg
    return loadConfig()
  }

  async function request(cfg, method, path, body) {
    cfg = cfgOrCurrent(cfg)
    var opts = {
      method: method,
      headers: headers(cfg, body !== undefined)
    }
    if (body !== undefined) opts.body = JSON.stringify(body)
    var res = await fetch(cfg.apiBase + path, opts)
    var data = await res.json().catch(function () {
      return {}
    })
    if (!res.ok || data.ok === false) {
      throw new Error(data.message || 'HTTP ' + res.status)
    }
    return data
  }

  async function apiGet(cfg, path) {
    return request(cfg, 'GET', path)
  }

  async function apiPost(cfg, path, body) {
    return request(cfg, 'POST', path, body || {})
  }

  async function apiPut(cfg, path, body) {
    return request(cfg, 'PUT', path, body || {})
  }

  async function apiPatch(cfg, path, body) {
    return request(cfg, 'PATCH', path, body || {})
  }

  async function apiDelete(cfg, path) {
    return request(cfg, 'DELETE', path)
  }

  /** High-level Full API helpers (v1 complete surface) */
  var Full = {
    summary: function (cfg) {
      return apiGet(cfg, '/api/v1/summary')
    },
    devices: function (cfg, tech) {
      var q = tech ? '?tech=' + encodeURIComponent(tech) : ''
      return apiGet(cfg, '/api/v1/devices' + q)
    },
    device: function (cfg, id) {
      return apiGet(cfg, '/api/v1/devices/' + encodeURIComponent(id))
    },
    createDevice: function (cfg, body) {
      return apiPost(cfg, '/api/v1/devices', body)
    },
    updateDevice: function (cfg, id, body) {
      return apiPatch(cfg, '/api/v1/devices/' + encodeURIComponent(id), body)
    },
    deleteDevice: function (cfg, id) {
      return apiDelete(cfg, '/api/v1/devices/' + encodeURIComponent(id))
    },
    control: function (cfg, id, body) {
      return apiPost(cfg, '/api/v1/devices/' + encodeURIComponent(id) + '/control', body)
    },
    listFiles: function (cfg, id) {
      return apiGet(cfg, '/api/v1/devices/' + encodeURIComponent(id) + '/files')
    },
    uploadFile: function (cfg, id, filename, contentBase64) {
      return apiPost(cfg, '/api/v1/devices/' + encodeURIComponent(id) + '/files', {
        filename: filename,
        contentBase64: contentBase64
      })
    },
    batchControl: function (cfg, deviceIds, action, extras) {
      var body = Object.assign({ deviceIds: deviceIds, action: action }, extras || {})
      return apiPost(cfg, '/api/v1/batch/control', body)
    },
    batchPrint: function (cfg, deviceIds, filename, contentBase64) {
      var body = { deviceIds: deviceIds, filename: filename }
      if (contentBase64) body.contentBase64 = contentBase64
      return apiPost(cfg, '/api/v1/batch/print', body)
    },
    logs: function (cfg, limit, deviceId) {
      var qs = []
      if (limit) qs.push('limit=' + encodeURIComponent(limit))
      if (deviceId) qs.push('deviceId=' + encodeURIComponent(deviceId))
      return apiGet(cfg, '/api/v1/logs' + (qs.length ? '?' + qs.join('&') : ''))
    },
    clearLogs: function (cfg) {
      return apiDelete(cfg, '/api/v1/logs')
    },
    settings: function (cfg) {
      return apiGet(cfg, '/api/v1/settings')
    },
    patchSettings: function (cfg, patch) {
      return apiPatch(cfg, '/api/v1/settings', patch)
    },
    discoverStart: function (cfg, brands) {
      return apiPost(cfg, '/api/v1/discover/lan', brands ? { brands: brands } : {})
    },
    discoverStatus: function (cfg) {
      return apiGet(cfg, '/api/v1/discover/lan')
    },
    discoverCancel: function (cfg) {
      return apiDelete(cfg, '/api/v1/discover/lan')
    },
    filamentBind: function (cfg, spoolId, deviceId, slotId) {
      return apiPost(cfg, '/api/v1/filament/' + encodeURIComponent(spoolId) + '/bind', {
        deviceId: deviceId,
        slotId: slotId
      })
    },
    filamentUnbind: function (cfg, spoolId, deviceId, slotId) {
      return apiPost(cfg, '/api/v1/filament/' + encodeURIComponent(spoolId) + '/unbind', {
        deviceId: deviceId,
        slotId: slotId
      })
    },
    fileToBase64: function (file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader()
        reader.onload = function () {
          var s = String(reader.result || '')
          var i = s.indexOf(',')
          resolve(i >= 0 ? s.slice(i + 1) : s)
        }
        reader.onerror = function () {
          reject(new Error('读取文件失败'))
        }
        reader.readAsDataURL(file)
      })
    }
  }

  async function health(cfg) {
    cfg = cfgOrCurrent(cfg)
    var res = await fetch(cfg.apiBase + '/api/health')
    var data = await res.json().catch(function () {
      return {}
    })
    if (!res.ok) throw new Error(data.message || 'HTTP ' + res.status)
    return data
  }

  async function loadSnapshotBlob(cfg, path) {
    cfg = cfgOrCurrent(cfg)
    var res = await fetch(cfg.apiBase + path, { headers: headers(cfg, false) })
    if (!res.ok) throw new Error('快照失败 HTTP ' + res.status)
    return URL.createObjectURL(await res.blob())
  }

  /**
   * Subscribe to SSE /api/v1/events
   * onEvent(type, data)
   * returns close function
   */
  function subscribeEvents(cfg, onEvent, onError) {
    cfg = cfgOrCurrent(cfg)
    if (!cfg.apiBase || !cfg.apiKey) return function () {}
    var url = cfg.apiBase + '/api/v1/events'
    var es = null
    var closed = false

    // EventSource cannot set custom headers — fall back to fetch stream if needed.
    // Prefer fetch ReadableStream with X-Api-Key.
    var ctrl = new AbortController()

    fetch(url, {
      headers: headers(cfg, false),
      signal: ctrl.signal
    })
      .then(function (res) {
        if (!res.ok) throw new Error('SSE HTTP ' + res.status)
        var reader = res.body.getReader()
        var decoder = new TextDecoder()
        var buf = ''
        function pump() {
          return reader.read().then(function (result) {
            if (result.done || closed) return
            buf += decoder.decode(result.value, { stream: true })
            var parts = buf.split('\n\n')
            buf = parts.pop() || ''
            parts.forEach(function (chunk) {
              var ev = 'message'
              var dataLines = []
              chunk.split('\n').forEach(function (line) {
                if (line.indexOf('event:') === 0) ev = line.slice(6).trim()
                else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim())
              })
              if (!dataLines.length) return
              var raw = dataLines.join('\n')
              var data
              try {
                data = JSON.parse(raw)
              } catch (e) {
                data = raw
              }
              if (onEvent) onEvent(ev, data)
            })
            return pump()
          })
        }
        return pump()
      })
      .catch(function (err) {
        if (!closed && onError) onError(err)
      })

    return function () {
      closed = true
      ctrl.abort()
      if (es) es.close()
    }
  }

  global.HanyeApi = {
    loadStore: loadStore,
    saveStore: saveStore,
    getCurrentServer: getCurrentServer,
    upsertServer: upsertServer,
    setCurrent: setCurrent,
    deleteServer: deleteServer,
    clearCurrent: clearCurrent,
    normalizeBase: normalizeBase,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    apiGet: apiGet,
    apiPost: apiPost,
    apiPut: apiPut,
    apiPatch: apiPatch,
    apiDelete: apiDelete,
    request: request,
    health: health,
    loadSnapshotBlob: loadSnapshotBlob,
    subscribeEvents: subscribeEvents,
    Full: Full
  }
})(window)

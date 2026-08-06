;(function () {
  var Api = window.HanyeApi
  var state = {
    page: 'home',
    cfg: null,
    mode: 'readonly',
    devices: [],
    statuses: {},
    summary: null,
    detailId: null,
    detail: null,
    spools: [],
    wall: [],
    zones: [],
    tech: '',
    filTech: '',
    filArchived: '0',
    quotePresets: null,
    pollTimer: null,
    stopSse: null,
    busy: false,
    connected: false,
    selectedIds: {},
    files: [],
    remoteSettings: null,
    logs: []
  }

  var $ = function (sel) {
    return document.querySelector(sel)
  }
  var $$ = function (sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel))
  }

  function toast(msg) {
    var el = $('#toast')
    el.textContent = msg
    el.classList.add('show')
    clearTimeout(toast._t)
    toast._t = setTimeout(function () {
      el.classList.remove('show')
    }, 2800)
  }

  function canControl() {
    return state.mode === 'control'
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;')
  }

  function formatRemain(sec) {
    if (sec == null || !isFinite(sec)) return '--'
    if (sec <= 0) return '0m'
    var m = Math.floor(sec / 60)
    var h = Math.floor(m / 60)
    if (h > 0) return h + 'h ' + (m % 60) + 'm'
    return m + 'm'
  }

  function formatEta(sec) {
    if (sec == null || !isFinite(sec) || sec <= 0) return '--'
    var eta = new Date(Date.now() + sec * 1000)
    var hh = String(eta.getHours()).padStart(2, '0')
    var mm = String(eta.getMinutes()).padStart(2, '0')
    var startToday = new Date()
    startToday.setHours(0, 0, 0, 0)
    var startEta = new Date(eta.getFullYear(), eta.getMonth(), eta.getDate())
    var dayDiff = Math.round((startEta - startToday) / 86400000)
    var t = hh + ':' + mm
    if (dayDiff <= 0) return t
    if (dayDiff === 1) return '明天 ' + t
    if (dayDiff === 2) return '后天 ' + t
    return eta.getMonth() + 1 + '/' + eta.getDate() + ' ' + t
  }

  function healthClass(h) {
    return h || 'offline'
  }

  function statusLabel(st) {
    if (!st) return '未知'
    if (st.health === 'offline') return '离线'
    if (st.health === 'error') return st.message || '报错'
    var s = String(st.state || '').toLowerCase()
    if (s === 'standby' || s === 'idle' || s === 'ready') return '机器空闲'
    if (s === 'finish' || s === 'finished' || s === 'complete') return '打印完成'
    if (st.filename) return st.filename
    return st.state || '--'
  }

  function showGate(show) {
    $('#gate').hidden = !show
    $('#app').hidden = show
  }

  function fillSavedSelects() {
    var store = Api.loadStore()
    var opts =
      '<option value="">— 选择已保存 —</option>' +
      store.servers
        .map(function (s) {
          return (
            '<option value="' +
            escapeAttr(s.id) +
            '"' +
            (s.id === store.currentId ? ' selected' : '') +
            '>' +
            escapeHtml(s.name || s.apiBase) +
            ' (' +
            escapeHtml(s.host + ':' + s.port) +
            ')</option>'
          )
        })
        .join('')
    var gateSel = $('#saved-select')
    var setSel = $('#settings-saved')
    if (gateSel) {
      gateSel.innerHTML = opts
      $('#saved-field').hidden = !store.servers.length
    }
    if (setSel) setSel.innerHTML = opts
  }

  function applyServerToGate(server) {
    if (!server) return
    $('#conn-host').value = server.host || ''
    $('#conn-port').value = server.port || '17890'
    $('#conn-key').value = server.apiKey || ''
    $('#conn-name').value = server.name || ''
  }

  function refreshCfg() {
    var cur = Api.getCurrentServer()
    state.cfg = cur
      ? { apiBase: cur.apiBase, apiKey: cur.apiKey, name: cur.name, id: cur.id }
      : null
    state.connected = !!(cur && cur.apiBase && cur.apiKey)
    return state.cfg
  }

  async function connectFromForm(host, port, apiKey, name, silent) {
    host = String(host || '').trim()
    port = String(port || '17890').trim() || '17890'
    apiKey = String(apiKey || '').trim()
    if (!host) {
      toast('请输入 IP / 主机名')
      return false
    }
    if (!apiKey) {
      toast('请输入 API Key')
      return false
    }
    var norm = Api.normalizeBase(host, port)
    var tmp = { apiBase: norm.apiBase, apiKey: apiKey }
    try {
      var h = await Api.health(tmp)
      // also verify key with summary
      await Api.apiGet(tmp, '/api/v1/summary')
      var server = Api.upsertServer({
        host: norm.host,
        port: norm.port,
        apiKey: apiKey,
        name: name
      })
      refreshCfg()
      state.mode = h.mode || 'readonly'
      if (!silent) toast('已连接 · v' + (h.version || '?') + ' · ' + (h.mode || ''))
      enterApp()
      return !!server
    } catch (e) {
      toast((silent ? '' : '连接失败：') + (e.message || e))
      return false
    }
  }

  function enterApp() {
    showGate(false)
    startRealtime()
    setPage(state.page === 'detail' ? 'home' : state.page || 'home')
    renderSettings()
  }

  function leaveApp() {
    stopRealtime()
    var last = Api.getCurrentServer()
    Api.clearCurrent()
    refreshCfg()
    fillSavedSelects()
    showGate(true)
    if (last) applyServerToGate(last)
    else {
      var store = Api.loadStore()
      if (store.servers[0]) applyServerToGate(store.servers[0])
    }
  }

  function setPage(name) {
    state.page = name
    $$('.page').forEach(function (p) {
      p.classList.toggle('active', p.dataset.page === name)
    })
    $$('.bottom-nav button, .top-nav button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.page === name)
    })
    if (name === 'home') loadHome()
    if (name === 'devices') loadDevices()
    if (name === 'filament') loadFilament()
    if (name === 'monitor') loadMonitor()
    if (name === 'quote') loadQuote()
    if (name === 'settings') renderSettings()
    if (name === 'detail') loadDetail(state.detailId)
  }

  function stopRealtime() {
    if (state.stopSse) {
      state.stopSse()
      state.stopSse = null
    }
    clearInterval(state.pollTimer)
    state.pollTimer = null
  }

  function startRealtime() {
    stopRealtime()
    if (!state.cfg) return
    state.stopSse = Api.subscribeEvents(
      state.cfg,
      function (ev, data) {
        if (ev === 'hello' && data) {
          state.mode = data.mode || state.mode
          $('#home-sse').textContent = '事件流已连接 · ' + (data.mode || '')
        }
        if (ev === 'statuses' && data && data.statuses) {
          var map = {}
          ;(Array.isArray(data.statuses) ? data.statuses : []).forEach(function (st) {
            if (st && st.deviceId) map[st.deviceId] = st
          })
          state.statuses = map
          renderHomeLive()
          if (state.page === 'devices') renderDeviceGrid()
          if (state.page === 'detail' && state.detailId) {
            var st = map[state.detailId]
            if (st && state.detail) {
              state.detail.status = st
              renderDetailBody()
            }
          }
        }
      },
      function () {
        $('#home-sse').textContent = '事件流不可用，已切换轮询'
      }
    )
    state.pollTimer = setInterval(function () {
      if (state.page === 'home') loadHome(true)
      if (state.page === 'devices') loadDevices(true)
      if (state.page === 'detail' && state.detailId) loadDetail(state.detailId, true)
    }, 8000)
  }

  async function loadHome(quiet) {
    if (!state.cfg) return
    try {
      var data = await Api.apiGet(state.cfg, '/api/v1/summary')
      state.summary = data
      state.mode = data.mode || state.mode
      var d = data.devices || {}
      var f = data.filament || {}
      var m = data.monitor || {}
      $('#home-stats').innerHTML =
        '<div class="stat"><div class="n">' +
        (d.online != null ? d.online : 0) +
        '/' +
        (d.total || 0) +
        '</div><div class="l">在线设备</div></div>' +
        '<div class="stat"><div class="n">' +
        (d.fdm || 0) +
        '</div><div class="l">FDM</div></div>' +
        '<div class="stat"><div class="n">' +
        (d.resin || 0) +
        '</div><div class="l">光固化</div></div>' +
        '<div class="stat"><div class="n">' +
        (f.total || 0) +
        '</div><div class="l">耗材料卷</div></div>' +
        '<div class="stat"><div class="n">' +
        (m.zones || 0) +
        '</div><div class="l">监控区域</div></div>' +
        '<div class="stat"><div class="n">' +
        (m.zoneCameras || 0) +
        '</div><div class="l">区域摄像头</div></div>'
      $('#home-mode').textContent =
        'API 模式：' + (data.mode === 'control' ? '可控制' : '只读') +
        (state.cfg.name ? ' · ' + state.cfg.name : '')
      // also refresh devices for live list if empty
      if (!Object.keys(state.statuses).length) {
        var devs = await Api.apiGet(state.cfg, '/api/v1/devices')
        state.devices = devs.devices || []
        state.devices.forEach(function (dev) {
          if (dev.status) state.statuses[dev.id] = dev.status
        })
      }
      renderHomeLive()
    } catch (e) {
      if (!quiet) toast(e.message || String(e))
    }
  }

  function renderHomeLive() {
    var box = $('#home-live')
    var ids = Object.keys(state.statuses)
    if (!ids.length && state.devices.length) {
      ids = state.devices.map(function (d) {
        return d.id
      })
    }
    if (!ids.length) {
      box.innerHTML = '<div class="muted">暂无设备状态</div>'
      return
    }
    var nameOf = {}
    state.devices.forEach(function (d) {
      nameOf[d.id] = d.name
    })
    box.innerHTML = ids
      .slice(0, 12)
      .map(function (id) {
        var st = state.statuses[id] || {}
        return (
          '<div class="live-row"><span><span class="dot ' +
          healthClass(st.health) +
          '"></span>' +
          escapeHtml(nameOf[id] || id) +
          '</span><span class="muted">' +
          escapeHtml(statusLabel(st)) +
          ' · ' +
          Math.round(st.progress || 0) +
          '%</span></div>'
        )
      })
      .join('')
  }

  function mergeStatus(dev) {
    var st = state.statuses[dev.id] || dev.status || {}
    return Object.assign({}, dev, { status: st })
  }

  function deviceCardHtml(dev) {
    dev = mergeStatus(dev)
    var st = dev.status || {}
    var pct = Math.min(100, Math.round(st.progress || 0))
    var resin = (dev.tech || 'fdm') === 'resin'
    var temps = resin
      ? ''
      : '<div class="temps">' +
        '<div>挤出 <strong>' +
        (st.extruder ? Math.round(st.extruder.actual) + '°' : '--') +
        '</strong></div>' +
        '<div>热床 <strong>' +
        (st.bed ? Math.round(st.bed.actual) + '°' : '--') +
        '</strong></div></div>'
    var checked = !!state.selectedIds[dev.id]
    return (
      '<div class="device-card" data-id="' +
      escapeAttr(dev.id) +
      '">' +
      '<label class="card-check" onclick="event.stopPropagation()">' +
      '<input type="checkbox" data-sel="' +
      escapeAttr(dev.id) +
      '"' +
      (checked ? ' checked' : '') +
      (canControl() ? '' : ' disabled') +
      ' /></label>' +
      '<div class="head"><div><span class="dot ' +
      healthClass(st.health) +
      '"></span><span class="name">' +
      escapeHtml(dev.name || dev.id) +
      '</span></div><span class="chip">' +
      escapeHtml(dev.brand || '') +
      '</span></div>' +
      '<div class="muted" style="margin-top:6px">' +
      escapeHtml(statusLabel(st)) +
      '</div>' +
      '<div class="progress' +
      (resin ? ' resin' : '') +
      '"><i style="width:' +
      pct +
      '%"></i></div>' +
      '<div class="meta"><span>剩余 ' +
      formatRemain(st.remainingSeconds) +
      '</span><span>约 ' +
      formatEta(st.remainingSeconds) +
      '</span></div>' +
      temps +
      '</div>'
    )
  }

  function selectedDeviceIds() {
    return Object.keys(state.selectedIds).filter(function (id) {
      return state.selectedIds[id]
    })
  }

  function updateBatchBar() {
    var ids = selectedDeviceIds()
    var bar = $('#batch-bar')
    if (bar) bar.hidden = !canControl() || ids.length === 0
    var c = $('#batch-count')
    if (c) c.textContent = '已选 ' + ids.length
    var addBtn = $('#btn-device-add')
    if (addBtn) addBtn.disabled = !canControl()
  }

  function renderDeviceGrid() {
    var box = $('#device-grid')
    if (!state.devices.length) {
      box.innerHTML = '<div class="empty">暂无设备</div>'
      updateBatchBar()
      return
    }
    box.innerHTML = state.devices.map(deviceCardHtml).join('')
    box.querySelectorAll('.device-card').forEach(function (el) {
      el.addEventListener('click', function () {
        state.detailId = el.getAttribute('data-id')
        setPage('detail')
      })
    })
    box.querySelectorAll('[data-sel]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-sel')
        if (cb.checked) state.selectedIds[id] = true
        else delete state.selectedIds[id]
        updateBatchBar()
      })
    })
    updateBatchBar()
  }

  async function loadDevices(quiet) {
    if (!state.cfg) return
    try {
      var q = state.tech ? '?tech=' + encodeURIComponent(state.tech) : ''
      var data = await Api.apiGet(state.cfg, '/api/v1/devices' + q)
      state.devices = data.devices || []
      state.devices.forEach(function (dev) {
        if (dev.status) state.statuses[dev.id] = dev.status
      })
      renderDeviceGrid()
    } catch (e) {
      if (!quiet) toast(e.message || String(e))
    }
  }

  function renderDetailBody() {
    var data = state.detail
    if (!data) return
    var d = data.device || {}
    var st = data.status || state.statuses[d.id] || {}
    var resin = (d.tech || 'fdm') === 'resin'
    var ctrlDisabled = canControl() ? '' : ' disabled'
    var html =
      '<div class="card">' +
      '<div class="muted">' +
      escapeHtml(d.brand || '') +
      ' · ' +
      (resin ? '光固化' : 'FDM') +
      ' · ' +
      escapeHtml(st.health || '') +
      '</div>' +
      '<div style="margin-top:8px">' +
      escapeHtml(statusLabel(st)) +
      '</div>' +
      '<div class="progress' +
      (resin ? ' resin' : '') +
      '"><i style="width:' +
      Math.min(100, Math.round(st.progress || 0)) +
      '%"></i></div>' +
      '<div class="meta"><span>剩余 ' +
      formatRemain(st.remainingSeconds) +
      '</span><span>预计 ' +
      formatEta(st.remainingSeconds) +
      '</span></div>' +
      (resin
        ? ''
        : '<div class="temps" style="margin-top:10px">' +
          '<div>挤出 <strong>' +
          (st.extruder ? Math.round(st.extruder.actual) + '/' + Math.round(st.extruder.target || 0) + '°' : '--') +
          '</strong></div>' +
          '<div>热床 <strong>' +
          (st.bed ? Math.round(st.bed.actual) + '/' + Math.round(st.bed.target || 0) + '°' : '--') +
          '</strong></div>' +
          '<div>主板 <strong>' +
          Math.round(st.boardTemp || 0) +
          '°</strong></div>' +
          '<div>仓内 <strong>' +
          Math.round(st.chamberTemp || 0) +
          '°</strong></div></div>') +
      '</div>'

    html +=
      '<div class="card"><h3>控制' +
      (canControl() ? '' : '（只读模式）') +
      '</h3><div class="control-grid">' +
      '<button class="btn warn" data-act="pause"' +
      ctrlDisabled +
      '>暂停</button>' +
      '<button class="btn" data-act="resume"' +
      ctrlDisabled +
      '>恢复</button>' +
      '<button class="btn danger" data-act="cancel"' +
      ctrlDisabled +
      '>取消</button>' +
      '<button class="btn ghost" data-act="home"' +
      ctrlDisabled +
      '>归零</button>' +
      '<button class="btn danger" data-act="emergency_stop"' +
      ctrlDisabled +
      '>紧急停止</button>' +
      '<button class="btn ghost" data-act="load_filament"' +
      ctrlDisabled +
      '>进料</button>' +
      '<button class="btn ghost" data-act="unload_filament"' +
      ctrlDisabled +
      '>退料</button></div>'

    if (!resin) {
      html +=
        '<div class="temp-row">' +
        '<span class="muted">挤出</span><input id="temp-ex" type="number" value="' +
        Math.round((st.extruder && st.extruder.target) || 0) +
        '" /><button class="btn sm" data-settemp="extruder"' +
        ctrlDisabled +
        '>设温</button>' +
        '<span class="muted">热床</span><input id="temp-bed" type="number" value="' +
        Math.round((st.bed && st.bed.target) || 0) +
        '" /><button class="btn sm" data-settemp="bed"' +
        ctrlDisabled +
        '>设温</button></div>' +
        '<div class="btn-row">' +
        '<button class="btn ghost sm" data-fan="0"' +
        ctrlDisabled +
        '>风扇0%</button>' +
        '<button class="btn ghost sm" data-fan="50"' +
        ctrlDisabled +
        '>风扇50%</button>' +
        '<button class="btn ghost sm" data-fan="100"' +
        ctrlDisabled +
        '>风扇100%</button></div>' +
        (st.chamberFanSpeed != null
          ? '<div class="btn-row"><button class="btn ghost sm" data-cfan="0"' +
            ctrlDisabled +
            '>仓内0%</button>' +
            '<button class="btn ghost sm" data-cfan="50"' +
            ctrlDisabled +
            '>仓内50%</button>' +
            '<button class="btn ghost sm" data-cfan="100"' +
            ctrlDisabled +
            '>仓内100%</button></div>'
          : '') +
        '<div class="btn-row">' +
        '<button class="btn ghost sm" data-spd="50"' +
        ctrlDisabled +
        '>速度50%</button>' +
        '<button class="btn ghost sm" data-spd="100"' +
        ctrlDisabled +
        '>速度100%</button>' +
        '<button class="btn ghost sm" data-spd="150"' +
        ctrlDisabled +
        '>速度150%</button></div>' +
        '<div class="temp-row"><span class="muted">打印文件</span>' +
        '<input id="print-file" type="text" placeholder="xxx.gcode" style="flex:1;min-width:120px" />' +
        '<button class="btn sm" id="btn-print-file"' +
        ctrlDisabled +
        '>打印</button></div>'
    }
    html += '</div>'

    html +=
      '<div class="card"><div class="page-head"><h3 style="margin:0">机内文件</h3>' +
      '<div class="btn-row">' +
      '<button class="btn ghost sm" id="btn-files-refresh">刷新</button>' +
      '<label class="btn sm' +
      (canControl() ? '' : ' disabled') +
      '">' +
      '上传<input type="file" id="file-upload" accept=".gcode,.gco,.nc,.bgcode,.3mf" hidden ' +
      (canControl() ? '' : 'disabled') +
      ' /></label></div></div>' +
      '<div id="files-list" class="muted">加载中…</div></div>'

    if (canControl()) {
      html +=
        '<div class="card"><button class="btn danger" id="btn-del-device" style="width:100%">删除此设备</button></div>'
    }

    $('#detail-title').textContent = d.name || d.id
    $('#detail-body').innerHTML = html
    bindDetailControls(d.id, st)
    void loadDeviceFiles(d.id)
  }

  function bindDetailControls(id, st) {
    $$('#detail-body [data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act')
        if (act === 'cancel' || act === 'emergency_stop') {
          if (!confirm('确认执行「' + act + '」？')) return
        }
        void control(id, { action: act })
      })
    })
    $$('#detail-body [data-fan]').forEach(function (b) {
      b.addEventListener('click', function () {
        void control(id, {
          action: 'set_fan',
          fan: 'part',
          percent: Number(b.getAttribute('data-fan'))
        })
      })
    })
    $$('#detail-body [data-cfan]').forEach(function (b) {
      b.addEventListener('click', function () {
        void control(id, {
          action: 'set_fan',
          fan: 'chamber',
          percent: Number(b.getAttribute('data-cfan')),
          fanName: st.chamberFanName
        })
      })
    })
    $$('#detail-body [data-spd]').forEach(function (b) {
      b.addEventListener('click', function () {
        void control(id, {
          action: 'set_speed',
          percent: Number(b.getAttribute('data-spd'))
        })
      })
    })
    $$('#detail-body [data-settemp]').forEach(function (b) {
      b.addEventListener('click', function () {
        var heater = b.getAttribute('data-settemp')
        var input = heater === 'bed' ? $('#temp-bed') : $('#temp-ex')
        void control(id, {
          action: 'set_temp',
          heater: heater,
          temperature: Number(input.value) || 0
        })
      })
    })
    var pf = $('#btn-print-file')
    if (pf) {
      pf.addEventListener('click', function () {
        var fn = ($('#print-file').value || '').trim()
        if (!fn) {
          toast('请输入文件名')
          return
        }
        void control(id, { action: 'print_file', filename: fn })
      })
    }
    var fr = $('#btn-files-refresh')
    if (fr) {
      fr.addEventListener('click', function () {
        void loadDeviceFiles(id)
      })
    }
    var fu = $('#file-upload')
    if (fu) {
      fu.addEventListener('change', async function () {
        var file = fu.files && fu.files[0]
        if (!file) return
        try {
          toast('上传中…')
          var b64 = await Api.Full.fileToBase64(file)
          await Api.Full.uploadFile(state.cfg, id, file.name, b64)
          toast('已上传 ' + file.name)
          void loadDeviceFiles(id)
        } catch (e) {
          toast(e.message || String(e))
        }
        fu.value = ''
      })
    }
    var dd = $('#btn-del-device')
    if (dd) {
      dd.addEventListener('click', async function () {
        if (!confirm('确认从监控台删除此设备？')) return
        try {
          await Api.Full.deleteDevice(state.cfg, id)
          toast('已删除')
          setPage('devices')
          void loadDevices()
        } catch (e) {
          toast(e.message || String(e))
        }
      })
    }
  }

  async function loadDeviceFiles(id) {
    var box = $('#files-list')
    if (!box || !state.cfg) return
    box.textContent = '加载中…'
    try {
      var data = await Api.Full.listFiles(state.cfg, id)
      var files = data.files || []
      state.files = files
      if (!files.length) {
        box.innerHTML = '<div class="muted">无文件或该品牌暂不支持列表</div>'
        return
      }
      box.innerHTML = files
        .slice(0, 80)
        .map(function (f) {
          var path = f.path || f.name || ''
          return (
            '<div class="file-row"><span class="ellipsis">' +
            escapeHtml(path) +
            '</span>' +
            (canControl()
              ? '<button class="btn ghost sm" data-print-path="' +
                escapeAttr(path) +
                '">打印</button>'
              : '') +
            '</div>'
          )
        })
        .join('')
      $$('#files-list [data-print-path]').forEach(function (b) {
        b.addEventListener('click', function () {
          void control(id, { action: 'print_file', filename: b.getAttribute('data-print-path') })
        })
      })
    } catch (e) {
      box.innerHTML = '<div class="muted">' + escapeHtml(e.message || String(e)) + '</div>'
    }
  }

  async function loadDetail(id, quiet) {
    if (!id || !state.cfg) return
    try {
      var data = await Api.apiGet(state.cfg, '/api/v1/devices/' + encodeURIComponent(id))
      state.detail = data
      if (data.status) state.statuses[id] = data.status
      renderDetailBody()
    } catch (e) {
      if (!quiet) toast(e.message || String(e))
    }
  }

  async function control(id, payload) {
    if (state.busy) return
    if (!canControl()) {
      toast('当前为只读模式，请在桌面端改为「可控制」')
      return
    }
    state.busy = true
    try {
      await Api.apiPost(
        state.cfg,
        '/api/v1/devices/' + encodeURIComponent(id) + '/control',
        payload
      )
      toast('已发送：' + payload.action)
      await loadDetail(id, true)
    } catch (e) {
      toast(e.message || String(e))
    } finally {
      state.busy = false
    }
  }

  async function loadFilament() {
    if (!state.cfg) return
    try {
      var qs = []
      if (state.filTech) qs.push('tech=' + encodeURIComponent(state.filTech))
      if (state.filArchived !== '') qs.push('archived=' + encodeURIComponent(state.filArchived))
      var data = await Api.apiGet(state.cfg, '/api/v1/filament' + (qs.length ? '?' + qs.join('&') : ''))
      state.spools = data.spools || []
      var box = $('#filament-list')
      $('#btn-filament-add').disabled = !canControl()
      if (!state.spools.length) {
        box.innerHTML = '<div class="empty">暂无耗材</div>'
        return
      }
      box.innerHTML = state.spools
        .map(function (s) {
          var remain = s.remainGrams != null ? s.remainGrams : '--'
          var total = s.totalGrams != null ? s.totalGrams : '--'
          var acts = canControl()
            ? '<div class="actions">' +
              '<button class="btn ghost sm" data-fil-edit="' +
              escapeAttr(s.id) +
              '">编辑</button>' +
              '<button class="btn ghost sm" data-fil-arch="' +
              escapeAttr(s.id) +
              '">' +
              (s.archived ? '取消归档' : '归档') +
              '</button>' +
              '<button class="btn danger sm" data-fil-del="' +
              escapeAttr(s.id) +
              '">删</button></div>'
            : ''
          return (
            '<div class="card spool"><div class="swatch" style="background:' +
            escapeAttr(s.colorHex || '#888') +
            '"></div><div><h3>' +
            escapeHtml(s.brandId || '') +
            ' · ' +
            escapeHtml(s.material || '') +
            '</h3><div class="muted">' +
            escapeHtml(s.color || '') +
            ' · 余量 ' +
            remain +
            ' / ' +
            total +
            ' g · ' +
            (s.rolls != null ? s.rolls + '卷 · ' : '') +
            escapeHtml(s.tech || 'fdm') +
            (Array.isArray(s.amsBindings) && s.amsBindings.length
              ? ' · 已绑' + s.amsBindings.length
              : s.amsBinding
                ? ' · 已绑'
                : '') +
            (s.archived ? ' · 已归档' : '') +
            '</div></div>' +
            acts +
            '</div>'
          )
        })
        .join('')
      $$('#filament-list [data-fil-edit]').forEach(function (b) {
        b.addEventListener('click', function () {
          openFilModal(b.getAttribute('data-fil-edit'))
        })
      })
      $$('#filament-list [data-fil-arch]').forEach(function (b) {
        b.addEventListener('click', async function () {
          var id = b.getAttribute('data-fil-arch')
          var spool = state.spools.find(function (x) {
            return x.id === id
          })
          try {
            await Api.apiPost(state.cfg, '/api/v1/filament/' + encodeURIComponent(id) + '/archive', {
              archived: !(spool && spool.archived)
            })
            toast('已更新归档')
            loadFilament()
          } catch (e) {
            toast(e.message || String(e))
          }
        })
      })
      $$('#filament-list [data-fil-del]').forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!confirm('确认删除该耗材？')) return
          try {
            await Api.apiDelete(
              state.cfg,
              '/api/v1/filament/' + encodeURIComponent(b.getAttribute('data-fil-del'))
            )
            toast('已删除')
            loadFilament()
          } catch (e) {
            toast(e.message || String(e))
          }
        })
      })
    } catch (e) {
      toast(e.message || String(e))
    }
  }

  function openFilModal(id) {
    var s = id
      ? state.spools.find(function (x) {
          return x.id === id
        })
      : null
    $('#fil-modal-title').textContent = s ? '编辑耗材' : '新增耗材'
    $('#fil-id').value = s ? s.id : ''
    $('#fil-brand').value = (s && s.brandId) || ''
    $('#fil-material').value = (s && s.material) || ''
    $('#fil-color').value = (s && s.color) || ''
    $('#fil-hex').value = (s && s.colorHex) || '#888888'
    $('#fil-total').value = s ? s.totalGrams : 1000
    $('#fil-remain').value = s && s.remainGrams != null ? s.remainGrams : 1000
    var rollsEl = $('#fil-rolls')
    if (rollsEl) rollsEl.value = s && s.rolls != null ? s.rolls : 1
    $('#fil-tech-edit').value = (s && s.tech) || 'fdm'
    $('#fil-notes').value = (s && (s.notes || s.location)) || ''
    var sel = $('#fil-bind-device')
    if (sel) {
      sel.innerHTML =
        '<option value="">不绑定</option>' +
        state.devices
          .filter(function (d) {
            return (d.tech || 'fdm') === 'fdm'
          })
          .map(function (d) {
            return (
              '<option value="' + escapeAttr(d.id) + '">' + escapeHtml(d.name || d.id) + '</option>'
            )
          })
          .join('')
    }
    var slotEl = $('#fil-bind-slot')
    if (slotEl) slotEl.value = 0
    $('#fil-modal').hidden = false
  }

  async function saveFilament() {
    var id = $('#fil-id').value
    var rolls = Math.max(
      1,
      Math.min(99, Math.floor(Number(($('#fil-rolls') && $('#fil-rolls').value) || 1)))
    )
    var body = {
      brandId: $('#fil-brand').value.trim(),
      material: $('#fil-material').value.trim(),
      color: $('#fil-color').value.trim(),
      colorHex: $('#fil-hex').value,
      totalGrams: Number($('#fil-total').value) || 0,
      remainGrams: Number($('#fil-remain').value),
      rolls: rolls,
      tech: $('#fil-tech-edit').value,
      notes: $('#fil-notes').value.trim()
    }
    try {
      var spoolId = id
      if (id) await Api.apiPut(state.cfg, '/api/v1/filament/' + encodeURIComponent(id), body)
      else {
        var created = await Api.apiPost(state.cfg, '/api/v1/filament', body)
        spoolId = created.spool && created.spool.id
      }
      var bindDev = $('#fil-bind-device') && $('#fil-bind-device').value
      if (bindDev && spoolId && canControl()) {
        var slot = Math.floor(Number(($('#fil-bind-slot') && $('#fil-bind-slot').value) || 0))
        await Api.Full.filamentBind(state.cfg, spoolId, bindDev, slot)
      }
      $('#fil-modal').hidden = true
      toast('耗材已保存')
      loadFilament()
    } catch (e) {
      toast(e.message || String(e))
    }
  }

  async function loadMonitor() {
    if (!state.cfg) return
    var box = $('#monitor-list')
    $$('#monitor-list .cam-tile').forEach(function (t) {
      if (typeof t._stopCam === 'function') t._stopCam()
    })
    box.innerHTML = '<div class="muted">加载中…</div>'
    $('#btn-zone-add').disabled = !canControl()
    try {
      var wall = await Api.apiGet(state.cfg, '/api/v1/monitor/wall').catch(function () {
        return { devices: [] }
      })
      var zones = await Api.apiGet(state.cfg, '/api/v1/monitor/zones').catch(function () {
        return { zones: [] }
      })
      state.wall = wall.devices || []
      state.zones = zones.zones || []
      var html = ''
      if (state.wall.length) {
        html += '<h3 style="margin:8px 0">内部监控</h3><div class="cam-grid" id="wall-cams"></div>'
      }
      if (state.zones.length || canControl()) {
        html += '<h3 style="margin:16px 0 8px">区域监控</h3><div id="zones-wrap"></div>'
      }
      if (!html) html = '<div class="empty">暂无摄像头</div>'
      box.innerHTML = html

      var wallEl = $('#wall-cams')
      if (wallEl) {
        // One tile per printer (same as desktop). Candidates are tried until one works.
        state.wall.forEach(function (dev) {
          var cams = dev.cameras || []
          if (!cams.length) return
          var paths = cams.map(function (cam) {
            return (
              '/api/v1/devices/' +
              encodeURIComponent(dev.deviceId) +
              '/cameras/' +
              encodeURIComponent(cam.id) +
              '/snapshot'
            )
          })
          var sub = cams.length === 1 ? cams[0].name || cams[0].id : cams.length + ' 路候选'
          appendCam(wallEl, (dev.name || '') + (sub ? ' · ' + sub : ''), paths)
        })
      }
      var zw = $('#zones-wrap')
      if (zw) {
        zw.innerHTML = state.zones
          .map(function (z) {
            var acts = canControl()
              ? '<div class="btn-row">' +
                '<button class="btn ghost sm" data-add-cam="' +
                escapeAttr(z.id) +
                '">加摄像头</button>' +
                '<button class="btn danger sm" data-del-zone="' +
                escapeAttr(z.id) +
                '">删区域</button></div>'
              : ''
            return (
              '<div class="zone-block card"><div class="zone-head"><strong>' +
              escapeHtml(z.name || z.id) +
              '</strong>' +
              acts +
              '</div><div class="cam-grid" data-zone-cams="' +
              escapeAttr(z.id) +
              '"></div></div>'
            )
          })
          .join('') || '<div class="empty">暂无区域</div>'

        state.zones.forEach(function (z) {
          var el = document.querySelector('[data-zone-cams="' + z.id + '"]')
          if (!el) return
          ;(z.cameras || []).forEach(function (cam) {
            var path =
              '/api/v1/monitor/zones/' +
              encodeURIComponent(z.id) +
              '/cameras/' +
              encodeURIComponent(cam.id) +
              '/snapshot'
            appendCam(el, cam.name || cam.id, [path], z.id, cam.id)
          })
        })

        $$('#zones-wrap [data-add-cam]').forEach(function (b) {
          b.addEventListener('click', async function () {
            var zid = b.getAttribute('data-add-cam')
            var name = prompt('摄像头名称', '摄像头')
            if (name == null) return
            var url = prompt('视频/快照 URL', 'http://')
            if (!url) return
            try {
              await Api.apiPost(
                state.cfg,
                '/api/v1/monitor/zones/' + encodeURIComponent(zid) + '/cameras',
                { name: name, url: url }
              )
              toast('已添加摄像头')
              loadMonitor()
            } catch (e) {
              toast(e.message || String(e))
            }
          })
        })
        $$('#zones-wrap [data-del-zone]').forEach(function (b) {
          b.addEventListener('click', async function () {
            if (!confirm('删除该区域？')) return
            try {
              await Api.apiDelete(
                state.cfg,
                '/api/v1/monitor/zones/' + encodeURIComponent(b.getAttribute('data-del-zone'))
              )
              toast('已删除区域')
              loadMonitor()
            } catch (e) {
              toast(e.message || String(e))
            }
          })
        })
      }
    } catch (e) {
      toast(e.message || String(e))
      box.innerHTML = '<div class="empty">加载失败</div>'
    }
  }

  function appendCam(parent, title, paths, zoneId, camId) {
    var pathList = Array.isArray(paths) ? paths.filter(Boolean) : paths ? [paths] : []
    var tile = document.createElement('div')
    tile.className = 'cam-tile'
    var delBtn =
      zoneId && camId && canControl()
        ? '<button class="btn danger sm" data-del-cam="1">删</button>'
        : ''
    tile.innerHTML =
      '<img alt="cam" /><div class="cap"><span>' + escapeHtml(title) + '</span>' + delBtn + '</div>'
    parent.appendChild(tile)
    var img = tile.querySelector('img')
    var cap = tile.querySelector('.cap span')
    var idx = 0
    var fails = 0
    var alive = false
    var lastBlob = ''
    var stopped = false

    async function pull() {
      if (stopped || !pathList.length || !state.cfg) return
      if (idx >= pathList.length) idx = 0
      var path = pathList[idx]
      try {
        var url = await Api.loadSnapshotBlob(state.cfg, path)
        if (stopped) {
          URL.revokeObjectURL(url)
          return
        }
        if (lastBlob) URL.revokeObjectURL(lastBlob)
        lastBlob = url
        img.src = url
        alive = true
        fails = 0
        if (cap && cap.textContent.indexOf('无法取流') >= 0) cap.textContent = title
        return
      } catch (_) {
        /* try next */
      }
      fails += 1
      if (fails % 2 === 0) idx += 1
      if (!alive && fails >= pathList.length * 3) {
        if (cap) cap.textContent = title + '（无法取流）'
      }
    }

    void pull()
    var timer = setInterval(function () {
      void pull()
    }, 1500)
    tile._stopCam = function () {
      stopped = true
      clearInterval(timer)
      if (lastBlob) URL.revokeObjectURL(lastBlob)
    }

    var db = tile.querySelector('[data-del-cam]')
    if (db) {
      db.addEventListener('click', async function (e) {
        e.stopPropagation()
        if (!confirm('删除摄像头？')) return
        try {
          await Api.apiDelete(
            state.cfg,
            '/api/v1/monitor/zones/' +
              encodeURIComponent(zoneId) +
              '/cameras/' +
              encodeURIComponent(camId)
          )
          toast('已删除')
          loadMonitor()
        } catch (err) {
          toast(err.message || String(err))
        }
      })
    }
  }

  function quoteFormHtml(presets) {
    var mats = (presets && presets.materials) || []
    var printers = (presets && presets.printers) || []
    return (
      '<h3>参数</h3>' +
      '<div class="field"><label>材料预设</label><select id="q-mat">' +
      mats
        .map(function (m) {
          return (
            '<option value="' +
            escapeAttr(m.id) +
            '" data-price="' +
            (m.pricePerKg || 0) +
            '">' +
            escapeHtml(m.label) +
            '</option>'
          )
        })
        .join('') +
      '</select></div>' +
      '<div class="field"><label>打印机预设（功率）</label><select id="q-printer">' +
      printers
        .map(function (p) {
          return (
            '<option value="' +
            escapeAttr(p.id) +
            '" data-watts="' +
            (p.watts || 0) +
            '">' +
            escapeHtml(p.label) +
            '</option>'
          )
        })
        .join('') +
      '</select></div>' +
      '<div class="field-row"><div class="field grow"><label>重量 g</label><input id="q-weight" type="number" value="50" /></div>' +
      '<div class="field grow"><label>耗时 小时</label><input id="q-hours" type="number" step="0.1" value="3" /></div></div>' +
      '<div class="field-row"><div class="field grow"><label>材料单价 元/kg</label><input id="q-price" type="number" value="65" /></div>' +
      '<div class="field grow"><label>功率 W</label><input id="q-watts" type="number" value="200" /></div></div>' +
      '<div class="field-row"><div class="field grow"><label>废料 %</label><input id="q-waste" type="number" value="5" /></div>' +
      '<div class="field grow"><label>电价 元/度</label><input id="q-elec" type="number" step="0.01" value="0.7" /></div></div>' +
      '<div class="field-row"><div class="field grow"><label>损耗 元/时</label><input id="q-wear" type="number" value="2" /></div>' +
      '<div class="field grow"><label>失败率 %</label><input id="q-fail" type="number" value="5" /></div></div>' +
      '<div class="field-row"><div class="field grow"><label>人工 分钟</label><input id="q-labor-m" type="number" value="15" /></div>' +
      '<div class="field grow"><label>人工 元/时</label><input id="q-labor-r" type="number" value="40" /></div></div>' +
      '<div class="field-row"><div class="field grow"><label>包装</label><input id="q-pack" type="number" value="2" /></div>' +
      '<div class="field grow"><label>运费</label><input id="q-ship" type="number" value="0" /></div></div>' +
      '<div class="field-row"><div class="field grow"><label>计价</label><select id="q-mode"><option value="markup">加价率</option><option value="margin">利润率</option></select></div>' +
      '<div class="field grow"><label>加价/利润 %</label><input id="q-pct" type="number" value="30" /></div></div>' +
      '<div class="field-row"><div class="field grow"><label>最低价</label><input id="q-min" type="number" value="0" /></div>' +
      '<div class="field grow"><label>数量</label><input id="q-qty" type="number" value="1" /></div></div>' +
      '<div class="field"><label>粘贴 G-code 注释（可选解析）</label><textarea id="q-gcode" placeholder="; filament used [g] = 12.3"></textarea></div>' +
      '<div class="btn-row"><button class="btn ghost" id="q-parse">解析 G-code</button><button class="btn" id="q-calc">计算报价</button></div>'
    )
  }

  async function loadQuote() {
    if (!state.cfg) return
    try {
      if (!state.quotePresets) {
        state.quotePresets = await Api.apiGet(state.cfg, '/api/v1/quote/presets')
      }
      $('#quote-form').innerHTML = quoteFormHtml(state.quotePresets)
      var mat = $('#q-mat')
      var pr = $('#q-printer')
      function syncPreset() {
        var mo = mat.options[mat.selectedIndex]
        var po = pr.options[pr.selectedIndex]
        if (mo) $('#q-price').value = mo.getAttribute('data-price') || $('#q-price').value
        if (po) $('#q-watts').value = po.getAttribute('data-watts') || $('#q-watts').value
      }
      mat.addEventListener('change', syncPreset)
      pr.addEventListener('change', syncPreset)
      syncPreset()
      $('#q-parse').addEventListener('click', async function () {
        try {
          var r = await Api.apiPost(state.cfg, '/api/v1/quote/parse-gcode', {
            text: $('#q-gcode').value
          })
          if (r.grams != null) $('#q-weight').value = r.grams
          if (r.hours != null) $('#q-hours').value = r.hours
          toast(r.note || '解析完成')
        } catch (e) {
          toast(e.message || String(e))
        }
      })
      $('#q-calc').addEventListener('click', async function () {
        try {
          var body = {
            weightG: Number($('#q-weight').value) || 0,
            printHours: Number($('#q-hours').value) || 0,
            pricePerKg: Number($('#q-price').value) || 0,
            watts: Number($('#q-watts').value) || 0,
            wastePct: Number($('#q-waste').value) || 0,
            electricity: Number($('#q-elec').value) || 0,
            wearPerHour: Number($('#q-wear').value) || 0,
            failPct: Number($('#q-fail').value) || 0,
            laborMinutes: Number($('#q-labor-m').value) || 0,
            laborRate: Number($('#q-labor-r').value) || 0,
            packaging: Number($('#q-pack').value) || 0,
            shipping: Number($('#q-ship').value) || 0,
            pricingMode: $('#q-mode').value,
            markupPct: Number($('#q-pct').value) || 0,
            marginPct: Number($('#q-pct').value) || 0,
            minPrice: Number($('#q-min').value) || 0,
            qty: Number($('#q-qty').value) || 1
          }
          var r = await Api.apiPost(state.cfg, '/api/v1/quote/calculate', body)
          var c = r.costs || {}
          $('#quote-result').innerHTML =
            '<h3>报价结果</h3>' +
            '<div class="quote-costs">' +
            '<div class="stat"><div class="n">¥' +
            Number(c.grand || 0).toFixed(2) +
            '</div><div class="l">总价</div></div>' +
            '<div class="stat"><div class="n">¥' +
            Number(c.perUnit || 0).toFixed(2) +
            '</div><div class="l">单价</div></div>' +
            '<div class="stat"><div class="n">¥' +
            Number(c.mat || 0).toFixed(2) +
            '</div><div class="l">材料</div></div>' +
            '<div class="stat"><div class="n">¥' +
            Number(c.elec || 0).toFixed(2) +
            '</div><div class="l">电费</div></div>' +
            '<div class="stat"><div class="n">¥' +
            Number(c.labor || 0).toFixed(2) +
            '</div><div class="l">人工</div></div>' +
            '<div class="stat"><div class="n">' +
            (Number(c.profitRate || 0) * 100).toFixed(1) +
            '%</div><div class="l">利润率</div></div></div>' +
            (c.appliedFloor ? '<p class="muted" style="margin-top:8px">已应用最低价保底</p>' : '')
        } catch (e) {
          toast(e.message || String(e))
        }
      })
    } catch (e) {
      toast(e.message || String(e))
    }
  }

  function renderSettings() {
    fillSavedSelects()
    var cur = Api.getCurrentServer()
    $('#settings-current').textContent = cur
      ? cur.name + ' · ' + cur.apiBase
      : '未连接'
    $('#settings-mode').textContent =
      '当前 API 模式：' +
      (state.mode === 'control' ? '可控制' : '只读') +
      ' · 完整版 API（设备/文件/批量/日志/设置）。写操作需「可控制」。'
    if (cur) {
      $('#set-host').value = cur.host
      $('#set-port').value = cur.port
      $('#set-key').value = cur.apiKey
      $('#set-name').value = cur.name || ''
    }
    var saveBtn = $('#btn-remote-save')
    var clearLogs = $('#btn-logs-clear')
    if (saveBtn) saveBtn.disabled = !canControl() || !state.cfg
    if (clearLogs) clearLogs.disabled = !canControl() || !state.cfg
    if (state.cfg) {
      void loadRemoteSettings()
      void loadLogs()
    }
  }

  async function loadRemoteSettings() {
    if (!state.cfg) return
    try {
      var data = await Api.Full.settings(state.cfg)
      var s = data.settings || {}
      state.remoteSettings = s
      var ne = $('#rs-notify-error')
      if (ne) ne.checked = s.notifyOnError !== false
      var nd = $('#rs-notify-done')
      if (nd) nd.checked = s.notifyOnPrintDone !== false
      var ams = $('#rs-ams-deduct')
      if (ams) ams.checked = s.amsAutoDeduct !== false
      var wh = $('#rs-webhook')
      if (wh) wh.checked = !!s.webhookEnabled
      var wu = $('#rs-webhook-url')
      if (wu) wu.value = s.webhookUrl || ''
      var rf = $('#rs-refresh')
      if (rf) rf.value = s.deviceRefreshSec != null ? s.deviceRefreshSec : 3
      var hint = $('#remote-settings-hint')
      if (hint) {
        hint.textContent =
          '模式 ' +
          (s.apiMode || state.mode) +
          (s.apiKeyMasked ? ' · Key ' + s.apiKeyMasked : '')
      }
    } catch (e) {
      var h = $('#remote-settings-hint')
      if (h) h.textContent = e.message || String(e)
    }
  }

  async function loadLogs() {
    var box = $('#logs-list')
    if (!box || !state.cfg) return
    try {
      var data = await Api.Full.logs(state.cfg, 80)
      state.logs = data.logs || []
      if (!state.logs.length) {
        box.innerHTML = '<div class="muted">暂无日志</div>'
        return
      }
      box.innerHTML = state.logs
        .map(function (l) {
          return (
            '<div class="log-row"><span class="muted">' +
            escapeHtml((l.time || '').slice(0, 19).replace('T', ' ')) +
            '</span> ' +
            escapeHtml(l.deviceName || l.deviceId || '') +
            ' · ' +
            escapeHtml(l.action || '') +
            ' · ' +
            escapeHtml(l.result || '') +
            '</div>'
          )
        })
        .join('')
    } catch (e) {
      box.textContent = e.message || String(e)
    }
  }

  function bind() {
    $$('.bottom-nav button, .top-nav button').forEach(function (b) {
      b.addEventListener('click', function () {
        setPage(b.dataset.page)
      })
    })

    $('#saved-select').addEventListener('change', function () {
      var id = $('#saved-select').value
      if (!id) return
      var store = Api.loadStore()
      var s = store.servers.find(function (x) {
        return x.id === id
      })
      applyServerToGate(s)
    })

    $('#btn-connect').addEventListener('click', function () {
      void connectFromForm(
        $('#conn-host').value,
        $('#conn-port').value,
        $('#conn-key').value,
        $('#conn-name').value
      )
    })
    $('#btn-test-gate').addEventListener('click', async function () {
      var norm = Api.normalizeBase($('#conn-host').value, $('#conn-port').value)
      var tmp = { apiBase: norm.apiBase, apiKey: $('#conn-key').value.trim() }
      try {
        var h = await Api.health(tmp)
        await Api.apiGet(tmp, '/api/v1/summary')
        toast('OK · v' + (h.version || '?') + ' · ' + (h.mode || ''))
      } catch (e) {
        toast(e.message || String(e))
      }
    })

    $('#btn-use-saved').addEventListener('click', async function () {
      var id = $('#settings-saved').value
      if (!id) {
        toast('请选择已保存地址')
        return
      }
      var s = Api.setCurrent(id)
      if (!s) return
      refreshCfg()
      try {
        var h = await Api.health(state.cfg)
        await Api.apiGet(state.cfg, '/api/v1/summary')
        state.mode = h.mode || state.mode
        toast('已切换 · ' + s.name)
        startRealtime()
        renderSettings()
        setPage('home')
      } catch (e) {
        toast('切换失败：' + (e.message || e))
      }
    })
    $('#btn-edit-conn').addEventListener('click', function () {
      var cur = Api.getCurrentServer()
      stopRealtime()
      fillSavedSelects()
      showGate(true)
      if (cur) applyServerToGate(cur)
      else {
        var store = Api.loadStore()
        if (store.servers[0]) applyServerToGate(store.servers[0])
      }
    })
    $('#btn-del-saved').addEventListener('click', function () {
      var id = $('#settings-saved').value
      if (!id) {
        toast('请选择要删除的地址')
        return
      }
      if (!confirm('删除该已保存地址？')) return
      Api.deleteServer(id)
      refreshCfg()
      fillSavedSelects()
      if (!Api.getCurrentServer()) leaveApp()
      else renderSettings()
      toast('已删除')
    })
    $('#btn-save-set').addEventListener('click', function () {
      void connectFromForm(
        $('#set-host').value,
        $('#set-port').value,
        $('#set-key').value,
        $('#set-name').value
      )
    })
    $('#btn-disconnect').addEventListener('click', function () {
      leaveApp()
      toast('已断开')
    })

    $('#tech-filter').addEventListener('change', function () {
      state.tech = $('#tech-filter').value
      loadDevices()
    })
    $('#fil-tech').addEventListener('change', function () {
      state.filTech = $('#fil-tech').value
      loadFilament()
    })
    $('#fil-archived').addEventListener('change', function () {
      state.filArchived = $('#fil-archived').value
      loadFilament()
    })
    $('#btn-back-devices').addEventListener('click', function () {
      setPage('devices')
    })
    $('#btn-filament-add').addEventListener('click', function () {
      if (!canControl()) {
        toast('只读模式无法新增')
        return
      }
      openFilModal(null)
    })
    $('#fil-cancel').addEventListener('click', function () {
      $('#fil-modal').hidden = true
    })
    $('#fil-save').addEventListener('click', function () {
      void saveFilament()
    })
    $('#btn-zone-add').addEventListener('click', async function () {
      if (!canControl()) {
        toast('只读模式无法新建')
        return
      }
      var name = prompt('区域名称', '车间')
      if (!name) return
      try {
        await Api.apiPost(state.cfg, '/api/v1/monitor/zones', { name: name })
        toast('已创建区域')
        loadMonitor()
      } catch (e) {
        toast(e.message || String(e))
      }
    })

    var addDev = $('#btn-device-add')
    if (addDev) {
      addDev.addEventListener('click', function () {
        if (!canControl()) {
          toast('只读模式无法添加')
          return
        }
        $('#dev-modal').hidden = false
      })
    }
    var devCancel = $('#dev-cancel')
    if (devCancel) {
      devCancel.addEventListener('click', function () {
        $('#dev-modal').hidden = true
      })
    }
    var devSave = $('#dev-save')
    if (devSave) {
      devSave.addEventListener('click', async function () {
        var brand = $('#dev-brand').value
        var body = {
          name: $('#dev-name').value.trim(),
          brand: brand,
          tech: $('#dev-tech').value,
          baseUrl: $('#dev-base').value.trim() || undefined,
          bambuHost: $('#dev-bambu-host').value.trim() || undefined,
          secret: $('#dev-secret').value.trim() || undefined
        }
        if (!body.name) {
          toast('请填写名称')
          return
        }
        try {
          await Api.Full.createDevice(state.cfg, body)
          $('#dev-modal').hidden = true
          toast('设备已添加')
          void loadDevices()
        } catch (e) {
          toast(e.message || String(e))
        }
      })
    }

    $$('[data-batch]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var act = b.getAttribute('data-batch')
        var ids = selectedDeviceIds()
        if (!ids.length) return
        if (act === 'cancel' && !confirm('批量取消打印？')) return
        try {
          var r = await Api.Full.batchControl(state.cfg, ids, act)
          var ok = (r.results || []).filter(function (x) {
            return x.ok
          }).length
          toast('批量 ' + act + '：成功 ' + ok + '/' + ids.length)
        } catch (e) {
          toast(e.message || String(e))
        }
      })
    })
    var batchClear = $('#btn-batch-clear')
    if (batchClear) {
      batchClear.addEventListener('click', function () {
        state.selectedIds = {}
        renderDeviceGrid()
      })
    }
    var batchPrint = $('#btn-batch-print')
    var batchFile = $('#batch-file')
    if (batchPrint && batchFile) {
      batchPrint.addEventListener('click', function () {
        if (!selectedDeviceIds().length) return
        batchFile.click()
      })
      batchFile.addEventListener('change', async function () {
        var file = batchFile.files && batchFile.files[0]
        var ids = selectedDeviceIds()
        if (!file || !ids.length) return
        try {
          toast('批量上传打印中…')
          var b64 = await Api.Full.fileToBase64(file)
          var r = await Api.Full.batchPrint(state.cfg, ids, file.name, b64)
          var ok = (r.results || []).filter(function (x) {
            return x.ok
          }).length
          toast('批量打印：成功 ' + ok + '/' + ids.length)
        } catch (e) {
          toast(e.message || String(e))
        }
        batchFile.value = ''
      })
    }

    var remoteSave = $('#btn-remote-save')
    if (remoteSave) {
      remoteSave.addEventListener('click', async function () {
        if (!canControl()) return
        try {
          await Api.Full.patchSettings(state.cfg, {
            notifyOnError: $('#rs-notify-error').checked,
            notifyOnPrintDone: $('#rs-notify-done').checked,
            amsAutoDeduct: $('#rs-ams-deduct').checked,
            webhookEnabled: $('#rs-webhook').checked,
            webhookUrl: $('#rs-webhook-url').value.trim() || undefined,
            deviceRefreshSec: Number($('#rs-refresh').value) || 3
          })
          toast('远程设置已保存')
          void loadRemoteSettings()
        } catch (e) {
          toast(e.message || String(e))
        }
      })
    }
    var disco = $('#btn-discover')
    if (disco) {
      disco.addEventListener('click', async function () {
        if (!canControl()) {
          toast('需要可控制模式')
          return
        }
        var stEl = $('#discover-status')
        try {
          await Api.Full.discoverStart(state.cfg)
          if (stEl) stEl.textContent = '扫描中…'
          var n = 0
          var timer = setInterval(async function () {
            n++
            try {
              var st = await Api.Full.discoverStatus(state.cfg)
              if (stEl) {
                stEl.textContent =
                  (st.phase || '') +
                  ' · 已扫 ' +
                  (st.scanned || 0) +
                  '/' +
                  (st.total || 0) +
                  ' · 发现 ' +
                  (st.found || 0)
              }
              if (st.phase === 'done' || st.phase === 'error' || st.phase === 'cancelled' || n > 60) {
                clearInterval(timer)
                if (st.hits && st.hits.length && stEl) {
                  stEl.textContent +=
                    ' · ' +
                    st.hits
                      .slice(0, 5)
                      .map(function (h) {
                        return (h.brand || '') + ' ' + (h.host || '')
                      })
                      .join('；')
                }
              }
            } catch (e) {
              clearInterval(timer)
              if (stEl) stEl.textContent = e.message || String(e)
            }
          }, 1500)
        } catch (e) {
          if (stEl) stEl.textContent = e.message || String(e)
          toast(e.message || String(e))
        }
      })
    }
    var logsClear = $('#btn-logs-clear')
    if (logsClear) {
      logsClear.addEventListener('click', async function () {
        if (!canControl() || !confirm('清空全部操作日志？')) return
        try {
          await Api.Full.clearLogs(state.cfg)
          toast('日志已清空')
          void loadLogs()
        } catch (e) {
          toast(e.message || String(e))
        }
      })
    }
  }

  // boot
  bind()
  fillSavedSelects()
  refreshCfg()
  if (state.connected) {
    // probe then enter
    Api.health(state.cfg)
      .then(function (h) {
        state.mode = h.mode || 'readonly'
        return Api.apiGet(state.cfg, '/api/v1/summary')
      })
      .then(function () {
        enterApp()
      })
      .catch(function () {
        var cur = Api.getCurrentServer()
        showGate(true)
        if (cur) applyServerToGate(cur)
        toast('无法连接上次地址，请检查网络或重新填写')
      })
  } else {
    showGate(true)
    var store = Api.loadStore()
    if (store.servers[0]) applyServerToGate(store.servers[0])
  }
})()

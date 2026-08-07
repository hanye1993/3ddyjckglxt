import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  ConfigProvider,
  Input,
  Layout,
  Space,
  Typography
} from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  FileSearchOutlined
} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import { deviceTech, selectVisibleDevices, useDeviceStore } from './stores/deviceStore'
import { SideNav } from './components/SideNav'
import { BrandFilterBar } from './components/BrandFilterBar'
import { BatchPrintBar } from './components/BatchPrintBar'
import { BatchPrintModal } from './components/BatchPrintModal'
import { DeviceGrid } from './components/DeviceGrid'
import { AddDeviceModal } from './components/AddDeviceModal'
import { DeviceDetailDrawer } from './components/DeviceDetailDrawer'
import { LogDrawer } from './components/LogDrawer'
import { FilamentManager } from './components/FilamentManager'
import { MonitorWallPage } from './components/monitor/MonitorWallPage'
import { MonitorZonesPage } from './components/monitor/MonitorZonesPage'
import { SettingsPage } from './components/SettingsPage'
import { SoftSettingsPage } from './components/SoftSettingsPage'
import { ToolsPage } from './components/ToolsPage'
import { ModelSitesPage } from './components/ModelSitesPage'
import { AiModelSitesPage } from './components/AiModelSitesPage'
import { WindowControls } from './components/WindowControls'
import { LoginPage } from './components/LoginPage'
import { BindSsoPage } from './components/BindSsoPage'
import { UsersPage } from './components/UsersPage'
import { PrintApprovalPage } from './components/PrintApprovalPage'
import { useFilamentStore, selectVisibleSpools } from './stores/filamentStore'
import { usePrintQueueStore } from './stores/printQueueStore'
import { useSettingsStore, resolveDeviceRefreshMs } from './stores/settingsStore'
import { useAuthStore, useAuthGrants } from './stores/authStore'
import { useMonitorStore } from './stores/monitorStore'
import { applyAppearance, getUiTheme } from './theme/appearance'
import type { ControlPayload, PrinterTech } from './types/printer'
import appIcon from './assets/icon.png'

const { Header } = Layout

export default function App() {
  const init = useDeviceStore((s) => s.init)
  const reconnectAll = useDeviceStore((s) => s.reconnectAll)
  const setSearch = useDeviceStore((s) => s.setSearch)
  const search = useDeviceStore((s) => s.search)
  const filter = useDeviceStore((s) => s.filter)
  const section = useDeviceStore((s) => s.section)
  const loading = useDeviceStore((s) => s.loading)
  const bambuPluginHint = useDeviceStore((s) => s.bambuPluginHint)
  const devices = useDeviceStore((s) => s.devices)
  const selectedId = useDeviceStore((s) => s.selectedId)
  const selectDevice = useDeviceStore((s) => s.selectDevice)

  const printerTech: PrinterTech | null =
    section === 'fdm' ? 'fdm' : section === 'resin' ? 'resin' : null

  const { permissions, deviceAcl, can, canDevice, canOpenDevice } = useAuthGrants()

  const visible = useMemo(() => {
    if (!printerTech) return []
    const list = selectVisibleDevices({ devices, filter, search, tech: printerTech })
    return list.filter((d) => canDevice(d.id, 'view'))
  }, [devices, filter, search, printerTech, permissions, deviceAcl, canDevice])

  const sectionCount = useMemo(
    () =>
      printerTech
        ? devices.filter(
            (d) => deviceTech(d) === printerTech && canDevice(d.id, 'view')
          ).length
        : 0,
    [devices, printerTech, permissions, deviceAcl, canDevice]
  )

  const [addOpen, setAddOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)

  const control = useDeviceStore((s) => s.control)
  const settingsInit = useSettingsStore((s) => s.init)
  const apiEnabled = useSettingsStore((s) => s.settings.apiEnabled)
  const deviceRefreshSec = useSettingsStore((s) => s.settings.deviceRefreshSec)
  const uiTheme = useSettingsStore((s) => s.settings.uiTheme)
  const uiBgMode = useSettingsStore((s) => s.settings.uiBgMode)
  const uiBgColor = useSettingsStore((s) => s.settings.uiBgColor)
  const uiBgImage = useSettingsStore((s) => s.settings.uiBgImage)
  const uiThemeDef = useMemo(() => getUiTheme(uiTheme), [uiTheme])

  const filamentSearch = useFilamentStore((s) => s.search)
  const setFilamentSearch = useFilamentStore((s) => s.setSearch)
  const openFilamentAdd = useFilamentStore((s) => s.openAddModal)
  const isFilament = section === 'filament'
  const isApi = section === 'api'
  const isTools = section === 'tools'
  const isMonitorWall = section === 'monitorWall'
  const isMonitorZones = section === 'monitorZones'
  const isModels = section === 'models'
  const isAiModels = section === 'aiModels'
  const isSettings = section === 'settings'
  const isUsers = section === 'users'
  const isPrintApprove = section === 'printApprove'

  const filamentVisibleCount = useFilamentStore((s) =>
    isFilament
      ? selectVisibleSpools({
          spools: s.spools,
          tech: s.tech,
          search: s.search,
          brandFilter: s.brandFilter,
          materialFilter: s.materialFilter,
          lowStockOnly: s.lowStockOnly,
          showArchived: s.showArchived,
          lowStockThreshold: s.lowStockThreshold
        }).length
      : 0
  )
  const filamentActiveCount = useFilamentStore((s) =>
    isFilament ? s.spools.filter((x) => !x.archived).length : 0
  )

  const authReady = useAuthStore((s) => s.ready)
  const role = useAuthStore((s) => s.role)
  const authed = useAuthStore((s) => s.isAuthed())
  const needsSsoBind = useAuthStore((s) => s.needsSsoBind)

  useEffect(() => {
    void useAuthStore.getState().init()
  }, [])

  useEffect(() => {
    if (!authReady || !authed) return
    void init()
    void settingsInit()
    void useFilamentStore.getState().init()
  }, [authReady, authed, init, settingsInit])

  useEffect(() => {
    if (role === 'client') return
    const unsub = window.electronAPI?.filament?.onChanged?.(() => {
      void useFilamentStore.getState().init()
    })
    return () => {
      unsub?.()
    }
  }, [role])

  useEffect(() => {
    applyAppearance({
      themeId: uiTheme,
      bgMode: uiBgMode,
      bgColor: uiBgColor,
      bgImage: uiBgImage
    })
  }, [uiTheme, uiBgMode, uiBgColor, uiBgImage])

  // Server: push live statuses into API for remote clients
  useEffect(() => {
    if (role === 'client' || !apiEnabled) return
    const push = () => {
      void window.electronAPI?.api?.pushStatuses(useDeviceStore.getState().statuses)
    }
    push()
    const t = window.setInterval(push, resolveDeviceRefreshMs({ deviceRefreshSec }))
    return () => window.clearInterval(t)
  }, [role, apiEnabled, deviceRefreshSec])

  // Client: pull ACL first, then all server snapshots each refresh tick
  useEffect(() => {
    if (role !== 'client' || !authed) return
    let cancelled = false
    const pull = () => {
      void (async () => {
        // Permissions / deviceAcl must be fresh before UI filters devices
        await useAuthStore
          .getState()
          .refreshMe()
          .catch(() => undefined)
        if (cancelled) return
        await Promise.all([
          useDeviceStore
            .getState()
            .refreshFromServer({ silent: true })
            .catch(() => undefined),
          useFilamentStore
            .getState()
            .refreshFromServer({ silent: true })
            .catch(() => undefined),
          usePrintQueueStore
            .getState()
            .refresh({ silent: true })
            .catch(() => undefined),
          useSettingsStore
            .getState()
            .refreshFromServer({ silent: true })
            .catch(() => undefined),
          useMonitorStore
            .getState()
            .refreshFromServer({ silent: true })
            .catch(() => undefined)
        ])
      })()
    }
    pull()
    const t = window.setInterval(pull, resolveDeviceRefreshMs({ deviceRefreshSec }))
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [role, authed, deviceRefreshSec])

  // Server: refresh print queue so client-submitted jobs appear without manual refresh
  useEffect(() => {
    if (role !== 'server') return
    const pull = () => {
      void usePrintQueueStore
        .getState()
        .refresh({ silent: true })
        .catch(() => undefined)
    }
    pull()
    const t = window.setInterval(pull, resolveDeviceRefreshMs({ deviceRefreshSec }))
    return () => window.clearInterval(t)
  }, [role, deviceRefreshSec])

  useEffect(() => {
    if (role === 'client') return
    const unsub = window.electronAPI?.api?.onControlRequest((req) => {
      void (async () => {
        try {
          await control(req.deviceId, req.payload as ControlPayload)
          window.electronAPI?.api?.replyControl({ requestId: req.requestId, ok: true })
        } catch (err) {
          window.electronAPI?.api?.replyControl({
            requestId: req.requestId,
            ok: false,
            message: err instanceof Error ? err.message : String(err)
          })
        }
      })()
    })
    return () => {
      unsub?.()
    }
  }, [control, role])

  // Server: handle remote reconnect requests from API clients
  useEffect(() => {
    if (role === 'client') return
    const unsub = window.electronAPI?.api?.onReconnectRequest?.((req) => {
      void (async () => {
        try {
          await reconnectAll()
          window.electronAPI?.api?.replyReconnect?.({ requestId: req.requestId, ok: true })
        } catch (err) {
          window.electronAPI?.api?.replyReconnect?.({
            requestId: req.requestId,
            ok: false,
            message: err instanceof Error ? err.message : String(err)
          })
        }
      })()
    })
    return () => {
      unsub?.()
    }
  }, [reconnectAll, role])

  useEffect(() => {
    if (role === 'client') return
    const unsub = window.electronAPI?.devices?.onChanged?.(() => {
      void init()
    })
    return () => {
      unsub?.()
    }
  }, [init, role])

  useEffect(() => {
    if (role === 'client') return
    const unsub = window.electronAPI?.api?.onDeviceOpRequest?.((req) => {
      void (async () => {
        const adapters = useDeviceStore.getState().adapters
        const adapter = adapters[req.deviceId]
        try {
          if (!adapter) throw new Error('设备未连接')
          if (req.op === 'listFiles') {
            const files = await adapter.listFiles()
            window.electronAPI?.api?.replyDeviceOp({
              requestId: req.requestId,
              ok: true,
              files
            })
            return
          }
          if (req.op === 'uploadFile') {
            const filename = req.filename || 'upload.bin'
            const bin = Uint8Array.from(atob(req.contentBase64 || ''), (c) => c.charCodeAt(0))
            const file = new File([bin], filename)
            await adapter.uploadFile(file)
            window.electronAPI?.api?.replyDeviceOp({ requestId: req.requestId, ok: true })
            return
          }
          if (req.op === 'downloadFile') {
            const remotePath = req.remotePath || ''
            const buf = await adapter.downloadFile(remotePath)
            const bytes = new Uint8Array(buf)
            let binary = ''
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
            window.electronAPI?.api?.replyDeviceOp({
              requestId: req.requestId,
              ok: true,
              filename: remotePath.split('/').pop() || 'download.bin',
              contentBase64: btoa(binary),
              contentType: 'application/octet-stream'
            })
            return
          }
          throw new Error(`Unknown op ${req.op}`)
        } catch (err) {
          window.electronAPI?.api?.replyDeviceOp({
            requestId: req.requestId,
            ok: false,
            message: err instanceof Error ? err.message : String(err)
          })
        }
      })()
    })
    return () => {
      unsub?.()
    }
  }, [role])

  useEffect(() => {
    if (role === 'client') return
    const unsub = window.electronAPI?.api?.onBatchPrintRequest?.((req) => {
      void (async () => {
        try {
          const files: File[] = []
          if (req.contentBase64) {
            const bin = Uint8Array.from(atob(req.contentBase64), (c) => c.charCodeAt(0))
            files.push(new File([bin], req.filename))
          }
          if (!files.length) {
            // Print existing remote file on each device
            const results = []
            for (const deviceId of req.deviceIds) {
              const device = useDeviceStore.getState().devices.find((d) => d.id === deviceId)
              try {
                await useDeviceStore.getState().control(deviceId, {
                  action: 'print_file',
                  filename: req.filename
                })
                results.push({
                  deviceId,
                  deviceName: device?.name || deviceId,
                  ok: true
                })
              } catch (err) {
                results.push({
                  deviceId,
                  deviceName: device?.name || deviceId,
                  ok: false,
                  message: err instanceof Error ? err.message : String(err)
                })
              }
            }
            window.electronAPI?.api?.replyBatchPrint({
              requestId: req.requestId,
              ok: results.every((r) => r.ok),
              results
            })
            return
          }
          const results = await useDeviceStore
            .getState()
            .batchUploadAndPrint(req.deviceIds, files)
          window.electronAPI?.api?.replyBatchPrint({
            requestId: req.requestId,
            ok: results.every((r) => r.ok),
            results
          })
        } catch (err) {
          window.electronAPI?.api?.replyBatchPrint({
            requestId: req.requestId,
            ok: false,
            results: req.deviceIds.map((deviceId) => ({
              deviceId,
              deviceName: deviceId,
              ok: false,
              message: err instanceof Error ? err.message : String(err)
            }))
          })
        }
      })()
    })
    return () => {
      unsub?.()
    }
  }, [role])

  const selected = useMemo(
    () => devices.find((d) => d.id === selectedId) || null,
    [devices, selectedId]
  )

  const selectedMatchesSection =
    !!selected &&
    !!printerTech &&
    deviceTech(selected) === printerTech &&
    canOpenDevice(selected.id)

  useEffect(() => {
    if (selectedId && selected && !canOpenDevice(selected.id)) {
      selectDevice(null)
    }
  }, [selectedId, selected, canOpenDevice, selectDevice, permissions, deviceAcl])

  if (!authReady) {
    return (
      <ConfigProvider locale={zhCN} theme={uiThemeDef.antd}>
        <div className="app-shell" style={{ padding: 48, textAlign: 'center' }}>
          <Typography.Text type="secondary">加载中…</Typography.Text>
        </div>
      </ConfigProvider>
    )
  }

  if (role === 'client' && !authed) {
    return (
      <ConfigProvider locale={zhCN} theme={uiThemeDef.antd}>
        <LoginPage />
      </ConfigProvider>
    )
  }

  if (role === 'client' && authed && needsSsoBind) {
    return (
      <ConfigProvider locale={zhCN} theme={uiThemeDef.antd}>
        <BindSsoPage />
      </ConfigProvider>
    )
  }

  return (
    <ConfigProvider locale={zhCN} theme={uiThemeDef.antd}>
      <div className="app-shell">
        <Header className="app-header">
          <div className="app-header-brand">
            <img src={appIcon} alt="" className="app-header-logo" draggable={false} />
            <Typography.Title level={4} className="app-header-title">
              {role === 'client' ? 'hanye-3D打印机监控台 · 客户端' : 'hanye-3D打印机监控台 · 服务端'}
            </Typography.Title>
          </div>
          <Space className="app-header-actions" size={8} align="center">
            {printerTech ? (
              <Input.Search
                placeholder={
                  printerTech === 'resin'
                    ? '搜索光固化设备 / 分组 / 标签'
                    : '搜索 FDM 设备 / 分组 / 标签'
                }
                allowClear
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="app-header-search"
              />
            ) : null}
            {isFilament ? (
              <Input.Search
                placeholder="搜索颜色 / 品牌 / 位置 / 备注"
                allowClear
                value={filamentSearch}
                onChange={(e) => setFilamentSearch(e.target.value)}
                className="app-header-search"
              />
            ) : null}
            {printerTech ? (
              <Button icon={<ReloadOutlined />} onClick={() => void reconnectAll()}>
                {role === 'client' ? '服务端重连' : '重连'}
              </Button>
            ) : null}
            <Button icon={<FileSearchOutlined />} onClick={() => setLogsOpen(true)}>
              日志
            </Button>
            {printerTech && can('device.create') ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
                {printerTech === 'resin' ? '添加光固化' : '添加 FDM'}
              </Button>
            ) : null}
            {isFilament && can('filament.create') ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openFilamentAdd()}>
                添加料卷
              </Button>
            ) : null}
            {role === 'client' ? (
              <Button onClick={() => useAuthStore.getState().logout()}>退出登录</Button>
            ) : null}
          </Space>
          <WindowControls />
        </Header>

        <div className="app-body">
          <aside className="app-sidebar">
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              功能
            </Typography.Text>
            <SideNav />
          </aside>
          <main className="app-main">
            {printerTech ? (
              <>
                <BrandFilterBar tech={printerTech} />
                <BatchPrintBar tech={printerTech} onBatchPrint={() => setBatchOpen(true)} />
                {printerTech === 'fdm' && bambuPluginHint ? (
                  <Alert
                    type="info"
                    showIcon
                    closable
                    style={{ marginBottom: 12 }}
                    message="Bambu 提示"
                    description={bambuPluginHint}
                  />
                ) : null}
                <DeviceGrid devices={visible} loading={loading} tech={printerTech} />
              </>
            ) : isFilament ? (
              <FilamentManager />
            ) : isApi ? (
              <SettingsPage />
            ) : isTools ? (
              <ToolsPage />
            ) : isMonitorWall ? (
              <MonitorWallPage />
            ) : isMonitorZones ? (
              <MonitorZonesPage />
            ) : isModels ? (
              <ModelSitesPage />
            ) : isAiModels ? (
              <AiModelSitesPage />
            ) : isUsers ? (
              <UsersPage />
            ) : isPrintApprove ? (
              <PrintApprovalPage />
            ) : isSettings ? (
              <SoftSettingsPage />
            ) : null}
          </main>
        </div>

        <footer className="app-footer">
          <span>
            {printerTech === 'fdm'
              ? `FDM ${sectionCount} · 可见 ${visible.length}`
              : printerTech === 'resin'
                ? `光固化 ${sectionCount} · 可见 ${visible.length}`
                : isFilament
                  ? `耗材 ${filamentActiveCount} · 可见 ${filamentVisibleCount}`
                  : isApi
                    ? 'API 服务'
                    : isTools
                      ? '常用工具'
                      : isMonitorWall
                        ? '内部监控 · 打印机摄像头墙'
                        : isMonitorZones
                          ? '区域监控 · 第三方摄像头'
                          : isModels
                            ? '模型网站'
                            : isAiModels
                              ? 'AI 建模网'
                              : '软件设置'}
            {' · v0.3.0'}
          </span>
          <span>
            {isApi
              ? '局域网 / 穿透 · 只读与可控制 · 接口文档'
              : isTools
                ? '代打报价 · 材料电费折旧人工 · G-code'
                : isMonitorWall
                  ? '机舱摄像头 · 逐台加载 · 离开即停流'
                  : isMonitorZones
                    ? '分区管理 · HTTP/MJPEG · 离开即停流'
                    : isModels
                      ? '厂家库 · 综合站 · 国外模型平台'
                      : isAiModels
                        ? '文生3D · 图生3D · 扫描重建'
                        : isSettings
                        ? '开机自启 · 主题 · 背景 · 本地数据'
                        : section === 'filament'
                          ? '本地料卷 · 低库存 · AMS/单色自动扣减'
                          : printerTech === 'resin'
                            ? '光固化 · 层进度监控 · 批量启停'
                            : 'Moonraker 实时 · Bambu 局域网 / 官方账号'}
          </span>
        </footer>
      </div>

      {printerTech ? (
        <AddDeviceModal
          open={addOpen}
          tech={printerTech}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
      {printerTech ? (
        <BatchPrintModal
          open={batchOpen}
          tech={printerTech}
          onClose={() => setBatchOpen(false)}
        />
      ) : null}
      <DeviceDetailDrawer
        device={selectedMatchesSection ? selected : null}
        open={selectedMatchesSection}
        onClose={() => selectDevice(null)}
      />
      <LogDrawer open={logsOpen} onClose={() => setLogsOpen(false)} />
    </ConfigProvider>
  )
}

import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message
} from 'antd'
import {
  CloudDownloadOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  UploadOutlined
} from '@ant-design/icons'
import type { CameraSource } from '../adapters/base'
import type { DeviceConfig, PrinterFileInfo } from '../types/printer'
import { deviceTech, useDeviceStore } from '../stores/deviceStore'
import { deviceStatusLabel } from '../utils/statusLabel'
import { formatEtaFinish, formatRemain } from '../utils/timeFormat'
import { AmsSlotChip } from './AmsSlotChip'
import { BambuDevModeHelp } from './BambuDevModeHelp'
import { CameraPanel } from './CameraPanel'
import { useFilamentStore } from '../stores/filamentStore'
import { findBrand } from '../data/filamentBrands'
import { materialLabel } from '../data/filamentMaterials'
import {
  findSpoolBoundToSlot,
  spoolBindings,
  spoolBindSlotsLeft,
  spoolRolls
} from '../utils/spoolBinding'

function fileNameOf(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

export function DeviceDetailDrawer({
  device,
  open,
  onClose
}: {
  device: DeviceConfig | null
  open: boolean
  onClose: () => void
}) {
  const deviceId = device?.id
  const st = useDeviceStore((s) => (deviceId ? s.statuses[deviceId] : undefined))
  const control = useDeviceStore((s) => s.control)
  const removeDevice = useDeviceStore((s) => s.removeDevice)
  const adapters = useDeviceStore((s) => s.adapters)
  const [files, setFiles] = useState<PrinterFileInfo[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [temp, setTemp] = useState(200)
  const [fanPct, setFanPct] = useState(100)
  const [chamberFanPct, setChamberFanPct] = useState(0)
  const [speedPct, setSpeedPct] = useState(100)
  const [filamentSlot, setFilamentSlot] = useState(0)
  const [busy, setBusy] = useState(false)
  const [fileBusy, setFileBusy] = useState<string | null>(null)
  const [cameras, setCameras] = useState<CameraSource[]>([])
  const [cameraLoading, setCameraLoading] = useState(false)
  const spools = useFilamentStore((s) => s.spools)
  const bindSpoolAms = useFilamentStore((s) => s.bindSpoolAms)
  const clearSlotBinding = useFilamentStore((s) => s.clearSlotBinding)

  const adapter = deviceId ? adapters[deviceId] : undefined

  const loadFiles = async () => {
    if (!deviceId || !adapter) return
    setLoadingFiles(true)
    try {
      const list = await adapter.listFiles()
      setFiles(list || [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '读取文件失败')
    } finally {
      setLoadingFiles(false)
    }
  }

  const loadCameras = async () => {
    if (!deviceId || !adapter) {
      setCameras([])
      setCameraLoading(false)
      return
    }
    setCameraLoading(true)
    try {
      const list = await adapter.getCameras()
      setCameras(list || [])
    } catch {
      setCameras([])
    } finally {
      setCameraLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !deviceId) return
    setFiles([])
    void loadFiles()
    void loadCameras()
    if (st?.fanSpeed != null) setFanPct(st.fanSpeed)
    if (st?.chamberFanSpeed != null) setChamberFanPct(st.chamberFanSpeed)
    if (st?.printSpeed != null) setSpeedPct(st.printSpeed)
    // Only re-run on open / device change — not on adapter identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deviceId])

  if (!device) return null

  const run = async (action: Parameters<typeof control>[1], label: string) => {
    setBusy(true)
    try {
      await control(device.id, action)
      message.success(`${label} 已发送`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const onUpload = async (file: File) => {
    const adapter = adapters[device.id]
    if (!adapter) {
      message.error('设备未连接')
      return false
    }
    setUploading(true)
    try {
      await adapter.uploadFile(file)
      await window.electronAPI?.logs.append({
        time: new Date().toISOString(),
        deviceId: device.id,
        deviceName: device.name,
        action: 'upload',
        result: 'ok',
        detail: file.name
      })
      message.success(`已上传 ${file.name}`)
      await loadFiles()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      await window.electronAPI?.logs.append({
        time: new Date().toISOString(),
        deviceId: device.id,
        deviceName: device.name,
        action: 'upload',
        result: 'error',
        detail
      })
      message.error(detail)
    } finally {
      setUploading(false)
    }
    return false
  }

  const downloadRemote = async (remotePath: string, mode: 'app' | 'as') => {
    const adapter = adapters[device.id]
    if (!adapter) {
      message.error('设备未连接')
      return
    }
    setFileBusy(remotePath)
    try {
      const data = await adapter.downloadFile(remotePath)
      const name = fileNameOf(remotePath)
      const res =
        mode === 'as'
          ? await window.electronAPI?.localFiles.saveAs({ fileName: name, data })
          : await window.electronAPI?.localFiles.save({
              fileName: name,
              data,
              subdir: device.name
            })
      if (!res?.ok || !res.path) {
        if (mode === 'as') message.info('已取消保存')
        else message.error('保存失败')
        return
      }
      await window.electronAPI?.logs.append({
        time: new Date().toISOString(),
        deviceId: device.id,
        deviceName: device.name,
        action: 'download',
        result: 'ok',
        detail: `${remotePath} → ${res.path}`
      })
      message.success(`已保存到 ${res.path}`)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      message.error(detail)
    } finally {
      setFileBusy(null)
    }
  }

  const startPrint = async (remotePath: string) => {
    const adapter = adapters[device.id]
    if (!adapter) {
      message.error('设备未连接')
      return
    }
    setFileBusy(remotePath)
    try {
      await adapter.printFile(remotePath)
      await window.electronAPI?.logs.append({
        time: new Date().toISOString(),
        deviceId: device.id,
        deviceName: device.name,
        action: 'print_file',
        result: 'ok',
        detail: remotePath
      })
      message.success(`已开始打印 ${remotePath}`)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      await window.electronAPI?.logs.append({
        time: new Date().toISOString(),
        deviceId: device.id,
        deviceName: device.name,
        action: 'print_file',
        result: 'error',
        detail
      })
      message.error(detail)
    } finally {
      setFileBusy(null)
    }
  }

  const brandName =
    device.brand === 'klipper'
      ? 'Klipper'
      : device.brand === 'creality'
        ? '创想三维'
        : device.brand === 'elegoo'
          ? '爱乐库'
          : device.brand === 'anycubic'
            ? '纵维立方'
            : device.brand === 'snapmaker'
              ? 'Snapmaker'
              : device.brand === 'flashforge'
                ? '闪铸'
                : device.brand === 'qidi'
                  ? '启迪'
                  : 'Bambu Lab'

  const isMultiColor = Boolean(st?.amsSlots?.length)
  const isResin = deviceTech(device) === 'resin'

  return (
    <Drawer
      title={
        <Space size={8}>
          <span>
            {device.name} · 控制
          </span>
          <Tag className={isResin ? 'tech-tag resin' : 'tech-tag fdm'} bordered={false}>
            {isResin ? '光固化' : 'FDM'}
          </Tag>
          {!isResin && isMultiColor ? (
            <Tag className="multi-color-tag" bordered={false}>
              多色
            </Tag>
          ) : null}
        </Space>
      }
      width={720}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Popconfirm
          title="删除此设备？"
          onConfirm={() => {
            void removeDevice(device.id).then(onClose)
          }}
        >
          <Button danger size="small">
            删除
          </Button>
        </Popconfirm>
      }
    >
      <CameraPanel cameras={cameras} loading={cameraLoading} brandHint={device.brand} />

      {device.brand === 'bambu' && (device.connectionMode || 'lan') === 'lan' ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            st?.message && String(st.message).includes('MQTT')
              ? '拓竹控制被拒（需开发者模式）'
              : '拓竹局域网控制说明'
          }
          description={
            <>
              {st?.message && String(st.message).includes('MQTT') ? (
                <div style={{ marginBottom: 8 }}>{String(st.message)}</div>
              ) : null}
              <BambuDevModeHelp compact={!String(st?.message || '').includes('MQTT')} />
            </>
          }
        />
      ) : null}

      <div style={{ marginBottom: 16 }}>
        <Space wrap size={16} style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space direction="vertical" size={0}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {brandName} · {isResin ? '光固化' : 'FDM'} · {st?.state || '--'} ·{' '}
              {device.connectionMode || 'lan'}
            </Typography.Text>
            <Typography.Text ellipsis style={{ maxWidth: 360 }}>
              {deviceStatusLabel(st)}
            </Typography.Text>
          </Space>
          <div style={{ minWidth: 160 }}>
            <Progress
              percent={Math.min(100, Math.round(st?.progress ?? 0))}
              size="small"
              status={st?.health === 'error' ? 'exception' : 'active'}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {isResin
                ? `层 ${st?.layer ?? '--'} / ${st?.layerTotal ?? '--'}`
                : `挤出 ${st?.extruder ? `${st.extruder.actual.toFixed(0)}°` : '--'} · 热床 ${
                    st?.bed ? `${st.bed.actual.toFixed(0)}°` : '--'
                  } · 主板 ${Math.round(st?.boardTemp ?? 0)}° · 仓内 ${Math.round(st?.chamberTemp ?? 0)}°`}
              {st?.remainingSeconds != null && st.remainingSeconds > 0
                ? ` · 剩余 ${formatRemain(st.remainingSeconds)} · 约 ${formatEtaFinish(st.remainingSeconds)} 完成`
                : ''}
            </Typography.Text>
          </div>
        </Space>
      </div>

      <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
        <Descriptions.Item label="健康">{st?.health || '--'}</Descriptions.Item>
        <Descriptions.Item label="层数">
          {st?.layer ?? '--'} / {st?.layerTotal ?? '--'}
        </Descriptions.Item>
        <Descriptions.Item label="剩余时间">{formatRemain(st?.remainingSeconds)}</Descriptions.Item>
        <Descriptions.Item label="预计完成">
          {st?.remainingSeconds != null && st.remainingSeconds > 0
            ? formatEtaFinish(st.remainingSeconds)
            : '--'}
        </Descriptions.Item>
        {!isResin ? (
          <>
            <Descriptions.Item label="主板温度">
              {Math.round(st?.boardTemp ?? 0)} °C
            </Descriptions.Item>
            <Descriptions.Item label="仓内温度">
              {Math.round(st?.chamberTemp ?? 0)} °C
            </Descriptions.Item>
          </>
        ) : null}
        <Descriptions.Item label="地址 / ID" span={2}>
          {device.baseUrl || device.bambuDeviceId || '--'}
        </Descriptions.Item>
        {st?.message ? (
          <Descriptions.Item label="提示" span={2}>
            {st.message}
          </Descriptions.Item>
        ) : null}
      </Descriptions>

      {!isResin ? (
        <div style={{ marginBottom: 16 }}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            耗材绑定
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            绑定本地料卷后打印完成自动扣减。多色 AMS 按剩余%；单色/外挂自动读取任务用量，无需手填。
          </Typography.Paragraph>
          {device.brand === 'bambu' && st?.amsSlots?.length ? (
            <Space size={8} wrap style={{ marginBottom: 12 }}>
              {st.amsSlots.map((slot) => {
                const bound = findSpoolBoundToSlot(spools, device.id, slot.id)
                return (
                  <Space key={slot.id} direction="vertical" size={4}>
                    <AmsSlotChip slot={slot} />
                    <Select
                      size="small"
                      style={{ minWidth: 150 }}
                      placeholder="绑定料卷"
                      allowClear
                      value={bound?.id}
                      onChange={(spoolId) => {
                        void (async () => {
                          if (!spoolId) {
                            await clearSlotBinding(device.id, slot.id)
                            message.success('已解除绑定')
                            return
                          }
                          const ok = await bindSpoolAms(spoolId, {
                            deviceId: device.id,
                            slotId: slot.id
                          })
                          if (!ok) {
                            const s = spools.find((x) => x.id === spoolId)
                            message.warning(
                              `该料卷仅 ${spoolRolls(s || { rolls: 1 })} 卷，已绑满，无法再绑`
                            )
                            return
                          }
                          message.success(`已绑定 AMS ${slot.id}`)
                        })()
                      }}
                      options={spools
                        .filter((s) => s.tech === 'fdm' && !s.archived)
                        .map((s) => {
                          const left = spoolBindSlotsLeft(s)
                          const already = spoolBindings(s).some(
                            (b) => b.deviceId === device.id && Number(b.slotId) === slot.id
                          )
                          return {
                            value: s.id,
                            disabled: left <= 0 && !already,
                            label: `${findBrand(s.brandId)?.name || s.brandId} ${materialLabel(s.material)} ${s.color} (${Math.round(s.remainGrams)}g · ${spoolBindings(s).length}/${spoolRolls(s)}卷)`
                          }
                        })}
                    />
                  </Space>
                )
              })}
            </Space>
          ) : null}
          {(() => {
            const extBound = findSpoolBoundToSlot(spools, device.id, 0)
            return (
              <Space wrap align="center">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  外挂 / 单色料架
                </Typography.Text>
                <Select
                  size="small"
                  style={{ minWidth: 200 }}
                  placeholder="绑定料卷"
                  allowClear
                  value={extBound?.id}
                  onChange={(spoolId) => {
                    void (async () => {
                      if (!spoolId) {
                        await clearSlotBinding(device.id, 0)
                        message.success('已解除绑定')
                        return
                      }
                      const ok = await bindSpoolAms(spoolId, {
                        deviceId: device.id,
                        slotId: 0
                      })
                      if (!ok) {
                        const s = spools.find((x) => x.id === spoolId)
                        message.warning(
                          `该料卷仅 ${spoolRolls(s || { rolls: 1 })} 卷，已绑满，无法再绑`
                        )
                        return
                      }
                      message.success('已绑定外挂/单色料架')
                    })()
                  }}
                  options={spools
                    .filter((s) => s.tech === 'fdm' && !s.archived)
                    .map((s) => {
                      const left = spoolBindSlotsLeft(s)
                      const already = spoolBindings(s).some(
                        (b) => b.deviceId === device.id && Number(b.slotId) === 0
                      )
                      return {
                        value: s.id,
                        disabled: left <= 0 && !already,
                        label: `${findBrand(s.brandId)?.name || s.brandId} ${materialLabel(s.material)} ${s.color} (${Math.round(s.remainGrams)}g · ${spoolBindings(s).length}/${spoolRolls(s)}卷)`
                      }
                    })}
                />
              </Space>
            )
          })()}
        </div>
      ) : null}

      <Typography.Title level={5}>远程控制</Typography.Title>
      <Space wrap style={{ marginBottom: 16 }}>
        <Popconfirm title="确认暂停打印？" onConfirm={() => void run({ action: 'pause' }, '暂停')}>
          <Button disabled={busy}>暂停</Button>
        </Popconfirm>
        <Popconfirm title="确认恢复打印？" onConfirm={() => void run({ action: 'resume' }, '恢复')}>
          <Button disabled={busy}>恢复</Button>
        </Popconfirm>
        <Popconfirm
          title="确认取消打印？此操作不可恢复"
          onConfirm={() => void run({ action: 'cancel' }, '取消')}
        >
          <Button danger disabled={busy}>
            取消打印
          </Button>
        </Popconfirm>
        {!isResin ? (
          <>
            <Button
              danger
              type="primary"
              disabled={busy}
              onClick={() => {
                Modal.confirm({
                  title: '紧急停止',
                  content: '将发送紧急停止指令，确认继续？',
                  okButtonProps: { danger: true },
                  onOk: () => run({ action: 'emergency_stop' }, '紧急停止')
                })
              }}
            >
              紧急停止
            </Button>
            <Popconfirm title="确认归零？" onConfirm={() => void run({ action: 'home' }, '归零')}>
              <Button disabled={busy}>归零</Button>
            </Popconfirm>
          </>
        ) : null}
      </Space>

      {!isResin ? (
      <Space wrap style={{ marginBottom: 12 }}>
        <InputNumber value={temp} onChange={(v) => setTemp(Number(v || 0))} addonAfter="°C" />
        <Button
          disabled={busy}
          onClick={() =>
            void run({ action: 'set_temp', heater: 'extruder', temperature: temp }, '设置挤出机温度')
          }
        >
          挤出机温度
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void run({ action: 'set_temp', heater: 'bed', temperature: temp }, '设置热床温度')
          }
        >
          热床温度
        </Button>
      </Space>
      ) : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="光固化控制"
          description="本机不提供挤出机/热床/风扇等 FDM 参数；切片上传与曝光参数后续接入。"
        />
      )}

      {!isResin ? (
        <div style={{ marginBottom: 24 }}>
          <Typography.Title level={5}>进料 / 退料</Typography.Title>
          <Space wrap align="center">
            {device.brand === 'bambu' && st?.amsSlots && st.amsSlots.length > 0 ? (
              <Select
                size="middle"
                style={{ minWidth: 140 }}
                value={filamentSlot}
                onChange={setFilamentSlot}
                options={[
                  { value: 0, label: '外挂料架' },
                  ...st.amsSlots.map((s) => ({
                    value: s.id,
                    label: `AMS ${s.id} · ${s.material}`
                  }))
                ]}
              />
            ) : null}
            <Popconfirm
              title="确认进料？"
              description={
                device.brand === 'bambu'
                  ? '将加热喷嘴并执行进料（请确认耗材已就绪）'
                  : '将调用 LOAD_FILAMENT 宏（需打印机已配置）'
              }
              onConfirm={() =>
                void run(
                  {
                    action: 'load_filament',
                    temperature: temp > 0 ? temp : 220,
                    slot:
                      device.brand === 'bambu' && filamentSlot > 0 ? filamentSlot : undefined
                  },
                  '进料'
                )
              }
            >
              <Button disabled={busy}>进料</Button>
            </Popconfirm>
            <Popconfirm
              title="确认退料？"
              description={
                device.brand === 'bambu'
                  ? '将加热喷嘴并退出当前耗材'
                  : '将调用 UNLOAD_FILAMENT 宏（需打印机已配置）'
              }
              onConfirm={() =>
                void run(
                  {
                    action: 'unload_filament',
                    temperature: temp > 0 ? temp : 220
                  },
                  '退料'
                )
              }
            >
              <Button disabled={busy}>退料</Button>
            </Popconfirm>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              使用上方温度（默认 220°C）
            </Typography.Text>
          </Space>
        </div>
      ) : null}

      {!isResin ? (
      <Space wrap style={{ marginBottom: 24 }}>
        {st?.chamberFanSpeed != null ? (
          <>
            <InputNumber
              min={0}
              max={100}
              value={chamberFanPct}
              onChange={(v) => setChamberFanPct(Number(v || 0))}
              addonAfter="仓内%"
            />
            <Button
              disabled={busy}
              onClick={() =>
                void run(
                  {
                    action: 'set_fan',
                    fan: 'chamber',
                    percent: chamberFanPct,
                    fanName: st.chamberFanName
                  },
                  '设置仓内风扇'
                )
              }
            >
              应用仓内风扇
            </Button>
          </>
        ) : null}
        <InputNumber
          min={0}
          max={100}
          value={fanPct}
          onChange={(v) => setFanPct(Number(v || 0))}
          addonAfter="风扇%"
        />
        <Button
          disabled={busy}
          onClick={() =>
            void run({ action: 'set_fan', fan: 'part', percent: fanPct }, '设置风扇')
          }
        >
          应用风扇
        </Button>
        <InputNumber
          min={1}
          max={200}
          value={speedPct}
          onChange={(v) => setSpeedPct(Number(v || 100))}
          addonAfter="速度%"
        />
        <Button
          disabled={busy}
          onClick={() => void run({ action: 'set_speed', percent: speedPct }, '设置速度')}
        >
          应用速度
        </Button>
      </Space>
      ) : null}

      <Typography.Title level={5}>{isResin ? '切片文件' : '文件'}</Typography.Title>
      <Space style={{ marginBottom: 8 }} wrap>
        <Button onClick={() => void loadFiles()} loading={loadingFiles}>
          刷新文件列表
        </Button>
        <Upload
          accept={
            isResin
              ? '.ctb,.goo,.pwmo,.pws,.photon,.phz,.zip,.slc'
              : '.gcode,.gco,.nc,.bgcode,.3mf'
          }
          showUploadList={false}
          beforeUpload={(file) => {
            void onUpload(file as unknown as File)
            return false
          }}
        >
          <Button icon={<UploadOutlined />} loading={uploading}>
            上传文件
          </Button>
        </Upload>
        <Button
          onClick={async () => {
            await window.electronAPI?.localFiles.openDir()
          }}
        >
          打开本地下载目录
        </Button>
      </Space>
      <Table
        size="small"
        rowKey="path"
        pagination={{ pageSize: 6 }}
        loading={loadingFiles}
        dataSource={files}
        columns={[
          { title: '路径', dataIndex: 'path', ellipsis: true },
          {
            title: '大小',
            dataIndex: 'size',
            width: 90,
            render: (v: number) => `${(v / 1024).toFixed(0)} KB`
          },
          {
            title: '操作',
            key: 'actions',
            width: 120,
            render: (_: unknown, row: PrinterFileInfo) => (
              <Space size={0}>
                <Popconfirm
                  title={`确认打印 ${row.path}？`}
                  onConfirm={() => void startPrint(row.path)}
                >
                  <Button
                    type="link"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    loading={fileBusy === row.path}
                  />
                </Popconfirm>
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'app',
                        icon: <SaveOutlined />,
                        label: '保存到应用目录',
                        onClick: () => void downloadRemote(row.path, 'app')
                      },
                      {
                        key: 'as',
                        icon: <CloudDownloadOutlined />,
                        label: '另存为…',
                        onClick: () => void downloadRemote(row.path, 'as')
                      }
                    ]
                  }}
                >
                  <Button
                    type="link"
                    size="small"
                    icon={<CloudDownloadOutlined />}
                    loading={fileBusy === row.path}
                  />
                </Dropdown>
              </Space>
            )
          }
        ]}
      />
    </Drawer>
  )
}

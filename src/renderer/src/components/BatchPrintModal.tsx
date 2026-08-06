import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  List,
  Modal,
  Progress,
  Space,
  Typography,
  Upload,
  message
} from 'antd'
import { InboxOutlined, PlayCircleOutlined } from '@ant-design/icons'
import {
  canBatchPrint,
  deviceTech,
  useDeviceStore,
  type BatchPrintResult
} from '../stores/deviceStore'
import type { PrinterTech } from '../types/printer'

const FDM_ACCEPT = '.gcode,.gco,.g,.bgcode,.nc'
const RESIN_ACCEPT = '.ctb,.goo,.pwmo,.pws,.photon,.phz,.zip,.slc'

export function BatchPrintModal({
  open,
  tech,
  onClose
}: {
  open: boolean
  tech: PrinterTech
  onClose: () => void
}) {
  const devices = useDeviceStore((s) => s.devices)
  const checkedIds = useDeviceStore((s) => s.checkedIds)
  const clearChecked = useDeviceStore((s) => s.clearChecked)
  const batchUploadAndPrint = useDeviceStore((s) => s.batchUploadAndPrint)
  const isResin = tech === 'resin'

  const [files, setFiles] = useState<File[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<BatchPrintResult[]>([])

  const selected = useMemo(
    () =>
      checkedIds
        .map((id) => devices.find((d) => d.id === id))
        .filter((d): d is NonNullable<typeof d> => !!d && deviceTech(d) === tech),
    [checkedIds, devices, tech]
  )

  const supported = selected.filter(canBatchPrint)
  const unsupported = selected.filter((d) => !canBatchPrint(d))

  const reset = () => {
    setFiles([])
    setRunning(false)
    setProgress({ done: 0, total: 0 })
    setResults([])
  }

  const handleClose = () => {
    if (running) return
    reset()
    onClose()
  }

  const start = async () => {
    if (isResin) {
      message.info('光固化批量上传切片功能开发中，请先使用批量暂停/继续/停止，或在单机详情中操作')
      return
    }
    if (!supported.length) {
      message.warning('没有可批量打印的设备（需 Klipper / 创想局域网 / 启迪）')
      return
    }
    if (!files.length) {
      message.warning('请先选择 G-code 文件')
      return
    }
    if (files.length > 1 && files.length !== supported.length) {
      message.warning(
        `多文件模式需与打印机数量一致：当前 ${files.length} 个文件、${supported.length} 台可打印设备`
      )
      return
    }

    setRunning(true)
    setResults([])
    setProgress({ done: 0, total: supported.length })
    try {
      const list = await batchUploadAndPrint(
        supported.map((d) => d.id),
        files,
        (done, total, result) => {
          setProgress({ done, total })
          setResults((prev) => [...prev, result])
        }
      )
      const ok = list.filter((r) => r.ok).length
      const fail = list.length - ok
      if (fail === 0) {
        message.success(`已在 ${ok} 台打印机启动打印`)
        clearChecked()
      } else {
        message.warning(`完成：成功 ${ok} · 失败 ${fail}`)
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal
      title={isResin ? '批量导入光固化切片' : '批量导入 G-code 并打印'}
      open={open}
      onCancel={handleClose}
      width={640}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={handleClose} disabled={running}>
          关闭
        </Button>,
        <Button
          key="start"
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={running}
          onClick={() => void start()}
          disabled={isResin || !supported.length || !files.length}
        >
          {isResin ? '上传（开发中）' : '上传并开打'}
        </Button>
      ]}
    >
      <Alert
        type={isResin ? 'info' : 'success'}
        showIcon
        style={{ marginBottom: 12 }}
        message={isResin ? '当前为光固化工作区' : '当前为 FDM 工作区'}
        description={
          isResin
            ? '与 FDM 隔离：仅操作光固化设备。切片上传对接开发中；批量暂停/继续/停止已可用。'
            : '与光固化隔离：仅操作 FDM 设备。支持 Moonraker G-code 上传开打。'
        }
      />

      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {isResin
          ? '请勾选光固化打印机。切片格式与 FDM 的 G-code 不同，不会混用。'
          : '勾选打印机后导入 G-code：单个文件发到全部所选设备；多个文件需与可打印设备一一对应。'}
      </Typography.Paragraph>

      <Typography.Text strong>已选设备（{selected.length}）</Typography.Text>
      <List
        size="small"
        style={{ marginTop: 8, marginBottom: 16, maxHeight: 160, overflow: 'auto' }}
        dataSource={selected}
        locale={{ emptyText: '请先在卡片上勾选打印机' }}
        renderItem={(d) => (
          <List.Item>
            <Space>
              <span>{d.name}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {d.brand}
              </Typography.Text>
              {!canBatchPrint(d) ? (
                <Typography.Text type="warning" style={{ fontSize: 12 }}>
                  {isResin ? '切片上传开发中' : '不支持批量上传'}
                </Typography.Text>
              ) : null}
            </Space>
          </List.Item>
        )}
      />

      {!isResin && unsupported.length ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${unsupported.length} 台设备不支持批量上传（Bambu / 云端 / 非 Moonraker），将被跳过`}
        />
      ) : null}

      <Upload.Dragger
        multiple
        accept={isResin ? RESIN_ACCEPT : FDM_ACCEPT}
        disabled={running || isResin}
        fileList={files.map((f, i) => ({
          uid: `${f.name}-${i}`,
          name: f.name,
          status: 'done' as const
        }))}
        beforeUpload={(file) => {
          setFiles((prev) => [...prev, file])
          return false
        }}
        onRemove={(item) => {
          setFiles((prev) => prev.filter((f) => f.name !== item.name))
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">
          {isResin ? '光固化切片上传开发中' : '点击或拖拽 G-code 到此处'}
        </p>
        <p className="ant-upload-hint">
          {isResin ? '预留格式：.ctb / .goo / .pwmo / .pws' : '支持 .gcode / .gco / .bgcode'}
        </p>
      </Upload.Dragger>

      {progress.total > 0 ? (
        <div style={{ marginTop: 16 }}>
          <Progress
            percent={Math.round((progress.done / progress.total) * 100)}
            status={running ? 'active' : undefined}
          />
          <List
            size="small"
            style={{ marginTop: 8, maxHeight: 140, overflow: 'auto' }}
            dataSource={results}
            renderItem={(r) => (
              <List.Item>
                <Typography.Text type={r.ok ? 'success' : 'danger'}>
                  {r.deviceName}：{r.ok ? `已开打 ${r.message || ''}` : r.message || '失败'}
                </Typography.Text>
              </List.Item>
            )}
          />
        </div>
      ) : null}
    </Modal>
  )
}

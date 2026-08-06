import { useState } from 'react'
import { Button, Popconfirm, Space, Typography, message } from 'antd'
import {
  CaretRightOutlined,
  ClearOutlined,
  CloudUploadOutlined,
  PauseOutlined,
  StopOutlined
} from '@ant-design/icons'
import { deviceTech, useDeviceStore } from '../stores/deviceStore'
import type { PrinterTech } from '../types/printer'

export function BatchPrintBar({
  tech,
  onBatchPrint
}: {
  tech: PrinterTech
  onBatchPrint: () => void
}) {
  const devices = useDeviceStore((s) => s.devices)
  const checkedIds = useDeviceStore((s) => s.checkedIds)
  const setCheckedIds = useDeviceStore((s) => s.setCheckedIds)
  const clearChecked = useDeviceStore((s) => s.clearChecked)
  const batchControl = useDeviceStore((s) => s.batchControl)
  const filter = useDeviceStore((s) => s.filter)
  const search = useDeviceStore((s) => s.search)
  const [busy, setBusy] = useState<'pause' | 'resume' | 'cancel' | null>(null)

  const sectionDevices = devices.filter((d) => deviceTech(d) === tech)
  if (!sectionDevices.length && !checkedIds.length) {
    // still show bar so user can understand batch area exists when empty? hide if no devices
  }
  if (!sectionDevices.length) return null

  const visibleIds = sectionDevices
    .filter((d) => {
      if (filter !== 'all' && d.brand !== filter) return false
      const q = search.trim().toLowerCase()
      if (!q) return true
      return (
        d.name.toLowerCase().includes(q) ||
        (d.group || '').toLowerCase().includes(q) ||
        (d.tags || []).some((t) => t.toLowerCase().includes(q))
      )
    })
    .map((d) => d.id)

  const allVisibleChecked =
    visibleIds.length > 0 && visibleIds.every((id) => checkedIds.includes(id))

  const runBatch = async (action: 'pause' | 'resume' | 'cancel', label: string) => {
    if (!checkedIds.length) {
      message.warning('请先勾选打印机')
      return
    }
    setBusy(action)
    try {
      const results = await batchControl(checkedIds, action)
      const ok = results.filter((r) => r.ok).length
      const fail = results.length - ok
      if (fail === 0) message.success(`已对 ${ok} 台设备执行${label}`)
      else message.warning(`${label}完成：成功 ${ok} · 失败 ${fail}`)
    } finally {
      setBusy(null)
    }
  }

  const disabled = !checkedIds.length || busy != null
  const importLabel = tech === 'resin' ? '批量导入切片' : '批量导入打印'

  return (
    <div className={`batch-print-bar tech-${tech}`}>
      <Space wrap size={10}>
        <Typography.Text type="secondary">
          {tech === 'resin' ? '光固化' : 'FDM'}已选{' '}
          <Typography.Text strong>{checkedIds.length}</Typography.Text> 台
        </Typography.Text>
        <Button
          size="small"
          onClick={() => setCheckedIds(allVisibleChecked ? [] : visibleIds)}
        >
          {allVisibleChecked ? '取消全选' : '全选当前列表'}
        </Button>
        {checkedIds.length ? (
          <Button size="small" icon={<ClearOutlined />} onClick={() => clearChecked()}>
            清空选择
          </Button>
        ) : null}

        <Button
          size="small"
          icon={<PauseOutlined />}
          disabled={disabled}
          loading={busy === 'pause'}
          onClick={() => void runBatch('pause', '暂停')}
        >
          批量暂停
        </Button>
        <Button
          size="small"
          icon={<CaretRightOutlined />}
          disabled={disabled}
          loading={busy === 'resume'}
          onClick={() => void runBatch('resume', '继续')}
        >
          批量继续
        </Button>
        <Popconfirm
          title={`确认停止所选 ${checkedIds.length} 台打印机？`}
          description="将取消当前打印任务，不可恢复"
          okButtonProps={{ danger: true }}
          disabled={disabled}
          onConfirm={() => void runBatch('cancel', '停止')}
        >
          <Button
            size="small"
            danger
            icon={<StopOutlined />}
            disabled={disabled}
            loading={busy === 'cancel'}
          >
            批量停止
          </Button>
        </Popconfirm>

        <Button
          type="primary"
          size="small"
          icon={<CloudUploadOutlined />}
          disabled={disabled}
          onClick={onBatchPrint}
        >
          {importLabel}
        </Button>
      </Space>
    </div>
  )
}

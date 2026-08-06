import { useEffect, useState } from 'react'
import { Button, Drawer, Space, Table, message } from 'antd'
import type { OperationLog } from '../../../preload/index'

export function LogDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<OperationLog[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = (await window.electronAPI?.logs.read()) || []
      setLogs(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  return (
    <Drawer
      title="操作日志"
      width={640}
      open={open}
      onClose={onClose}
      extra={
        <Space>
          <Button onClick={() => void load()}>刷新</Button>
          <Button
            type="primary"
            onClick={async () => {
              const res = await window.electronAPI?.logs.export()
              if (res?.ok && res.path) message.success(`已导出到 ${res.path}`)
              else message.warning('暂无日志可导出')
            }}
          >
            导出
          </Button>
        </Space>
      }
    >
      <Table
        size="small"
        loading={loading}
        rowKey={(r) => `${r.time}-${r.deviceId}-${r.action}`}
        dataSource={logs}
        pagination={{ pageSize: 12 }}
        columns={[
          { title: '时间', dataIndex: 'time', width: 180 },
          { title: '设备', dataIndex: 'deviceName', width: 120 },
          { title: '指令', dataIndex: 'action', width: 100 },
          { title: '结果', dataIndex: 'result', width: 80 },
          { title: '详情', dataIndex: 'detail', ellipsis: true }
        ]}
      />
    </Drawer>
  )
}

import { useEffect, useState } from 'react'
import { Empty, Spin, Typography } from 'antd'
import type { CameraSource } from '../../adapters/base'
import type { DeviceConfig } from '../../types/printer'
import { useDeviceStore } from '../../stores/deviceStore'
import { SnapshotCam } from './SnapshotCam'

type WallSlot = {
  device: DeviceConfig
  cameras: CameraSource[]
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Printer chamber-camera wall. Discovers one device at a time;
 * unmount (nav leave) stops all snapshot polls.
 */
export function MonitorWallPage() {
  const devices = useDeviceStore((s) => s.devices)
  const adapters = useDeviceStore((s) => s.adapters)
  const [slots, setSlots] = useState<WallSlot[]>([])
  const [scanning, setScanning] = useState(true)
  const [progress, setProgress] = useState('')

  useEffect(() => {
    let cancelled = false
    setSlots([])
    setScanning(true)
    setProgress('')

    const run = async () => {
      const list = [...devices]
      for (let i = 0; i < list.length; i++) {
        if (cancelled) return
        const device = list[i]
        setProgress(`探测 ${i + 1}/${list.length} · ${device.name}`)
        const adapter = adapters[device.id]
        if (!adapter) continue
        try {
          const cameras = await adapter.getCameras()
          if (cancelled) return
          if (cameras?.length) {
            setSlots((prev) => [...prev, { device, cameras }])
          }
        } catch {
          /* no camera */
        }
        await delay(280)
      }
      if (!cancelled) {
        setScanning(false)
        setProgress('')
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [devices, adapters])

  if (!devices.length) {
    return <Empty description="暂无打印机设备" />
  }

  return (
    <div className="monitor-page">
      <div className="monitor-page-head">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            内部监控 · 打印机摄像头墙
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            仅显示可取流的机舱摄像头；离开本页自动停止拉流。
          </Typography.Text>
        </div>
        {scanning ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <Spin size="small" style={{ marginRight: 8 }} />
            {progress || '探测中…'}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {slots.length} 路画面
          </Typography.Text>
        )}
      </div>

      {!slots.length && !scanning ? (
        <Empty description="没有发现可用的打印机摄像头（需局域网机舱摄像头已开）" />
      ) : (
        <div className="monitor-wall-grid">
          {slots.map((slot) => (
            <SnapshotCam
              key={slot.device.id}
              title={slot.device.name}
              subtitle={slot.cameras[0]?.name || slot.device.brand}
              cameras={slot.cameras}
              intervalMs={
                slot.cameras.some((c) => (c.snapshotUrl || '').startsWith('bambu-cam://'))
                  ? 2500
                  : 1200
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

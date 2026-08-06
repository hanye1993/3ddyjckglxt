import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tabs,
  Typography,
  message
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import type { CameraSource } from '../../adapters/base'
import { useMonitorStore } from '../../stores/monitorStore'
import type { ZoneCamera } from '../../types/monitor'
import { SnapshotCam } from './SnapshotCam'

function toSources(cam: ZoneCamera): CameraSource[] {
  const snap = cam.snapshotUrl || cam.url
  return [
    {
      id: cam.id,
      name: cam.name,
      streamUrl: cam.url,
      snapshotUrl: snap,
      remoteStreamUrl: cam.url,
      remoteSnapshotUrl: snap
    }
  ]
}

export function MonitorZonesPage() {
  const loading = useMonitorStore((s) => s.loading)
  const zones = useMonitorStore((s) => s.zones)
  const activeZoneId = useMonitorStore((s) => s.activeZoneId)
  const init = useMonitorStore((s) => s.init)
  const setActiveZoneId = useMonitorStore((s) => s.setActiveZoneId)
  const addZone = useMonitorStore((s) => s.addZone)
  const renameZone = useMonitorStore((s) => s.renameZone)
  const removeZone = useMonitorStore((s) => s.removeZone)
  const addCamera = useMonitorStore((s) => s.addCamera)
  const removeCamera = useMonitorStore((s) => s.removeCamera)

  const [zoneModal, setZoneModal] = useState<'add' | 'rename' | null>(null)
  const [camModal, setCamModal] = useState(false)
  const [zoneName, setZoneName] = useState('')
  const [camForm] = Form.useForm<{ name: string; url: string; snapshotUrl?: string }>()

  useEffect(() => {
    void init()
  }, [init])

  const active = useMemo(
    () => zones.find((z) => z.id === activeZoneId) || zones[0] || null,
    [zones, activeZoneId]
  )

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip="加载区域监控…" />
      </div>
    )
  }

  return (
    <div className="monitor-page">
      <div className="monitor-page-head">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            区域监控 · 第三方摄像头
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            按区域管理外接摄像头（HTTP 快照 / MJPEG）；离开本页自动停止拉流。
          </Typography.Text>
        </div>
        <Space wrap>
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              setZoneName('')
              setZoneModal('add')
            }}
          >
            新建区域
          </Button>
          {active ? (
            <>
              <Button
                icon={<EditOutlined />}
                onClick={() => {
                  setZoneName(active.name)
                  setZoneModal('rename')
                }}
              >
                重命名
              </Button>
              <Popconfirm
                title={`删除区域「${active.name}」？`}
                onConfirm={() => void removeZone(active.id)}
              >
                <Button danger icon={<DeleteOutlined />}>
                  删除区域
                </Button>
              </Popconfirm>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  camForm.resetFields()
                  setCamModal(true)
                }}
              >
                添加摄像头
              </Button>
            </>
          ) : null}
        </Space>
      </div>

      {!zones.length ? (
        <Empty
          description="还没有区域。例如先建「A区」，再添加该区摄像头地址。"
          style={{ marginTop: 48 }}
        >
          <Button
            type="primary"
            onClick={() => {
              setZoneName('A区')
              setZoneModal('add')
            }}
          >
            创建 A区
          </Button>
        </Empty>
      ) : (
        <>
          <Tabs
            activeKey={active?.id}
            onChange={(k) => setActiveZoneId(k)}
            items={zones.map((z) => ({
              key: z.id,
              label: `${z.name}（${z.cameras.length}）`
            }))}
          />
          {active && !active.cameras.length ? (
            <Empty description={`「${active.name}」暂无摄像头，点击右上角添加`} />
          ) : active ? (
            <div className="monitor-wall-grid">
              {active.cameras.map((cam) => (
                <div key={cam.id} className="monitor-tile-wrap">
                  <SnapshotCam
                    title={cam.name}
                    subtitle={active.name}
                    cameras={toSources(cam)}
                    intervalMs={1200}
                  />
                  <Popconfirm
                    title="移除此摄像头？"
                    onConfirm={() => void removeCamera(active.id, cam.id)}
                  >
                    <Button size="small" danger type="text" className="monitor-tile-remove">
                      移除
                    </Button>
                  </Popconfirm>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}

      <Modal
        title={zoneModal === 'rename' ? '重命名区域' : '新建区域'}
        open={!!zoneModal}
        onCancel={() => setZoneModal(null)}
        onOk={() => {
          const n = zoneName.trim()
          if (!n) {
            message.warning('请填写区域名称')
            return
          }
          if (zoneModal === 'rename' && active) {
            void renameZone(active.id, n).then(() => setZoneModal(null))
          } else {
            void addZone(n).then(() => setZoneModal(null))
          }
        }}
        destroyOnHidden
      >
        <Input
          placeholder="例如 A区、一楼车间"
          value={zoneName}
          onChange={(e) => setZoneName(e.target.value)}
          onPressEnter={() => {
            /* ok via modal */
          }}
        />
      </Modal>

      <Modal
        title={`添加摄像头${active ? ` · ${active.name}` : ''}`}
        open={camModal}
        onCancel={() => setCamModal(false)}
        onOk={() => {
          void camForm.validateFields().then(async (v) => {
            if (!active) return
            const cam = await addCamera(active.id, {
              name: v.name,
              url: v.url,
              snapshotUrl: v.snapshotUrl?.trim() || undefined
            })
            if (!cam) {
              message.error('请填写有效的画面地址')
              return
            }
            message.success('已添加')
            setCamModal(false)
          })
        }}
        destroyOnHidden
      >
        <Form form={camForm} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="门口摄像头" />
          </Form.Item>
          <Form.Item
            name="url"
            label="画面 URL"
            rules={[{ required: true, message: '请输入 URL' }]}
            extra="支持 HTTP 快照或 MJPEG，例如 http://192.168.1.50:8080/?action=snapshot"
          >
            <Input placeholder="http://..." />
          </Form.Item>
          <Form.Item name="snapshotUrl" label="快照 URL（可选）" extra="不填则使用上面的地址">
            <Input placeholder="http://..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

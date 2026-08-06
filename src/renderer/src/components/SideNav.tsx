import { startTransition, type ReactNode } from 'react'
import { Menu } from 'antd'
import {
  ApiOutlined,
  AppstoreOutlined,
  EnvironmentOutlined,
  ExperimentOutlined,
  InboxOutlined,
  RobotOutlined,
  SettingOutlined,
  ShopOutlined,
  ToolOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'
import { useDeviceStore, type AppSection } from '../stores/deviceStore'

const ITEMS: { key: AppSection; label: string; icon: ReactNode }[] = [
  { key: 'fdm', label: 'FDM', icon: <AppstoreOutlined /> },
  { key: 'resin', label: '光固化', icon: <ExperimentOutlined /> },
  { key: 'filament', label: '耗材管理', icon: <InboxOutlined /> },
  { key: 'api', label: 'API 服务', icon: <ApiOutlined /> },
  { key: 'tools', label: '常用工具', icon: <ToolOutlined /> },
  { key: 'monitorWall', label: '内部监控', icon: <VideoCameraOutlined /> },
  { key: 'monitorZones', label: '区域监控', icon: <EnvironmentOutlined /> },
  { key: 'models', label: '模型网站', icon: <ShopOutlined /> },
  { key: 'aiModels', label: 'AI 建模网', icon: <RobotOutlined /> },
  { key: 'settings', label: '软件设置', icon: <SettingOutlined /> }
]

export function SideNav() {
  const section = useDeviceStore((s) => s.section)
  const setSection = useDeviceStore((s) => s.setSection)

  return (
    <Menu
      mode="inline"
      selectedKeys={[section]}
      onClick={({ key }) => {
        startTransition(() => setSection(key as AppSection))
      }}
      style={{ background: 'transparent', border: 'none' }}
      items={ITEMS.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: item.label
      }))}
    />
  )
}

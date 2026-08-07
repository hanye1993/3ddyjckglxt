import { startTransition, type ReactNode, useMemo } from 'react'
import { Menu } from 'antd'
import {
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  EnvironmentOutlined,
  ExperimentOutlined,
  InboxOutlined,
  RobotOutlined,
  SettingOutlined,
  ShopOutlined,
  TeamOutlined,
  ToolOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'
import { useDeviceStore, type AppSection } from '../stores/deviceStore'
import { useAuthStore, useAuthGrants } from '../stores/authStore'

const ITEMS: { key: AppSection; label: string; icon: ReactNode; perm?: string; serverOnly?: boolean; clientHide?: boolean }[] = [
  { key: 'fdm', label: 'FDM', icon: <AppstoreOutlined />, perm: 'nav.devices' },
  { key: 'resin', label: '光固化', icon: <ExperimentOutlined />, perm: 'nav.devices' },
  { key: 'filament', label: '耗材管理', icon: <InboxOutlined />, perm: 'nav.filament' },
  { key: 'api', label: 'API 服务', icon: <ApiOutlined />, serverOnly: true },
  { key: 'tools', label: '常用工具', icon: <ToolOutlined />, perm: 'nav.tools' },
  { key: 'monitorWall', label: '内部监控', icon: <VideoCameraOutlined />, perm: 'nav.monitor' },
  { key: 'monitorZones', label: '区域监控', icon: <EnvironmentOutlined />, perm: 'nav.monitor' },
  { key: 'models', label: '模型网站', icon: <ShopOutlined /> },
  { key: 'aiModels', label: 'AI 建模网', icon: <RobotOutlined /> },
  { key: 'users', label: '用户权限', icon: <TeamOutlined />, perm: 'nav.users', serverOnly: true },
  { key: 'printApprove', label: '打印审核/队列', icon: <AuditOutlined />, perm: 'nav.printApprove' },
  { key: 'settings', label: '软件设置', icon: <SettingOutlined />, perm: 'nav.settings' }
]

export function SideNav() {
  const section = useDeviceStore((s) => s.section)
  const setSection = useDeviceStore((s) => s.setSection)
  const role = useAuthStore((s) => s.role)
  const { permissions, deviceAcl, can } = useAuthGrants()

  const items = useMemo(() => {
    return ITEMS.filter((item) => {
      if (item.serverOnly && role === 'client') return false
      if (item.clientHide && role === 'client') return false
      if (item.key === 'printApprove') {
        // Admins manage queue; requesters can open「我的打印任务」
        return (
          can('nav.printApprove') ||
          can('print.approve') ||
          can('device.action.print.request') ||
          can('device.action.print')
        )
      }
      if (item.perm && !can(item.perm)) return false
      return true
    }).map((item) => ({
      key: item.key,
      icon: item.icon,
      label: item.label
    }))
  }, [role, can, permissions, deviceAcl])

  return (
    <Menu
      mode="inline"
      selectedKeys={[section]}
      onClick={({ key }) => {
        startTransition(() => setSection(key as AppSection))
      }}
      style={{ background: 'transparent', border: 'none' }}
      items={items}
    />
  )
}

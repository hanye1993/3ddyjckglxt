import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  ColorPicker,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Typography,
  message
} from 'antd'
import {
  FolderOpenOutlined,
  InfoCircleOutlined,
  PictureOutlined,
  ReloadOutlined,
  SelectOutlined
} from '@ant-design/icons'
import { useDeviceStore } from '../stores/deviceStore'
import { useFilamentStore } from '../stores/filamentStore'
import { useSettingsStore, type UiBgMode, type UiThemeId } from '../stores/settingsStore'
import { UI_THEMES, applyAppearance } from '../theme/appearance'

const APP_VERSION = '0.3.0'

export function SoftSettingsPage() {
  const [dataRoot, setDataRoot] = useState('')
  const [defaultRoot, setDefaultRoot] = useState('')
  const [downloads, setDownloads] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [busy, setBusy] = useState(false)
  const [migrate, setMigrate] = useState(true)
  const [pickingBg, setPickingBg] = useState(false)

  const deviceInit = useDeviceStore((s) => s.init)
  const filamentInit = useFilamentStore((s) => s.init)
  const settings = useSettingsStore((s) => s.settings)
  const saving = useSettingsStore((s) => s.saving)
  const patchLocal = useSettingsStore((s) => s.patchLocal)
  const save = useSettingsStore((s) => s.save)
  const settingsInit = useSettingsStore((s) => s.init)

  const refresh = async () => {
    const info = await window.electronAPI?.dataRoot?.get()
    if (!info) return
    setDataRoot(info.root)
    setDefaultRoot(info.defaultRoot)
    setDownloads(info.downloads)
    setIsCustom(info.isCustom)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const reloadStores = async () => {
    await Promise.all([deviceInit(), filamentInit(), settingsInit()])
  }

  const openDataRoot = async () => {
    const ok = await window.electronAPI?.dataRoot?.open()
    if (!ok) message.error('无法打开数据目录')
  }

  const openDownloads = async () => {
    const ok = await window.electronAPI?.localFiles?.openDir()
    if (!ok) message.error('无法打开下载目录')
  }

  const chooseAndSet = async () => {
    const picked = await window.electronAPI?.dataRoot?.choose()
    if (!picked || !picked.ok) return

    Modal.confirm({
      title: '切换数据目录',
      content: (
        <div>
          <p>新目录：</p>
          <Typography.Text code>{picked.path}</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            {migrate
              ? '将复制当前设备 / 耗材 / 设置等到新目录（不删除旧目录）。'
              : '仅切换目录指针，不会复制旧数据。'}
            可在上方开关修改「切换时迁移数据」。
          </Typography.Paragraph>
        </div>
      ),
      okText: '确认切换',
      cancelText: '取消',
      onOk: async () => {
        setBusy(true)
        try {
          const res = await window.electronAPI?.dataRoot?.set({
            path: picked.path,
            migrate
          })
          if (!res?.ok) {
            message.error(res?.message || '切换失败')
            return
          }
          message.success(res.message)
          await refresh()
          await reloadStores()
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const resetDefault = () => {
    Modal.confirm({
      title: '恢复默认数据目录',
      content: `将切回：${defaultRoot || '应用默认目录'}。可选择是否把当前数据迁回去。`,
      okText: '恢复默认',
      cancelText: '取消',
      onOk: async () => {
        setBusy(true)
        try {
          const res = await window.electronAPI?.dataRoot?.set({
            reset: true,
            migrate
          })
          if (!res?.ok) {
            message.error(res?.message || '恢复失败')
            return
          }
          message.success(res.message)
          await refresh()
          await reloadStores()
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const persistAppearance = async (partial: {
    uiTheme?: UiThemeId
    uiBgMode?: UiBgMode
    uiBgColor?: string
    uiBgImage?: string
  }) => {
    const next = { ...useSettingsStore.getState().settings, ...partial }
    patchLocal(partial)
    applyAppearance({
      themeId: next.uiTheme,
      bgMode: next.uiBgMode,
      bgColor: next.uiBgColor,
      bgImage: next.uiBgImage
    })
    await save(partial)
    // 保存回写后再刷一次，避免短暂被默认主题覆盖
    const s = useSettingsStore.getState().settings
    applyAppearance({
      themeId: s.uiTheme,
      bgMode: s.uiBgMode,
      bgColor: s.uiBgColor,
      bgImage: s.uiBgImage
    })
  }

  const pickBgImage = async () => {
    setPickingBg(true)
    try {
      const res = await window.electronAPI?.settings?.pickBackgroundImage()
      if (!res?.ok) {
        if (res?.message && res.message !== '已取消') message.error(res.message)
        return
      }
      await persistAppearance({ uiBgMode: 'image', uiBgImage: res.dataUrl })
      message.success('背景图片已应用')
    } finally {
      setPickingBg(false)
    }
  }

  return (
    <div className="settings-page">
      <Typography.Title level={4} className="settings-page-title">
        软件设置
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="settings-page-desc">
        开机自启、偏好、主题与背景。
      </Typography.Paragraph>

      <Card className="settings-card" title="关于">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div className="settings-row">
            <div className="settings-row-label">
              <Typography.Text strong>hanye-3D打印机监控台</Typography.Text>
              <Typography.Text type="secondary">版本 v{APP_VERSION}</Typography.Text>
            </div>
            <InfoCircleOutlined style={{ fontSize: 18, opacity: 0.55 }} />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              介绍
            </Typography.Text>
            <Typography.Text>
              统一监控 Klipper / 拓竹 / 创想等 FDM 与光固化设备，管理耗材料卷，并提供内部监控、区域摄像头与开放 API。
            </Typography.Text>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              开发者
            </Typography.Text>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              B站：
              <Typography.Link
                onClick={() =>
                  void window.electronAPI?.shell?.openExternal(
                    'https://search.bilibili.com/all?keyword=%E5%B0%8F%E6%B1%89%E6%95%85%E4%BA%8B'
                  )
                }
              >
                @小汉故事
              </Typography.Link>
              <br />
              QQ：
              <Typography.Text copyable={{ text: '2500689358' }}>2500689358</Typography.Text>
              <br />
              群号：
              <Typography.Text copyable={{ text: '1053838529' }}>1053838529</Typography.Text>
            </Typography.Paragraph>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              感谢
            </Typography.Text>
            <Typography.Text>时空之树测试反馈</Typography.Text>
          </div>
        </Space>
      </Card>

      <Card className="settings-card" title="开机与偏好" loading={saving && busy}>
        <div className="settings-row" style={{ marginBottom: 12 }}>
          <div className="settings-row-label">
            <Typography.Text strong>设备状态刷新间隔</Typography.Text>
            <Typography.Text type="secondary">
              轮询类设备多久更新一次状态（Klipper 备用拉取、闪铸 / Snapmaker / 纵维等）。拓竹 MQTT
              推送不受影响。修改后会重连设备。
            </Typography.Text>
          </div>
          <Select
            style={{ width: 120 }}
            value={settings.deviceRefreshSec}
            options={[
              { value: 1, label: '1 秒' },
              { value: 2, label: '2 秒' },
              { value: 3, label: '3 秒' },
              { value: 5, label: '5 秒' },
              { value: 8, label: '8 秒' },
              { value: 10, label: '10 秒' },
              { value: 15, label: '15 秒' },
              { value: 30, label: '30 秒' },
              { value: 60, label: '60 秒' }
            ]}
            onChange={(v) => {
              void (async () => {
                await save({ deviceRefreshSec: Number(v) || 3 })
                message.success('已保存，正在按新间隔重连设备…')
                void useDeviceStore.getState().reconnectAll()
              })()
            }}
          />
        </div>
        <div className="settings-row" style={{ marginBottom: 12 }}>
          <div className="settings-row-label">
            <Typography.Text strong>开机自启</Typography.Text>
            <Typography.Text type="secondary">登录 Windows 后自动启动本软件</Typography.Text>
          </div>
          <Switch
            checked={settings.openAtLogin}
            onChange={(v) => {
              void (async () => {
                patchLocal({ openAtLogin: v })
                await save({ openAtLogin: v })
                message.success(v ? '已开启开机自启' : '已关闭开机自启')
              })()
            }}
          />
        </div>
        <div className="settings-row" style={{ marginBottom: 12 }}>
          <div className="settings-row-label">
            <Typography.Text strong>关闭时最小化到托盘</Typography.Text>
            <Typography.Text type="secondary">点窗口关闭时隐藏到系统托盘，而不是退出</Typography.Text>
          </div>
          <Switch
            checked={settings.minimizeToTray}
            onChange={(v) => {
              void (async () => {
                patchLocal({ minimizeToTray: v })
                await save({ minimizeToTray: v })
              })()
            }}
          />
        </div>
        <div className="settings-row" style={{ marginBottom: 12 }}>
          <div className="settings-row-label">
            <Typography.Text strong>设备异常通知</Typography.Text>
            <Typography.Text type="secondary">健康状态变为错误时弹出系统通知</Typography.Text>
          </div>
          <Switch
            checked={settings.notifyOnError}
            onChange={(v) => {
              void save({ notifyOnError: v })
            }}
          />
        </div>
        <div className="settings-row" style={{ marginBottom: 12 }}>
          <div className="settings-row-label">
            <Typography.Text strong>打印完成通知</Typography.Text>
            <Typography.Text type="secondary">打印结束时提醒</Typography.Text>
          </div>
          <Switch
            checked={settings.notifyOnPrintDone}
            onChange={(v) => {
              void save({ notifyOnPrintDone: v })
            }}
          />
        </div>
        <div className="settings-row" style={{ marginBottom: 12 }}>
          <div className="settings-row-label">
            <Typography.Text strong>空闲通知</Typography.Text>
            <Typography.Text type="secondary">设备回到空闲时提醒（默认关闭）</Typography.Text>
          </div>
          <Switch
            checked={settings.notifyOnIdle}
            onChange={(v) => {
              void save({ notifyOnIdle: v })
            }}
          />
        </div>
        <div className="settings-row" style={{ marginBottom: 12 }}>
          <div className="settings-row-label">
            <Typography.Text strong>低库存通知</Typography.Text>
            <Typography.Text type="secondary">耗材料卷低于阈值时提醒</Typography.Text>
          </div>
          <Switch
            checked={settings.notifyOnLowFilament}
            onChange={(v) => {
              void save({ notifyOnLowFilament: v })
            }}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <Typography.Text strong>耗材自动扣减</Typography.Text>
            <Typography.Text type="secondary">
              打印完成时扣减已绑定料卷（AMS 按剩余%；单色/外挂自动读任务用量）
            </Typography.Text>
          </div>
          <Switch
            checked={settings.amsAutoDeduct}
            onChange={(v) => {
              void save({ amsAutoDeduct: v })
            }}
          />
        </div>
      </Card>

      <Card className="settings-card" title="主题">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          共 5 套主题；默认「午夜蓝」为当前风格。切换后立即生效并保存。
        </Typography.Paragraph>
        <div className="theme-picker-grid">
          {UI_THEMES.map((t) => {
            const active = settings.uiTheme === t.id
            return (
              <button
                key={t.id}
                type="button"
                className={`theme-picker-card${active ? ' is-active' : ''}`}
                onClick={() => {
                  void persistAppearance({ uiTheme: t.id })
                }}
              >
                <div className="theme-picker-swatches">
                  {t.swatch.map((c) => (
                    <span key={c} style={{ background: c }} />
                  ))}
                </div>
                <div className="theme-picker-meta">
                  <Typography.Text strong>{t.name}</Typography.Text>
                  <Typography.Text type="secondary">{t.desc}</Typography.Text>
                </div>
              </button>
            )
          })}
        </div>
      </Card>

      <Card className="settings-card" title="背景">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          默认沿用当前主题渐变；也可换成纯色或自定义图片。
        </Typography.Paragraph>
        <Radio.Group
          value={settings.uiBgMode}
          optionType="button"
          buttonStyle="solid"
          style={{ marginBottom: 16 }}
          onChange={(e) => {
            void persistAppearance({ uiBgMode: e.target.value as UiBgMode })
          }}
          options={[
            { value: 'default', label: '默认渐变' },
            { value: 'color', label: '纯色' },
            { value: 'image', label: '图片' }
          ]}
        />

        {settings.uiBgMode === 'color' ? (
          <div className="settings-field">
            <Typography.Text strong>背景颜色</Typography.Text>
            <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
              <ColorPicker
                value={settings.uiBgColor}
                showText
                onChangeComplete={(c) => {
                  const hex = c.toHexString()
                  void persistAppearance({ uiBgColor: hex, uiBgMode: 'color' })
                }}
              />
              <Input
                value={settings.uiBgColor}
                style={{ maxWidth: 140 }}
                onChange={(e) => patchLocal({ uiBgColor: e.target.value })}
                onBlur={() => {
                  if (/^#[0-9a-fA-F]{3,8}$/.test(settings.uiBgColor)) {
                    void persistAppearance({ uiBgColor: settings.uiBgColor })
                  }
                }}
              />
            </div>
          </div>
        ) : null}

        {settings.uiBgMode === 'image' ? (
          <div className="settings-field">
            <Typography.Text strong>背景图片</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              建议使用暗色或低对比图片，过大文件会被拒绝（约 &lt; 1.5MB）。
            </Typography.Paragraph>
            <Space wrap>
              <Button
                type="primary"
                icon={<PictureOutlined />}
                loading={pickingBg}
                onClick={() => void pickBgImage()}
              >
                选择图片…
              </Button>
              <Button
                disabled={!settings.uiBgImage}
                onClick={() => {
                  void persistAppearance({ uiBgImage: '', uiBgMode: 'default' })
                }}
              >
                清除并恢复默认
              </Button>
            </Space>
            {settings.uiBgImage ? (
              <div
                className="bg-preview"
                style={{ backgroundImage: `url("${settings.uiBgImage}")` }}
              />
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="settings-card" title="本地数据">
        <div className="settings-field">
          <Typography.Text strong>数据目录</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }} copyable={!!dataRoot}>
            {dataRoot || '加载中…'}
          </Typography.Paragraph>
          <Typography.Text type="secondary">
            设备列表、耗材、软件设置、密钥、操作日志、下载文件等保存在此目录
            {isCustom ? '（自定义）' : '（默认）'}。
          </Typography.Text>
        </div>

        <div className="settings-field">
          <Typography.Text strong>下载子目录</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }} copyable={!!downloads}>
            {downloads || '—'}
          </Typography.Paragraph>
        </div>

        <div className="settings-row" style={{ marginBottom: 12 }}>
          <div className="settings-row-label">
            <Typography.Text strong>切换时迁移数据</Typography.Text>
            <Typography.Text type="secondary">复制现有数据到新目录（不删除旧目录）</Typography.Text>
          </div>
          <Switch checked={migrate} onChange={setMigrate} />
        </div>

        <Space wrap>
          <Button icon={<FolderOpenOutlined />} onClick={() => void openDataRoot()}>
            打开数据目录
          </Button>
          <Button icon={<FolderOpenOutlined />} onClick={() => void openDownloads()}>
            打开下载目录
          </Button>
          <Button
            type="primary"
            icon={<SelectOutlined />}
            loading={busy}
            onClick={() => void chooseAndSet()}
          >
            选择目录…
          </Button>
          <Button
            icon={<ReloadOutlined />}
            disabled={!isCustom}
            loading={busy}
            onClick={resetDefault}
          >
            恢复默认
          </Button>
        </Space>
      </Card>
    </div>
  )
}

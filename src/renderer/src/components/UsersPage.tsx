import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message
} from 'antd'
import {
  defaultPermissions,
  DEVICE_ACTION_PERMS,
  DEVICE_GLOBAL_PERMS,
  FILAMENT_PERMS,
  LEVEL_LABELS,
  NAV_PERMS,
  PERM_LABELS,
  PRINT_APPROVE_PERMS,
  type AuthUserPublic,
  type UserLevel
} from '@shared/permissions'
import { SSO_PROVIDER_LABELS, type SsoProviderId, type SsoProviderOption } from '@shared/sso'
import { useDeviceStore } from '../stores/deviceStore'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'

const ALL_GLOBAL = [
  ...NAV_PERMS,
  ...DEVICE_GLOBAL_PERMS,
  ...FILAMENT_PERMS,
  ...PRINT_APPROVE_PERMS
]

function globalPermsOnly(list: string[]): string[] {
  return list.filter((p) => !p.startsWith('device.action.'))
}

export function UsersPage() {
  const role = useAuthStore((s) => s.role)
  const devices = useDeviceStore((s) => s.devices)
  const [users, setUsers] = useState<AuthUserPublic[]>([])
  const [loading, setLoading] = useState(false)
  const [edit, setEdit] = useState<AuthUserPublic | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      if (role === 'server') {
        const res = await window.electronAPI?.auth?.localUsers?.()
        if (res?.ok) setUsers((res.users || []) as AuthUserPublic[])
        else message.error(res?.message || '加载失败')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [role])

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 16 }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          用户与权限
        </Typography.Title>
        <Button type="primary" onClick={() => setCreating(true)}>
          新建用户
        </Button>
        <Button onClick={() => void reload()}>刷新</Button>
      </Space>
      <Typography.Paragraph type="secondary">
        服务端本机免登录管理。默认管理员 <code>admin</code> / <code>admin123</code>，请及时改密。
        可为用户勾选全局权限，并按设备单独授权操作。
      </Typography.Paragraph>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={users}
        pagination={false}
        columns={[
          { title: '用户名', dataIndex: 'username' },
          { title: '显示名', dataIndex: 'displayName' },
          {
            title: '等级',
            dataIndex: 'level',
            render: (lv: UserLevel) => LEVEL_LABELS[lv] || lv
          },
          {
            title: '状态',
            dataIndex: 'enabled',
            render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag>禁用</Tag>)
          },
          {
            title: '权限数',
            render: (_: unknown, r: AuthUserPublic) => r.permissions?.length || 0
          },
          {
            title: '对接',
            render: (_: unknown, r: AuthUserPublic) => {
              const p = r.ssoProvider || 'none'
              if (p === 'none') return <Typography.Text type="secondary">本地</Typography.Text>
              return (
                <Tag>
                  {SSO_PROVIDER_LABELS[p as SsoProviderId] || p}
                  {r.ssoExternalId ? ` · ${r.ssoExternalId}` : ''}
                </Tag>
              )
            }
          },
          {
            title: '操作',
            render: (_: unknown, r: AuthUserPublic) => (
              <Space>
                <Button size="small" onClick={() => setEdit(r)}>
                  编辑
                </Button>
                <Button
                  size="small"
                  danger
                  onClick={async () => {
                    const res = await window.electronAPI?.auth?.localDeleteUser?.(r.id)
                    if (res?.ok) {
                      message.success('已删除')
                      void reload()
                    } else message.error(res?.message || '删除失败')
                  }}
                >
                  删除
                </Button>
              </Space>
            )
          }
        ]}
      />

      <UserEditor
        open={creating || !!edit}
        user={edit}
        devices={devices.map((d) => ({ id: d.id, name: d.name }))}
        onCancel={() => {
          setCreating(false)
          setEdit(null)
        }}
        onSaved={() => {
          setCreating(false)
          setEdit(null)
          void reload()
        }}
      />
    </div>
  )
}

function UserEditor(props: {
  open: boolean
  user: AuthUserPublic | null
  devices: Array<{ id: string; name: string }>
  onCancel: () => void
  onSaved: () => void
}) {
  const isNew = !props.user
  const [form] = Form.useForm()
  const [perms, setPerms] = useState<string[]>([])
  const [deviceAcl, setDeviceAcl] = useState<Record<string, string[]>>({})
  const [ssoProvider, setSsoProvider] = useState<'none' | SsoProviderId>('none')
  const [ssoExternalId, setSsoExternalId] = useState('')
  const [saving, setSaving] = useState(false)
  const sso = useSettingsStore((s) => s.settings.sso)

  const ssoOptions = useMemo(() => {
    const list: SsoProviderOption[] = []
    if (sso.wecom.enabled) {
      list.push({
        id: 'wecom',
        label: SSO_PROVIDER_LABELS.wecom,
        scanLogin: true,
        enabled: true,
        configured: Boolean(sso.wecom.corpId && sso.wecom.secret)
      })
    }
    if (sso.dingtalk.enabled) {
      list.push({
        id: 'dingtalk',
        label: SSO_PROVIDER_LABELS.dingtalk,
        scanLogin: true,
        enabled: true,
        configured: Boolean(sso.dingtalk.appKey && sso.dingtalk.appSecret)
      })
    }
    if (sso.ad.enabled) {
      list.push({
        id: 'ad',
        label: SSO_PROVIDER_LABELS.ad,
        scanLogin: false,
        enabled: true,
        configured: Boolean(sso.ad.ldapUrl && sso.ad.baseDn)
      })
    }
    return list
  }, [sso])

  useEffect(() => {
    if (!props.open) return
    if (props.user) {
      form.setFieldsValue({
        username: props.user.username,
        displayName: props.user.displayName,
        level: props.user.level,
        enabled: props.user.enabled,
        password: ''
      })
      setPerms(globalPermsOnly(props.user.permissions || []))
      setDeviceAcl(props.user.deviceAcl || {})
      setSsoProvider((props.user.ssoProvider as 'none' | SsoProviderId) || 'none')
      setSsoExternalId(props.user.ssoExternalId || '')
    } else {
      form.setFieldsValue({
        username: '',
        displayName: '',
        level: 'viewer',
        enabled: true,
        password: ''
      })
      setPerms(globalPermsOnly(defaultPermissions('viewer')))
      setDeviceAcl({})
      setSsoProvider('none')
      setSsoExternalId('')
    }
  }, [props.open, props.user, form])

  const deviceOptions = useMemo(() => props.devices, [props.devices])

  return (
    <Modal
      title={isNew ? '新建用户' : `编辑用户 · ${props.user?.username}`}
      open={props.open}
      onCancel={props.onCancel}
      width={820}
      confirmLoading={saving}
      onOk={async () => {
        const vals = await form.validateFields()
        if (sso.requireBinding && (ssoProvider === 'none' || !ssoExternalId.trim())) {
          message.error('已开启强制绑定，请选择企微/钉钉/AD 并填写对接账号')
          return
        }
        setSaving(true)
        try {
          const payload = {
            id: props.user?.id,
            username: vals.username,
            displayName: vals.displayName,
            level: vals.level as UserLevel,
            enabled: vals.enabled !== false,
            password: vals.password || undefined,
            permissions: globalPermsOnly(perms),
            deviceAcl,
            ssoProvider,
            ssoExternalId: ssoProvider === 'none' ? '' : ssoExternalId
          }
          const res = await window.electronAPI?.auth?.localUpsertUser?.(payload)
          if (!res?.ok) {
            message.error(res?.message || '保存失败')
            return
          }
          message.success('已保存')
          props.onSaved()
        } finally {
          setSaving(false)
        }
      }}
    >
      <Form form={form} layout="vertical">
        {isNew ? (
          <Form.Item label="用户名" name="username" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        ) : null}
        <Form.Item label="显示名" name="displayName">
          <Input />
        </Form.Item>
        <Form.Item label="等级" name="level" rules={[{ required: true }]}>
          <Select
            options={(Object.keys(LEVEL_LABELS) as UserLevel[]).map((k) => ({
              value: k,
              label: LEVEL_LABELS[k]
            }))}
            onChange={(lv: UserLevel) => setPerms(globalPermsOnly(defaultPermissions(lv)))}
          />
        </Form.Item>
        <Form.Item label={isNew ? '密码' : '新密码（留空不改）'} name="password" rules={isNew ? [{ required: true }] : []}>
          <Input.Password />
        </Form.Item>
        <Form.Item label="启用" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>

      <Typography.Text strong>账号对接（单选）</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ margin: '4px 0 8px', fontSize: 12 }}>
        {sso.requireBinding
          ? '服务端已开启强制绑定：必须选择一种对接并填写外部账号。'
          : '在软件设置中启用企微 / 钉钉 / AD 后可选。绑定后可用对应方式登录（扫码或域密码）。'}
      </Typography.Paragraph>
      <Radio.Group
        style={{ marginBottom: 8 }}
        value={ssoProvider}
        onChange={(e) => {
          setSsoProvider(e.target.value)
          if (e.target.value === 'none') setSsoExternalId('')
        }}
        options={[
          { value: 'none', label: '不对接（仅本地密码）' },
          ...ssoOptions.map((p) => ({
            value: p.id,
            label: `${p.label}${p.scanLogin ? ' · 可扫码' : ' · 域密码'}${p.configured ? '' : '（未配完）'}`
          }))
        ]}
      />
      {ssoProvider !== 'none' ? (
        <Input
          style={{ marginBottom: 16 }}
          placeholder={
            ssoProvider === 'ad'
              ? 'AD 账号（sAMAccountName）'
              : ssoProvider === 'wecom'
                ? '企微 UserId'
                : '钉钉 unionId / userId'
          }
          value={ssoExternalId}
          onChange={(e) => setSsoExternalId(e.target.value)}
        />
      ) : (
        <div style={{ marginBottom: 16 }} />
      )}
      {ssoOptions.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          尚未启用任何对接模块，请到「软件设置 → 企微 / 钉钉 / AD 对接」配置。
        </Typography.Paragraph>
      ) : null}

      <Typography.Text strong>全局权限（可单独勾选）</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ margin: '4px 0 8px', fontSize: 12 }}>
        导航、设备管理、耗材与审核等；打印机上的暂停/归零/进料等操作请在下方按设备勾选。
      </Typography.Paragraph>
      <div style={{ maxHeight: 220, overflow: 'auto', margin: '8px 0 16px', border: '1px solid #333', padding: 8 }}>
        <Checkbox.Group
          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
          value={perms.filter((p) => ALL_GLOBAL.includes(p as (typeof ALL_GLOBAL)[number]))}
          onChange={(v) => {
            // Keep non-UI legacy codes out of global list; device actions live only in deviceAcl
            const next = (v as string[]).filter((p) => !p.startsWith('device.action.'))
            setPerms(next)
          }}
          options={ALL_GLOBAL.map((p) => ({
            value: p,
            label: PERM_LABELS[p] || p
          }))}
        />
      </div>

      <Typography.Text strong>按设备授权</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ margin: '4px 0 8px', fontSize: 12 }}>
        开启设备后，该用户只能看到已开启的设备；暂停、归零、急停、进料等
        <Typography.Text strong> 操作权限只在该设备下方勾选 </Typography.Text>
        。全部关闭设备开关时，若有「查看设备」全局权限则可看到全部设备，但仍须开启设备并勾选操作才能控制。
      </Typography.Paragraph>
      <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 8 }}>
        {deviceOptions.map((d) => {
          const selected = deviceAcl[d.id] || []
          const active = d.id in deviceAcl
          return (
            <div key={d.id} style={{ marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #2a2a2a' }}>
              <Space wrap>
                <Switch
                  size="small"
                  checked={active}
                  onChange={(on) => {
                    setDeviceAcl((prev) => {
                      const next = { ...prev }
                      if (on) next[d.id] = ['view']
                      else delete next[d.id]
                      return next
                    })
                  }}
                />
                <Typography.Text>{d.name}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {d.id}
                </Typography.Text>
                {active ? (
                  <>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => {
                        setDeviceAcl((prev) => ({
                          ...prev,
                          [d.id]: ['view', ...DEVICE_ACTION_PERMS]
                        }))
                      }}
                    >
                      全选操作
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => {
                        setDeviceAcl((prev) => ({ ...prev, [d.id]: ['view'] }))
                      }}
                    >
                      仅查看
                    </Button>
                  </>
                ) : null}
              </Space>
              {active ? (
                <Checkbox.Group
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}
                  value={selected}
                  onChange={(v) => {
                    const list = v as string[]
                    const next = list.includes('view') ? list : ['view', ...list]
                    setDeviceAcl((prev) => ({ ...prev, [d.id]: next }))
                  }}
                  options={[
                    { value: 'view', label: '查看（仅卡片，不可进控制）' },
                    ...DEVICE_ACTION_PERMS.map((a) => ({
                      value: a,
                      label: PERM_LABELS[`device.action.${a}`] || a
                    }))
                  ]}
                />
              ) : null}
            </div>
          )
        })}
        {!deviceOptions.length ? (
          <Typography.Text type="secondary">暂无设备</Typography.Text>
        ) : null}
      </div>
    </Modal>
  )
}

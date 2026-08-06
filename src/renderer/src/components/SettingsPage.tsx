import { useEffect, useMemo } from 'react'
import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Switch,
  Typography,
  message
} from 'antd'
import { CopyOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../stores/settingsStore'

export function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings)
  const status = useSettingsStore((s) => s.status)
  const loading = useSettingsStore((s) => s.loading)
  const saving = useSettingsStore((s) => s.saving)
  const hskBusy = useSettingsStore((s) => s.hskBusy)
  const hskDomains = useSettingsStore((s) => s.hskDomains)
  const init = useSettingsStore((s) => s.init)
  const patchLocal = useSettingsStore((s) => s.patchLocal)
  const setAccessMode = useSettingsStore((s) => s.setAccessMode)
  const save = useSettingsStore((s) => s.save)
  const generateApiKey = useSettingsStore((s) => s.generateApiKey)
  const refreshStatus = useSettingsStore((s) => s.refreshStatus)
  const fetchHskMeta = useSettingsStore((s) => s.fetchHskMeta)
  const syncHskMapping = useSettingsStore((s) => s.syncHskMapping)
  const exportFrpcConfig = useSettingsStore((s) => s.exportFrpcConfig)
  const getFrpcToml = useSettingsStore((s) => s.getFrpcToml)

  const isLocal = settings.apiAccessMode === 'local'
  const isSunlogin = settings.apiAccessMode === 'sunlogin'
  const isFrpc = settings.apiAccessMode === 'frpc'

  useEffect(() => {
    void init()
  }, [init])

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success('已复制')
    } catch {
      message.error('复制失败')
    }
  }

  const openUrl = (url: string) => {
    void window.electronAPI?.shell?.openExternal(url)
  }

  const accessLabel = isFrpc ? 'Frpc 内网穿透' : isSunlogin ? '向日葵穿透' : '本地 API'
  const externalBase = isFrpc
    ? status?.frpcUrl
    : isSunlogin
      ? status?.hskUrl
      : status?.domainUrl || status?.publicUrl

  const exampleSummary = useMemo(() => {
    if (!externalBase) return ''
    return `curl -H "X-Api-Key: ${settings.apiKey}" "${externalBase}/api/v1/summary"`
  }, [externalBase, settings.apiKey])

  const onFetchHsk = async () => {
    const res = await fetchHskMeta()
    if (res.ok) message.success('已拉取账号信息')
    else message.error(res.message || '拉取失败')
  }

  const onSyncHsk = async () => {
    const res = await syncHskMapping()
    if (res.ok) message.success('映射已创建或同步')
    else message.error(res.message || '同步失败')
  }

  const onExportFrpc = async () => {
    const res = await exportFrpcConfig()
    if (res.ok) message.success(res.path ? `已导出：${res.path}` : '已导出 frpc.toml')
    else message.error(res.message || '导出失败')
  }

  const onCopyFrpcToml = async () => {
    const toml = await getFrpcToml()
    if (!toml) {
      message.error('无法生成配置')
      return
    }
    await copy(toml)
  }

  return (
    <div className="settings-page">
      <Typography.Title level={4} className="settings-page-title">
        API 服务
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="settings-page-desc">
        将本软件作为局域网 / 公网 API 服务端，供外部系统读取设备与耗材数据。
      </Typography.Paragraph>

      <Card
        className="settings-card"
        title="API 服务"
        loading={loading}
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void refreshStatus()}>
            刷新状态
          </Button>
        }
      >
        <div className="settings-row">
          <div className="settings-row-label">
            <Typography.Text strong>启用 API</Typography.Text>
            <Typography.Text type="secondary">监听 0.0.0.0，局域网可访问</Typography.Text>
          </div>
          <Switch
            checked={settings.apiEnabled}
            onChange={(v) => patchLocal({ apiEnabled: v })}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <Typography.Text strong>权限模式</Typography.Text>
            <Typography.Text type="secondary">只读仅拉取数据；可控制可远程操作打印机</Typography.Text>
          </div>
          <Radio.Group
            value={settings.apiMode}
            onChange={(e) => patchLocal({ apiMode: e.target.value })}
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'readonly', label: '只读' },
              { value: 'control', label: '可控制' }
            ]}
          />
        </div>

        {settings.apiMode === 'control' ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="可控制模式风险"
            description="外网可达时等同远程操控打印机，请务必保管 API Key，并仅在可信网络开启。"
          />
        ) : null}

        <div className="settings-field">
          <Typography.Text strong>端口</Typography.Text>
          <InputNumber
            min={1}
            max={65535}
            value={settings.apiPort}
            onChange={(v) => patchLocal({ apiPort: Number(v || 17890) })}
            style={{ width: 160 }}
          />
        </div>

        <div className="settings-field">
          <Typography.Text strong>API Key</Typography.Text>
          <Space.Compact style={{ width: '100%', maxWidth: 520 }}>
            <Input
              value={settings.apiKey}
              onChange={(e) => patchLocal({ apiKey: e.target.value })}
            />
            <Button icon={<CopyOutlined />} onClick={() => void copy(settings.apiKey)}>
              复制
            </Button>
            <Button onClick={generateApiKey}>重新生成</Button>
          </Space.Compact>
          <Typography.Text type="secondary">请求头：X-Api-Key</Typography.Text>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <Typography.Text strong>外网接入</Typography.Text>
            <Typography.Text type="secondary">本地公网、向日葵穿透或 Frpc</Typography.Text>
          </div>
          <Radio.Group
            value={settings.apiAccessMode}
            onChange={(e) => setAccessMode(e.target.value)}
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'local', label: '本地 API' },
              { value: 'sunlogin', label: '向日葵穿透' },
              { value: 'frpc', label: 'Frpc 穿透' }
            ]}
          />
        </div>

        {isLocal ? (
          <>
            <div className="settings-field">
              <Typography.Text strong>公网 IP（选填）</Typography.Text>
              <Input
                placeholder="例如 203.0.113.10"
                value={settings.publicIp}
                onChange={(e) => patchLocal({ publicIp: e.target.value })}
                style={{ maxWidth: 320 }}
              />
            </div>
            <div className="settings-field">
              <Typography.Text strong>域名（选填）</Typography.Text>
              <Input
                placeholder="例如 api.example.com 或 https://api.example.com"
                value={settings.domain}
                onChange={(e) => patchLocal({ domain: e.target.value })}
                style={{ maxWidth: 420 }}
              />
            </div>
          </>
        ) : null}

        {isSunlogin ? (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="向日葵 / 贝锐内网穿透"
              description={
                <div className="settings-hsk-steps">
                  <div>1. 安装并登录向日葵或花生壳客户端（穿透由客户端完成）</div>
                  <div>2. 在贝锐管理平台创建映射 API Key</div>
                  <div>3. 启用上方 API 并保存后，在此同步映射到 127.0.0.1:{settings.apiPort}</div>
                  <Space wrap style={{ marginTop: 8 }}>
                    <Button
                      size="small"
                      icon={<LinkOutlined />}
                      onClick={() => openUrl('https://sunlogin.oray.com/')}
                    >
                      向日葵官网
                    </Button>
                    <Button
                      size="small"
                      icon={<LinkOutlined />}
                      onClick={() => openUrl('https://hsk.oray.com/')}
                    >
                      花生壳官网
                    </Button>
                    <Button
                      size="small"
                      icon={<LinkOutlined />}
                      onClick={() => openUrl('https://service.oray.com/question/50663.html')}
                    >
                      映射 API 说明
                    </Button>
                  </Space>
                </div>
              }
            />

            <div className="settings-field">
              <Typography.Text strong>穿透 API Key</Typography.Text>
              <Input.Password
                placeholder="贝锐管理平台 → API keys"
                value={settings.hskApiKey}
                onChange={(e) => patchLocal({ hskApiKey: e.target.value })}
                style={{ maxWidth: 520 }}
              />
            </div>

            <div className="settings-field">
              <Typography.Text strong>映射类型</Typography.Text>
              <Radio.Group
                value={settings.hskFwType}
                onChange={(e) => patchLocal({ hskFwType: e.target.value })}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { value: 2, label: 'HTTP' },
                  { value: 1, label: 'TCP' },
                  { value: 3, label: 'HTTPS' }
                ]}
              />
            </div>

            <div className="settings-field">
              <Typography.Text strong>穿透域名</Typography.Text>
              <Space wrap>
                <Select
                  showSearch
                  allowClear
                  placeholder="先拉取账号信息"
                  value={settings.hskDomain || undefined}
                  onChange={(v) => patchLocal({ hskDomain: v || '' })}
                  style={{ minWidth: 280 }}
                  options={
                    hskDomains.length
                      ? hskDomains.map((d) => ({ value: d.domainname, label: d.domainname }))
                      : settings.hskDomain
                        ? [{ value: settings.hskDomain, label: settings.hskDomain }]
                        : []
                  }
                />
                <Input
                  placeholder="或手动输入域名"
                  value={settings.hskDomain}
                  onChange={(e) => patchLocal({ hskDomain: e.target.value })}
                  style={{ width: 240 }}
                />
              </Space>
            </div>

            <Space wrap style={{ marginBottom: 16 }}>
              <Button loading={hskBusy || saving} onClick={() => void onFetchHsk()}>
                拉取账号信息
              </Button>
              <Button
                type="primary"
                loading={hskBusy || saving}
                disabled={!settings.hskApiKey.trim() || !settings.hskDomain.trim()}
                onClick={() => void onSyncHsk()}
              >
                创建或同步映射
              </Button>
            </Space>
          </>
        ) : null}

        {isFrpc ? (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Frpc 内网穿透"
              description={
                <div className="settings-hsk-steps">
                  <div>1. 自备 frps 服务端，本机运行 frpc 客户端</div>
                  <div>2. 填写下方参数并保存，导出或复制 frpc.toml</div>
                  <div>
                    3. 执行 <code>frpc -c frpc.toml</code>，将流量转到 127.0.0.1:{settings.apiPort}
                  </div>
                  <Space wrap style={{ marginTop: 8 }}>
                    <Button
                      size="small"
                      icon={<LinkOutlined />}
                      onClick={() => openUrl('https://github.com/fatedier/frp')}
                    >
                      frp 项目
                    </Button>
                  </Space>
                </div>
              }
            />

            <div className="settings-field">
              <Typography.Text strong>frps 服务器地址</Typography.Text>
              <Input
                placeholder="例如 frp.example.com"
                value={settings.frpcServerAddr}
                onChange={(e) => patchLocal({ frpcServerAddr: e.target.value })}
                style={{ maxWidth: 360 }}
              />
            </div>

            <div className="settings-field">
              <Typography.Text strong>frps 端口</Typography.Text>
              <InputNumber
                min={1}
                max={65535}
                value={settings.frpcServerPort}
                onChange={(v) => patchLocal({ frpcServerPort: Number(v || 7000) })}
                style={{ width: 160 }}
              />
            </div>

            <div className="settings-field">
              <Typography.Text strong>Token（选填）</Typography.Text>
              <Input.Password
                placeholder="与 frps 配置一致"
                value={settings.frpcToken}
                onChange={(e) => patchLocal({ frpcToken: e.target.value })}
                style={{ maxWidth: 420 }}
              />
            </div>

            <div className="settings-field">
              <Typography.Text strong>代理类型</Typography.Text>
              <Radio.Group
                value={settings.frpcType}
                onChange={(e) => patchLocal({ frpcType: e.target.value })}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { value: 'tcp', label: 'TCP' },
                  { value: 'http', label: 'HTTP' }
                ]}
              />
            </div>

            {settings.frpcType === 'tcp' ? (
              <div className="settings-field">
                <Typography.Text strong>远程端口</Typography.Text>
                <InputNumber
                  min={1}
                  max={65535}
                  value={settings.frpcRemotePort}
                  onChange={(v) => patchLocal({ frpcRemotePort: Number(v || settings.apiPort) })}
                  style={{ width: 160 }}
                />
                <Typography.Text type="secondary">外网访问端口（映射到本机 API 端口）</Typography.Text>
              </div>
            ) : (
              <div className="settings-field">
                <Typography.Text strong>自定义域名</Typography.Text>
                <Input
                  placeholder="例如 api.example.com"
                  value={settings.frpcCustomDomain}
                  onChange={(e) => patchLocal({ frpcCustomDomain: e.target.value })}
                  style={{ maxWidth: 360 }}
                />
              </div>
            )}

            <div className="settings-field">
              <Typography.Text strong>外网访问主机</Typography.Text>
              <Input
                placeholder={
                  settings.frpcType === 'tcp'
                    ? 'frps 公网 IP 或域名，用于拼访问地址'
                    : '可选，未填自定义域名时使用'
                }
                value={settings.frpcPublicHost}
                onChange={(e) => patchLocal({ frpcPublicHost: e.target.value })}
                style={{ maxWidth: 420 }}
              />
            </div>

            <Space wrap style={{ marginBottom: 16 }}>
              <Button loading={saving} onClick={() => void onCopyFrpcToml()}>
                复制 frpc.toml
              </Button>
              <Button type="primary" loading={saving} onClick={() => void onExportFrpc()}>
                导出并打开目录
              </Button>
            </Space>
          </>
        ) : null}

        <Space style={{ marginTop: 8, marginBottom: 16 }}>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存并应用
          </Button>
        </Space>

        <Alert
          type={status?.running ? 'success' : 'info'}
          showIcon
          message={status?.running ? 'API 运行中' : 'API 已停止'}
          description={
            <div className="settings-status-block">
              {status?.error ? <div>错误：{status.error}</div> : null}
              <div>权限：{status?.mode === 'control' ? '可控制' : '只读'}</div>
              <div>外网接入：{accessLabel}</div>
              <div>端口：{status?.port ?? settings.apiPort}</div>
              {status?.localUrls?.length ? (
                <div>
                  本机 / 局域网：
                  {status.localUrls.map((u) => (
                    <div key={u}>
                      <Typography.Link onClick={() => void copy(u)}>{u}</Typography.Link>
                    </div>
                  ))}
                </div>
              ) : null}
              {isLocal && status?.publicUrl ? (
                <div>
                  公网 IP：
                  <Typography.Link onClick={() => void copy(status.publicUrl!)}>
                    {status.publicUrl}
                  </Typography.Link>
                </div>
              ) : null}
              {isLocal && status?.domainUrl ? (
                <div>
                  域名：
                  <Typography.Link onClick={() => void copy(status.domainUrl!)}>
                    {status.domainUrl}
                  </Typography.Link>
                </div>
              ) : null}
              {isSunlogin && status?.hskUrl ? (
                <div>
                  穿透地址：
                  <Typography.Link onClick={() => void copy(status.hskUrl!)}>
                    {status.hskUrl}
                  </Typography.Link>
                </div>
              ) : null}
              {isFrpc && status?.frpcUrl ? (
                <div>
                  Frpc 地址：
                  <Typography.Link onClick={() => void copy(status.frpcUrl!)}>
                    {status.frpcUrl}
                  </Typography.Link>
                </div>
              ) : null}
              {exampleSummary ? (
                <div className="settings-hsk-example">
                  <div>调用示例：</div>
                  <Typography.Paragraph copyable={{ text: exampleSummary }} code>
                    {exampleSummary}
                  </Typography.Paragraph>
                </div>
              ) : null}
              {isSunlogin ? (
                <Typography.Text type="secondary">
                  请保持向日葵 / 花生壳客户端在线，否则外网无法连通。
                </Typography.Text>
              ) : null}
              {isFrpc ? (
                <Typography.Text type="secondary">
                  请保持 frpc 进程在线，并确保本软件 API 已启用。
                </Typography.Text>
              ) : null}
            </div>
          }
        />

        <Typography.Title level={5} style={{ marginTop: 20 }}>
          接口说明
        </Typography.Title>
        <div className="settings-api-docs">
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            本软件开启 API 后作为服务端；第三方用 HTTP 拉取监控数据，或在「可控制」模式下远程操作打印机。
          </Typography.Paragraph>

          <div className="settings-api-doc-block">
            <Typography.Text strong>一、怎么接入</Typography.Text>
            <ol>
              <li>
                上方开启「启用 API」，选好权限（只读 / 可控制）与外网接入方式，点「保存并应用」。
              </li>
              <li>
                Base URL 优先用状态区显示的外网 / 局域网地址
                {externalBase ? (
                  <>
                    （当前：
                    <Typography.Link onClick={() => void copy(externalBase)}>
                      {externalBase}
                    </Typography.Link>
                    ）
                  </>
                ) : (
                  <>（例如 <code>http://127.0.0.1:{settings.apiPort}</code>）</>
                )}
                。
              </li>
              <li>
                除健康检查外，每个请求必须带请求头：
                <code>X-Api-Key: {settings.apiKey || '（上方 API Key）'}</code>
              </li>
              <li>
                响应均为 JSON；成功一般含 <code>ok: true</code>。错误常见：401（Key 错误）、403（只读模式禁止控制）、404（设备不存在）。
              </li>
            </ol>
            <div className="settings-hsk-example">
              <div>连通性测试（无需 Key）：</div>
              <Typography.Paragraph
                copyable={{
                  text: `curl "${(externalBase || `http://127.0.0.1:${settings.apiPort}`).replace(/\/$/, '')}/api/health"`
                }}
                code
              >
                {`curl "${(externalBase || `http://127.0.0.1:${settings.apiPort}`).replace(/\/$/, '')}/api/health"`}
              </Typography.Paragraph>
            </div>
            {exampleSummary ? (
              <div className="settings-hsk-example">
                <div>带 Key 拉取汇总：</div>
                <Typography.Paragraph copyable={{ text: exampleSummary }} code>
                  {exampleSummary}
                </Typography.Paragraph>
              </div>
            ) : null}
          </div>

          <div className="settings-api-doc-block">
            <Typography.Text strong>二、查询接口（显示什么）</Typography.Text>
            <ul className="settings-endpoints">
              <li>
                <code>GET /api/health</code>
                <div className="settings-api-doc-desc">
                  无需 Key。确认服务是否在线；返回版本号、当前权限模式（readonly / control）、服务器时间。
                </div>
              </li>
              <li>
                <code>GET /api/v1/events</code>
                <div className="settings-api-doc-desc">
                  SSE 实时推送。连接后先收到 <code>hello</code>，随后持续推送 <code>statuses</code>
                  （全设备状态快照）。适合手机墙 / 看板长连接。
                </div>
              </li>
              <li>
                <code>GET /api/v1/summary</code>
                <div className="settings-api-doc-desc">
                  看板汇总：设备总数 / FDM 数 / 光固化数 / 在线数；耗材料卷总数及 FDM、树脂数量；区域监控分区数与摄像头数；当前 API 模式。
                </div>
              </li>
              <li>
                <code>GET /api/v1/settings</code>
                <div className="settings-api-doc-desc">
                  消毒后的应用设置（通知开关、amsAutoDeduct、deviceRefreshSec、webhook、apiMode 等）。API Key
                  仅返回掩码 <code>apiKeyMasked</code> 与 <code>apiKeySet</code>，不含 frpc/hsk 明文密钥。
                </div>
              </li>
              <li>
                <code>GET /api/v1/logs</code>
                <div className="settings-api-doc-desc">
                  操作日志。可选 <code>?limit=100</code>（最大 500）、<code>?deviceId=</code>。
                </div>
              </li>
              <li>
                <code>GET /api/v1/devices</code>
                <div className="settings-api-doc-desc">
                  全部打印机列表（已脱敏，不含密钥）。每台附带实时 <code>status</code>。
                  可选 <code>?tech=fdm</code> / <code>?tech=resin</code>。
                </div>
              </li>
              <li>
                <code>GET /api/v1/devices/:id</code>
                <div className="settings-api-doc-desc">单台设备详情 + 当前 status。</div>
              </li>
              <li>
                <code>GET /api/v1/devices/:id/files</code>
                <div className="settings-api-doc-desc">
                  列出打印机上的文件（需桌面端窗口在线、适配器已连接）。Moonraker 系完整支持；部分品牌可能返回空或错误说明。
                </div>
              </li>
              <li>
                <code>GET /api/v1/devices/:id/files/content?path=相对路径</code>
                <div className="settings-api-doc-desc">
                  下载文件。默认 JSON（含 contentBase64）；加 <code>&format=binary</code> 直接下二进制。
                </div>
              </li>
              <li>
                <code>GET /api/v1/discover/lan</code>
                <div className="settings-api-doc-desc">局域网发现进度与结果（phase / hits）。</div>
              </li>
              <li>
                <code>GET /api/v1/filament</code>
                <div className="settings-api-doc-desc">
                  耗材料卷：含 <code>rolls</code>、<code>amsBindings</code> / <code>amsBinding</code>、余量等。
                  可选 <code>?tech=</code>、<code>?archived=0|1</code>。
                </div>
              </li>
              <li>
                <code>GET /api/v1/filament/:id</code>
                <div className="settings-api-doc-desc">单卷详情。</div>
              </li>
              <li>
                <code>GET /api/v1/quote/presets</code>
                <div className="settings-api-doc-desc">代打计算器预设材料与打印机功率。</div>
              </li>
              <li>
                <code>GET /api/v1/monitor/wall</code>
                <div className="settings-api-doc-desc">内部监控：已添加打印机的舱内摄像头列表。</div>
              </li>
              <li>
                <code>GET /api/v1/devices/:id/cameras</code>
                <div className="settings-api-doc-desc">单台打印机摄像头列表。</div>
              </li>
              <li>
                <code>GET /api/v1/devices/:id/cameras/:cameraId/snapshot</code>
                <div className="settings-api-doc-desc">
                  抓取 JPEG；可选 <code>?format=json</code>。
                </div>
              </li>
              <li>
                <code>GET /api/v1/monitor/zones</code> / <code>.../zones/:zoneId</code>
                <div className="settings-api-doc-desc">区域监控分区列表与详情。</div>
              </li>
              <li>
                <code>GET /api/v1/monitor/zones/:zoneId/cameras/:cameraId/snapshot</code>
                <div className="settings-api-doc-desc">区域摄像头抓帧；支持 <code>?format=json</code>。</div>
              </li>
            </ul>
          </div>

          <div className="settings-api-doc-block">
            <Typography.Text strong>三、控制接口（完整版 · 需「可控制」模式）</Typography.Text>
            {settings.apiMode === 'control' ? (
              <ul className="settings-endpoints">
                <li>
                  <code>POST /api/v1/devices</code>
                  <div className="settings-api-doc-desc">
                    新增设备。必填 <code>name</code>、<code>brand</code>；Moonraker 需 <code>baseUrl</code>；拓竹局域网需{' '}
                    <code>bambuHost</code>。可选一次性 <code>secret</code>（访问码/API Key，写入加密存储，响应不回显）。
                  </div>
                </li>
                <li>
                  <code>PATCH / PUT /api/v1/devices/:id</code>
                  <div className="settings-api-doc-desc">
                    更新设备。可传 <code>secret</code> 旋转密钥；<code>clearSecret: true</code> 清除密钥。
                  </div>
                </li>
                <li>
                  <code>DELETE /api/v1/devices/:id</code>
                  <div className="settings-api-doc-desc">删除设备并清理密钥。</div>
                </li>
                <li>
                  <code>POST /api/v1/devices/:id/control</code>
                  <div className="settings-api-doc-desc">
                    单机控制。Body 必含 <code>action</code>（见下方白名单）。
                  </div>
                </li>
                <li>
                  <code>POST /api/v1/devices/:id/filament/load|unload</code>
                  <div className="settings-api-doc-desc">进料 / 退料快捷接口。</div>
                </li>
                <li>
                  <code>POST /api/v1/devices/:id/files</code>
                  <div className="settings-api-doc-desc">
                    上传文件。Body：<code>{`{ "filename": "a.gcode", "contentBase64": "…" }`}</code>
                    （需桌面窗口在线）。
                  </div>
                </li>
                <li>
                  <code>POST /api/v1/batch/control</code>
                  <div className="settings-api-doc-desc">
                    批量控制。<code>{`{ "deviceIds": ["…"], "action": "pause" }`}</code>，可附带与单机相同的额外字段。
                  </div>
                </li>
                <li>
                  <code>POST /api/v1/batch/print</code>
                  <div className="settings-api-doc-desc">
                    批量打印。<code>deviceIds</code> + <code>filename</code>；若带 <code>contentBase64</code> 则先上传再打印（Moonraker/创想/奇迪局域网）。仅 filename 则对各机发{' '}
                    <code>print_file</code>。
                  </div>
                </li>
                <li>
                  <code>POST /api/v1/discover/lan</code> · <code>DELETE /api/v1/discover/lan</code>
                  <div className="settings-api-doc-desc">
                    启动 / 取消局域网扫描。可选 Body <code>{`{ "brands": ["klipper","bambu"] }`}</code>。用 GET 查进度。
                  </div>
                </li>
                <li>
                  <code>PATCH /api/v1/settings</code>
                  <div className="settings-api-doc-desc">
                    更新设置：notify*、amsAutoDeduct、deviceRefreshSec、webhook*、apiMode、apiEnabled、apiPort、apiKey
                    等。改端口/Key 会自动重启 API 服务。
                  </div>
                </li>
                <li>
                  <code>DELETE /api/v1/logs</code>
                  <div className="settings-api-doc-desc">清空操作日志。</div>
                </li>
                <li>
                  <code>POST /api/v1/filament</code> · <code>PUT/PATCH/DELETE …/filament/:id</code> ·{' '}
                  <code>POST …/archive</code>
                  <div className="settings-api-doc-desc">
                    耗材 CRUD。支持 <code>rolls</code>、<code>amsBindings</code> / <code>amsBinding</code>、
                    <code>price</code> 等。
                  </div>
                </li>
                <li>
                  <code>POST /api/v1/filament/:id/bind</code> · <code>…/unbind</code>
                  <div className="settings-api-doc-desc">
                    绑定 / 解绑设备槽位。Body：<code>{`{ "deviceId": "…", "slotId": 0 }`}</code>（0=外挂，≥1=AMS）。
                    受卷数上限约束。
                  </div>
                </li>
                <li>
                  <code>POST/PATCH/PUT/DELETE /api/v1/monitor/zones…</code>
                  <div className="settings-api-doc-desc">区域监控分区与摄像头的完整增删改（与桌面区域监控一致）。</div>
                </li>
              </ul>
            ) : (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 8, marginBottom: 8 }}
                message="当前为只读模式"
                description="切换到「可控制」并保存后，才会开放设备增删改、文件、批量、设置写入等接口。外网可达时请务必保管 API Key。"
              />
            )}
            <Typography.Text type="secondary">支持的设备 action：</Typography.Text>
            <ul className="settings-endpoints settings-endpoints-actions">
              <li>
                <code>pause</code> / <code>resume</code> / <code>cancel</code> / <code>emergency_stop</code> /{' '}
                <code>home</code>
              </li>
              <li>
                <code>set_temp</code> — <code>heater</code> + <code>temperature</code>
              </li>
              <li>
                <code>set_fan</code> — <code>percent</code>；可选 <code>fan</code>（part/chamber）
              </li>
              <li>
                <code>set_speed</code> — <code>percent</code>
              </li>
              <li>
                <code>load_filament</code> / <code>unload_filament</code> — 可选 temperature、slot
              </li>
              <li>
                <code>print_file</code> — 需 <code>filename</code>
              </li>
            </ul>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              说明：云端账号登录（拓竹/创想短信等）仅桌面端支持；文件/批量打印需保持本软件主窗口运行以便桥接适配器。状态 Webhook 可在设置中开启（POST JSON，约 2s 节流）。
            </Typography.Paragraph>
            <div className="settings-hsk-example">
              <div>控制示例（暂停打印）：</div>
              <Typography.Paragraph
                copyable={{
                  text: `curl -X POST -H "Content-Type: application/json" -H "X-Api-Key: ${settings.apiKey}" -d "{\\"action\\":\\"pause\\"}" "${(externalBase || `http://127.0.0.1:${settings.apiPort}`).replace(/\/$/, '')}/api/v1/devices/设备ID/control"`
                }}
                code
              >
                {`curl -X POST -H "Content-Type: application/json" -H "X-Api-Key: …" -d '{"action":"pause"}' "${(externalBase || `http://127.0.0.1:${settings.apiPort}`).replace(/\/$/, '')}/api/v1/devices/设备ID/control"`}
              </Typography.Paragraph>
              <div>新增设备示例：</div>
              <Typography.Paragraph
                copyable={{
                  text: `curl -X POST -H "Content-Type: application/json" -H "X-Api-Key: ${settings.apiKey}" -d "{\\"name\\":\\"P1\\",\\"brand\\":\\"klipper\\",\\"baseUrl\\":\\"http://192.168.1.10:7125\\",\\"secret\\":\\"moonraker-key\\"}" "${(externalBase || `http://127.0.0.1:${settings.apiPort}`).replace(/\/$/, '')}/api/v1/devices"`
                }}
                code
              >
                {`curl -X POST -H "Content-Type: application/json" -H "X-Api-Key: …" -d '{"name":"P1","brand":"klipper","baseUrl":"http://192.168.1.10:7125","secret":"…"}' "…/api/v1/devices"`}
              </Typography.Paragraph>
            </div>
          </div>

          <div className="settings-api-doc-block">
            <Typography.Text strong>四、代打计算器接口</Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              只读 Key 即可调用。公式与软件内「代打价格计算器」一致。
            </Typography.Text>
            <ul className="settings-endpoints">
              <li>
                <code>POST /api/v1/quote/calculate</code>
                <div className="settings-api-doc-desc">
                  共用参数：<code>weightG</code>、<code>printHours</code>、<code>wastePct</code>、
                  <code>watts</code>、<code>electricity</code>、<code>wearPerHour</code>、
                  <code>laborMinutes</code>、<code>laborRate</code>、<code>packaging</code>、
                  <code>shipping</code>、<code>failPct</code>、<code>pricingMode</code>（markup/margin）、
                  <code>markupPct</code>/<code>marginPct</code>、<code>minPrice</code>、<code>qty</code>。
                  单方案再传 <code>pricePerKg</code>；多方案传 <code>options[]</code>（可含{' '}
                  <code>spoolId</code> 自动换算 ¥/kg）。
                </div>
              </li>
              <li>
                <code>POST /api/v1/quote/parse-gcode</code>
                <div className="settings-api-doc-desc">
                  Body：<code>{`{ "text": "…gcode…" }`}</code>，解析克数与预估小时。
                </div>
              </li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  )
}

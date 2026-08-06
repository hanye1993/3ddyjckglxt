# hanye · 3D 打印机监控台

Windows 桌面应用：统一监控与控制多品牌 FDM / 光固化 3D 打印机，并提供局域网 HTTP API，供浏览器、Android、PHP 等客户端远程调用。

当前版本：**0.3.0** · 许可证：[MIT](LICENSE)

## 功能

- 多品牌设备接入（密钥使用 Electron `safeStorage` 加密存储）
- 实时状态：温度、进度、剩余时间、在线状态；支持 FDM / 树脂分区
- 远程控制：暂停 / 恢复 / 取消 / 急停 / 归零、设温、风扇、速度、进退料、打印文件
- 批量暂停 / 恢复 / 取消，以及批量上传打印
- 耗材管理：料卷、卷数、AMS / 外挂槽位绑定、自动扣减、归档
- 监控墙：舱内摄像头 + 自定义区域 HTTP / MJPEG 摄像头与抓帧
- 代打报价：解析 G-code 克重与时长，成本计算，导出 Excel
- 局域网完整 HTTP API（只读 / 可控制），支持 SSE 推送与 Webhook
- 外网接入：花生壳（向日葵映射）或 frpc

> 说明：云端账号登录（如拓竹、创想短信登录）仅桌面端可用；文件上传与批量打印需保持桌面主窗口运行。

## 支持品牌

| 品牌 | 连接方式 |
|------|----------|
| Klipper / 奇迪 / 创想局域网 | Moonraker HTTP + WebSocket |
| 拓竹 Bambu Lab | MQTT + 局域网摄像头；云端登录（仅桌面） |
| 创想 Creality | 局域网 WebSocket + 云端 |
| 电光 Elegoo | SDCP |
| 纵维 Anycubic | 局域网 + 云端 |
| Snapmaker | 局域网 |
| 闪铸 FlashForge | 局域网 |

设备字段 `brand` 取值：`klipper`、`bambu`、`creality`、`elegoo`、`anycubic`、`snapmaker`、`flashforge`、`qidi`。

## 环境要求

- Windows 10 / 11
- Node.js 20+（开发与打包）
- Android 客户端另需：Android Studio、JDK 17、Android 7.0+（API 24）

## 快速开始

```bash
git clone https://github.com/hanye1993/hanye3Dprintergroup-control.git
cd hanye3Dprintergroup-control
npm install
npm run dev
```

### 打包 Windows 安装包

```bash
npm run dist
```

产物输出到 `release/`（该目录已加入 `.gitignore`，不会提交到仓库）。

常用脚本：

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式 |
| `npm run build` | 仅编译 |
| `npm run dist` | 编译并打包 |
| `npm run sync:android` | 同步 Web 资源到 Android |
| `npm run typecheck` | TypeScript 检查 |

## 桌面端使用

1. 启动后在侧栏进入 FDM / 光固化设备页，手动添加或局域网发现打印机。
2. **耗材**：管理料卷并绑定 AMS / 外挂槽位，可开启自动扣减。
3. **监控**：查看舱内摄像头，或配置区域摄像头。
4. **工具**：代打报价与 Excel 导出。
5. **设置**：主题、数据目录、开机启动、托盘、通知、Webhook、API 服务等。

应用数据默认保存在 Electron `userData`，可在设置中更改数据目录。常见文件：`devices.json`、`filament-spools.json`、`monitor-zones.json`、`app-settings.json`、`operation-logs.jsonl`、`secrets.bin`。

## 开启 API

1. 打开 **API 服务**，启用 API。
2. 选择权限：**只读（readonly）** 或 **可控制（control）**。
3. 端口默认 `17890`，复制 API Key。
4. 外网可选：`local` / `sunlogin`（花生壳）/ `frpc`。
5. 保存并应用。应用内「接口说明」可复制 curl 示例。

约定：

- Base URL：`http://<主机>:<端口>`，例如 `http://127.0.0.1:17890`
- 除健康检查外，请求头必须带：`X-Api-Key: <密钥>`
- 只读模式下写操作返回 `403`
- 允许 CORS，支持 `OPTIONS` 预检

## 客户端

### 浏览器

1. 桌面端开启 API（写操作用「可控制」）。
2. 打开 [`clients/web/index.html`](clients/web/index.html)。
3. 填写 IP、端口（默认 `17890`）、API Key。

### Android

```bash
npm run sync:android
```

用 Android Studio 打开 [`clients/android`](clients/android) 运行或打包。详见 [`clients/android/README.md`](clients/android/README.md)。

### PHP

复制 [`clients/php/config.sample.php`](clients/php/config.sample.php) 为 `config.php`（勿提交 `config.php`），填写 `API_BASE` 与 `API_KEY`，使用 [`clients/php/lib/ApiClient.php`](clients/php/lib/ApiClient.php) 调用接口。

---

## HTTP API

### 通用

| 项 | 说明 |
|----|------|
| 默认端口 | `17890` |
| 鉴权 | 请求头 `X-Api-Key`（`GET /api/health` 除外） |
| 模式 | `readonly` / `control` |
| 成功 | 多数含 `"ok": true` |
| 常见错误 | `401` Key 无效 · `403` 只读禁止写 · `404` 不存在 · `400` 参数错误 · `502` 适配器失败 |

### 健康检查

```http
GET /api/health
```

无需 Key。

```json
{ "ok": true, "version": "0.3.0", "mode": "readonly", "time": "2026-01-01T00:00:00.000Z" }
```

```bash
curl "http://127.0.0.1:17890/api/health"
```

### 实时与汇总

#### `GET /api/v1/events`（SSE）

连接后先收到 `hello`，随后持续推送 `statuses`（全设备状态快照）。

#### `GET /api/v1/summary`

```bash
curl -H "X-Api-Key: YOUR_KEY" "http://127.0.0.1:17890/api/v1/summary"
```

```json
{
  "ok": true,
  "devices": { "total": 3, "fdm": 2, "resin": 1, "online": 2 },
  "filament": { "total": 10, "fdm": 8, "resin": 2 },
  "monitor": { "zones": 1, "zoneCameras": 2 },
  "mode": "control"
}
```

可选开启 Webhook：向 `webhookUrl` POST 状态 JSON，并附带 `X-Api-Key`。

### 设置与日志

| 方法 | 路径 | 模式 | 说明 |
|------|------|------|------|
| GET | `/api/v1/settings` | 任意 | 公开设置；Key 仅返回掩码 |
| PATCH | `/api/v1/settings` | control | 更新白名单字段 |
| GET | `/api/v1/logs` | 任意 | `?limit=`（1–500）`?deviceId=` |
| DELETE | `/api/v1/logs` | control | 清空日志 |

PATCH 允许字段：`apiEnabled`、`apiMode`、`apiPort`、`apiKey`、`apiAccessMode`、`publicIp`、`domain`、`notifyOnError`、`notifyOnPrintDone`、`notifyOnIdle`、`notifyOnLowFilament`、`amsAutoDeduct`、`deviceRefreshSec`、`webhookEnabled`、`webhookUrl`、`openAtLogin`、`minimizeToTray`。

### 设备

| 方法 | 路径 | 模式 | 说明 |
|------|------|------|------|
| GET | `/api/v1/devices` | 任意 | 列表 + `status`；`?tech=fdm\|resin` |
| GET | `/api/v1/devices/:id` | 任意 | 单台详情 |
| POST | `/api/v1/devices` | control | 新增 |
| PATCH / PUT | `/api/v1/devices/:id` | control | 更新；可传 `secret` 或 `clearSecret` |
| DELETE | `/api/v1/devices/:id` | control | 删除并清理密钥 |

新增示例（Moonraker）：

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{"name":"P1","brand":"klipper","tech":"fdm","connectionMode":"lan","baseUrl":"http://192.168.1.10:7125","secret":"moonraker-api-key"}' \
  "http://127.0.0.1:17890/api/v1/devices"
```

拓竹局域网需提供 `bambuHost`（或可用的 `baseUrl`）。响应中密钥不回显。

### 控制与文件

| 方法 | 路径 | 模式 | 说明 |
|------|------|------|------|
| POST | `/api/v1/devices/:id/control` | control | Body 必含 `action` |
| POST | `/api/v1/devices/:id/filament/load` | control | 进料 |
| POST | `/api/v1/devices/:id/filament/unload` | control | 退料 |
| GET | `/api/v1/devices/:id/files` | 任意 | 列出机内文件 |
| POST | `/api/v1/devices/:id/files` | control | `{ "filename", "contentBase64" }` |
| GET | `/api/v1/devices/:id/files/content` | 任意 | `?path=`；`format=json\|binary` |
| DELETE | `/api/v1/devices/:id/files/content` | control | 当前返回 501 |

控制 `action`：

| action | 额外字段 |
|--------|----------|
| `pause` / `resume` / `cancel` / `emergency_stop` / `home` | — |
| `set_temp` | `heater`、`temperature` |
| `set_fan` | `percent`；可选 `fan`（`part`/`chamber`）或 `fanName` |
| `set_speed` | `percent` |
| `print_file` | `filename` |
| `load_filament` / `unload_filament` | 可选 `temperature`、`slot` |

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{"action":"pause"}' \
  "http://127.0.0.1:17890/api/v1/devices/DEVICE_ID/control"
```

### 批量与发现

| 方法 | 路径 | 模式 | 说明 |
|------|------|------|------|
| POST | `/api/v1/batch/control` | control | `{ "deviceIds", "action", … }` |
| POST | `/api/v1/batch/print` | control | `{ "deviceIds", "filename", "contentBase64?" }` |
| POST | `/api/v1/discover/lan` | control | 启动扫描；可选 `{ "brands": [...] }` |
| GET | `/api/v1/discover/lan` | 任意 | 进度与结果 |
| DELETE | `/api/v1/discover/lan` | control | 取消 |

### 耗材

| 方法 | 路径 | 模式 | 说明 |
|------|------|------|------|
| GET | `/api/v1/filament` | 任意 | `?tech=` `?archived=0\|1` |
| GET | `/api/v1/filament/:id` | 任意 | 详情 |
| POST | `/api/v1/filament` | control | 新建 |
| PUT / PATCH | `/api/v1/filament/:id` | control | 更新 |
| DELETE | `/api/v1/filament/:id` | control | 删除 |
| POST | `/api/v1/filament/:id/archive` | control | 归档 |
| POST | `/api/v1/filament/:id/bind` | control | `{ "deviceId", "slotId" }`（0=外挂，≥1=AMS） |
| POST | `/api/v1/filament/:id/unbind` | control | 解绑 |

新建必填：`brandId`、`material`、`color`、`totalGrams`（>0）。可选 `rolls`、`amsBindings`、`remainGrams`、`price`、`tech` 等。

### 监控与摄像头

| 方法 | 路径 | 模式 | 说明 |
|------|------|------|------|
| GET | `/api/v1/monitor/wall` | 任意 | 舱内摄像头墙 |
| GET | `/api/v1/devices/:id/cameras` | 任意 | 单机摄像头 |
| GET | `/api/v1/devices/:id/cameras/:cameraId/snapshot` | 任意 | JPEG；`?format=json` |
| GET / POST / PUT | `/api/v1/monitor/zones` | 写需 control | 区域分区 |
| GET / PATCH / PUT / DELETE | `/api/v1/monitor/zones/:zoneId` | 写需 control | 分区操作 |
| POST | `/api/v1/monitor/zones/:zoneId/cameras` | control | `{ "name?", "url", "snapshotUrl?" }` |
| GET / PATCH / PUT / DELETE | `…/cameras/:cameraId` | 写需 control | 区域摄像头 |
| GET | `…/cameras/:cameraId/snapshot` | 任意 | 区域抓帧 |

### 代打报价

只读模式可用。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/quote/presets` | 预设材料与功率 |
| POST | `/api/v1/quote/calculate` | 成本计算 |
| POST | `/api/v1/quote/parse-gcode` | `{ "text" }` 或 `{ "gcode" }` |

计算常用字段：`weightG`、`printHours`（或小时+分钟拆分）、`wastePct`、`watts`、`electricity`、`wearPerHour`、`laborMinutes`、`laborRate`、`packaging`、`shipping`、`failPct`、`pricingMode`（`markup`/`margin`）、`markupPct`/`marginPct`、`minPrice`、`qty`；可用 `pricePerKg` 或 `options[]`。

### 端点速查

| 类别 | 方法 | 路径 |
|------|------|------|
| 健康 | GET | `/api/health` |
| 实时 | GET | `/api/v1/events` |
| 汇总 | GET | `/api/v1/summary` |
| 设置 | GET / PATCH | `/api/v1/settings` |
| 日志 | GET / DELETE | `/api/v1/logs` |
| 设备 | GET / POST / PATCH / PUT / DELETE | `/api/v1/devices`、`/devices/:id` |
| 控制 | POST | `/api/v1/devices/:id/control` |
| 文件 | GET / POST | `/api/v1/devices/:id/files` |
| 批量 | POST | `/api/v1/batch/control`、`/batch/print` |
| 发现 | POST / GET / DELETE | `/api/v1/discover/lan` |
| 耗材 | CRUD + bind/unbind/archive | `/api/v1/filament…` |
| 监控 | wall / zones / snapshot | `/api/v1/monitor…` |
| 报价 | GET / POST | `/api/v1/quote/…` |

## 配置说明

配置保存在 `app-settings.json`（应用数据目录，不进仓库）：

| 键 | 默认 | 含义 |
|----|------|------|
| `apiEnabled` | `false` | 是否启动 API |
| `apiMode` | `readonly` | `readonly` / `control` |
| `apiPort` | `17890` | 端口 |
| `apiKey` | 随机生成 | 鉴权密钥 |
| `apiAccessMode` | `local` | `local` / `sunlogin` / `frpc` |
| `amsAutoDeduct` | `true` | 耗材自动扣减 |
| `deviceRefreshSec` | `3` | 状态刷新间隔（秒） |
| `webhookEnabled` / `webhookUrl` | — | 状态 Webhook |
| `notifyOn*` | — | 桌面通知开关 |
| `openAtLogin` / `minimizeToTray` | — | 开机 / 托盘 |

打包安装包时，若缺少 `build/vc_redist.x64.exe`，可从 [Microsoft VC++ Redistributable](https://aka.ms/vc14/vc_redist.x64.exe) 下载放到 `build/`。

## 安全建议

- 不要把打印机原生端口直接暴露到公网；优先隧道（花生壳 / frpc）+ 本软件 API Key。
- API Key 等同控制权，勿写入公开仓库或发给他人。
- Web / Android 客户端会在本机保存 Key，注意设备安全。
- 仓库中不要提交 `config.php`、`local.properties`、`secrets.bin`、设备列表等本地数据。

## 目录结构

```
printer-monitor/
├── src/
│   ├── main/          # Electron 主进程、品牌适配器、HTTP API
│   ├── preload/       # 预加载桥接
│   └── renderer/      # React 桌面 UI
├── clients/
│   ├── web/           # 浏览器客户端
│   ├── android/       # Android WebView 客户端
│   └── php/           # PHP 调用库
├── build/             # NSIS 脚本、VC++ 红包安装包
├── resources/         # 图标与运行时 DLL
├── package.json
└── README.md
```

桌面端是唯一与打印机原生协议通信的进程；远程客户端只访问统一 HTTP API。

## License

MIT

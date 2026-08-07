# hanye · 3D 打印机监控台

Windows 桌面端统一监控与控制多品牌 FDM / 光固化 3D 打印机，并提供局域网 HTTP API。支持 **服务端 / 客户端** 分角色部署、用户权限、按设备授权、打印队列审核，以及浏览器 / Android / PHP 远程访问。

**仓库：** [https://github.com/hanye1993/3ddyjckglxt](https://github.com/hanye1993/3ddyjckglxt)  
**版本：** 0.3.0 · **许可：** MIT

---

## 目录

- [功能概览](#功能概览)
- [服务端与客户端](#服务端与客户端)
- [支持品牌](#支持品牌)
- [环境要求](#环境要求)
- [安装与运行](#安装与运行)
- [用户权限与按设备授权](#用户权限与按设备授权)
- [打印队列与审核](#打印队列与审核)
- [开启 API 服务](#开启-api-服务)
- [其它客户端](#其它客户端)
- [配置与安全](#配置与安全)
- [项目结构](#项目结构)

---

## 功能概览

| 模块 | 能力 |
|------|------|
| 设备管理 | 添加 / 编辑 / 删除；品牌筛选；局域网发现；操作日志 |
| 实时监控 | 温度、进度、剩余时间、在线状态；FDM / 树脂分区；客户端按刷新周期同步 |
| 远程控制 | 暂停 / 恢复 / 取消 / 急停 / 归零；设温、风扇、速度；进退料 |
| 批量操作 | 批量暂停 / 恢复 / 取消；批量上传并打印（Moonraker 类） |
| 耗材 | 料卷管理、AMS / 外挂绑定、自动扣减；客户端自动同步服务端变更 |
| 打印队列 | 客户端提交 `.gcode` → 按权限审核或直入队 → 管理员确认床清空后开打 |
| 权限 | 全局导航 / 耗材 / 审核；**打印机操作仅在「按设备授权」中勾选** |
| 监控墙 | 舱内摄像头；自定义区域 HTTP / MJPEG |
| 代打报价 | G-code 解析克重与时长；Excel 导出 |
| HTTP API | 只读 / 可控制；SSE；Webhook；花生壳 / frpc |

---

## 服务端与客户端

| 角色 | 说明 |
|------|------|
| **服务端** | 公司 Windows 机：连接全部打印机、本机管理台、用户与队列、默认开启 API（端口 **17890**） |
| **客户端** | 员工电脑：登录服务端后拉数据与状态；**不托管 API**；仅显示有权限的设备与操作 |

```bash
npm run dev:server   # 开发 · 服务端
npm run dev:client   # 开发 · 客户端
npm run dist:server  # 打包服务端安装包 → release/ 或 release-server/
npm run dist:client  # 打包客户端安装包 → release/
```

默认管理员：`admin` / `admin123`（请立刻修改）。

---

## 支持品牌

| 品牌 | 协议 / 模式 |
|------|-------------|
| Klipper / 奇迪 / 创想局域网 | Moonraker HTTP + WebSocket |
| 拓竹 Bambu Lab | MQTT + 局域网摄像头；云端登录（仅桌面） |
| 创想 Creality | 局域网原生 WS + 云端 |
| Elegoo | SDCP |
| 纵维 Anycubic | 局域网 + 云端 |
| Snapmaker / 闪铸 | 局域网 |

`brand` 字段：`klipper`、`bambu`、`creality`、`elegoo`、`anycubic`、`snapmaker`、`flashforge`、`qidi`。

---

## 环境要求

- Node.js 20+ / npm  
- Windows 10 / 11  
- Android 客户端另需：Android Studio、JDK 17、API 24+

---

## 安装与运行

```bash
git clone https://github.com/hanye1993/3ddyjckglxt.git
cd 3ddyjckglxt
npm install
npm run dev:server    # 或 npm run dev:client
```

### 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run build` | 编译主进程 / 渲染进程 |
| `npm run dist` | 通用 Windows 包 |
| `npm run dist:server` / `dist:client` | 分角色安装包 |
| `npm run sync:android` | 同步 Web 到 Android 资源 |
| `npm run typecheck` | TypeScript 检查 |

---

## 用户权限与按设备授权

服务端侧栏 **用户权限**：

1. **全局权限**：导航、设备增删、耗材、审核等（**不含** 暂停/归零等机台操作）。
2. **按设备授权**：开启某台打印机后，该用户只能看到已开启设备；暂停、归零、急停、进料、上传等 **只在该设备下勾选**。
3. **仅「查看」**：只能看到设备卡片，**不能点进控制面板**；需至少再勾一项操作权限才能进入控制页。

客户端每个刷新周期会同步：权限 / ACL、设备列表与状态、耗材、打印队列、设置、监控区域。

---

## 打印队列与审核

1. 在设备控制面板 **发送 G 文件打印**（**仅 `.gcode`**）。
2. 上传前确认：G 文件正确，且为 **本台打印机** 切片软件所切。
3. 有直接打印权限 → 入该机队列；仅申请权限 → 待审核，通过后入队。
4. 每台打印机独立队列；管理员（服务端或管理员客户端）任选任务开打。
5. 开打前弹窗确认：上一盘已取下、热床清空。
6. 提交者可看自己的排队位次；侧栏「打印审核/队列」可看全表。

---

## 开启 API 服务

仅 **服务端** 托管 API（客户端即使设置里带有 `apiEnabled` 也不会监听端口）。

1. 服务端打开 **API 服务**，确认已启用，端口默认 `17890`。
2. 模式：`readonly` / `control`。
3. 请求头：`X-Api-Key: <密钥>` 或用户 JWT `Authorization: Bearer <token>`。
4. 健康检查：`GET /api/health`（无需密钥）。

详细接口说明见桌面端「API 服务」页内文档。

---

## 其它客户端

### 浏览器（Web）

打开 [`clients/web/index.html`](clients/web/index.html)，填写服务端地址与 API Key。

### Android

```bash
npm run sync:android
```

用 Android Studio 打开 [`clients/android`](clients/android)。说明见 [`clients/android/README.md`](clients/android/README.md)。

### PHP

复制 [`clients/php/config.sample.php`](clients/php/config.sample.php) 为 `config.php` 后按示例调用。

---

## 配置与安全

- 数据默认在 Electron `userData`（可自定义数据根目录）。
- 常见文件：`devices.json`、`filament-spools.json`、`users.json`、`print-requests.json`、`app-settings.json`、`secrets.bin`。
- 设备密钥使用 Electron `safeStorage` 加密；勿将 `secrets.bin`、真实 `config.php`、密钥提交到 Git。
- 生产环境请修改默认管理员密码，并限制 API 暴露范围。

---

## 项目结构

```
├── src/main/          # Electron 主进程、API、认证、队列
├── src/renderer/      # React 界面
├── src/preload/       # 预加载桥
├── src/shared/        # 权限、角色、SSO 等共享类型
├── clients/web/       # 浏览器客户端
├── clients/android/   # Android WebView 客户端
├── clients/php/       # PHP 示例
├── build/             # 安装器脚本与资源
└── package.json
```

---

## License

MIT

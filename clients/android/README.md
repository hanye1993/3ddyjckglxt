# Android 客户端

WebView 壳，内置自适应界面，对接桌面端 HTTP API。

## 能力

- 设备：列表、多选批量控制、添加 / 删除、详情控制、机内文件上传打印
- 耗材：卷数、槽位绑定、归档
- 监控墙与区域摄像头
- 代打报价
- 远程设置、局域网发现、操作日志

## 环境

- Android Studio Hedgehog 及以上
- JDK 17
- Android 7.0+（API 24）

## 打包

在仓库根目录执行：

```powershell
npm run sync:android
```

用 Android Studio 打开本目录后 Run，或：

```powershell
.\gradlew.bat assembleDebug
```

Debug APK：`app/build/outputs/apk/debug/app-debug.apk`（`app/build` 已忽略，不提交）。

## 使用

1. 电脑端开启 API，建议模式为「可控制」
2. App 填写局域网 IP、端口（默认 `17890`）、API Key
3. 文件上传 / 批量打印需桌面主窗口在线

注意：本机 `local.properties` 含 SDK 路径，已加入 `.gitignore`，请勿提交。

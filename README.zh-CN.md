# chat-demo-android

[English](README.md) | 简体中文

基于 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 开发的 **Android WebView 应用与静态聊天前端（API demo）**。无需应用后端，应用内页面直接请求配置的 DeepSeek API 服务。

- **应用名称**：`API demo`
- **当前版本**：`2.1.1`
- **Android 包名**：`xyz.app566512.apidemo`
- **系统要求**：Android 8.0+（`minSdkVersion 26`，`targetSdkVersion 34`）
- **签名方式**：免 Gradle 构建，自动使用本地 `~/.android/debug.keystore` 签名，输出 `dist-apk/abyss.apk`

首次使用时，请在应用内 **设置 → 数据管理** 中填写 DeepSeek API Key。

## 构建 Android APK

准备以下环境：

- **Node.js 22.12+** 与 **pnpm**
- **JDK 11+**（需包含 `javac`、`jar`、`keytool`；未加入 `PATH` 时可设置 `JAVA_HOME`）
- **Android SDK**（需包含 `platforms` 与 `build-tools`，并设置 `ANDROID_HOME` 或 `ANDROID_SDK_ROOT`）

在终端运行：

```sh
pnpm install
pnpm build:apk
```

构建脚本 [scripts/build-apk.mjs](scripts/build-apk.mjs) 不依赖 Gradle，会直接调用 `aapt2`、`javac`、`d8`、`jar`、`zipalign` 与 `apksigner`，将前端 `dist/` 打包进 `assets/web/` 并生成已签名的 `dist-apk/abyss.apk`。

## 网页运行与构建

本项目仍保留完整的 Web 开发与静态 / 单文件打包能力：

```sh
# 启动开发服务器（http://localhost:8090）
pnpm dev

# 生成静态站点产物到 dist/
pnpm build

# 生成脚本/样式/字体全内联的单文件 HTML（dist-single/index.html）
pnpm build:single
```

## 功能与 Android 端增强

### 对话与基础能力

- 多会话、自动标题、重命名与删除；编辑提问、重新生成与切换消息分支。
- 欢迎页支持「快速模式（Flash） / 专家模式（Pro + 自动 OCR + 发送前旁路搜索） / RP 模式（长上下文、支持突破单条 32K 上限与纯文本附件本地内联，并在设置页独立切换 Flash/Pro 模型）」。
- 流式回答、深度思考、智能搜索（专家模式走旁路搜索，先搜后答并复用同一套来源引用）、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传（纯文本本地解码内联、图片与多种文档/代码格式，Pro 模型自动接入 DeepSeek OCR 识别图片文字）、语音输入（ASR）与回复朗读（TTS，可开启回答完成后自动朗读）；移动端录音时输入框首行显示实时频谱。
- 在「对话设置」中开启「允许上传视频」，即可在快速模式的每条提问中附一段最长 60 秒的视频。每段视频均匀抽取 16 帧，拼成 4 张 2×2 图片发送。原视频可在应用内播放，Android 可在发送时转写视频对白。
- 从快速模式的附件菜单进入 **DeepSeek Live**。语音通话可接续已有文字对话、支持插话打断，通话结束后自动保存在独立会话中。
- 支持按快速 / 专家 / RP 模式分别自定义系统提示词，并可一键恢复默认。
- Markdown、Prism 代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、位置设置、ZIP 历史导入导出。

### Android 与移动端优化

- **HTTPS 虚拟域名挂载**：WebView 将 `https://appassets.androidplatform.net/` 拦截映射到本地 `assets/web/`，使 `localStorage` 与 IndexedDB 处于标准 HTTPS 同源下稳定持久化。
- **系统级适配**：Edge-to-Edge 状态栏与导航栏安全区适配（`--safe-top` / `--safe-bottom`）、系统深浅色同步、物理/手势返回键优先关闭弹窗与侧栏。
- **原生媒体与权限接入**：移动端输入框「+」面板集成相机拍照、系统相册、文件选择器，授权相册后直接显示最近 10 张照片缩略图快选；语音输入自动申请系统录音权限。
- **导出写入系统下载目录**：导出历史对话 ZIP 时自动拦截 `blob:` 下载并写入手机公共 `Download/` 目录。
- **移动端交互优化**：手势滑动开合侧边栏抽屉；历史对话列表支持长按弹出操作菜单（桌面端保留悬停显示）；支持在底部输入栏编辑历史提问与增删附件；图片支持站内全屏预览；设置弹窗适配移动端卡片分页布局（通用 / 数据管理 / 位置信息 / 系统提示词），API Key 支持掩码查看、编辑与清除。
- **输入法联动**：WebView 高度跟随键盘动画逐帧收缩，输入框、附件面板与键盘收放保持同步；打开抽屉、侧栏或弹窗时不再抢焦点自动唤起键盘，避免键盘与入场动画叠加造成的掉帧。

## 数据存储与备份

- Android 版使用 Android Keystore 管理加密密钥，API Key 的密文保存在应用私有目录并排除在系统备份之外。网页版通过 Web Crypto 加密后存入 IndexedDB。页面不支持加密存储时，API Key 仅在本次页面打开期间有效。
- 应用设置保存在 `localStorage`，会话记录、分支与附件原件保存在 IndexedDB。Android 系统备份和换机迁移会排除 WebView 的 `localStorage`，以防旧版写入过的明文记录一并转移。发送对话、上传附件与使用语音功能时，相应内容会直接提交给配置的 API 服务。
- **卸载与升级提示**：
  - **直接卸载应用** 会连同应用私有沙盒数据一并清空，导致本地历史对话和 API Key 丢失。
  - **同包名、同签名覆盖安装** 升级新版时，历史会话与设置会保留。
  - 卸载或更换设备前，请通过 **设置 → 数据管理 → 导出所有历史对话** 将 ZIP 备份保存至手机 `Download/` 目录。备份包含会话及本地图片和视频原件，格式详见 [历史导入导出](src/services/chat/history/README.md)。
- **删除全部对话**：**设置 → 数据管理 → 删除所有对话** 会在确认后清空全部本地会话、附件原件和未发送草稿，保留 API Key 与应用设置，不影响已上传到 API 服务的文件。

## 开发命令与目录结构

| 命令                | 用途                                  |
| ------------------- | ------------------------------------- |
| `pnpm dev`          | 启动本地开发服务器                    |
| `pnpm build`        | 构建静态站点到 `dist/`                |
| `pnpm build:single` | 构建单文件产物到 `dist-single/`       |
| `pnpm build:apk`    | 构建并签名 Android APK 到 `dist-apk/` |
| `pnpm type`         | TypeScript 类型检查                   |
| `pnpm lint`         | oxlint 检查                           |
| `pnpm format`       | oxfmt 格式化                          |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`，可通过 `createConfig({ apiOrigin, devServer, singleFile })` 自定义 API 地址与代理配置。聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容 Messages / Files API 通信，语音使用 ASR / TTS 接口。

```text
android/               AndroidManifest.xml、MainActivity.java 与图标/主题资源
scripts/
  build-apk.mjs        免 Gradle Android APK 构建与签名脚本
  inline-dist.mjs      单文件 HTML 内联脚本
src/
  app/                 应用布局、主题联动、视口与全局样式
  components/          聊天输入、消息列表、搜索引用、Markdown、设置与侧边栏组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、分支树、IndexedDB/内存存储与 ZIP 导入导出
    markdown/          Markdown 解析、代码高亮、公式与 Mermaid 图表
    speech/            录音编码与流式 PCM 朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)，衍生自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。

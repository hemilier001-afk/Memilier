# Hemilier 桌面智能体

一个运行在桌面端的智能体应用：对话 + 工具调用 + 文件/命令操作 + 联网搜索，由本地 **Ollama** 或云端（DeepSeek / MiniMax / OpenAI 兼容）模型驱动。基于 Electron + React + TypeScript。

> 界面参考 Claude / Codex 桌面版，品牌为 Hemilier。

## 下载安装（普通用户）

到本仓库的 **[Releases](../../releases)** 页面下载：

- **Windows**：`Hemilier-0.1.0-win.zip` —— 解压后双击 `Hemilier.exe` 即可运行（免安装）。
  - 首次运行 Windows SmartScreen 可能提示“未知发布者”（程序未做数字签名）：点 **更多信息 → 仍要运行**。
- 使用前在 **设置 → 模型** 里填入你自己的 API Key（推荐 `deepseek-chat`，工具调用最稳）。
- 详细用法见 [Windows 操作手册](./docs/操作手册-Windows.pdf)。

> 你的 API Key 仅加密保存在本机（`%APPDATA%\Hemilier\`），不在程序包内、也不上传任何第三方。

## 能力

- 💬 流式对话，Markdown + 代码高亮 + 数学公式（KaTeX）
- 🛠 15 个内置工具：读写/编辑文件、`glob`/`grep`、执行命令、联网搜索 `web_search` / 读网页 `fetch_url`、记忆、技能等
- 🔐 权限网关：写文件/执行命令/联网前需确认；危险命令强制二次确认；只读操作可自动放行
- 📁 工作区沙箱：所有路径限定在选定目录内
- 🧩 多模型（本地 Ollama + 云端 OpenAI 兼容），对话内随时切换
- 🛒 插件市场：一键安装 Word / Excel / PPT / PDF / 数据 / 图片 技能包
- 🔌 MCP（stdio + http/sse）、Skills、Projects、Customize、定时例程
- 🗂 右侧工作区：Files / Preview(可编辑) / Diff / Plan / Memory / Git / Terminal
- 🌓 深浅主题、原生菜单 + 快捷键、可中断生成

## 从源码运行 / 构建（开发者）

```bash
# 本地模型（可选）：启动 Ollama 并拉取支持工具调用的模型
ollama serve && ollama pull qwen2.5

npm install        # 安装依赖
npm run dev        # 开发模式（热更新）
```

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发模式 |
| `npm run build` | 构建三端产物 |
| `npm run typecheck` | 类型检查 |
| `npm run lint` / `npm run format` | 代码规范 |
| `npm test` | 单元测试（Vitest） |
| `npm run package` | 打包 macOS dmg |

**打包 Windows 便携版（在 macOS 上跨平台打）：**

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --x64 --config electron-builder.win.yml
```

产物在 `dist/Hemilier-0.1.0-win.zip`。

## 文档

- [Windows 操作手册](./docs/操作手册-Windows.pdf) ｜ [通用操作手册](./docs/操作手册.pdf)
- [项目开发文档 CLAUDE.md](./CLAUDE.md)（架构、智能体循环、扩展指南）

## 许可证

[MIT](./LICENSE) © 2026 Hemilier

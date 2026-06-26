# CLAUDE.md

本文件为 Claude Code 在本仓库工作时提供指导。项目是 **hemilier 桌面智能体**——一个运行在桌面端的智能体 APP，具备对话、工具调用、文件操作、命令执行能力，由本地 **Ollama** 或云端 **OpenAI 兼容**模型驱动。设计上参考 Claude / Codex 桌面版的交互，但品牌为 hemilier（界面不出现 Claude 字样）。

> 维护约定：当架构、技术栈、目录结构、命令发生变化时，**同步更新本文件**。本文件是后续开发的事实来源。面向用户的使用说明见 `docs/操作手册.md`。

---

## 1. 项目目标

- **对话界面**：流式输出、Markdown/代码高亮、多轮会话、会话历史、复制/重新生成/编辑重发/导出。
- **智能体能力**：模型自主调用工具（读写文件、执行命令、搜索代码、MCP 工具）完成多步任务。
- **多模型**：本地 Ollama + 云端 OpenAI 兼容端点（DeepSeek / MiniMax / OpenAI 等），对话内随时切换。
- **类 Claude/Codex 工作台**：三个独立空间、项目分组、自定义指令、定时例程、右侧工作区面板（文件/预览编辑/Diff/计划/终端）。
- **安全**：有副作用的操作经权限确认；文件操作限定工作区沙箱。

---

## 2. 技术栈

| 层 | 选型 | 备注 |
|---|---|---|
| 桌面框架 | **Electron 33** | sandbox + contextIsolation |
| 构建工具 | **electron-vite** + **TypeScript** | 主/渲染/preload 三端统一，HMR |
| 前端框架 | **React 18** | |
| 样式 | **Tailwind CSS**（语义化 CSS 变量色板，暖珊瑚品牌色，深浅主题） | 未用组件库 |
| 消息渲染 | **react-markdown** + **remark-gfm** + **rehype-highlight**（highlight.js 代码高亮）+ **remark-math** + **rehype-katex**（KaTeX 数学公式，CSS 在 main.tsx 引入） | |
| 状态管理 | **Zustand** | |
| 本地模型 | **Ollama REST API** (`/api/chat`) | 流式 + 工具调用 |
| 云端模型 | **OpenAI 兼容** (`/v1/chat/completions`) | SSE 流式 + function calling |
| 语音转写 | **OpenAI 兼容** (`/v1/audio/transcriptions`) | 麦克风 → ASR |
| 存储 | **JSON 文件**（`userData/*.json`） | 见偏离说明；未用 sqlite / electron-store |
| 校验 | **zod** | 工具入参校验 |
| 质量 | **ESLint(flat) + Prettier + Vitest** | |

**环境前提**：Node 已就绪；Rust 未装（故不用 Tauri）。本地模型需先 `ollama serve` 并 `ollama pull qwen2.5`（或其它支持 tool calling 的模型）；或在设置里配置云端 API。

---

## 3. 目录结构

```
.
├── CLAUDE.md                       # 本文件（开发指导）
├── docs/操作手册.md / 操作手册.pdf  # 面向用户的操作手册（PDF 由 scripts/md-to-pdf.cjs 生成）
├── package.json                    # name: hemilier-desktop-agent
├── electron.vite.config.ts         # 三端构建 + @shared/@renderer 别名
├── tsconfig.json / tsconfig.node.json
├── tailwind.config.js / postcss.config.js
├── eslint.config.mjs / .prettierrc.json
├── electron-builder.yml            # mac 打包（dmg，含 build/icon.icns）
├── electron-builder.win.yml        # Windows 打包（zip 便携，免 Wine）
├── build/                          # 应用图标 icon.png / icon.icns
├── scripts/gen-icon.cjs            # 用 Electron 离屏渲染 SVG→PNG 生成图标
├── scripts/md-to-pdf.cjs           # markdown-it + Electron printToPDF 生成操作手册 PDF
├── test/                           # Vitest：security / frontmatter / agent-loop / diff
└── src/
    ├── main/                       # 主进程
    │   ├── index.ts                # 窗口、生产 CSP、Dock 图标、麦克风权限、userData 迁移、生命周期
    │   ├── menu.ts                 # 原生应用菜单 + 快捷键（点击经 menu:action 事件下发渲染端）
    │   ├── ipc.ts                  # 全部 IPC handler（集中注册）+ 终端 spawn + 例程调度启动
    │   ├── security.ts             # resolveInWorkspace：路径沙箱
    │   ├── store.ts                # 设置/会话/项目持久化（JSON）+ 模型id/kind/mode 迁移
    │   ├── providers/
    │   │   ├── types.ts            # ModelProvider 接口
    │   │   ├── ollama.ts           # Ollama（流式 + 工具 + 不支持工具退回纯聊天）
    │   │   ├── openai.ts           # OpenAI 兼容（SSE 流式 + function calling + 退回）
    │   │   └── registry.ts         # 多 Provider 路由：getProviders/resolveProvider/bareModel/listAllModels
    │   ├── mcp/manager.ts          # MCP 客户端：连 stdio server、合并工具、调用路由（15s 超时）
    │   ├── skills/
    │   │   ├── manager.ts          # Skills：扫描 SKILL.md，按需加载正文
    │   │   └── frontmatter.ts      # 无依赖 frontmatter 解析（便于单测）
    │   ├── plugins/manager.ts      # Plugins：扫描 plugin.json，提供 MCP+skills；从文件夹安装/市场一键安装/卸载(原子写状态)
    │   ├── plugins/catalog.ts      # 内置「插件市场」目录：Word/Excel/PPT/PDF/数据/图片技能包，安装即写成 plugin+SKILL.md
    │   ├── routines/manager.ts     # 例程：调度器 + 后台运行 + 任务列表 + 系统通知（routines.json）
    │   ├── routines/worktree.ts    # 后台例程的 git worktree 隔离（独立分支跑、改动提交到分支）
    │   └── agent/
    │       ├── loop.ts             # Agent loop：模型↔工具循环（核心；含运行模式与工具过滤）
    │       ├── tools.ts            # 内置工具注册表：15 个
    │       ├── safety.ts           # 纯函数安全判定：isDangerousCommand / isPrivateIp（有单测）
    │       └── permission.ts       # PermissionManager（按 SideEffect；rememberKey 细粒度；autoApproveAll 供后台例程）
    ├── preload/index.ts            # contextBridge 暴露 window.api（类型 = Api）
    ├── renderer/src/               # 渲染进程（React）
    │   ├── main.tsx / App.tsx / store.ts / index.css / global.d.ts
    │   └── components/
    │       ├── Sidebar.tsx         # 单一左栏：新对话/搜索/空间导航/Customize/Routines/Tasks/Projects/Recents/设置/折叠
    │       ├── ChatView.tsx        # 头部 + 消息流 + Composer（模式/附加/@文件/麦克风工具栏）
    │       ├── Message.tsx         # 消息渲染、工具卡片、复制/重发/编辑、Markdown
    │       ├── RightPanel.tsx      # 工作区：Files / Preview(可编辑) / Diff / Plan / Git / Terminal
    │       ├── SettingsModal.tsx   # 设置（含云端 Provider、ASR、MCP、Skills、Plugins、发送方式、快捷键参考）
    │       ├── CustomizeModal.tsx  # 每空间自定义指令
    │       ├── RoutinesModal.tsx   # 例程管理
    │       ├── TasksModal.tsx      # 后台任务列表
    │       └── PermissionDialog.tsx
    └── shared/
        ├── types.ts                # 全部共享类型契约（含 Api）
        └── diff.ts                 # 无依赖按行 LCS diff（Diff 面板用，便于单测）
```

### 与原规划的偏离（务实取舍）
- **工具放单文件 `agent/tools.ts`**（注册表模式）：新增工具 = 加一个 `Tool` 对象并入 `ALL` 数组。
- **持久化用 JSON 文件**（`userData/{settings,conversations,projects}.json` + `routines.json`），非 sqlite/electron-store——避免原生模块编译，开箱即跑。
- **IPC 集中在 `ipc.ts`**，未拆目录。
- **代码高亮用 rehype-highlight（highlight.js）**，未用 Shiki；数学公式用 **KaTeX**（remark-math + rehype-katex）。

---

## 4. 核心架构：智能体循环 (Agent Loop)

`agent/loop.ts`（跑在主进程）：

```
runAgent({ conversationId, userContent?, provider, permission, signal, send })
  → 取对话；（userContent 存在时）追加用户消息并持久化（省略 = 重新生成）
  → 组装 system（基础提示 + 该空间自定义指令 + 运行模式提示）
  → 按【运行模式】决定可用工具：
        auto  → 内置全部 + MCP
        plan  → 仅只读工具（listToolDefs(true)）
        chat  → 无工具
  → 循环（上限 25 轮）：provider.chat({ model=bareModel(...), messages=[system, ...trimHistory(历史)], tools, onToken })
        trimHistory：按 ~48k 字符预算保留最近消息（保护 tool 配对），防止超出上下文窗口
        若有 tool_calls：逐个经【权限网关】→ 主进程执行 → 结果回灌为 role=tool 消息
        若无 tool_calls：推送最终文本，done
```

**推送给渲染进程的事件**（IPC `agent:event`）：`token` / `tool_call_start` / `tool_call_result` / `message` / `plan` / `diff` / `done` / `error`。另有 `terminal:event`（终端输出）、`tasks:update`（后台任务）。

**ToolContext** 额外回调：`recordDiff(path, before, after)`（写/改文件时发 `diff` 事件）、`setPlan(steps)`（`update_plan` 工具更新计划，持久化到 `conv.plan` 并发 `plan` 事件）。

**内置工具（15 个）**：`read_file`、`write_file`、`edit_file`(支持 `replace_all`)、`list_dir`、`glob`、`grep`、`run_command`、`fetch_url`(联网读网页)、`web_search`(DuckDuckGo 联网搜索，免密钥)、`load_skill`、`update_plan`、`add_memory`、`forget_memory`、`recall`、`save_skill`。每个含 `sideEffect: 'none'|'write'|'exec'`，权限网关据此决定是否弹确认。写/执行类弹**授权框**：`edit_file` 显示前后 diff、`write_file` 显示写入内容、`run_command`/`fetch_url`/`web_search` 显示命令/URL/查询词（`PermissionDialog`）。MCP 工具调用有 30s 超时。

**工具执行（`loop.ts`）**：自动放行的只读工具(`sideEffect:'none'` 且开了自动放行)**并行执行**(`Promise.all`)、写/执行类按序(避免授权框相撞)，结果按原始顺序回灌(满足 OpenAI 每个 tool_call 都需 tool 响应)。**权限"本会话记住"按细粒度 key**：`run_command` 记到命令首词(cmd:npm)、MCP 记到具体工具、其余按副作用级别。

**工具调用容错（提升弱模型成功率）**：`getTool` 做**别名归一化 + 大小写容错**(bash/sh/shell/terminal→run_command、cat/read→read_file、ls/dir→list_dir、create_file→write_file、str_replace/apply_patch→edit_file、websearch→web_search、fetch→fetch_url 等)，命中后把 `tc.name` 落成规范名；执行前若 `args` 是 JSON 字符串则兜底解析；部分参数用 `z.coerce`(如 web_search 的 count 接受字符串数字)；未知工具时回灌**可用工具清单**让模型自纠。

**记忆架构（Memory，五层全）**：
- 规则层：`CLAUDE.md`（开发）+ 每空间 Customize 自定义指令。
- 常驻层：系统提示注入「工作区顶层清单 + 项目记忆」。
- 治理层：项目记忆为 `<ws>/.hemilier/memory.json` 的**结构化条目**（`memory.ts`），每条含 type(事实/偏好/决策/坑/待办)、source、createdAt；超 30 天标⚠较旧；`add_memory` 记一条、`forget_memory` 按 id 删；右栏 **Memory** 标签可视化增删。
- 历史召回：`recall` 走 `store.searchHistory` 关键词检索过去所有对话（排除当前）。
- 反思/沉淀：`save_skill` 把可复用流程写成 `<ws>/.hemilier/skills/<name>/SKILL.md`（被 skillManager 自动发现、可 `load_skill` 复用）；对话头部 🧠 按钮触发 `reflect()`（让模型回顾本次对话→add_memory/save_skill）。
- 后续可增强：向量/FTS 语义召回、空闲自动 dreaming。

**Provider 解析**：`ipc.ts` 按 `conv.model || settings.defaultModel` 用 `resolveProvider()` 选出 Ollama 或某云端端点；`loop.ts` 用 `bareModel()` 去掉 `<provider>::` 前缀后传给 API。

---

## 5. 模型 Provider 抽象（已多实现）

```ts
interface ModelProvider {
  id: string
  listModels(): Promise<ModelInfo[]>
  chat(opts: { model; messages; tools?; signal?; onToken? }): Promise<ChatResult>
}
```

- `ollama.ts`：`POST /api/chat`（stream），逐行 JSON；不支持工具的模型自动退回纯聊天。
- `openai.ts`：`POST /v1/chat/completions`（SSE），function calling；工具调用分片按 index 拼接，消息按 OpenAI 规范带 `tool_calls`/`tool_call_id`。
- `registry.ts`：模型 id 形如 `<provider>::<model>`。内置 `ollama` 用 `settings.ollamaBaseUrl`；其余来自 `settings.providers`（用户配置的 openai 端点）。`listAllModels` 聚合并加前缀；旧裸名由 store 迁移成 `ollama::<model>`。
- **ASR**：`ipc.ts` 的 `asr:transcribe` 复用某 provider 的 `/audio/transcriptions`（在主进程发请求，绕过 CSP）。

---

## 6. 安全模型（重要）

- 窗口：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；仅经 preload `contextBridge` 暴露白名单 `window.api`。
- **生产 CSP**（`index.ts`）：打包环境注入严格 CSP（`default-src 'self'` 等），开发环境不注入以兼容 HMR。网络访问（模型/ASR）都在主进程，故 CSP 不影响。
- **权限网关**（`agent/permission.ts`）：只读工具默认放行（可设置关闭）；写/执行/MCP 工具弹确认；支持“本会话记住”。`autoApproveAll` 模式供**后台例程**无人值守时自动放行——例程提示用户仅用于信任的指令。
- **路径沙箱**（`security.ts`）：文件工具与“应用内编辑器”写回都经 `resolveInWorkspace`，解析 `..`/符号链接后校验，越界拒绝。
- `run_command` 与 Terminal 面板都在工作区目录下执行；命令有超时与输出截断。
- **机密加密**：`settings.json` 里的 API Key 用 Electron `safeStorage`(系统钥匙串)加密落盘(`safe:` 前缀)，内存明文；不可用环境优雅退回明文。
- **SSRF 防护**：`fetch_url` 经 `safeFetch` **手动跟随重定向、逐跳复检**(`redirect:'manual'`)，每跳都 `assertPublicUrl`；`isPrivateIp`(在 `agent/safety.ts`)拒绝 localhost/`*.local`/回环/私网/`169.254`(云元数据)/`100.64`(CGNAT)/IPv4-mapped IPv6/IPv6 ULA，DNS 解析后对真实 IP 复核。
- **危险命令识别**：`agent/safety.ts` 的 `isDangerousCommand`(纯函数、有单测)识别 `rm -rf`/`-fr`/`find -delete`/`sudo`/`curl|sh`/`base64 -d`/fork 炸弹/`git reset --hard` 等，命中则**强制二次确认**(绕过"记住")。
- **权限"记住"粒度**：`run_command` 按命令首词(`cmd:npm`)，其余按**具体工具名**(`tool:fetch_url`)——不再用 `eff:exec` 粗粒度(否则记一个网络工具会顺带放行所有 exec)。
- **`grep` ReDoS 防护**：模型给的正则有 **5s 时间预算**，超时返回部分结果而非顶死 CPU。
- **窗口导航**：`setWindowOpenHandler` 仅放行 `http/https/mailto` 经系统浏览器打开；`will-navigate` 阻止主框架被导航到外部地址。`terminal:run` 校验 cwd 必须是已存在目录。
- **JSON 损坏保护**：`store`/`routines` 读到损坏文件时**先备份为 `.corrupt-<ts>.bak` 再以空值启动**(不静默覆盖丢数据)；`routines.json` 也改为原子写。

---

## 7. 数据模型（shared/types.ts）

- `Message`: `{ id, role, content, images?, toolCalls?, toolCallId?, createdAt }`（`images`：user 消息图片，存为引用 `himg:<会话id>/<uuid>.<ext>`，文件落在 `userData/images/`；发送给视觉模型前经 `main/images.ts` 的 `imageStore.resolve` 还原成 data URL，渲染端经 `images:read` IPC 还原；旧数据里的内联 data URL 仍兼容）
- `ToolCall`: `{ id, name, args, status, result?, error? }`
- `Conversation`: `{ id, title, model, kind, mode?, projectId?, plan?, messages, workspaceDir, createdAt, updatedAt }`
  - `kind: 'chat'|'cowork'|'code'`（独立空间）；`mode: 'auto'|'plan'|'chat'`（运行模式）
- `Project`: `{ id, name, kind, createdAt }`
- `Routine`: `{ id, name, kind, prompt, intervalMinutes, enabled, workspaceDir?, model?, createdAt, lastRunAt? }`
- `BackgroundTask`: `{ id, title, conversationId, routineId?, status, startedAt, endedAt?, error? }`
- `Settings`: `{ ollamaBaseUrl, defaultModel, workspaceDir, theme, autoApproveReadOnly, mcpServers, providers[], customInstructions, asrProviderId?, asrModel? }`
- 其它：`ProviderConfig`、`PlanStep`、`DiffEntry`、`AgentEvent`、`TerminalEvent`、`ModelInfo`、`FsEntry` 等。
- **持久化**：`userData/settings.json`、`conversations.json`、`projects.json`、`routines.json`、`window-state.json`（窗口大小/位置）。启动时 store 做迁移（裸模型名 → `ollama::`、补 `kind='chat'`、`mode='auto'`），并把旧 `claude-desktop-agent` 目录的数据搬到 `hemilier-desktop-agent`。

---

## 8. 开发命令

```bash
npm install
npm run dev            # 开发（electron-vite，HMR）
npm run build          # 构建三端产物
npm run typecheck      # tsc --noEmit（两套 tsconfig）
npm run lint           # ESLint（eslint.config.mjs）
npm run lint:fix
npm run format         # Prettier
npm run format:check
npm run test           # Vitest（test/）
npm run package        # mac 打包（electron-builder → dmg）
# Windows 便携 zip（在 macOS 上跨平台打）：
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --x64 --config electron-builder.win.yml
```

> **运行前提**：`ollama serve` + `ollama pull qwen2.5`，或在设置配云端 API。无模型时仍能启动，发送会提示“尚未选择模型”。
>
> **图标**：改图标改 `scripts/gen-icon.cjs` 里的 SVG，`npx electron scripts/gen-icon.cjs "$(pwd)"` 重生成 `build/icon.png`，再用 `sips`/`iconutil` 重建 `icon.icns`。

**调试约定**：改动后 `npm run dev` 验证；UI/交互改动要实际跑起来看，不能只靠类型检查就宣称完成。

---

## 9. 功能现状

**已完成**
- 基础聊天：流式 Markdown 实时渲染、代码高亮与复制、模型选择器、中断、深浅主题、可拖动窗口。
- 智能体循环 + 8 工具 + 权限网关 + 工具调用可视化卡片。
- 持久化：JSON 存储、时间分组的 Recents、设置面板。
- **多 Provider**：Ollama + OpenAI 兼容（DeepSeek/MiniMax/OpenAI），对话内切换、按提供方分组。
- **三个独立空间** Chat/Cowork/Code（各自对话列表与当前对话）。
- **Projects** 项目分组、**Customize** 每空间自定义指令、**Routines** 定时例程 + **Tasks** 后台任务（系统通知）。
- **运行模式** 自动/计划/对话（真正改变可用工具）。**视图模式** 精简/标准/详尽（工具卡片详略）。
- **右侧工作区**：Files / Preview(可编辑+保存) / Diff(按行 LCS) / Plan / **Git** / Terminal。
- **Git 集成**：右栏 Git 标签——分支、改动/已暂存列表、暂存/取消暂存、提交、点文件看 unified diff、非仓库可 `git init`（主进程 `execFile('git')`）。
- **对话增强**：编辑历史消息重发、会话导出 Markdown、`@` 文件引用、**会话重命名**（双击/✎）。
- **输入框工具栏**：模式选择、附加菜单（上传文件/上传图片/选工作区/管理插件）、麦克风（ASR-API 版）。
- **图片/视觉输入**：附加菜单上传或直接粘贴图片，缩略图预览，按 Provider 格式发送（OpenAI `image_url` / Ollama `images`）。需视觉模型。
- **健壮性**：长对话按字符预算自动裁剪历史（计入图片体积、保护工具配对）+ 头部 token 粗估指示；历史图片只在最近一条带图消息保留（省重复上传）；Provider 流式**空闲超时**(60s 无数据自动中断，防卡死，见 `providers/util.ts` 的 `stallGuard`)；Provider 设置失焦才保存（防抖）；窗口大小/位置记忆；JSON **原子写**(临时文件+rename)；**单实例锁**；主进程**日志文件** `userData/main.log` + 未捕获异常记录。
- **MCP / Skills / Plugins**（见 §10 汇合点）。
- **工程化**：生产 CSP、ESLint+Prettier、Vitest（4 个测试文件）、应用图标、hemilier 品牌、Windows/mac 打包。

**待做 / TODO**
- Anthropic 原生 Provider、可拖拽重排面板、真·并行后台多线程（当前后台例程为单进程串行 + git worktree 隔离，未做多线程）。

### 三个子系统如何汇合
`agent/loop.ts` 每次发送时，从 `pluginManager.activePlugins()` 取启用插件的技能目录与 MCP server，与工作区/全局技能、设置里的 MCP server 合并 →
- 技能描述注入 system prompt，`load_skill` 经 `ctx.skillDirs` 查找；
- 工具列表（auto 模式）= 内置 `listToolDefs()` + `mcpManager.listToolDefs({...插件MCP, ...用户MCP})`；
- 执行时按 `mcp__` 前缀路由到 `mcpManager.callTool`，否则走内置注册表。
- 技能目录：全局 `userData/skills` + 工作区 `<ws>/.hemilier/skills` + 插件目录。

### 已知限制
- Ollama 工具调用依赖模型能力；不支持的模型自动退回纯聊天。
- MCP 连接按配置签名缓存：改命令/参数会自动重连（无需重启）；连接报错/调用失败会丢弃死连接以便下次重连；设置面板有「测试连接」探活。支持 **stdio + http(streamable) + sse** 三种传输（有 `url` 走远程，否则 `command` 走 stdio）。
- 后台例程在 git 仓库里运行时，自动用 **git worktree + 隔离分支**（`hemilier/<名>-<id>`）跑，改动提交到该分支、不碰用户当前工作树（见 `routines/worktree.ts`）；非 git 仓库则原地运行。
- 例程为固定分钟间隔；程序需保持运行才会触发。后台例程自动放行工具，仅用于可信指令。
- 语音转写依赖支持 `/audio/transcriptions` 的端点（OpenAI 可用；DeepSeek 无音频）。
- Windows 包为免 Wine 的便携 zip（跳过 exe 签名与版本写入），非 NSIS 安装包。

---

## 10. 编码约定

- TypeScript 严格模式；主/渲染共享类型放 `src/shared`。
- 工具入参一律用 zod 校验后执行。
- IPC 通道用字符串常量，preload 暴露强类型 `window.api`（类型 = `Api`，所有方法/事件都要在 `shared/types.ts` 的 `Api` 接口里声明，typecheck 保证 preload 完整）。
- 新增工具 = 在 `agent/tools.ts` 加 `Tool` 对象并入 `ALL`（含 `sideEffect`）。
- 新增 IPC = `ipc.ts` 加 handler + `preload/index.ts` 加方法 + `Api` 加类型。
- 界面文案与品牌用 **hemilier**，不出现 Claude 字样（`CLAUDE.md` 文件名与 store 迁移用的旧目录名常量是例外，属开发/兼容用途）。
- 注释与命名贴合既有风格；副作用、危险操作显式标注。
- 提交前自检：`npm run typecheck && npm run lint && npm run test && npm run format:check` 全绿；改了主进程/preload 需重启 `npm run dev` 验证。

// 内置 MCP 连接器目录（对标 Claude 的 Get apps）：精选可本地运行的主流 MCP server，
// 一键接入 = 按模板写入 settings.mcpServers + 自动授信（内置目录 = 可信来源）。
// 刻意只收 stdio(npx) 可跑、无 OAuth 前置的：本地开源 app 不具备云回调条件；
// 目录随版本内置更新，不在线拉取（防供应链，与 MCP 信任门同一哲学）。

export interface McpConnectorDef {
  /** 也用作 mcpServers 的键名 */
  id: string
  name: string
  icon: string
  category: string
  description: string
  command: string
  args: string[]
  /** 需要用户填写的环境变量（如 API Token） */
  envFields?: { key: string; label: string; required: boolean; secret?: boolean }[]
  /** 需要用户填写的追加参数（拼到 args 尾部），如 filesystem 的目录 */
  argFields?: { label: string; placeholder: string; required: boolean }[]
}

export const MCP_CATALOG: McpConnectorDef[] = [
  {
    id: 'filesystem',
    name: '本地文件系统',
    icon: '📁',
    category: '基础',
    description: '让模型读写指定目录下的文件（工作区之外的目录也可授权）。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    argFields: [
      { label: '允许访问的目录（绝对路径）', placeholder: '/Users/you/Documents', required: true }
    ]
  },
  {
    id: 'memory',
    name: '知识图谱记忆',
    icon: '🧠',
    category: '基础',
    description: '基于知识图谱的持久记忆：实体、关系、观察，跨对话累积。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory']
  },
  {
    id: 'sequential-thinking',
    name: '思维链推理',
    icon: '🧩',
    category: '基础',
    description: '结构化分步思考工具，帮模型把复杂问题拆解成可回溯的推理链。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking']
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: '🐙',
    category: '开发',
    description: '仓库 / Issue / PR / 文件操作。需要 GitHub 个人访问令牌。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envFields: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub 个人访问令牌',
        required: true,
        secret: true
      }
    ]
  },
  {
    id: 'puppeteer',
    name: '浏览器自动化',
    icon: '🎭',
    category: '开发',
    description: 'Puppeteer 驱动的网页导航 / 截图 / 表单操作（比内置浏览器工具更强）。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer']
  },
  {
    id: 'brave-search',
    name: 'Brave 搜索',
    icon: '🔎',
    category: '联网',
    description:
      'Brave Search API 联网搜索（比内置免密搜索质量更稳）。需要 API Key（有免费额度）。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envFields: [
      { key: 'BRAVE_API_KEY', label: 'Brave Search API Key', required: true, secret: true }
    ]
  },
  {
    id: 'google-maps',
    name: '谷歌地图',
    icon: '🗺️',
    category: '联网',
    description: '地点搜索、路线规划、地理编码。需要 Google Maps API Key。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-maps'],
    envFields: [
      { key: 'GOOGLE_MAPS_API_KEY', label: 'Google Maps API Key', required: true, secret: true }
    ]
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: '💬',
    category: '协作',
    description: '读取频道、发送消息、检索历史。需要 Slack Bot Token。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envFields: [
      { key: 'SLACK_BOT_TOKEN', label: 'Slack Bot Token（xoxb-…）', required: true, secret: true },
      { key: 'SLACK_TEAM_ID', label: 'Slack Team ID（T…）', required: true }
    ]
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    icon: '🦊',
    category: '开发',
    description: '项目 / Issue / MR / 文件操作。需要 GitLab 个人访问令牌。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    envFields: [
      {
        key: 'GITLAB_PERSONAL_ACCESS_TOKEN',
        label: 'GitLab 个人访问令牌',
        required: true,
        secret: true
      },
      {
        key: 'GITLAB_API_URL',
        label: 'GitLab API 地址（自建实例填，默认 gitlab.com）',
        required: false
      }
    ]
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    icon: '🐘',
    category: '数据',
    description: '只读查询 Postgres 数据库、检视表结构。填入连接串即可。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    argFields: [
      {
        label: '数据库连接串',
        placeholder: 'postgresql://user:pass@localhost:5432/db',
        required: true
      }
    ]
  },
  {
    id: 'redis',
    name: 'Redis',
    icon: '🔴',
    category: '数据',
    description: '读写 Redis 键值、执行常用命令。填入 Redis 连接地址。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-redis'],
    argFields: [{ label: 'Redis 地址', placeholder: 'redis://localhost:6379', required: true }]
  },
  {
    id: 'everything',
    name: '功能演示（测试用）',
    icon: '🧪',
    category: '其它',
    description: '官方全功能演示 server：工具/资源/提示样例齐全，适合验证 MCP 链路是否通。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything']
  }
]

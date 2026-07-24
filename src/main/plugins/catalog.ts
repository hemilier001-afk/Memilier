// 内置「插件市场」目录：每个条目是一个可一键安装的技能包（写成 plugin + SKILL.md）。
// 这些技能教智能体如何借助 run_command 调用成熟的库/命令处理常见文档格式。
// 安装即把内容写进 userData/plugins/<id>/，被插件/技能系统自动发现。

export interface CatalogPlugin {
  id: string
  name: string
  description: string
  category: string
  icon: string
  /** 写入 SKILL.md 的内容 */
  skill: { description: string; body: string }
}

export const CATALOG: CatalogPlugin[] = [
  {
    id: 'office-word',
    name: 'Word 文档（.docx）',
    description: '创建/读取 Word 文档（内置原生支持，零依赖）',
    category: '办公文档',
    icon: '📝',
    skill: {
      description:
        '处理 Word .docx：read_document 读取、write_docx 由 Markdown 生成。原生内置，无需 Python。',
      body: [
        '# Word 文档（.docx）处理',
        '',
        '本应用**原生支持** Word 读写，优先用内置工具（无需安装任何东西）：',
        '',
        '## 读取',
        '`read_document` 工具直接读 .docx 正文文本（`{"path": "文件.docx"}`）。',
        '',
        '## 创建',
        '`write_docx` 工具把 Markdown 生成为排版好的 Word 文档：',
        '- 支持 `#`/`##`/`###` 标题、**粗体**/*斜体*/`等宽`、`-` 与 `1.` 列表、`|` 表格、``` 代码块、`>` 引用',
        '- 例：`{"path": "季度报告.docx", "markdown": "# 季度报告\\n\\n## 概述\\n…"}`',
        '- **内嵌图片**：Markdown 里用 `![说明](相对路径.png)` 引用工作区图片（PNG/JPEG/GIF），自动嵌入。',
        '',
        '## 修改已有文档',
        '流程：`read_document` 读出正文 → 按用户要求改写成新 Markdown → `write_docx` 生成新文件',
        '（建议输出为 `原名-修订.docx`，不要覆盖原件）。',
        '',
        '## 进阶（复杂排版：页眉页脚/图片/精确样式）',
        '内置生成器覆盖不了的，可退回 Python 方案：`pip install python-docx` 后写脚本经 run_command 执行。'
      ].join('\n')
    }
  },
  {
    id: 'office-excel',
    name: 'Excel 表格（.xlsx）',
    description: '读写 Excel 表格与多工作表（内置原生支持，零依赖）',
    category: '办公文档',
    icon: '📊',
    skill: {
      description:
        '处理 Excel .xlsx：read_document 读取（各表 TSV）、write_xlsx 由二维数组生成。原生内置，无需 Python。',
      body: [
        '# Excel 表格（.xlsx）处理',
        '',
        '本应用**原生支持** Excel 读写，优先用内置工具：',
        '',
        '## 读取',
        '`read_document` 直接读 .xlsx：输出各工作表的 TSV 文本（含共享字符串解析）。',
        '',
        '## 创建',
        '`write_xlsx` 把二维数组生成为表格（首行=表头自动加粗；数字自动写成数值单元格）：',
        '- 单表：`{"path": "销量.xlsx", "rows": [["月份","销量"],["1月",120],["2月",150]]}`',
        '- 多表：`{"path": "年报.xlsx", "sheets": [{"name":"Q1","rows":[…]},{"name":"Q2","rows":[…]}]}`',
        '- **图表**：给工作表加 `chart`（type=column/bar/line/pie），默认类别取首列、系列取其余列：',
        '  `{"path":"销量.xlsx","rows":[["月","A","B"],["1月",120,90]],"chart":{"type":"column","title":"销量"}}`',
        '',
        '## 修改/汇总已有表格',
        '`read_document` 读出数据 → 在回复里计算/整理 → `write_xlsx` 输出新文件。',
        '',
        '## 公式',
        '单元格以 `=` 开头即写成公式，打开时自动计算：`["合计", "=SUM(B2:B10)"]`。',
        '身份证号/银行卡号/前导零编号会自动保持文本格式，不丢精度。',
        '',
        '## 进阶（图表/条件格式/精确样式）',
        '内置生成器不做图表与条件格式；需要时退回 Python：`pip install openpyxl`，经 run_command 执行。'
      ].join('\n')
    }
  },
  {
    id: 'office-ppt',
    name: 'PowerPoint（.pptx）',
    description: '大纲生成幻灯片、读取已有演示稿（内置原生支持，零依赖）',
    category: '办公文档',
    icon: '📑',
    skill: {
      description:
        '处理 PowerPoint .pptx：read_document 读取各页文本、write_pptx 由大纲生成 16:9 幻灯片。原生内置。',
      body: [
        '# PowerPoint（.pptx）处理',
        '',
        '本应用**原生支持** PPT 读写，优先用内置工具：',
        '',
        '## 读取',
        '`read_document` 读 .pptx：按「--- 幻灯片 N ---」分节输出各页文本。',
        '',
        '## 创建',
        '先和用户确认大纲（每页标题+要点），再用 `write_pptx` 生成（16:9）：',
        '`{"path": "提案.pptx", "slides": [{"title":"项目提案","bullets":["背景","目标"]},{"title":"方案","bullets":["路线A","路线B"]}]}`',
        '- **配图页**：`{"title":"效果图","image":"shot.png"}`（工作区图片路径）。',
        '- **图表页**：`{"title":"销量","chart":{"type":"column","categories":["1月","2月"],"series":[{"name":"A","values":[120,150]}]}}`。',
        '',
        '## 进阶（图片/图表/自定义版式）',
        '内置生成器只做「标题+要点」版式；复杂设计退回 Python：`pip install python-pptx`，经 run_command 执行。'
      ].join('\n')
    }
  },
  {
    id: 'doc-pdf',
    name: 'PDF 文档',
    description: '提取 PDF 文本、由 Markdown 导出精排 PDF（内置原生支持）',
    category: '办公文档',
    icon: '📕',
    skill: {
      description:
        '处理 PDF：read_document 提取文本（文本型 PDF）、export_pdf 由 Markdown 导出排版好的 PDF。原生内置。',
      body: [
        '# PDF 文档处理',
        '',
        '## 读取',
        '`read_document` 直接提取文本型 PDF 的文字。**扫描件（纯图片）在 macOS 上会自动',
        '用系统 OCR（Apple Vision）识别**（结果带识别误差提示）；Windows 上无此回退，如实说明。',
        '',
        '## 生成（推荐路径）',
        '`export_pdf` 把 Markdown 导出为排版精良的 PDF（Chromium 打印引擎：中文、表格、代码块完整支持）：',
        '`{"path": "方案.pdf", "markdown": "# 项目方案\\n\\n| 阶段 | 时间 |\\n|---|---|\\n| 一期 | 3月 |", "title": "项目方案"}`',
        '',
        '## 页操作（合并/拆分/旋转）',
        '用 `pdf_pages` 工具：',
        '- 合并：`{"operation":"merge","output":"合订.pdf","inputs":["a.pdf","b.pdf"]}`',
        '- 抽页/拆分：`{"operation":"extract","output":"节选.pdf","input":"全本.pdf","pages":"1-3,5"}`',
        '- 旋转：`{"operation":"rotate","output":"正向.pdf","input":"横的.pdf","rotate":90}`（省略 pages=全部）。加密 PDF 无法操作。',
        '',
        '## 进阶（表格坐标级提取/合并拆分）',
        '需要精确表格结构或页面级操作时退回 Python：`pip install pdfplumber`（提取）/ `pypdf`（合并拆分），经 run_command 执行。'
      ].join('\n')
    }
  },
  {
    id: 'data-analysis',
    name: '数据分析（CSV/Excel）',
    description: '用 pandas 清洗、统计、透视、画图',
    category: '数据',
    icon: '🧮',
    skill: {
      description: '用 pandas 处理 CSV/Excel：清洗、聚合、透视、统计、出图。需要 Python + pandas。',
      body: [
        '# 数据分析（pandas）',
        '',
        '当用户要**清洗/统计/透视/分析表格数据**时使用。',
        '',
        '## 准备',
        '`python -c "import pandas"`；缺失则 `pip install pandas`（画图再加 `matplotlib`）。',
        '',
        '## 常用模式',
        '```python',
        'import pandas as pd',
        'df = pd.read_csv("data.csv")          # 或 pd.read_excel("data.xlsx")',
        'print(df.head()); print(df.describe(include="all"))',
        'g = df.groupby("类别")["金额"].sum().sort_values(ascending=False)',
        'print(g)',
        'g.to_csv("汇总.csv")',
        '```',
        '先 `head()`/`info()` 了解数据结构，再按用户目标聚合；结果可存回 CSV/Excel。',
        '',
        '## 内置直读/直写 CSV（无需 Python）',
        '简单 CSV/TSV 用内置工具更快：`read_document` 读（自动识别分隔符、处理引号转义）、',
        '`write_csv` 写（带 UTF-8 BOM，Excel 双击不乱码）。只有复杂统计/透视才上 pandas。'
      ].join('\n')
    }
  },
  {
    id: 'image-basic',
    name: '图片处理',
    description: '缩放/裁剪/格式转换/加水印（基于 Pillow）',
    category: '多媒体',
    icon: '🖼️',
    skill: {
      description: '用 Pillow 处理图片：缩放、裁剪、转格式、加水印、批量。需要 Python + Pillow。',
      body: [
        '# 图片处理（Pillow）',
        '',
        '`python -c "import PIL"`；缺失则 `pip install Pillow`。',
        '```python',
        'from PIL import Image',
        'im = Image.open("in.png")',
        'im.thumbnail((800, 800))           # 等比缩放',
        'im.convert("RGB").save("out.jpg", quality=85)   # 转格式',
        '```',
        '批量处理时遍历目录（用 glob 工具先列文件）；操作前确认输出路径，避免覆盖原图。'
      ].join('\n')
    }
  }
]

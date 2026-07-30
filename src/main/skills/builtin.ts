// 内置技能（随应用发布，无需从插件市场安装）。
// 动因：这些技能教模型怎么用**内置的** Office 工具（read_document/write_docx/…），
// 属于应用自带能力的说明书，不该依赖用户手动安装——否则全新安装（尤其 Windows）
// 的智能体不知道自己有这些能力，表现明显变弱。
//
// 与磁盘技能的关系见 skills/manager.ts：工作区 > 全局 > 内置 > 插件。
// 内置版优先于插件市场装的同名旧副本，保证说明书始终与当前版本的工具一致。

export interface BuiltinSkill {
  name: string
  description: string
  body: string
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: 'office-word',
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
      '- 支持 `#` ~ `######` **六级**标题、**粗体**/*斜体*/`等宽`/~~删除线~~、`|` 表格、``` 代码块、`>` 引用',
      '- **多级列表**：靠前导空格分层（每 2 个空格一级），会生成递进缩进与不同项目符号',
      '- **分页**：单独一行写 `<!-- pagebreak -->` 即插入分页符（法律文书每份单独起页很常用）',
      '- **页眉页脚**：`write_docx` 的 `header`/`footer` 参数；页脚里用 `{page}`/`{pages}` 插入页码与总页数，',
      '  例：`{"path":"文书.docx","markdown":"…","header":"湖北立丰律师事务所","footer":"第 {page} 页 共 {pages} 页"}`',
      '- **排版默认值**：正文宋体小四、1.5 倍行距、**首行自动缩进 2 字符**（中文公文惯例）——',
      '  不要在文本里手动加全角空格来缩进，会重复缩进。',
      '- 例：`{"path": "季度报告.docx", "markdown": "# 季度报告\\n\\n## 概述\\n…"}`',
      '- **内嵌图片**：Markdown 里用 `![说明](相对路径.png)` 引用工作区图片（PNG/JPEG/GIF），自动嵌入。',
      '',
      '## 修改已有文档',
      '流程：`read_document` 读出正文 → 按用户要求改写成新 Markdown → `write_docx` 生成新文件',
      '（建议输出为 `原名-修订.docx`，不要覆盖原件）。',
      '',
      '## 进阶（复杂排版：页眉页脚/精确样式）',
      '内置生成器覆盖不了的，可退回 Python 方案：`pip install python-docx` 后写脚本经 run_command 执行。'
    ].join('\n')
  },
  {
    name: 'office-excel',
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
      '- 列宽按内容自动计算（中文按双宽），表头行自动冻结，大表滚动时表头不跑。',
      '- **图表**：给工作表加 `chart`（type=column/bar/line/pie），默认类别取首列、系列取其余列：',
      '  `{"path":"销量.xlsx","rows":[["月","A","B"],["1月",120,90]],"chart":{"type":"column","title":"销量"}}`',
      '',
      '## 修改/汇总已有表格',
      '`read_document` 读出数据 → 在回复里计算/整理 → `write_xlsx` 输出新文件。',
      '',
      '## 公式与数据保真',
      '单元格以 `=` 开头即写成公式，打开时自动计算：`["合计", "=SUM(B2:B10)"]`。',
      '身份证号/银行卡号/前导零编号会自动保持文本格式，不丢精度。',
      '',
      '## 进阶（条件格式/精确样式）',
      '需要时退回 Python：`pip install openpyxl`，经 run_command 执行。'
    ].join('\n')
  },
  {
    name: 'office-ppt',
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
      '- 标题与要点里可用 `**粗体**`/`*斜体*`/`~~删除线~~`，会转成真正的字体样式（不会字面显示）。',
      '- **演讲者备注**：每页可加 `notes` 字段（讲稿/要点说明，放映时只有演讲者可见）。',
      '- **配图页**：`{"title":"效果图","image":"shot.png"}`（工作区图片路径）。',
      '- **图表页**：`{"title":"销量","chart":{"type":"column","categories":["1月","2月"],"series":[{"name":"A","values":[120,150]}]}}`。',
      '',
      '## 进阶（自定义版式）',
      '内置生成器只做「标题+要点」版式；复杂设计退回 Python：`pip install python-pptx`，经 run_command 执行。'
    ].join('\n')
  },
  {
    name: 'doc-pdf',
    description:
      '处理 PDF：read_document 提取文本（扫描件在 macOS 自动 OCR）、export_pdf 导出精排 PDF、pdf_pages 合并拆分。原生内置。',
    body: [
      '# PDF 文档处理',
      '',
      '## 读取',
      '`read_document` 直接提取文本型 PDF 的文字（中文 CID 编码可还原）。',
      '**扫描件（纯图片）在 macOS 上会自动用系统 OCR（Apple Vision）识别**（结果带识别误差提示）；',
      'Windows 上无此回退，应如实告知用户需要文字版或外部 OCR 工具。',
      '',
      '## 生成（推荐路径）',
      '`export_pdf` 把 Markdown 导出为排版精良的 PDF（Chromium 打印引擎：中文、表格、代码块完整支持；',
      '同样支持六级标题、多级嵌套列表、~~删除线~~，以及 `<!-- pagebreak -->` 分页）：',
      '`{"path": "方案.pdf", "markdown": "# 项目方案\\n\\n| 阶段 | 时间 |\\n|---|---|\\n| 一期 | 3月 |", "title": "项目方案"}`',
      '',
      '## 页操作（合并/拆分/抽页/旋转）',
      '用 `pdf_pages` 工具：',
      '- 合并：`{"operation":"merge","output":"合订.pdf","inputs":["a.pdf","b.pdf"]}`',
      '- 抽页/拆分：`{"operation":"extract","output":"节选.pdf","input":"全本.pdf","pages":"1-3,5"}`',
      '- 旋转：`{"operation":"rotate","output":"正向.pdf","input":"横的.pdf","rotate":90}`（省略 pages=全部）。加密 PDF 无法操作。',
      '',
      '## 进阶（表格坐标级提取）',
      '需要精确表格结构时退回 Python：`pip install pdfplumber`，经 run_command 执行。'
    ].join('\n')
  },
  {
    name: 'data-csv',
    description:
      '处理 CSV/TSV：read_document 直读、write_csv 生成；大数据量可转 Excel 或用 Python。',
    body: [
      '# CSV / TSV 数据处理',
      '',
      '## 读取',
      '`read_document` 直接读 .csv/.tsv（自动识别分隔符、处理引号转义与 BOM）。',
      '',
      '## 生成',
      '`write_csv` 由二维数组生成：`{"path":"结果.csv","rows":[["名称","数量"],["苹果",3]]}`',
      '- 需要 TSV：`{"path":"结果.tsv","delimiter":"\\t"}`',
      '- 含中文时默认写 BOM，Excel 打开不乱码。',
      '',
      '## 分析建议',
      '- 数据量小（几百行内）：`read_document` 读出后直接在回复里统计、必要时 `write_xlsx` 出带图表的报表。',
      '- 数据量大或需复杂统计：写 Python 脚本经 run_command 执行（`pip install pandas`）。'
    ].join('\n')
  }
]

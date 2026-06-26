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
    description: '创建/读取/编辑 Word 文档（基于 python-docx）',
    category: '办公文档',
    icon: '📝',
    skill: {
      description:
        '处理 Word .docx：读取文本、创建/修改文档、加标题/表格。需要 Python + python-docx。',
      body: [
        '# Word 文档（.docx）处理',
        '',
        '当用户需要**创建/读取/修改 .docx**时使用本技能。底层用 Python 的 `python-docx` 库，经 run_command 执行。',
        '',
        '## 准备（首次）',
        '先确认依赖：`python -c "import docx"`；若报错则 `pip install python-docx`（Windows 用 `py -m pip install python-docx`）。',
        '',
        '## 读取',
        '把脚本写成临时 .py 再运行，避免命令行转义问题：',
        '```python',
        'import docx, sys',
        'd = docx.Document(sys.argv[1])',
        'print("\\n".join(p.text for p in d.paragraphs))',
        '```',
        '用 write_file 写成 `_read_docx.py`，再 `run_command: python _read_docx.py 目标.docx`。',
        '',
        '## 创建/修改',
        '```python',
        'import docx',
        'doc = docx.Document()            # 或 docx.Document("已有.docx")',
        'doc.add_heading("标题", level=1)',
        'doc.add_paragraph("正文段落")',
        't = doc.add_table(rows=1, cols=2); t.rows[0].cells[0].text="A"; t.rows[0].cells[1].text="B"',
        'doc.save("输出.docx")',
        '```',
        '完成后用自然语言总结生成/修改了哪些内容与文件名。'
      ].join('\n')
    }
  },
  {
    id: 'office-excel',
    name: 'Excel 表格（.xlsx）',
    description: '读写 Excel、公式、多工作表（基于 openpyxl）',
    category: '办公文档',
    icon: '📊',
    skill: {
      description: '处理 Excel .xlsx：读取/写入单元格、公式、多 sheet。需要 Python + openpyxl。',
      body: [
        '# Excel 表格（.xlsx）处理',
        '',
        '当用户需要**读写 .xlsx / 生成报表**时使用。底层用 `openpyxl`，经 run_command 执行。',
        '',
        '## 准备',
        '`python -c "import openpyxl"`；缺失则 `pip install openpyxl`。',
        '',
        '## 读取',
        '```python',
        'import openpyxl, sys',
        'wb = openpyxl.load_workbook(sys.argv[1], data_only=True)',
        'ws = wb.active',
        'for row in ws.iter_rows(values_only=True): print(row)',
        '```',
        '',
        '## 写入 / 生成',
        '```python',
        'import openpyxl',
        'wb = openpyxl.Workbook(); ws = wb.active; ws.title = "数据"',
        'ws.append(["姓名", "分数"]); ws.append(["张三", 90])',
        'ws["C1"] = "=AVERAGE(B2:B2)"   # 支持公式',
        'wb.save("输出.xlsx")',
        '```',
        '大批量数据优先用 pandas（见「数据分析」插件）。'
      ].join('\n')
    }
  },
  {
    id: 'office-ppt',
    name: 'PowerPoint（.pptx）',
    description: '生成/编辑幻灯片、标题页、要点（基于 python-pptx）',
    category: '办公文档',
    icon: '📑',
    skill: {
      description: '处理 PowerPoint .pptx：新建幻灯片、标题/正文/要点。需要 Python + python-pptx。',
      body: [
        '# PowerPoint（.pptx）处理',
        '',
        '当用户需要**做幻灯片/演示文稿**时使用。底层用 `python-pptx`。',
        '',
        '## 准备',
        '`python -c "import pptx"`；缺失则 `pip install python-pptx`。',
        '',
        '## 生成',
        '```python',
        'from pptx import Presentation',
        'from pptx.util import Inches, Pt',
        'prs = Presentation()',
        '# 标题页',
        's = prs.slides.add_slide(prs.slide_layouts[0])',
        's.shapes.title.text = "演示标题"; s.placeholders[1].text = "副标题"',
        '# 要点页',
        's2 = prs.slides.add_slide(prs.slide_layouts[1])',
        's2.shapes.title.text = "议程"',
        'tf = s2.placeholders[1].text_frame; tf.text = "第一点"',
        'p = tf.add_paragraph(); p.text = "第二点"',
        'prs.save("输出.pptx")',
        '```',
        '先和用户确认大纲（每页标题+要点），再逐页生成。'
      ].join('\n')
    }
  },
  {
    id: 'doc-pdf',
    name: 'PDF 文档',
    description: '提取 PDF 文本/表格、由 Markdown 生成 PDF',
    category: '办公文档',
    icon: '📕',
    skill: {
      description: '读取 PDF 文本/表格（pdfplumber），或由内容生成 PDF。需要 Python + pdfplumber。',
      body: [
        '# PDF 文档处理',
        '',
        '## 读取（提取文本/表格）',
        '`python -c "import pdfplumber"`；缺失则 `pip install pdfplumber`。',
        '```python',
        'import pdfplumber, sys',
        'with pdfplumber.open(sys.argv[1]) as pdf:',
        '    for i, page in enumerate(pdf.pages):',
        '        print(f"--- page {i+1} ---")',
        '        print(page.extract_text() or "")',
        '        for tbl in page.extract_tables(): print(tbl)',
        '```',
        '',
        '## 生成 PDF',
        '简单文档可用 `reportlab`（`pip install reportlab`）；',
        '若内容是 Markdown，可先写成 .md，再用现有命令行工具（如 pandoc/wkhtmltopdf，若可用）转 PDF。',
        '生成前确认页面内容与文件名。'
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
        '先 `head()`/`info()` 了解数据结构，再按用户目标聚合；结果可存回 CSV/Excel。'
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

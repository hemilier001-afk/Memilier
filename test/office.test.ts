import { existsSync, readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crc32, readZip, writeZip, xmlEsc, xmlUnesc } from '../src/main/office/zip'
import {
  extractAny,
  extractDocx,
  extractPdf,
  extractPptx,
  extractXlsx
} from '../src/main/office/extract'
import { ocrAvailable } from '../src/main/office/ocr'
import { markdownToDocx } from '../src/main/office/docx'
import { colRef, rowsToXlsx } from '../src/main/office/xlsx'
import { slidesToPptx } from '../src/main/office/pptx'
import { mdToHtml } from '../src/main/office/pdf'

describe('zip 容器', () => {
  it('crc32 标准校验值', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })
  it('写→读 往返（含中文名与中文内容）', () => {
    const zip = writeZip([
      { name: 'a.txt', data: 'hello' },
      { name: '目录/中文文件.xml', data: '<r>你好，hemilier</r>' }
    ])
    const files = readZip(zip)
    expect(files.get('a.txt')!.toString()).toBe('hello')
    expect(files.get('目录/中文文件.xml')!.toString()).toBe('<r>你好，hemilier</r>')
  })
  it('xml 转义往返', () => {
    const raw = `<a & "b" 'c'>`
    expect(xmlUnesc(xmlEsc(raw))).toBe(raw)
  })
})

describe('docx 生成 ↔ 提取', () => {
  it('Markdown 生成的文档能被提取回文本', () => {
    const buf = markdownToDocx(
      '# 季度报告\n\n本季度**营收增长**显著。\n\n- 要点一\n- 要点二\n\n| 项目 | 数值 |\n|---|---|\n| 营收 | 1200 |'
    )
    const text = extractDocx(buf)
    expect(text).toContain('季度报告')
    expect(text).toContain('营收增长')
    expect(text).toContain('要点一')
    expect(text).toContain('1200')
  })
  it('document.xml 使用标题样式且正确转义', () => {
    const buf = markdownToDocx('# A&B <标题>')
    const xml = readZip(buf).get('word/document.xml')!.toString()
    expect(xml).toContain('w:pStyle w:val="Heading1"')
    expect(xml).toContain('A&amp;B &lt;标题&gt;')
    expect(readZip(buf).has('word/styles.xml')).toBe(true)
  })
  it('表格提取保行列结构（行=换行、单元格=tab）', () => {
    const buf = markdownToDocx('| 项目 | 数值 |\n|---|---|\n| 营收 | 1200 |')
    const text = extractDocx(buf)
    expect(text).toContain('项目\t数值')
    expect(text).toContain('营收\t1200')
  })
  it('粗体内含单星号不破坏解析', () => {
    const buf = markdownToDocx('**a*b**')
    const xml = readZip(buf).get('word/document.xml')!.toString()
    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('a*b')
  })
})

describe('xlsx 生成 ↔ 提取', () => {
  it('列引用 A/Z/AA', () => {
    expect(colRef(0)).toBe('A')
    expect(colRef(25)).toBe('Z')
    expect(colRef(26)).toBe('AA')
  })
  it('二维数组往返（数字成数值单元格）', () => {
    const buf = rowsToXlsx([
      {
        name: '销售',
        rows: [
          ['月份', '销售额'],
          ['1月', 1200],
          ['2月', '1500'] // 字符串数字也按数值写
        ]
      }
    ])
    const text = extractXlsx(buf)
    expect(text).toContain('工作表：销售')
    expect(text).toContain('月份\t销售额')
    expect(text).toContain('1月\t1200')
    const xml = readZip(buf).get('xl/worksheets/sheet1.xml')!.toString()
    expect(xml).toContain('t="n"><v>1200</v>')
    expect(xml).toContain('t="n"><v>1500</v>')
  })
  it('多工作表', () => {
    const buf = rowsToXlsx([
      { name: 'Q1', rows: [['a']] },
      { name: 'Q2', rows: [['b']] }
    ])
    const text = extractXlsx(buf)
    expect(text).toContain('工作表：Q1')
    expect(text).toContain('工作表：Q2')
  })
  it('数据保真：身份证号/前导零保文本，普通数字仍是数值', () => {
    const buf = rowsToXlsx([
      {
        name: 'S',
        rows: [
          ['姓名', '身份证号', '编号', '金额'],
          ['张三', '110101199001011234', '007', '1200.5']
        ]
      }
    ])
    const xml = readZip(buf).get('xl/worksheets/sheet1.xml')!.toString()
    expect(xml).toContain('>110101199001011234</t>') // 18 位 → 文本，防浮点丢精度
    expect(xml).toContain('>007</t>') // 前导零 → 文本
    expect(xml).toContain('t="n"><v>1200.5</v>') // 常规数字仍是数值
  })
  it('公式单元格：= 开头写成 <f>', () => {
    const buf = rowsToXlsx([
      {
        name: 'S',
        rows: [
          ['a', 1],
          ['合计', '=SUM(B1:B1)']
        ]
      }
    ])
    const xml = readZip(buf).get('xl/worksheets/sheet1.xml')!.toString()
    expect(xml).toContain('<f>SUM(B1:B1)</f>')
    expect(xml).not.toContain('=SUM') // 公式体不含等号前缀
  })
  it('工作表名消毒：非法字符/超长/重名', () => {
    const buf = rowsToXlsx([
      { name: '2024/Q1:预算*汇总表格名字超长超长超长超长超长超长超长', rows: [['a']] },
      { name: 'X', rows: [['b']] },
      { name: 'X', rows: [['c']] }
    ])
    const wb = readZip(buf).get('xl/workbook.xml')!.toString()
    const names = [...wb.matchAll(/name="([^"]*)"/g)].map((m) => m[1])
    for (const n of names) {
      expect(n).not.toMatch(/[\\/:*?[\]]/)
      expect(n.length).toBeLessThanOrEqual(31)
    }
    expect(new Set(names).size).toBe(3) // 重名被唯一化
  })
  it('提取稀疏行按列引用对位（空单元格不顶列）', () => {
    // 手工构造 A1 与 C1 有值、B1 缺失的表
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="C1" t="inlineStr"><is><t>c</t></is></c></row></sheetData></worksheet>`
    const buf = writeZip([
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
      },
      {
        name: 'xl/workbook.xml',
        data: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="S" sheetId="1"/></sheets></workbook>'
      },
      { name: 'xl/worksheets/sheet1.xml', data: sheet }
    ])
    expect(extractXlsx(buf)).toContain('a\t\tc')
  })
})

describe('pptx 生成 ↔ 提取', () => {
  it('大纲往返', () => {
    const buf = slidesToPptx([
      { title: '项目提案', bullets: ['背景与目标', '实施路线'] },
      { title: '预算', bullets: ['一期 100 万'] }
    ])
    const text = extractPptx(buf)
    expect(text).toContain('--- 幻灯片 1 ---')
    expect(text).toContain('项目提案')
    expect(text).toContain('实施路线')
    expect(text).toContain('--- 幻灯片 2 ---')
    expect(text).toContain('预算')
    // ECMA-376 必需件齐全（PowerPoint 打开的前提）
    const files = readZip(buf)
    // 正文自动缩字防溢出
    const slideXml = files.get('ppt/slides/slide1.xml')!.toString()
    expect(slideXml).toContain('<a:normAutofit/>')
    for (const part of [
      'ppt/presentation.xml',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/theme/theme1.xml',
      'ppt/slides/slide1.xml',
      'ppt/slides/_rels/slide1.xml.rels'
    ]) {
      expect(files.has(part), part).toBe(true)
    }
  })
})

describe('pdf 提取', () => {
  it('从未压缩内容流提取 Tj 文本（无页面结构的兜底路径）', () => {
    const pdf = [
      '%PDF-1.4',
      '1 0 obj << /Length 60 >> stream',
      'BT /F1 12 Tf 72 700 Td (Hello hemilier) Tj [(Second) (Part)] TJ ET',
      'endstream endobj',
      'trailer << /Root 1 0 R >>',
      '%%EOF'
    ].join('\n')
    const text = extractPdf(Buffer.from(pdf, 'latin1'))
    expect(text).toContain('Hello hemilier')
    expect(text).toContain('SecondPart')
  })
  it('CID 编码：经 ToUnicode CMap 还原中文（现代中文 PDF 的标准形态）', () => {
    const cmap = [
      'begincmap',
      '2 beginbfchar',
      '<0001> <4F60>', // 你
      '<0002> <597D>', // 好
      'endbfchar',
      '1 beginbfrange',
      '<0010> <0012> <0041>', // A B C
      'endbfrange',
      'endcmap'
    ].join('\n')
    const pdf = [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
      '4 0 obj << /Type /Font /Subtype /Type0 /ToUnicode 6 0 R >> endobj',
      '5 0 obj << /Length 40 >> stream',
      'BT /F1 12 Tf <00010002> Tj 0 -14 Td <001000110012> Tj ET',
      'endstream endobj',
      `6 0 obj << /Length ${cmap.length} >> stream`,
      cmap,
      'endstream endobj',
      '%%EOF'
    ].join('\n')
    const text = extractPdf(Buffer.from(pdf, 'latin1'))
    expect(text).toContain('你好')
    expect(text).toContain('ABC')
    // 0 -14 Td 是真换行（y≠0）
    expect(text).toMatch(/你好\n/)
  })
  it('ASCII85+Flate 滤镜链（ReportLab 系生成器的常态）', () => {
    const enc85 = (buf: Buffer): string => {
      let out = ''
      for (let i = 0; i < buf.length; i += 4) {
        const chunk = Buffer.concat([buf.subarray(i, i + 4), Buffer.alloc(4)]).subarray(0, 4)
        const n = chunk.length >= 4 ? (buf.length - i >= 4 ? 4 : buf.length - i) : 4
        let tuple = ((chunk[0] << 24) >>> 0) + (chunk[1] << 16) + (chunk[2] << 8) + chunk[3]
        const five: number[] = []
        for (let k = 0; k < 5; k++) {
          five.unshift(tuple % 85)
          tuple = Math.floor(tuple / 85)
        }
        const keep = buf.length - i >= 4 ? 5 : buf.length - i + 1
        out += five
          .slice(0, keep)
          .map((c) => String.fromCharCode(c + 33))
          .join('')
        void n
      }
      return out
    }
    const content = 'BT /F1 12 Tf 72 700 Td (Chain A85 works) Tj ET'
    const a85 = enc85(deflateSync(Buffer.from(content, 'latin1'))) + '~>'
    const pdf = [
      '%PDF-1.4',
      `1 0 obj << /Length ${a85.length} /Filter [ /ASCII85Decode /FlateDecode ] >> stream`,
      a85,
      'endstream endobj',
      '%%EOF'
    ].join('\n')
    const text = extractPdf(Buffer.from(pdf, 'latin1'))
    expect(text).toContain('Chain A85 works')
  })
  it('无文本时给出如实说明', () => {
    const text = extractPdf(Buffer.from('%PDF-1.4\n%%EOF', 'latin1'))
    expect(text).toContain('未能从该 PDF 提取到文本')
  })
  it('加密 PDF 明确提示受密码保护（而非误报扫描件）', () => {
    const pdf = '%PDF-1.4\ntrailer << /Encrypt 5 0 R /Root 1 0 R >>\n%%EOF'
    const text = extractPdf(Buffer.from(pdf, 'latin1'))
    expect(text).toContain('已加密')
    expect(text).not.toContain('扫描件')
  })
  it('真实文件：Chromium 生成的中文操作手册 PDF', () => {
    const p = resolve(__dirname, '../docs/操作手册.pdf')
    if (!existsSync(p)) return // 仓库无此文件时跳过
    const text = extractPdf(readFileSync(p))
    expect(text.length).toBeGreaterThan(3000)
    expect(text).toContain('它能做什么')
    expect(text).toContain('Ollama')
    expect(text).toContain('Hemilier') // 拉丁字形逐字定位应被正确拼回单词
  })
})

describe('extractAny（异步入口）与 OCR 可用性', () => {
  it('extractAny 异步返回 docx 文本', async () => {
    const buf = markdownToDocx('# 异步入口')
    await expect(extractAny('a.docx', buf)).resolves.toContain('异步入口')
  })
  it('ocrAvailable 返回布尔且不抛错', () => {
    expect(typeof ocrAvailable()).toBe('boolean')
  })
})

describe('mdToHtml（export_pdf 的排版层）', () => {
  it('标题/表格/代码/转义', () => {
    const html = mdToHtml('# 标题\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\n<script>\n```')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('&lt;script&gt;') // 代码块内容被转义
    expect(html).not.toContain('<script>')
  })
  it('列表与行内样式', () => {
    const html = mdToHtml('- **重点** 与 `代码`\n- 次点')
    expect(html).toContain('<ul>')
    expect(html).toContain('<strong>重点</strong>')
    expect(html).toContain('<code>代码</code>')
  })
})

// ============ 第二批：CSV / 图表 / 嵌图 / 修订 / PDF页操作 ============
import { parseCsv, toCsv, csvToDisplay } from '../src/main/office/csv'
import { excelChartXml, pptChartXml, chartDataRows } from '../src/main/office/chart'
import { imageSize } from '../src/main/office/imagesize'
import { extractDocxRevisions } from '../src/main/office/extract'
import { markdownToDocx as mdDocx } from '../src/main/office/docx'
import { slidesToPptx as toPptx } from '../src/main/office/pptx'
import { rowsToXlsx as toXlsx } from '../src/main/office/xlsx'
import {
  mergePdfs,
  extractPages,
  rotatePages,
  parsePageRange,
  pdfPageCount
} from '../src/main/office/pdfops'

describe('CSV/TSV 读写', () => {
  it('解析含引号/逗号/换行的字段', () => {
    const rows = parseCsv('a,b,c\n"x,1","y\nz","w""q"')
    expect(rows[0]).toEqual(['a', 'b', 'c'])
    expect(rows[1]).toEqual(['x,1', 'y\nz', 'w"q'])
  })
  it('制表符/分号分隔自动识别', () => {
    expect(parseCsv('a\tb\t c')[0]).toEqual(['a', 'b', ' c'])
    expect(parseCsv('a;b;c')[0]).toEqual(['a', 'b', 'c'])
  })
  it('写出往返（含 BOM 与转义）', () => {
    const csv = toCsv([
      ['名称', '备注'],
      ['苹果', '甜,脆']
    ])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('"甜,脆"')
    expect(parseCsv(csv)[1]).toEqual(['苹果', '甜,脆'])
  })
  it('csvToDisplay → TSV 对齐', () => {
    expect(csvToDisplay('a,b\n1,2')).toBe('a\tb\n1\t2')
  })
  it('extractAny 路由 .csv/.tsv', async () => {
    await expect(extractAny('d.csv', Buffer.from('x,y\n1,2'))).resolves.toBe('x\ty\n1\t2')
  })
})

describe('图片尺寸解析', () => {
  it('识别真实 PNG（build/icon.png）', () => {
    const p = resolve(__dirname, '../build/icon.png')
    if (!existsSync(p)) return
    const info = imageSize(readFileSync(p))
    expect(info?.ext).toBe('png')
    expect(info!.width).toBeGreaterThan(0)
    expect(info!.height).toBeGreaterThan(0)
  })
  it('非图片返回 null', () => {
    expect(imageSize(Buffer.from('hello'))).toBeNull()
  })
})

describe('图表 XML', () => {
  it('Excel 图表引用本表单元格 + 缓存值', () => {
    const xml = excelChartXml(
      {
        type: 'column',
        title: 'T',
        categories: ['1月', '2月'],
        series: [{ name: 'A', values: [10, 20] }]
      },
      '数据',
      { catCol: 0, serCols: [1], headerRow: 1, firstDataRow: 2 }
    )
    expect(xml).toContain("<c:f>'数据'!$A$2:$A$3</c:f>")
    expect(xml).toContain("<c:f>'数据'!$B$2:$B$3</c:f>")
    expect(xml).toContain('<c:barDir val="col"/>')
    expect(xml).toContain('<c:v>10</c:v>')
  })
  it('折线/饼图类型正确', () => {
    const line = pptChartXml({
      type: 'line',
      categories: ['a'],
      series: [{ name: 's', values: [1] }]
    })
    expect(line).toContain('<c:lineChart>')
    const pie = pptChartXml({
      type: 'pie',
      categories: ['a', 'b'],
      series: [{ name: 's', values: [1, 2] }]
    })
    expect(pie).toContain('<c:pieChart>')
  })
  it('chartDataRows 布局：表头 + 类别行', () => {
    const rows = chartDataRows({
      type: 'bar',
      categories: ['x', 'y'],
      series: [{ name: 'A', values: [1, 2] }]
    })
    expect(rows[0]).toEqual(['', 'A'])
    expect(rows[1]).toEqual(['x', 1])
  })
  it('带图表的 xlsx 含图表部件', () => {
    const buf = toXlsx([
      {
        name: 'S',
        rows: [
          ['月', '量'],
          ['1月', 5]
        ],
        chart: { type: 'column' }
      }
    ])
    const files = readZip(buf)
    expect(files.has('xl/charts/chart1.xml')).toBe(true)
    expect(files.has('xl/drawings/drawing1.xml')).toBe(true)
    expect(files.get('xl/worksheets/sheet1.xml')!.toString()).toContain('<drawing r:id="rId1"/>')
  })
})

describe('docx 内嵌图片', () => {
  it('![](png) 生成图片 drawing + media 部件', () => {
    const p = resolve(__dirname, '../build/icon.png')
    if (!existsSync(p)) return
    const images = new Map([['logo.png', readFileSync(p)]])
    const buf = mdDocx('# 标题\n\n![标志](logo.png)\n\n正文', images)
    const files = readZip(buf)
    expect([...files.keys()].some((k) => k.startsWith('word/media/image'))).toBe(true)
    expect(files.get('word/document.xml')!.toString()).toContain('<a:blip')
    // 提取仍正常（图片不破坏文本层）
    expect(extractDocx(buf)).toContain('标题')
  })
  it('图片缺失时退回 alt 文本，不报错', () => {
    const buf = mdDocx('![缺图](nope.png)')
    expect(extractDocx(buf)).toContain('缺图')
  })
})

describe('pptx 图片/图表', () => {
  it('图表页含 chart + 内嵌工作簿', () => {
    const buf = toPptx([
      {
        title: '图表',
        chart: { type: 'column', categories: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] }
      }
    ])
    const files = readZip(buf)
    expect(files.has('ppt/charts/chart1.xml')).toBe(true)
    expect(files.has('ppt/embeddings/workbook1.xlsx')).toBe(true)
    expect(files.get('ppt/charts/chart1.xml')!.toString()).toContain('<c:externalData')
  })
})

describe('docx 批注/修订提取', () => {
  it('提取 w:ins/w:del 与批注', () => {
    // 手工构造带修订与批注的最小 docx
    const doc = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:ins w:author="张三"><w:r><w:t>新增文字</w:t></w:r></w:ins><w:del w:author="李四"><w:r><w:delText>删除文字</w:delText></w:r></w:del></w:p></w:body></w:document>`
    const comments = `<?xml version="1.0"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:comment w:id="1" w:author="王五" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>这里需要复核</w:t></w:r></w:p></w:comment></w:comments>`
    const buf = writeZip([
      { name: 'word/document.xml', data: doc },
      { name: 'word/comments.xml', data: comments }
    ])
    const rev = extractDocxRevisions(buf)
    expect(rev).toContain('王五')
    expect(rev).toContain('这里需要复核')
    expect(rev).toContain('插入（张三）：新增文字')
    expect(rev).toContain('删除（李四）：删除文字')
  })
})

describe('PDF 页操作', () => {
  const manual = resolve(__dirname, '../docs/操作手册.pdf')
  it('parsePageRange 解析页码规格', () => {
    expect(parsePageRange('1-3,5', 10)).toEqual([0, 1, 2, 4])
    expect(parsePageRange('8-', 10)).toEqual([7, 8, 9])
    expect(parsePageRange('99', 10)).toEqual([])
  })
  it('抽页/合并/旋转（真实多页 PDF，装配后可重新解析）', () => {
    if (!existsSync(manual)) return
    const buf = readFileSync(manual)
    const total = pdfPageCount(buf)
    expect(total).toBeGreaterThan(2)
    const ex = extractPages(buf, '1-2')
    expect(pdfPageCount(ex)).toBe(2)
    const merged = mergePdfs([extractPages(buf, '1'), extractPages(buf, '2-3')])
    expect(pdfPageCount(merged)).toBe(3)
    const rot = rotatePages(buf, 90, '1')
    expect(pdfPageCount(rot)).toBe(total)
  })
  it('加密 PDF 拒绝操作', () => {
    const fake = Buffer.from('%PDF-1.4\n1 0 obj<</Encrypt 2 0 R>>endobj\n%%EOF', 'latin1')
    expect(() => pdfPageCount(fake)).toThrow(/加密/)
  })
})

describe('Markdown 表现力（实测踩过的坑）', () => {
  it('docx：四~六级标题不再把 # 符号写进文档', () => {
    const text = extractDocx(markdownToDocx('#### 四级\n##### 五级\n###### 六级'))
    expect(text).toContain('四级')
    expect(text).not.toContain('#') // 旧实现只支持到 H3，"#### 四级"原样输出
    const xml = readZip(markdownToDocx('#### 四级')).get('word/styles.xml')!.toString()
    expect(xml).toContain('Heading4') // 样式必须真实存在，否则 Word 里退化成正文
  })

  it('docx：嵌套列表按层级递增缩进（旧实现三级完全相同）', () => {
    const xml = readZip(markdownToDocx('- 一级\n  - 二级\n    - 三级'))
      .get('word/document.xml')!
      .toString()
    const lefts = [...xml.matchAll(/w:left="(\d+)"/g)].map((m) => Number(m[1]))
    expect(lefts[0]).toBeLessThan(lefts[1])
    expect(lefts[1]).toBeLessThan(lefts[2])
  })

  it('docx：删除线与分页符', () => {
    expect(readZip(markdownToDocx('~~作废~~')).get('word/document.xml')!.toString()).toContain(
      '<w:strike/>'
    )
    expect(
      readZip(markdownToDocx('甲\n\n<!-- pagebreak -->\n\n乙')).get('word/document.xml')!.toString()
    ).toContain('w:br w:type="page"')
  })

  it('PDF：嵌套列表生成真正的嵌套 ul，标题支持到 h6', () => {
    const html = mdToHtml('- 一级\n  - 二级').replace(/\n/g, '')
    expect(html).toBe('<ul><li>一级</li><ul><li>二级</li></ul></ul>')
    expect(mdToHtml('##### 五级')).toBe('<h5>五级</h5>')
    expect(mdToHtml('~~删除~~')).toContain('<del>删除</del>')
  })

  it('pptx：要点里的 **粗体** 变成真正的加粗，而不是字面显示', () => {
    const buf = slidesToPptx([{ title: '标题**重点**', bullets: ['要点**粗**'] }])
    expect(readZip(buf).get('ppt/slides/slide1.xml')!.toString()).toContain('b="1"')
    expect(extractPptx(buf)).not.toContain('**') // 旧实现幻灯片上会出现字面的 **
  })
})

describe('中文排版与表格可读性', () => {
  it('docx：正文段落首行缩进 2 字符，标题/列表不缩进', () => {
    const xml = readZip(markdownToDocx('正文一段。\n\n# 标题\n\n- 列表'))
      .get('word/document.xml')!
      .toString()
    // 只有正文那一段带首行缩进
    expect([...xml.matchAll(/firstLineChars="200"/g)]).toHaveLength(1)
  })

  it('docx：正文默认小四（24 半磅）+ 中文宋体', () => {
    const st = readZip(markdownToDocx('x')).get('word/styles.xml')!.toString()
    expect(st).toContain('w:sz w:val="24"')
    expect(st).toContain('w:eastAsia="宋体"')
  })

  it('xlsx：按内容自动列宽（中文按双宽算），并冻结表头行', () => {
    const buf = rowsToXlsx([
      {
        name: 'S',
        rows: [
          ['姓名', '申请执行标的金额'],
          ['张三', 1234567.89]
        ]
      }
    ])
    const xml = readZip(buf).get('xl/worksheets/sheet1.xml')!.toString()
    const widths = [...xml.matchAll(/width="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(widths).toHaveLength(2)
    expect(widths[1]).toBeGreaterThan(widths[0]) // 8 个汉字的列明显更宽
    expect(xml).toContain('state="frozen"') // 大表滚动时表头不跑
  })

  it('xlsx：列宽有上下限，超长内容不会把表撑爆', () => {
    const buf = rowsToXlsx([{ name: 'S', rows: [['x'.repeat(500)], ['a']] }])
    const xml = readZip(buf).get('xl/worksheets/sheet1.xml')!.toString()
    const w = Number(/width="([\d.]+)"/.exec(xml)![1])
    expect(w).toBeLessThanOrEqual(60)
    expect(w).toBeGreaterThanOrEqual(8)
  })
})

describe('xlsx 读取保真（实测踩过的坑）', () => {
  /** 构造一个带样式的最小 xlsx：A1 为日期格式(numFmtId=14)，B1 为普通数字 */
  function makeSheet(cells: string, styles: string): Buffer {
    return writeZip([
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
      },
      {
        name: 'xl/workbook.xml',
        data: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="S" sheetId="1"/></sheets></workbook>'
      },
      { name: 'xl/styles.xml', data: styles },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells}</row></sheetData></worksheet>`
      }
    ])
  }
  const STYLES_DATE =
    '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'

  it('日期序列号还原成可读日期（否则"出生日期"会读成 34908）', () => {
    // 34908 = 1995-07-28；s="1" 指向 numFmtId=14 的日期格式
    const buf = makeSheet(
      '<c r="A1" s="1"><v>34908</v></c><c r="B1" s="0"><v>34908</v></c>',
      STYLES_DATE
    )
    const text = extractXlsx(buf)
    expect(text).toContain('1995-07-28') // 日期格式的列
    expect(text).toContain('34908') // 非日期格式的列保持原样，不误转
  })

  it('自定义 yyyy-mm-dd 格式同样识别', () => {
    const styles =
      '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts><numFmt numFmtId="176" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="1"><xf numFmtId="176"/></cellXfs></styleSheet>'
    expect(extractXlsx(makeSheet('<c r="A1" s="0"><v>45000</v></c>', styles))).toMatch(
      /\d{4}-\d{2}-\d{2}/
    )
  })

  it('单元格内换行被压平，不再打散 TSV 行列对齐', () => {
    const buf = rowsToXlsx([
      {
        name: 'S',
        rows: [
          ['剩余本金\n（元）', '备注'],
          ['100', 'x']
        ]
      }
    ])
    const lines = extractXlsx(buf).split('\n')
    // 表头必须是完整一行两列，而不是被换行拆成多行
    expect(lines[1]).toBe('剩余本金 （元）\t备注')
    expect(lines[2]).toBe('100\tx')
  })
})

describe('Word 页眉页脚 / PPT 演讲者备注（此前完全丢失）', () => {
  it('docx：页眉页脚可生成，且能被读回', () => {
    const buf = markdownToDocx('正文', undefined, {
      header: '湖北立丰律师事务所',
      footer: '第 {page} 页 共 {pages} 页'
    })
    const text = extractDocx(buf)
    expect(text).toContain('【页眉】湖北立丰律师事务所')
    expect(text).toContain('【页脚】第 1 页 共 1 页') // 域代码 PAGE/NUMPAGES 不该出现在正文
    expect(text).not.toContain('NUMPAGES')
    // {page} 必须落成真正的页码域，而不是死字
    expect(readZip(buf).get('word/footer1.xml')!.toString()).toContain('PAGE')
  })

  it('docx：不传页眉页脚时不生成多余部件', () => {
    const files = readZip(markdownToDocx('正文'))
    expect(files.has('word/header1.xml')).toBe(false)
    expect(files.has('word/footer1.xml')).toBe(false)
  })

  it('pptx：演讲者备注可生成，且能被读回', () => {
    const buf = slidesToPptx([
      { title: '风险提示', bullets: ['条款一'], notes: '这里要强调违约责任' }
    ])
    expect(extractPptx(buf)).toContain('【备注】这里要强调违约责任')
    const files = readZip(buf)
    expect(files.has('ppt/notesSlides/notesSlide1.xml')).toBe(true)
    expect(files.has('ppt/notesMasters/notesMaster1.xml')).toBe(true) // 备注母版是必需件
  })

  it('pptx：没有备注的幻灯片不生成备注部件', () => {
    const files = readZip(slidesToPptx([{ title: 'T', bullets: ['a'] }]))
    expect(files.has('ppt/notesSlides/notesSlide1.xml')).toBe(false)
    expect(files.has('ppt/notesMasters/notesMaster1.xml')).toBe(false)
  })
})

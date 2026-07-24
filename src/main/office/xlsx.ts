// 二维数组 → .xlsx（SpreadsheetML）纯 TS 生成器。
// 数字写成数值单元格（可参与公式），其余写成内联字符串；首行加粗视作表头；多工作表支持。
// 每个工作表可带一个图表（引用本表数据的柱/条/折线/饼图）。
import { writeZip, xmlEsc } from './zip'
import { excelChartXml, type ChartSpec, type ChartType } from './chart'

export type CellValue = string | number
/** 工作表图表：默认类别取首列、系列取其余各列、首行为表头 */
export interface SheetChart {
  type: ChartType
  title?: string
  categoryCol?: number
  seriesCols?: number[]
  hasHeader?: boolean
}
export interface SheetInput {
  name: string
  rows: CellValue[][]
  chart?: SheetChart
}

/** 0→A, 25→Z, 26→AA … */
export function colRef(i: number): string {
  let s = ''
  let n = i
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/** 从工作表数据 + 图表配置 → ChartSpec（读实际单元格算缓存值）与列布局 */
function buildChartSpec(
  rows: CellValue[][],
  ch: SheetChart
): { spec: ChartSpec; catCol: number; serCols: number[]; headerRow: number; firstDataRow: number } {
  const hasHeader = ch.hasHeader ?? true
  const catCol = ch.categoryCol ?? 0
  const ncol = Math.max(...rows.map((r) => r.length), 0)
  const serCols =
    ch.seriesCols && ch.seriesCols.length
      ? ch.seriesCols
      : Array.from({ length: ncol }, (_v, i) => i).filter((i) => i !== catCol)
  const dataRows = hasHeader ? rows.slice(1) : rows
  const categories = dataRows.map((r) => String(r[catCol] ?? ''))
  const series = serCols.map((c, k) => ({
    name: hasHeader ? String(rows[0]?.[c] ?? `系列${k + 1}`) : `系列${k + 1}`,
    values: dataRows.map((r) => {
      const v = r[c]
      return typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0
    })
  }))
  return {
    spec: { type: ch.type, title: ch.title, categories, series },
    catCol,
    serCols,
    headerRow: 1,
    firstDataRow: hasHeader ? 2 : 1
  }
}

function sheetXml(rows: CellValue[][], hasDrawing: boolean): string {
  const rowsXml = rows
    .map((cols, r) => {
      const cells = cols
        .map((v, c) => {
          const ref = `${colRef(c)}${r + 1}`
          if (typeof v === 'number' && Number.isFinite(v)) {
            return `<c r="${ref}" ${r === 0 ? 's="1" ' : ''}t="n"><v>${v}</v></c>`
          }
          const text = String(v ?? '')
          // '=' 开头 → 公式单元格（Excel/WPS 打开时自动重算），如 "=SUM(B2:B10)"
          if (text.startsWith('=') && text.length > 1) {
            return `<c r="${ref}"><f>${xmlEsc(text.slice(1))}</f></c>`
          }
          // 纯数字字符串按数值写（模型常把数字传成字符串），但两类必须保文本：
          // ① 前导零（007/编号）会被 Excel 吃掉；② >15 位有效数字（身份证/卡号）浮点会丢精度
          if (
            text !== '' &&
            /^-?\d+(\.\d+)?$/.test(text) &&
            !/^-?0\d/.test(text) &&
            text.replace(/[-.]/g, '').length <= 15
          ) {
            return `<c r="${ref}" ${r === 0 ? 's="1" ' : ''}t="n"><v>${text}</v></c>`
          }
          return `<c r="${ref}" ${r === 0 ? 's="1" ' : ''}t="inlineStr"><is><t xml:space="preserve">${xmlEsc(
            text
          )}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${rowsXml}</sheetData>${
    hasDrawing ? '<drawing r:id="rId1"/>' : ''
  }</worksheet>`
}

/** 图表锚定的 drawing 部件（放在数据下方，宽 ~8 列、高 ~16 行） */
function drawingXml(anchorRow: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchorRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchorRow + 16}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>
</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`
}

/** Excel 表名规则：禁 \\ / : * ? [ ]，≤31 字符，非空且唯一；违规会触发"文件需修复" */
function safeSheetName(raw: string, used: Set<string>): string {
  let n = (raw || 'Sheet').replace(/[\\/:*?[\]]/g, '·').slice(0, 31) || 'Sheet'
  const base = n
  let i = 2
  while (used.has(n)) {
    const suffix = `~${i++}`
    n = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(n)
  return n
}

/** 生成 .xlsx；sheets 至少一个 */
export function rowsToXlsx(sheets: SheetInput[]): Buffer {
  if (!sheets.length) throw new Error('至少需要一个工作表')
  const usedNames = new Set<string>()
  sheets = sheets.map((s, i) => ({
    ...s,
    name: safeSheetName(s.name || `Sheet${i + 1}`, usedNames)
  }))

  // 预处理图表：为带 chart 的工作表分配全局编号的 chart/drawing 部件
  const chartParts: { name: string; data: string | Buffer }[] = []
  const chartOverrides: string[] = []
  const sheetHasChart = sheets.map((s) => !!s.chart)
  let cIdx = 0
  sheets.forEach((s, i) => {
    if (!s.chart) return
    cIdx++
    const { spec, catCol, serCols, headerRow, firstDataRow } = buildChartSpec(s.rows, s.chart)
    const chartXml = excelChartXml(spec, s.name, { catCol, serCols, headerRow, firstDataRow })
    const anchorRow = s.rows.length + 1 // 数据下方一行
    chartParts.push(
      { name: `xl/charts/chart${cIdx}.xml`, data: chartXml },
      { name: `xl/drawings/drawing${cIdx}.xml`, data: drawingXml(anchorRow) },
      {
        name: `xl/drawings/_rels/drawing${cIdx}.xml.rels`,
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${cIdx}.xml"/>
</Relationships>`
      },
      {
        name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${cIdx}.xml"/>
</Relationships>`
      }
    )
    chartOverrides.push(
      `<Override PartName="/xl/charts/chart${cIdx}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
      `<Override PartName="/xl/drawings/drawing${cIdx}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
    )
  })

  const entries = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets
  .map(
    (_s, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )
  .join('\n')}
${chartOverrides.join('\n')}
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map(
          (s, i) =>
            `<sheet name="${xmlEsc(s.name || `Sheet${i + 1}`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
        )
        .join('')}</sheets></workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_s, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  )
  .join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    {
      // s="1" = 表头加粗样式
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`
    },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: sheetXml(s.rows, sheetHasChart[i])
    })),
    ...chartParts
  ]
  return writeZip(entries)
}

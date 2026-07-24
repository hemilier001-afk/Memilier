// DrawingML 图表（c:chart）生成：柱状/条形/折线/饼图。Excel 与 PPT 共用同一图表格式，
// 差别只在数据引用——Excel 直接引用工作表单元格（c:f 指向本表数据，天然有效）；
// PPT 引用内嵌的迷你工作簿（externalData）。两者都写入 numCache/strCache 以便离线渲染。
import { xmlEsc } from './zip'

export type ChartType = 'column' | 'bar' | 'line' | 'pie'
export interface ChartSpec {
  type: ChartType
  title?: string
  /** 类别轴标签（如 ['1月','2月',…]） */
  categories: string[]
  /** 数据系列 */
  series: { name: string; values: number[] }[]
}

const C_NS =
  'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

function colLetter(i: number): string {
  let s = ''
  let n = i
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

function strCache(items: string[]): string {
  return (
    `<c:strCache><c:ptCount val="${items.length}"/>` +
    items.map((v, i) => `<c:pt idx="${i}"><c:v>${xmlEsc(v)}</c:v></c:pt>`).join('') +
    `</c:strCache>`
  )
}
function numCache(items: number[]): string {
  return (
    `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${items.length}"/>` +
    items
      .map((v, i) => `<c:pt idx="${i}"><c:v>${Number.isFinite(v) ? v : 0}</c:v></c:pt>`)
      .join('') +
    `</c:numCache>`
  )
}

interface SerRef {
  nameRef: string
  valRange: string
}
/** 引用集合：类别区间 + 每个系列的名称/数值引用（Excel 指本表真实列；PPT 指内嵌 Sheet1） */
function refsFor(
  sheet: string,
  catCol: number,
  serCols: number[],
  headerRow: number,
  firstDataRow: number,
  count: number
): { catRange: string; sers: SerRef[] } {
  const q = `'${sheet.replace(/'/g, "''")}'`
  const lastRow = firstDataRow + count - 1
  const catRange = `${q}!$${colLetter(catCol)}$${firstDataRow}:$${colLetter(catCol)}$${lastRow}`
  const sers = serCols.map((c) => ({
    nameRef: `${q}!$${colLetter(c)}$${headerRow}`,
    valRange: `${q}!$${colLetter(c)}$${firstDataRow}:$${colLetter(c)}$${lastRow}`
  }))
  return { catRange, sers }
}

function serialize(
  spec: ChartSpec,
  catRange: string,
  serRefs: SerRef[],
  externalRid?: string
): string {
  const isPie = spec.type === 'pie'
  const sers = spec.series
    .map((s, si) => {
      const { nameRef, valRange } = serRefs[si]
      return (
        `<c:ser><c:idx val="${si}"/><c:order val="${si}"/>` +
        `<c:tx><c:strRef><c:f>${nameRef}</c:f>${strCache([s.name])}</c:strRef></c:tx>` +
        `<c:cat><c:strRef><c:f>${catRange}</c:f>${strCache(spec.categories)}</c:strRef></c:cat>` +
        `<c:val><c:numRef><c:f>${valRange}</c:f>${numCache(s.values)}</c:numRef></c:val>` +
        `</c:ser>`
      )
    })
    .join('')

  let plot: string
  if (isPie) {
    plot = `<c:pieChart><c:varyColors val="1"/>${sers}</c:pieChart>`
  } else if (spec.type === 'line') {
    plot =
      `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}` +
      `<c:marker val="1"/><c:axId val="1"/><c:axId val="2"/></c:lineChart>`
  } else {
    const dir = spec.type === 'bar' ? 'bar' : 'col'
    plot =
      `<c:barChart><c:barDir val="${dir}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${sers}` +
      `<c:axId val="1"/><c:axId val="2"/></c:barChart>`
  }
  const axes = isPie
    ? ''
    : `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>` +
      `<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>`
  const title = spec.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${xmlEsc(spec.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : `<c:autoTitleDeleted val="1"/>`

  const external = externalRid
    ? `<c:externalData r:id="${externalRid}"><c:autoUpdate val="0"/></c:externalData>`
    : ''
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace ${C_NS}><c:chart>${title}` +
    `<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>` +
    `<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>` +
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>${external}</c:chartSpace>`
  )
}

/** Excel 图表：引用本工作表真实单元格。
 *  catCol=类别列下标，serCols=各系列列下标，headerRow/firstDataRow 为 1-based 行号。 */
export function excelChartXml(
  spec: ChartSpec,
  sheetName: string,
  layout: { catCol: number; serCols: number[]; headerRow: number; firstDataRow: number }
): string {
  const { catRange, sers } = refsFor(
    sheetName,
    layout.catCol,
    layout.serCols,
    layout.headerRow,
    layout.firstDataRow,
    spec.categories.length
  )
  return serialize(spec, catRange, sers)
}

/** PPT 图表：引用内嵌工作簿 Sheet1（表头第 1 行、数据第 2 行起；类别 A 列、系列 B.. 列）。
 *  externalRid：指向内嵌 .xlsx 的关系 id（PowerPoint 据此可编辑数据，且避免"需修复"提示）。 */
export function pptChartXml(spec: ChartSpec, externalRid?: string): string {
  const serCols = spec.series.map((_s, i) => i + 1) // B, C, …
  const { catRange, sers } = refsFor('Sheet1', 0, serCols, 1, 2, spec.categories.length)
  return serialize(spec, catRange, sers, externalRid)
}

/** 图表内嵌工作簿的数据（PPT 用；也可给 Excel 校验）：表头行 + 各类别行 */
export function chartDataRows(spec: ChartSpec): (string | number)[][] {
  const header = ['', ...spec.series.map((s) => s.name)]
  const body = spec.categories.map((cat, r) => [cat, ...spec.series.map((s) => s.values[r] ?? 0)])
  return [header, ...body]
}

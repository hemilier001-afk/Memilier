// 大纲 → .pptx（PresentationML）纯 TS 生成器。
// 每张幻灯片 = 标题 + 要点列表；可选整页配图或图表；16:9 版式；主题/母版/版式用最小合法骨架。
import { writeZip, xmlEsc } from './zip'
import { imageSize } from './imagesize'
import { pptChartXml, chartDataRows, type ChartSpec } from './chart'
import { rowsToXlsx } from './xlsx'

export interface SlideInput {
  title: string
  bullets?: string[]
  /** 整页配图（工作区路径；由工具层解析为字节传入 images）。有图/图表时占用正文区，忽略 bullets 布局 */
  image?: string
  /** 数据图表（柱/条/折线/饼） */
  chart?: ChartSpec
}

// 正文区盒子（EMU）：标题下方
const BODY = { x: 838200, y: 1825625, cx: 10515600, cy: 4351338 }
const EMU_PER_PX = 9525

const NS_P =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'

// 最小合法主题（PowerPoint 打开 pptx 必须有完整的 clrScheme/fontScheme/fmtScheme）
const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="hemilier"><a:themeElements>
<a:clrScheme name="hemilier"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="3D3D3A"/></a:dk2><a:lt2><a:srgbClr val="FBF3EA"/></a:lt2><a:accent1><a:srgbClr val="D2552C"/></a:accent1>
<a:accent2><a:srgbClr val="8F8D85"/></a:accent2><a:accent3><a:srgbClr val="B8B6AE"/></a:accent3><a:accent4><a:srgbClr val="6B5B4A"/></a:accent4>
<a:accent5><a:srgbClr val="9C7A5B"/></a:accent5><a:accent6><a:srgbClr val="4A6B5B"/></a:accent6><a:hlink><a:srgbClr val="D2552C"/></a:hlink><a:folHlink><a:srgbClr val="8F8D85"/></a:folHlink></a:clrScheme>
<a:fontScheme name="hemilier"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="hemilier"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${NS_P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${NS_P} type="titleAndBody"><p:cSld name="Title and Body"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sldLayout>`

/** 图片按宽高比缩放居中到正文盒子内 */
function fitPic(buf: Buffer, rId: string): string | null {
  const info = imageSize(buf)
  if (!info) return null
  let cx = info.width * EMU_PER_PX
  let cy = info.height * EMU_PER_PX
  const scale = Math.min(BODY.cx / cx, BODY.cy / cy, 1)
  cx = Math.round(cx * scale)
  cy = Math.round(cy * scale)
  const offX = BODY.x + Math.round((BODY.cx - cx) / 2)
  const offY = BODY.y + Math.round((BODY.cy - cy) / 2)
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${offX}" y="${offY}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  )
}

/** 图表 graphicFrame 填满正文盒子 */
function chartFrame(rId: string): string {
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${BODY.x}" y="${BODY.y}"/><a:ext cx="${BODY.cx}" cy="${BODY.cy}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
    `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rId}"/>` +
    `</a:graphicData></a:graphic></p:graphicFrame>`
  )
}

/** extraShapes：额外的图片/图表形状 XML；有它时不渲染正文要点占位符 */
function slideXml(s: SlideInput, extraShapes: string): string {
  const bodyPlaceholder = extraShapes
    ? ''
    : (() => {
        const bullets = (s.bullets ?? []).map(
          (b) =>
            `<a:p><a:pPr indent="-228600" marL="285750"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="zh-CN" sz="2000"/><a:t>${xmlEsc(
              b
            )}</a:t></a:r></a:p>`
        )
        if (!bullets.length) bullets.push('<a:p><a:endParaRPr/></a:p>')
        return `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${BODY.x}" y="${BODY.y}"/><a:ext cx="${BODY.cx}" cy="${BODY.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>${bullets.join('')}</p:txBody></p:sp>`
      })()
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS_P}><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="3600" b="1"/><a:t>${xmlEsc(
    s.title
  )}</a:t></a:r></a:p></p:txBody></p:sp>
${bodyPlaceholder}${extraShapes}
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

/** 大纲 → .pptx 文件内容。images：`image` 字段路径 → 图片字节（由工具层从工作区读入）。 */
export function slidesToPptx(slides: SlideInput[], images?: Map<string, Buffer>): Buffer {
  if (!slides.length) throw new Error('至少需要一张幻灯片')
  const relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const imgMap = images ?? new Map<string, Buffer>()

  // 逐页处理图片/图表，分配全局部件编号
  const slideExtraShapes: string[] = []
  const slideExtraRels: string[] = [] // 每页除 layout 之外的 <Relationship>
  const extraParts: { name: string; data: string | Buffer }[] = []
  const overrides: string[] = []
  const imgExts = new Set<string>()
  let mediaN = 0
  let chartN = 0

  slides.forEach((s) => {
    const shapes: string[] = []
    const rels: string[] = []
    // 图片
    const ibuf = s.image ? imgMap.get(s.image) : undefined
    if (ibuf) {
      const info = imageSize(ibuf)
      if (info) {
        mediaN++
        const rId = `rIdImg${mediaN}`
        const ext = info.ext === 'jpeg' ? 'jpg' : info.ext
        imgExts.add(ext)
        const pic = fitPic(ibuf, rId)
        if (pic) {
          shapes.push(pic)
          rels.push(
            `<Relationship Id="${rId}" Type="${relType}/image" Target="../media/image${mediaN}.${ext}"/>`
          )
          extraParts.push({ name: `ppt/media/image${mediaN}.${ext}`, data: ibuf })
        }
      }
    }
    // 图表（含内嵌工作簿，避免 PowerPoint 打开时提示需修复）
    if (s.chart && s.chart.series?.length && s.chart.categories?.length) {
      chartN++
      const cRid = `rIdChart${chartN}`
      const embed = rowsToXlsx([{ name: 'Sheet1', rows: chartDataRows(s.chart) }])
      const chartXml = pptChartXml(s.chart, 'rId1')
      shapes.push(chartFrame(cRid))
      rels.push(
        `<Relationship Id="${cRid}" Type="${relType}/chart" Target="../charts/chart${chartN}.xml"/>`
      )
      extraParts.push(
        { name: `ppt/charts/chart${chartN}.xml`, data: chartXml },
        { name: `ppt/embeddings/workbook${chartN}.xlsx`, data: embed },
        {
          name: `ppt/charts/_rels/chart${chartN}.xml.rels`,
          data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${relType}/package" Target="../embeddings/workbook${chartN}.xlsx"/>
</Relationships>`
        }
      )
      overrides.push(
        `<Override PartName="/ppt/charts/chart${chartN}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`
      )
    }
    slideExtraShapes.push(shapes.join('\n'))
    slideExtraRels.push(rels.join('\n'))
  })

  const imgDefaults = [...imgExts]
    .map((e) => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`)
    .join('')
  const xlsxDefault = chartN
    ? '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>'
    : ''

  return writeZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${imgDefaults}${xlsxDefault}
${slides
  .map(
    (_s, i) =>
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  )
  .join('\n')}
${overrides.join('\n')}
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${relType}/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    },
    {
      name: 'ppt/presentation.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS_P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1000"/></p:sldMasterIdLst>
<p:sldIdLst>${slides.map((_s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1000" Type="${relType}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${slides
  .map(
    (_s, i) =>
      `<Relationship Id="rId${i + 1}" Type="${relType}/slide" Target="slides/slide${i + 1}.xml"/>`
  )
  .join('\n')}
</Relationships>`
    },
    { name: 'ppt/theme/theme1.xml', data: THEME },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: SLIDE_MASTER },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${relType}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="${relType}/theme" Target="../theme/theme1.xml"/>
</Relationships>`
    },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: SLIDE_LAYOUT },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${relType}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`
    },
    ...slides.map((s, i) => ({
      name: `ppt/slides/slide${i + 1}.xml`,
      data: slideXml(s, slideExtraShapes[i])
    })),
    ...slides.map((_s, i) => ({
      name: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${relType}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
${slideExtraRels[i]}
</Relationships>`
    })),
    ...extraParts
  ])
}

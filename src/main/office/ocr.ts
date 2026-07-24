// 扫描件 OCR 回退（仅 macOS，零第三方依赖）：用系统自带的 Vision 框架（Live Text 同款引擎）。
// 做法：把内嵌的 Swift 小程序在首次使用时用 swiftc 编译到 userData/ocr/（按源码哈希缓存，
// 源码变更自动重编），之后 execFile 调用：PDF 逐页经 CoreGraphics 渲染成位图 → VNRecognizeTextRequest。
// 不可用（非 mac / 无开发者工具）时静默降级——调用方保持原有如实提示。
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SWIFT_SOURCE = String.raw`// hemilier-ocr：PDF/图片 → 文本（Apple Vision）
import Foundation
import CoreGraphics
import ImageIO
import Vision

func ocrImage(_ cg: CGImage) -> String {
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
  req.usesLanguageCorrection = true
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  try? handler.perform([req])
  let obs = (req.results ?? [])
  // 按视觉阅读顺序排序（Vision 坐标原点在左下：先上后下、再左后右）
  let sorted = obs.sorted {
    let ay = $0.boundingBox.midY, by = $1.boundingBox.midY
    if abs(ay - by) > 0.012 { return ay > by }
    return $0.boundingBox.minX < $1.boundingBox.minX
  }
  return sorted.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

let args = CommandLine.arguments
guard args.count >= 2 else { exit(2) }
let filePath = args[1]
let maxPages = args.count >= 3 ? (Int(args[2]) ?? 20) : 20
let url = URL(fileURLWithPath: filePath)

if filePath.lowercased().hasSuffix(".pdf") {
  guard let doc = CGPDFDocument(url as CFURL) else { exit(1) }
  let n = min(doc.numberOfPages, maxPages)
  if n < 1 { exit(1) }
  for i in 1...n {
    guard let page = doc.page(at: i) else { continue }
    let box = page.getBoxRect(.mediaBox)
    let rot = ((page.rotationAngle % 360) + 360) % 360
    let swap = rot == 90 || rot == 270
    let scale: CGFloat = 2.5 // ≈180dpi，兼顾识别率与速度
    let w = Int((swap ? box.height : box.width) * scale)
    let h = Int((swap ? box.width : box.height) * scale)
    guard w > 0, h > 0,
      let ctx = CGContext(
        data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { continue }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: CGFloat(w), height: CGFloat(h)))
    ctx.saveGState()
    // 处理页面 /Rotate：把内容转正再识别
    switch rot {
    case 90:
      ctx.translateBy(x: 0, y: CGFloat(h))
      ctx.rotate(by: -.pi / 2)
    case 180:
      ctx.translateBy(x: CGFloat(w), y: CGFloat(h))
      ctx.rotate(by: .pi)
    case 270:
      ctx.translateBy(x: CGFloat(w), y: 0)
      ctx.rotate(by: .pi / 2)
    default: break
    }
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: -box.minX, y: -box.minY)
    ctx.drawPDFPage(page)
    ctx.restoreGState()
    if let img = ctx.makeImage() {
      print("=== 第 \(i) 页 ===")
      print(ocrImage(img))
    }
  }
  if doc.numberOfPages > maxPages { print("=== （共 \(doc.numberOfPages) 页，仅识别前 \(maxPages) 页） ===") }
} else {
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
    let img = CGImageSourceCreateImageAtIndex(src, 0, nil)
  else { exit(1) }
  print(ocrImage(img))
}
`

function ocrDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    return path.join(app.getPath('userData'), 'ocr')
  } catch {
    return path.join(os.tmpdir(), 'hemilier-ocr')
  }
}

export function ocrAvailable(): boolean {
  return process.platform === 'darwin' && existsSync('/usr/bin/swiftc')
}

let ensuring: Promise<string | null> | null = null

/** 确保 OCR 可执行文件就绪（首次编译 5~15s，之后按源码哈希缓存复用） */
function ensureBinary(): Promise<string | null> {
  ensuring ??= (async () => {
    if (!ocrAvailable()) return null
    const dir = ocrDir()
    const bin = path.join(dir, 'hemilier-ocr')
    const hashFile = path.join(dir, 'hemilier-ocr.hash')
    const hash = createHash('sha1').update(SWIFT_SOURCE).digest('hex')
    try {
      if (existsSync(bin) && (await fs.readFile(hashFile, 'utf8').catch(() => '')) === hash) {
        return bin
      }
      await fs.mkdir(dir, { recursive: true })
      const src = path.join(dir, 'hemilier-ocr.swift')
      await fs.writeFile(src, SWIFT_SOURCE, 'utf8')
      await new Promise<void>((resolve, reject) => {
        execFile('/usr/bin/swiftc', ['-O', '-o', bin, src], { timeout: 180_000 }, (err, _o, se) =>
          err ? reject(new Error(`swiftc 编译失败：${se || err.message}`)) : resolve()
        )
      })
      await fs.writeFile(hashFile, hash, 'utf8')
      return bin
    } catch (e) {
      console.error('[ocr] 编译不可用：', e)
      return null
    }
  })()
  // 失败后允许下次重试（如用户中途装好了 CLT）
  void ensuring.then((r) => {
    if (r === null) ensuring = null
  })
  return ensuring
}

/** 对 PDF/图片文件跑 OCR；不可用或失败返回 null（调用方保持原有提示） */
export async function runOcr(filePath: string, maxPages = 20): Promise<string | null> {
  const bin = await ensureBinary()
  if (!bin) return null
  return new Promise((resolve) => {
    execFile(
      bin,
      [filePath, String(maxPages)],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        const text = (stdout ?? '').trim()
        resolve(!err && text ? text : null)
      }
    )
  })
}

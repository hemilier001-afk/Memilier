// 从图片字节读取宽高（无依赖，只解头部）。支持 PNG / JPEG / GIF。
// 用于把图片按原始宽高比嵌入 docx/pptx 时计算尺寸。

export interface ImageInfo {
  width: number
  height: number
  /** OOXML 内容类型用的扩展名（png/jpeg/gif） */
  ext: 'png' | 'jpeg' | 'gif'
}

export function imageSize(buf: Buffer): ImageInfo | null {
  // PNG：签名 89 50 4E 47，IHDR 在偏移 16 起，宽高各 4 字节大端
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), ext: 'png' }
  }
  // GIF：GIF87a/GIF89a，宽高在偏移 6 起，各 2 字节小端
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), ext: 'gif' }
  }
  // JPEG：FF D8 开头，扫描 SOF0-SOF3/SOF5-SOF7/SOF9-SOF11 标记取宽高
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++
        continue
      }
      const marker = buf[off + 1]
      // SOFn 帧头（排除 C4/C8/CC 这些非帧头标记）
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        const height = buf.readUInt16BE(off + 5)
        const width = buf.readUInt16BE(off + 7)
        return { width, height, ext: 'jpeg' }
      }
      // 段长度跳到下一个标记
      const len = buf.readUInt16BE(off + 2)
      if (len < 2) break
      off += 2 + len
    }
  }
  return null
}

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getTool } from '../src/main/agent/tools'

// 实测踩过的坑：read_file 读到目录会回吐 Node 的 EISDIR，读到 .xlsx 会把 ZIP 字节
// 灌进上下文，模型拿着乱码"分析"半天导致任务跑偏。这里锁住"明确指路"的行为。

let ws = ''
const read = getTool('read_file')!
const edit = getTool('edit_file')!
const grepTool = getTool('grep')!

beforeEach(() => {
  ws = mkdtempSync(path.join(tmpdir(), 'hemi-readfile-'))
})
afterEach(() => rmSync(ws, { recursive: true, force: true }))

const run = (rel: string): Promise<string> => read.execute({ path: rel }, { workspace: ws })

describe('read_file 的输入防护', () => {
  it('正常文本文件照常读取', async () => {
    writeFileSync(path.join(ws, 'a.txt'), '你好，世界')
    await expect(run('a.txt')).resolves.toBe('你好，世界')
  })

  it('目录 → 提示改用 list_dir，而不是抛 EISDIR', async () => {
    mkdirSync(path.join(ws, '个案资料'))
    await expect(run('个案资料')).rejects.toThrow(/目录.*list_dir/s)
  })

  it('Office/PDF 文档 → 指路 read_document，绝不回吐二进制', async () => {
    for (const name of ['表.xlsx', '文书.docx', '演示.pptx', '合同.pdf']) {
      writeFileSync(path.join(ws, name), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]))
      await expect(run(name)).rejects.toThrow(/read_document/)
    }
  })

  it('旧版二进制 Office → 提示先另存为新格式', async () => {
    writeFileSync(path.join(ws, '旧.doc'), Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))
    await expect(run('旧.doc')).rejects.toThrow(/另存为/)
  })

  it('图片/压缩包等二进制 → 明确拒绝', async () => {
    writeFileSync(path.join(ws, 'p.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await expect(run('p.png')).rejects.toThrow(/二进制/)
  })

  it('扩展名认不出但内容是二进制（含空字节）→ 同样拦住', async () => {
    writeFileSync(path.join(ws, 'mystery.dat'), Buffer.from([0x41, 0x00, 0x42, 0x00]))
    await expect(run('mystery.dat')).rejects.toThrow(/二进制/)
  })

  it('CSV 走 read_document（有分隔符/引号处理），不当纯文本读', async () => {
    writeFileSync(path.join(ws, 'data.csv'), 'a,b\n1,2')
    await expect(run('data.csv')).rejects.toThrow(/read_document/)
  })
})

describe('edit_file 的输入防护（防止损坏文件）', () => {
  const doEdit = (rel: string): Promise<string> =>
    edit.execute({ path: rel, old_string: 'a', new_string: 'b' }, { workspace: ws } as never)

  it('二进制文件绝不允许编辑——读成乱码再写回会真的损坏文件', async () => {
    const bin = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x61, 0x00])
    writeFileSync(path.join(ws, 'book.xlsx'), bin)
    await expect(doEdit('book.xlsx')).rejects.toThrow(/read_document|二进制/)
    // 关键断言：文件内容一个字节都没被改动
    expect(readFileSync(path.join(ws, 'book.xlsx'))).toEqual(bin)
  })

  it('目录 → 明确指路而非 EISDIR', async () => {
    mkdirSync(path.join(ws, 'dir1'))
    await expect(doEdit('dir1')).rejects.toThrow(/目录/)
  })

  it('普通文本仍可正常编辑', async () => {
    writeFileSync(path.join(ws, 'x.txt'), 'a')
    await expect(doEdit('x.txt')).resolves.toContain('已编辑')
    expect(readFileSync(path.join(ws, 'x.txt'), 'utf8')).toBe('b')
  })
})

describe('grep 跳过二进制', () => {
  it('不把二进制里的乱码当作匹配结果返回', async () => {
    writeFileSync(path.join(ws, 'ok.txt'), 'hello world')
    // 构造一个含 NUL 且恰好包含 "hello" 字节的二进制
    writeFileSync(path.join(ws, 'blob.bin'), Buffer.from('hello\u0000\u0000binary', 'binary'))
    writeFileSync(path.join(ws, 'sheet.xlsx'), Buffer.from('hello xlsx bytes'))
    const out = await grepTool.execute({ pattern: 'hello' }, { workspace: ws } as never)
    expect(out).toContain('ok.txt')
    expect(out).not.toContain('blob.bin')
    expect(out).not.toContain('sheet.xlsx')
  })
})

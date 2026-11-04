#!/usr/bin/env node
/**
 * 生成沉浸式阅读用的紧凑释义索引。
 *
 * 数据源：public/dicts/en/word/CET4_T.json（离线四级词库，~4.4MB）
 * 输出：  public/dicts/en/word/cet4-gloss.json（~300KB，首屏一次拉取 + 浏览器缓存）
 *
 * 用法：node scripts/prepare-gloss-index.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(root, 'public/dicts/en/word/CET4_T.json')
const OUT = path.join(root, 'public/dicts/en/word/cet4-gloss.json')

// 单条释义、搭配的截断长度：太小会丢失信息，太大会让索引膨胀
const TRANS_MAX = 60
const PHRASE_MAX_CN = 24
const PHRASE_MAX_PER_WORD = 6

const cut = (s, max) => {
  s = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? s.slice(0, max) : s
}

const words = JSON.parse(fs.readFileSync(SRC, 'utf8'))
if (!Array.isArray(words)) throw new Error('CET4_T.json 结构不是数组')

const out = {}
let phraseCount = 0

for (const w of words) {
  const key = String(w.word ?? '')
    .trim()
    .toLowerCase()
  if (!key) continue

  // 音标：优先美音 phonetic1，退回英音
  const phonetic = String(w.phonetic1 || w.phonetic0 || '').trim()

  // 释义：取前两个词性，拼成 “v. 取消…；n. 取消…”
  const trans = (w.trans ?? [])
    .filter(t => t && t.cn)
    .slice(0, 2)
    .map(t => (t.pos ? `${t.pos} ` : '') + cut(t.cn, TRANS_MAX / 2))
    .join('；')

  const phrases = (w.phrases ?? [])
    .filter(p => p && p.c && p.cn)
    .slice(0, PHRASE_MAX_PER_WORD)
    .map(p => [String(p.c).trim(), cut(p.cn, PHRASE_MAX_CN)])

  phraseCount += phrases.length

  const entry = { p: phonetic, t: cut(trans, TRANS_MAX) }
  if (phrases.length) entry.ph = phrases
  out[key] = entry
}

const payload = { v: 1, count: Object.keys(out).length, words: out }
fs.writeFileSync(OUT, JSON.stringify(payload))

const bytes = fs.statSync(OUT).size
console.log(
  `[gloss] 词条 ${payload.count}，搭配 ${phraseCount}，输出 ${(bytes / 1024).toFixed(1)} KB -> ${path.relative(root, OUT)}`
)

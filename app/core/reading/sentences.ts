/**
 * 阅读页的朗读脚本：把正文段落切成句子，供播放组件逐句朗读与高亮。
 * 这里的函数都是纯函数，方便用 node --test 直接验证。
 */

export interface SentenceSpan {
  /** 句子文本（不含段落换行） */
  text: string
  /** 所属段落序号，从 0 开始 */
  paragraph: number
  /** 全文句子序号，从 0 开始 */
  index: number
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'inc', 'ltd', 'co',
  'fig', 'eg', 'ie', 'approx', 'dept', 'est', 'al', 'jan', 'feb', 'mar', 'apr', 'jun',
  'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'u.s', 'u.k', 'e.u', 'j.d', 'a.m',
  'p.m', 'b.c', 'a.d',
])

/** 句号前是缩写（Mr. / U.S. / J.D.）时不算句末 */
function isAbbreviationAt(text: string, dotIndex: number): boolean {
  const match = text.slice(0, dotIndex).match(/([A-Za-z][A-Za-z.]*)$/)
  if (!match) return false
  return ABBREVIATIONS.has(match[1].toLowerCase().replace(/\.+$/, ''))
}

/**
 * 把一段英文切成句子：句末引号跟着上一句，缩写与小数（54.5）不误切。
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  const sentences: string[] = []
  let start = 0
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch !== '.' && ch !== '!' && ch !== '?') continue

    let end = i + 1
    while (end < normalized.length && /["'”’)\]]/.test(normalized[end])) end++
    if (end < normalized.length && normalized[end] !== ' ') continue
    if (ch === '.' && isAbbreviationAt(normalized, i)) continue

    const sentence = normalized.slice(start, end).trim()
    if (sentence) sentences.push(sentence)
    start = end
    i = end - 1
  }

  const tail = normalized.slice(start).trim()
  if (tail) sentences.push(tail)
  return sentences
}

/** 段落文本 → 逐句朗读脚本（句序号在全文范围内连续） */
export function buildReadingScript(paragraphs: string[]): SentenceSpan[] {
  const script: SentenceSpan[] = []
  paragraphs.forEach((paragraph, paragraphIndex) => {
    splitSentences(paragraph).forEach(text => {
      script.push({ text, paragraph: paragraphIndex, index: script.length })
    })
  })
  return script
}

/** 按段落分组，正文渲染时一段一个 <p> */
export function groupScriptByParagraph(script: SentenceSpan[]): SentenceSpan[][] {
  const groups: SentenceSpan[][] = []
  for (const item of script) {
    const bucket = groups[item.paragraph]
    if (bucket) bucket.push(item)
    else groups[item.paragraph] = [item]
  }
  return groups
}

/** 每秒词数按 160 估算，用来显示「第 n/m 句 · 00:12 / 03:40」 */
export function estimateSpeechSeconds(text: string, rate = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (!words) return 0
  return Math.round((words / 160) * 60 / Math.max(0.25, rate))
}

export function totalSpeechSeconds(script: SentenceSpan[], rate = 1): number {
  return script.reduce((sum, item) => sum + estimateSpeechSeconds(item.text, rate), 0)
}

/** 点重点词时定位到它所在的句子，允许复数与所有格 */
export function indexOfSentenceWithWord(script: SentenceSpan[], word: string): number {
  const escaped = word.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!escaped) return -1
  const stem = escaped.replace(/y$/, '(?:y|ies)')
  const pattern = new RegExp(`\\b${stem}(?:es|s|[’']s)?\\b`, 'i')
  const found = script.find(item => pattern.test(item.text))
  return found ? found.index : -1
}

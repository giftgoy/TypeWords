import type { Word } from '../types/types.ts'

/**
 * 磨耳朵：把词表整理成「能连续听」的队列。
 * 这里只做纯数据转换，播放交给 useWordListening，界面交给 WordListeningPlayer。
 */

export type ListeningScope = 'current' | 'collect' | 'wrong' | 'known'
/**
 * 排序方式：'new'（只听未学）/'due'（只听到期）在这里按顺序排，
 * 真正的「按学习状态过滤」由播放引擎（useWordListening）负责。
 */
export type ListeningOrder = 'sequence' | 'random' | 'new' | 'due'

export interface ListeningItem {
  word: string
  phonetic: string
  /** 中文释义，多条用「；」拼起来，太长会截断，用于显示 */
  meaning: string
  /** 朗读用的短释义：只取最常用的那条，磨耳朵不需要把整本词典念完 */
  spoken: string
  /** 全部英文例句（trim 后非空的才收，单条超长截断），播放引擎按轮次挑一条读 */
  examples: string[]
  /** 第一条例句（英文），恒等于 examples[0]，没有就是空串（兼容现有界面显示） */
  example: string
  exampleCn: string
}

/** 释义最多读这么多字符，超过就截断，磨耳朵要的是节奏而不是完整释义 */
const MEANING_LIMIT = 140
const SPOKEN_LIMIT = 40
/** 单条例句最多读这么长，太长的句子磨耳朵念起来节奏就没了 */
const EXAMPLE_LIMIT = 200

export function toListeningItem(source: Word | null | undefined): ListeningItem | null {
  const word = (source?.word ?? '').trim()
  if (!word) return null
  const translations = (source?.trans ?? [])
    .map(item => ({ pos: item.pos?.trim() ?? '', cn: item.cn?.trim() ?? '' }))
    .filter(item => item.cn)
  const meaning = translations
    .map(item => [item.pos, item.cn].filter(Boolean).join(' '))
    .join('；')
    .slice(0, MEANING_LIMIT)
  // 一条 trans 的 cn 本身也可能是「取消（计划好的事情）；终止」，先切第一段再去括号
  const spoken = (translations[0]?.cn ?? '')
    .split(/[；;]/)[0]
    .replace(/（[^）]*）|\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SPOKEN_LIMIT)
  // 例句收全部：每条 trim 后非空才收，超长截断；example 恒取第一条，兼容现有界面显示
  const examples: string[] = []
  for (const sentence of source?.sentences ?? []) {
    const text = (sentence?.c ?? '').trim()
    if (!text) continue
    examples.push(text.length > EXAMPLE_LIMIT ? text.slice(0, EXAMPLE_LIMIT) : text)
  }
  return {
    word,
    phonetic: (source?.phonetic0 || source?.phonetic1 || '').trim(),
    meaning,
    spoken,
    examples,
    example: examples[0] ?? '',
    exampleCn: (source?.sentences?.[0]?.cn ?? '').trim(),
  }
}

/** 确定性随机：同一个 seed 永远得到同样的顺序，方便测试与「不跳来跳去」 */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  let state = (seed >>> 0) || 1
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  const output = [...items]
  for (let i = output.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[output[i], output[j]] = [output[j], output[i]]
  }
  return output
}

/**
 * 词表 → 队列：按小写单词去重，丢弃没有释义也没有例句的空词条。
 * 只有 'sequence'/'random' 影响排序；'new'/'due' 在这里按顺序排，过滤在引擎层做。
 * limit：每轮最多收多少个词，0 表示全部；随机排序时先洗牌再截取，等价于随机抽样。
 */
export function buildListeningQueue(words: Word[], order: ListeningOrder = 'sequence', seed = 1, limit = 0): ListeningItem[] {
  const seen = new Set<string>()
  const items: ListeningItem[] = []
  for (const word of words ?? []) {
    const item = toListeningItem(word)
    if (!item) continue
    const key = item.word.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  const queue = order === 'random' ? seededShuffle(items, seed) : items
  return limit > 0 ? queue.slice(0, limit) : queue
}

/** 队列内前后翻，越界就绕回另一头（磨耳朵本来就要一直循环） */
export function stepQueueIndex(current: number, total: number, step: 1 | -1): number {
  if (total <= 0) return 0
  const next = (current + step) % total
  return next < 0 ? next + total : next
}

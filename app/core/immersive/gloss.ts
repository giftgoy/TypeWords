/**
 * 沉浸式阅读的离线释义索引。
 *
 * 数据由 scripts/prepare-gloss-index.mjs 从 public/dicts/en/word/CET4_T.json 生成，
 * 只保留注音、精简释义和前若干条搭配，体积约为原词库的 1/8，可一次拉取后靠浏览器缓存。
 *
 * 这里只放纯函数 + 一个带内存缓存的加载器，方便单测，也避免把网络逻辑写进组件。
 */
import { withAppBaseURL } from '../utils/base-url.ts'
import { lemmaCandidates } from './lemmatize.ts'
import type { Word } from '../types/types.ts'

export type GlossPhrase = [phrase: string, cn: string]

export interface GlossEntry {
  /** 音标（美音优先） */
  p?: string
  /** 精简释义，形如 "v. 取消…；n. 取消…" */
  t: string
  /** 搭配，[英文, 中文] */
  ph?: GlossPhrase[]
}

export interface GlossFile {
  v: number
  count: number
  words: Record<string, GlossEntry>
}

export interface GlossHit {
  entry: GlossEntry
  /** 命中的词库原形（可能是 lemma 还原后的结果） */
  lemma: string
}

export interface PhraseHit {
  phrase: string
  cn: string
  /** 该搭配挂靠的词库原形 */
  lemma: string
}

export interface GlossBundle {
  /** 词条数量 */
  size: number
  /** 单个 token 查词，内部带缓存 */
  find(token: string): GlossHit | null
  words: Record<string, GlossEntry>
  /** 英文搭配（小写、空格归一）→ 中文释义 */
  phrases: Map<string, PhraseHit>
  phraseStarts: Map<string, PhraseHit[]>
  /** 搭配最长包含几个单词，用于正文匹配时限制窗口 */
  maxPhraseWords: number
}

const normalizePhrase = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

export function createGlossBundle(file: GlossFile | null | undefined): GlossBundle {
  const words = file?.words ?? {}
  const hasWord = (w: string) => Object.prototype.hasOwnProperty.call(words, w)

  const cache = new Map<string, GlossHit | null>()
  const phrases = new Map<string, PhraseHit>()
  let maxPhraseWords = 1

  for (const [lemma, entry] of Object.entries(words)) {
    for (const [rawPhrase, cn] of entry.ph ?? []) {
      const key = normalizePhrase(rawPhrase)
      if (!key) continue
      const wordCount = key.split(' ').length
      if (wordCount < 2) continue
      if (wordCount > maxPhraseWords) maxPhraseWords = Math.min(wordCount, 5)
      if (!phrases.has(key)) phrases.set(key, { phrase: rawPhrase, cn, lemma })
    }
  }

  const phraseStarts = new Map<string, PhraseHit[]>()
  for (const phrase of phrases.values()) {
    const first = phrase.phrase.toLowerCase().split(' ')[0]
    const key = lemmaCandidates(first).find(hasWord) || first
    const group = phraseStarts.get(key) || []
    group.push(phrase)
    phraseStarts.set(key, group)
  }
  return {
    words,
    size: Object.keys(words).length,
    find(token: string) {
      if (cache.has(token)) return cache.get(token) ?? null
      const exact = token.trim().toLowerCase()
      let hit: GlossHit | null = hasWord(exact) ? { entry: words[exact], lemma: exact } : null
      for (const candidate of lemmaCandidates(token)) {
        if (hit) break
        if (hasWord(candidate)) {
          hit = { entry: words[candidate], lemma: candidate }
          break
        }
      }
      cache.set(token, hit)
      return hit
    },
    phrases,
    phraseStarts,
    maxPhraseWords,
  }
}

/** 取释义的第一小项，作为词下 11px 注音（太长会撑爆排版） */
export function shortGloss(translation: string, max = 10): string {
  const first = String(translation ?? '')
    .trim()
    .replace(/^[a-z]+\.\s*/i, '')
    .split(/[；;]/)[0]
    .trim()
  return first.length > max ? first.slice(0, max) : first
}

/**
 * 词下注音：比 shortGloss 更克制 —— 只取第一个义项组，超长直接省略。
 * 注音挂在词下，相邻目标词的注音容易互相压住，越短越好。
 */
export function annoGloss(translation: string, max = 12): string {
  const first = String(translation ?? '')
    .trim()
    .replace(/^[a-z]+\.\s*/i, '')
    .split(/[；;]/)[0]
    .trim()
  if (!first) return ''
  return first.length > max ? `${first.slice(0, max)}…` : first
}

/** 单词对照表用的释义：保留词性 + 前两三个义项，过长省略 */
export function tableGloss(translation: string, max = 36): string {
  const text = String(translation ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  const parts = text.split(/[；;]/).map(s => s.trim()).filter(Boolean)
  const head = parts.slice(0, 3).join('；')
  return head.length > max ? `${head.slice(0, max)}…` : head
}

let bundlePromise: Promise<GlossBundle | null> | null = null

/** 加载（并缓存）释义索引；失败返回 null，由调用方降级为纯文本阅读 */
export function loadGlossBundle(): Promise<GlossBundle | null> {
  if (!bundlePromise) {
    bundlePromise = fetch(withAppBaseURL('/dicts/en/word/reading-gloss.json'))
      .then(res => (res.ok ? (res.json() as Promise<GlossFile>) : null))
      .then(file => (file && file.words ? createGlossBundle(file) : null))
      .catch(() => null)
      .then(bundle => {
        // 失败时允许下次重试
        if (!bundle) bundlePromise = null
        return bundle
      })
  }
  return bundlePromise
}

export function wordsToEntries(words: Word[]): Record<string, GlossEntry> {
  return Object.fromEntries(words.map(word => [word.word.toLowerCase(), {
    p: word.phonetic1 || word.phonetic0,
    t: word.trans.map(t => `${t.pos} ${t.cn}`).join('；'),
    ph: word.phrases?.map(p => [p.c, p.cn] as GlossPhrase),
  }]))
}

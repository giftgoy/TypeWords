import { readingRequest } from '../immersive/api.ts'

/** AI 讲解：请求与结果清洗。
 * 密钥和模型配置都在服务端（typewords-reading），前端只发文本、只渲染结构化结果。 */

export type ExplainMode = 'article' | 'paragraph' | 'sentence'
export type ExplainLanguage = 'zh' | 'bilingual'

export interface ExplainSentence {
  en: string
  cn: string
  note: string
}

export interface ExplainWord {
  word: string
  meaning: string
  usage: string
}

export interface ArticleExplanation {
  title: string
  theme: string
  summary: string[]
  sentences: ExplainSentence[]
  words: ExplainWord[]
  highlights: string[]
}

function text(value: unknown, limit = 400): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, limit)
}

function textList(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => text(item, 300)).filter(Boolean).slice(0, limit)
}

/** 宽松清洗：字段缺失或类型不对就丢掉，界面按空数组处理 */
export function normalizeExplanation(raw: unknown): ArticleExplanation {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const sentences: ExplainSentence[] = []
  if (Array.isArray(source.sentences)) {
    for (const item of source.sentences.slice(0, 40)) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const en = text(row.en, 1200)
      if (!en) continue
      sentences.push({ en, cn: text(row.cn), note: text(row.note) })
    }
  }
  const words: ExplainWord[] = []
  if (Array.isArray(source.words)) {
    for (const item of source.words.slice(0, 30)) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const word = text(row.word, 80)
      if (!word) continue
      words.push({ word, meaning: text(row.meaning, 240), usage: text(row.usage, 240) })
    }
  }
  return {
    title: text(source.title, 160),
    theme: text(source.theme, 400),
    summary: textList(source.summary, 6),
    sentences,
    words,
    highlights: textList(source.highlights, 5),
  }
}

export function hasExplanation(explanation: ArticleExplanation): boolean {
  return Boolean(
    explanation.theme ||
      explanation.summary.length ||
      explanation.sentences.length ||
      explanation.words.length ||
      explanation.highlights.length
  )
}

export interface ExplainRequest {
  text: string
  mode: ExplainMode
  language?: ExplainLanguage
  title?: string
  session?: string
}

export async function requestExplanation(input: ExplainRequest): Promise<ArticleExplanation> {
  const text = input.text.trim()
  if (!text) throw new Error('没有可讲解的正文。')
  if (text.length > 6000) throw new Error('这段文字太长，AI 讲解一次最多 6000 字符，可以先按段落讲解。')
  const data = await readingRequest('explain', {
    text,
    mode: input.mode,
    language: input.language ?? 'zh',
    title: input.title ?? '',
    session: input.session ?? 'reading-explain',
  })
  const explanation = normalizeExplanation(data)
  if (!hasExplanation(explanation)) throw new Error('模型没有返回可用的讲解，请重试。')
  return explanation
}
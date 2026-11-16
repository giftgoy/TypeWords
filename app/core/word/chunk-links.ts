/**
 * chunk-links — 单词 → 词块 联动索引
 *
 * 惰性加载本地词块词典(public/dicts/en/word/market-en-chunks-300.json),
 * 按词块中出现的单词 token 建立倒排索引,供练习详情面板展示
 * 「包含当前单词的词块」(方案 B:练单词 → 显示相关词块)。
 *
 * - 索引按整词 token 精确匹配(小写),不做词形还原
 * - 长度 <2 的 token 不入索引(避免 a/of 之类的介词噪音)
 * - 加载失败时置空缓存,下次访问自动重试(与 word-examples 加载器一致)
 */
import type { Word } from '@/core/types/types.ts'
import { resourceWrap } from '@/core/utils/index.ts'

const CHUNK_DICT_URL = '/dicts/en/word/market-en-chunks-300.json'

let chunkIndexPromise: Promise<Map<string, Word[]>> | null = null

function buildChunkIndex(chunks: Word[]): Map<string, Word[]> {
  const index = new Map<string, Word[]>()
  for (const chunk of chunks) {
    const text = typeof chunk?.word === 'string' ? chunk.word.trim().toLowerCase() : ''
    if (!text) continue
    const tokens = new Set(text.split(/\s+/).filter(Boolean))
    for (const token of tokens) {
      if (token.length < 2) continue
      const list = index.get(token)
      if (list) list.push(chunk)
      else index.set(token, [chunk])
    }
  }
  return index
}

function loadChunkIndex(): Promise<Map<string, Word[]>> {
  chunkIndexPromise ??= fetch(resourceWrap(CHUNK_DICT_URL))
    .then(res => {
      if (!res.ok) throw new Error(`chunk dict load failed: ${res.status}`)
      return res.json() as Promise<Word[]>
    })
    .then(chunks => buildChunkIndex(Array.isArray(chunks) ? chunks : []))
    .catch(() => {
      chunkIndexPromise = null
      return new Map<string, Word[]>()
    })
  return chunkIndexPromise
}

/**
 * 查询包含指定单词的词块。
 * 多词短语(如正在练习词块词典本身)返回空,避免面板重复展示自身。
 */
export async function getChunksForWord(word: string): Promise<Word[]> {
  const key = (word ?? '').trim().toLowerCase()
  if (!key || /\s/.test(key)) return []
  const index = await loadChunkIndex()
  return index.get(key) ?? []
}

/** 词块中文释义:trans 各项 cn 以分号连接 */
export function chunkTransCn(chunk: Word): string {
  return (chunk?.trans ?? []).map(item => item?.cn).filter(Boolean).join('；')
}

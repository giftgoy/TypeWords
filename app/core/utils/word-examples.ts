import type { WordSubContent } from '../types/types.ts'

export function normalizeExampleWord(word: string): string {
  return word.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
}

export function wordExampleBucket(word: string): string {
  const first = normalizeExampleWord(word)[0] ?? ''
  return /^[a-z]$/.test(first) ? first : 'other'
}

export function exampleSourceUrl(value: unknown): string | undefined {
  return typeof value === 'string' && /^https:\/\/tatoeba\.org\/en\/sentences\/show\/\d+$/.test(value) ? value : undefined
}

export function withWordExamples<T extends { sentences: WordSubContent[] }>(word: T, fallback: WordSubContent[]): T {
  return word.sentences?.length || !fallback.length ? word : { ...word, sentences: fallback }
}

export function createWordExampleLoader(readBucket: (bucket: string) => Promise<unknown>) {
  const buckets = new Map<string, Promise<Record<string, WordSubContent[]>>>()
  return async (word: string): Promise<WordSubContent[]> => {
    const key = normalizeExampleWord(word)
    if (!key) return []
    const bucket = wordExampleBucket(key)
    let pending = buckets.get(bucket)
    if (!pending) {
      pending = readBucket(bucket).then(data => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid example data')
        return data as Record<string, WordSubContent[]>
      }).catch(error => {
        buckets.delete(bucket)
        throw error
      })
      buckets.set(bucket, pending)
    }
    const data = await pending
    const sentences = Object.hasOwn(data, key) && Array.isArray(data[key]) ? data[key] : []
    return sentences.filter(sentence =>
      typeof sentence?.c === 'string' && sentence.c.trim() &&
      typeof sentence.cn === 'string' && sentence.cn.trim() &&
      typeof sentence.attribution === 'string' && sentence.attribution.trim() &&
      exampleSourceUrl(sentence.sourceUrl)
    )
  }
}

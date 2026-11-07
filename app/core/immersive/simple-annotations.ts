import { CONTRACTIONS, IRREGULAR_LEMMAS } from './lemmatize.ts'

type AnnotationToken = {
  text: string
  lemma?: string
  form?: string
  target?: boolean
  gloss?: string
  fullGloss?: string
  title?: string
  phrase?: string
  phraseCn?: string
  phraseSpace?: boolean
  annotationExcluded?: boolean
}
const normalize = (word: string) => word.trim().toLowerCase().replace(/[’‘]/g, "'")

/** 最后过滤显示标记，防止语境释义或搭配再次把简单词标回来；查词数据保留。 */
export function excludeSimpleAnnotations<T extends AnnotationToken>(
  tokens: T[],
  ignored: Set<string>,
  enabled: boolean
): T[] {
  if (!enabled) return tokens
  const keys = new Set([...ignored].map(normalize))
  const excluded = (value?: string) => {
    if (!value) return false
    const key = normalize(value)
    return keys.has(key) || keys.has(CONTRACTIONS[key]) || keys.has(IRREGULAR_LEMMAS[key])
  }
  const result = tokens.map(token =>
    excluded(token.text) || excluded(token.lemma) || excluded(token.form)
      ? {
          ...token,
          annotationExcluded: !!(token.target || token.phrase),
          target: false,
          gloss: undefined,
          title: undefined,
          phrase: undefined,
          phraseCn: undefined,
          phraseSpace: false,
        }
      : { ...token }
  )
  for (let i = 0; i < result.length; i++) {
    if (result[i].phraseSpace && result[i].phrase !== result[i + 1]?.phrase) result[i].phraseSpace = false
  }
  return result
}

import { lemmaCandidates } from './lemmatize.ts'

/** Literal phrases also match regular/irregular inflections and one inserted adverb. */
export function phraseTokenIndexes(tokens: { text: string; space: boolean; kind: string }[], phrase: string, exact = false): number[][] {
  const normalized = phrase.toLowerCase().replaceAll('’', "'")
  const parts = normalized.split(/\s+/)
  const matches: number[][] = []
  for (let start = 0; start < tokens.length; start++) {
    if (exact) {
      let text = ''
      for (let end = start; end < tokens.length; end++) {
        text += (end > start && tokens[end - 1].space ? ' ' : '') + tokens[end].text.toLowerCase()
        if (!normalized.startsWith(text)) break
        if (text === normalized) { matches.push(Array.from({ length: end - start + 1 }, (_, i) => start + i)); break }
      }
      continue
    }
    let part = 0
    let skipped = false
    const indexes: number[] = []
    for (let i = start; i < tokens.length && part < parts.length; i++) {
      const token = tokens[i]
      if (token.kind !== 'word' || (i > start && !tokens[i - 1].space)) break
      if (token.text.toLowerCase() === parts[part] || lemmaCandidates(token.text).some(candidate => lemmaCandidates(parts[part]).includes(candidate))) {
        indexes.push(i)
        part++
      } else if (part > 0 && !skipped && /ly$/i.test(token.text)) {
        skipped = true
        indexes.push(i)
      } else break
    }
    if (part === parts.length) matches.push(indexes)
  }
  return matches
}

export const DEFAULT_SIMPLE_WORDS = [
  'a',
  'an',
  'i',
  'my',
  'me',
  'you',
  'your',
  'he',
  'his',
  'she',
  'her',
  'it',
  'what',
  'who',
  'where',
  'how',
  'when',
  'which',
  'be',
  'am',
  'is',
  'was',
  'are',
  'were',
  'do',
  'did',
  'can',
  'could',
  'will',
  'would',
  'the',
  'that',
  'this',
  'and',
  'not',
  'no',
  'yes',
  'to',
  'of',
  'for',
  'at',
  'in',
]

export function normalizeWordKey(value: string): string {
  return value.trim().toLowerCase()
}

export function parseSimpleWords(value: string | string[]): string[] {
  const entries = typeof value === 'string' ? value.split(/[,，;；、\r\n\t]+/) : value
  return [...new Set(entries.map(normalizeWordKey).filter(Boolean))]
}

export function buildIgnoreWordsSet(simpleWords: string[], knownWords: string[], enabled: boolean): Set<string> {
  return new Set(parseSimpleWords(enabled ? [...knownWords, ...simpleWords] : knownWords))
}

/** Advance through the source dictionary, including skipped gaps, without counting a word twice. */
export function advanceFilteredStudyIndex<T extends { id?: string | number; word: string }>(
  words: T[],
  taskNewWords: T[],
  currentIndex: number,
  ignoreSet: Set<string>
): number {
  let nextIndex = Math.max(0, Math.min(words.length, currentIndex))
  const positions = new Map(
    words.map((word, index) => [word.id != null ? `id:${word.id}` : `word:${normalizeWordKey(word.word)}`, index])
  )
  for (const word of taskNewWords) {
    const position = positions.get(word.id != null ? `id:${word.id}` : `word:${normalizeWordKey(word.word)}`)
    if (position !== undefined) nextIndex = Math.max(nextIndex, position + 1)
  }
  while (nextIndex < words.length && ignoreSet.has(normalizeWordKey(words[nextIndex].word))) nextIndex++
  return nextIndex
}

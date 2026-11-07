import { lemmaCandidates } from './lemmatize.ts'

export type DictionaryMembershipIndex = {
  v: number
  dictionaries: { id: string; name: string; url?: string; size: number }[]
  words: Record<string, number[]>
}
export type MembershipRow = {
  form: string
  count: number
  candidates: { lemma: string; dictionaries: string[] }[]
  dictionaries: string[]
  exact: boolean
  exactDictionaries: string[]
}
export function analyzeDictionaryMembership(text: string, index: DictionaryMembershipIndex, includeCandidates = true) {
  const forms = new Map<string, number>()
  for (const match of text.matchAll(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)) {
    const form = match[0].toLowerCase().replace(/’/g, "'")
    forms.set(form, (forms.get(form) || 0) + 1)
  }
  const has = (word: string) => Object.hasOwn(index.words, word)
  const rows: MembershipRow[] = [...forms].map(([form, count]) => {
    const exact = has(form)
    const exactDictionaries = exact ? index.words[form].map(i => index.dictionaries[i]?.id).filter(Boolean) : []
    const candidates = (includeCandidates ? lemmaCandidates(form).filter(w => w !== form && has(w)) : [])
      .map(lemma => ({
        lemma,
        dictionaries: index.words[lemma]
          .map(i => index.dictionaries[i]?.id)
          .filter(id => id && !exactDictionaries.includes(id)),
      }))
      .filter(c => c.dictionaries.length)
    return {
      form,
      count,
      candidates,
      exact,
      exactDictionaries,
      dictionaries: [...new Set([...exactDictionaries, ...candidates.flatMap(v => v.dictionaries)])],
    }
  })
  rows.sort((a, b) => b.count - a.count || a.form.localeCompare(b.form))
  const tokens = rows.reduce((n, row) => n + row.count, 0)
  const matched = rows.filter(row => row.dictionaries.length)
  const summaries = index.dictionaries
    .map(dictionary => {
      const hits = rows.filter(row => row.dictionaries.includes(dictionary.id))
      return {
        ...dictionary,
        forms: hits.length,
        exact: hits.filter(row => row.exactDictionaries.includes(dictionary.id)).length,
        candidates: hits.filter(row => !row.exactDictionaries.includes(dictionary.id)).length,
        occurrences: hits.reduce((n, row) => n + row.count, 0),
      }
    })
    .sort((a, b) => b.forms - a.forms || a.name.localeCompare(b.name))
  return {
    rows,
    summaries,
    tokens,
    uniqueForms: rows.length,
    matchedForms: matched.length,
    unmatchedForms: rows.length - matched.length,
    matchedTokens: matched.reduce((n, row) => n + row.count, 0),
  }
}

export function withPersonalDictionaries(
  index: DictionaryMembershipIndex,
  books: {
    id: unknown
    name: string
    custom?: boolean
    system?: boolean
    language?: string
    words: { word: string }[]
  }[]
): DictionaryMembershipIndex {
  const dictionaries = [...index.dictionaries]
  const words: Record<string, number[]> = Object.assign(Object.create(null), index.words)
  for (const book of books) {
    if (book.language !== 'en' || (!book.custom && !book.system) || !book.words?.length) continue
    const keys = [...new Set(book.words.map(w => w.word.toLowerCase().replace(/’/g, "'").trim()).filter(Boolean))]
    const position = dictionaries.length
    dictionaries.push({ id: 'personal:' + book.id, name: book.name + '（我的词典）', size: keys.length })
    for (const key of keys) words[key] = [...(words[key] || []), position]
  }
  return { v: 1, dictionaries, words }
}

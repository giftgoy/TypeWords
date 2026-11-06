import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeExampleWord, wordExampleBucket } from '../app/core/utils/word-examples.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = resolve(root, '.typewords.local/sources/tatoeba')
const raw = await readFile(resolve(sourceDir, 'cmn.txt'), 'utf8')
const archive = await readFile(resolve(sourceDir, 'cmn-eng.zip'))
const archiveHash = createHash('sha256').update(archive).digest('hex')
if (archiveHash !== 'd606361aa7312dcdfb15ef4fc51cb1e7ed8bc2dc608a7b192626cd36e8403106') {
  throw new Error('The sentence corpus changed. Review its provenance and update the pinned hash before rebuilding.')
}
const dictionaryDir = resolve(root, 'public/dicts/en/word')
const dictionaries = []
const wanted = new Set()
for (const filename of await readdir(dictionaryDir)) {
  if (filename !== 'CET4_T.json' && !filename.startsWith('market-')) continue
  const words = JSON.parse(await readFile(resolve(dictionaryDir, filename), 'utf8'))
  dictionaries.push({ filename, words })
  for (const word of words) if (!word.sentences?.length) wanted.add(normalizeExampleWord(word.word))
}

const candidates = new Map()
for (const line of raw.split(/\r?\n/)) {
  const [c, cn, attribution] = line.split('\t')
  if (!c || !cn || !attribution?.startsWith('CC-BY 2.0 (France) Attribution:')) continue
  const normalized = normalizeExampleWord(c)
  const tokens = normalized.match(/[a-z]+(?:['-][a-z]+)*/g) ?? []
  if (tokens.length < 4 || tokens.length > 14 || !/^[A-Z]/.test(c) || !/[.!?]$/.test(c) || !/\p{Script=Han}/u.test(cn)) continue
  const ids = [...attribution.matchAll(/#(\d+)/g)]
  if (ids.length < 2) continue
  const keys = new Set(tokens)
  for (let count = 2; count <= 4; count++) {
    for (let start = 0; start <= tokens.length - count; start++) {
      const phrase = tokens.slice(start, start + count).join(' ')
      if (normalized.includes(phrase)) keys.add(phrase)
    }
  }
  for (const key of keys) {
    if (!wanted.has(key)) continue
    const list = candidates.get(key) ?? []
    const score = Math.abs(tokens.length - 7) + (/\b(Tom|Mary|Boston)\b/.test(c) ? 2 : 0)
    const existing = list.find(item => item.c.toLowerCase() === c.toLowerCase())
    if (existing) continue
    list.push({ c, cn, attribution, sourceUrl: `https://tatoeba.org/en/sentences/show/${ids[0][1]}`, score })
    list.sort((a, b) => a.score - b.score || a.c.localeCompare(b.c, 'en'))
    candidates.set(key, list.slice(0, 2))
  }
}

const buckets = Object.fromEntries([...Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)), 'other'].map(key => [key, {}]))
for (const [word, sentences] of [...candidates].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  buckets[wordExampleBucket(word)][word] = sentences.map(({ score, ...sentence }) => sentence)
}
const outputDir = resolve(root, 'public/dicts/en/examples')
await mkdir(outputDir, { recursive: true })
for (const [bucket, words] of Object.entries(buckets)) {
  await writeFile(resolve(outputDir, `${bucket}.json`), JSON.stringify(words) + '\n')
}
const coverage = dictionaries.map(({ filename, words }) => ({
  filename,
  words: words.length,
  originalExamples: words.filter(word => word.sentences?.length).length,
  supplementalExamples: words.filter(word => !word.sentences?.length && candidates.has(normalizeExampleWord(word.word))).length,
}))
await writeFile(resolve(root, 'public/list/word-example-sources.json'), JSON.stringify({
  source: 'Tatoeba sentence pairs, curated by ManyThings.org',
  sourceUrl: 'https://www.manythings.org/anki/',
  downloadUrl: 'https://www.manythings.org/anki/cmn-eng.zip',
  snapshotDate: '2026-02-13',
  archiveSha256: archiveHash,
  license: 'CC BY 2.0 FR',
  licenseUrl: 'https://creativecommons.org/licenses/by/2.0/fr/',
  changes: 'Selected and indexed matching original sentence pairs; English and Chinese text and author attribution remain unchanged.',
  matchedWords: candidates.size,
  coverage,
}, null, 2) + '\n')
await writeFile(resolve(root, 'public/resource-licenses/tatoeba-manythings-about.txt'), await readFile(resolve(sourceDir, '_about.txt')))
console.log(JSON.stringify({ matchedWords: candidates.size, coat: buckets.c.coat, coverage }, null, 2))

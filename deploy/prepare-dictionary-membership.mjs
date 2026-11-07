import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public/list/word.json'), 'utf8'))
  .flat()
  .filter(v => v.language === 'en')
const dictionaries = []
const words = Object.create(null)
for (const item of catalog) {
  const source = path.resolve(root, 'public/dicts/en/word', item.url)
  if (!source.startsWith(path.join(root, 'public/dicts/en/word') + path.sep)) throw new Error('Invalid dictionary path')
  const raw = JSON.parse(fs.readFileSync(source, 'utf8'))
  const entries = Array.isArray(raw) ? raw : raw.words
  if (!Array.isArray(entries)) throw new Error('Invalid dictionary: ' + item.name)
  const keys = [
    ...new Set(
      entries
        .map(w =>
          String(w.word || '')
            .toLowerCase()
            .replace(/’/g, "'")
            .trim()
        )
        .filter(Boolean)
    ),
  ]
  const index = dictionaries.length
  dictionaries.push({ id: String(item.id), name: item.name, url: item.url, size: keys.length })
  for (const key of keys) (words[key] ||= []).push(index)
}
fs.writeFileSync(
  path.join(root, 'public/dicts/en/word/dictionary-membership.json'),
  JSON.stringify({ v: 1, dictionaries, words })
)
console.log(`Dictionary membership: ${dictionaries.length} dictionaries, ${Object.keys(words).length} entries`)

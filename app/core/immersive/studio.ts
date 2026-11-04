import { lemmaCandidates } from './lemmatize.ts'
import type { Article } from '../types/types.ts'

export function parseTargetWords(raw: string): string[] {
  const words = [...new Set(raw.split(/[,，;；\n]+/).map(w => w.trim().toLowerCase()).filter(Boolean))]
  if (!words.length || words.length > 100 || words.some(w => !/^(?=.*[a-z])[a-z0-9 .'+/#-]+$/.test(w))) throw new Error('请输入 1–100 个英语目标词或短语，以逗号或换行分隔。')
  return words
}

export function validateCoverage(targets: string[], vocabulary: Article['readingStudy']['vocabulary']) {
  const missing = targets.filter(target => !vocabulary.some(v => v.lemma.toLowerCase() === target && (
    v.form.toLowerCase() === target || (v.form.toLowerCase().split(' ').length === target.split(' ').length && v.form.toLowerCase().split(' ').every((word, i) => lemmaCandidates(word).some(lemma => lemmaCandidates(target.split(' ')[i]).includes(lemma))))
  )))
  if (missing.length) throw new Error(`以下目标词未以可核对的词形覆盖：${missing.join(', ')}。请重试。`)
}

export function studyMarkdown(article: Article) {
  const study = article.readingStudy!
  const text = article.text.replace(new RegExp(`(?<![A-Za-z0-9])(${study.vocabulary.map(v => v.form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a,b) => b.length-a.length).join('|')})(?![A-Za-z0-9])`, 'gi'), '**$1**')
  return `# ${article.title}\n\n${text}\n\n## 中文翻译\n\n${article.textTranslate}\n\n## 目标词清单\n\n${study.vocabulary.map(v => `- ${v.lemma} → ${v.form}：${v.meaning}`).join('\n')}\n\n## 值得背诵的搭配/句型\n\n${study.phrases.map(p => `- ${p.text}：${p.meaning}`).join('\n')}\n\n${study.theme}\n`
}

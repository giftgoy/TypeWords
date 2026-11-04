import { computed, onMounted, ref } from 'vue'
import { useBaseStore } from '../stores/base.ts'
import { withAppBaseURL } from '../utils/base-url.ts'
import type { Word } from '../types/types.ts'

export function useReadingVocabulary() {
  const store = useBaseStore()
  const catalog = ref<{ id: string | number; name: string; url: string }[]>([])
  onMounted(async () => {
    const response = await fetch(withAppBaseURL('/list/word.json'))
    if (response.ok) catalog.value = (await response.json()).filter(v => v.language === 'en')
  })
  const sources = computed(() => [
    ...catalog.value.map(v => ({ key: `catalog:${v.id}`, name: v.name, resource: v })),
    ...store.word.bookList.filter(v => v.words.length || v.custom).map(v => ({ key: `custom:${v.id}`, name: `${v.name}（我的词库）`, resource: v })),
  ])
  async function load(key: string): Promise<Word[]> {
    const source = sources.value.find(v => v.key === key)
    if (!source) return []
    if (key.startsWith('custom:')) return (source.resource as { words: Word[] }).words
    const response = await fetch(withAppBaseURL(`/dicts/en/word/${source.resource.url}`))
    if (!response.ok) throw new Error('词库加载失败，请重试')
    const data = await response.json()
    return Array.isArray(data) ? data : data.words
  }
  return { sources, load }
}

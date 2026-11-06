import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Word, WordSubContent } from '../types/types.ts'
import { withAppBaseURL } from '../utils/base-url'
import { createWordExampleLoader, withWordExamples } from '../utils/word-examples'

const loadExamples = createWordExampleLoader(async bucket => {
  const response = await fetch(withAppBaseURL(`/dicts/en/examples/${bucket}.json`), { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error('Examples unavailable')
  return response.json()
})

export function useWordExamples(getWord: () => Word, enabled: () => boolean = () => true) {
  const fallback = shallowRef<WordSubContent[]>([])
  const loading = ref(false)
  const failed = ref(false)
  let generation = 0

  async function reload() {
    const word = getWord()
    const request = ++generation
    fallback.value = []
    loading.value = false
    failed.value = false
    if (!enabled() || !word.word || word.sentences?.length) return
    loading.value = true
    try {
      const sentences = await loadExamples(word.word)
      if (generation === request) fallback.value = sentences
    } catch {
      if (generation === request) failed.value = true
    } finally {
      if (generation === request) loading.value = false
    }
  }

  watch(() => [enabled(), getWord().word, getWord().sentences], reload, { immediate: true })
  onScopeDispose(() => { generation++ })
  return { wordWithExamples: computed(() => withWordExamples(getWord(), fallback.value)), loading, failed, reload }
}

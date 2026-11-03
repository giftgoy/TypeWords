import { GUIDE_STORAGE_KEY, createLearningGuideState, readLearningGuideState } from '@/core/utils/learning-guide'
import type { LearningGuideState } from '@/core/utils/learning-guide'
import { useRouter } from 'vue-router'

export function useLearningGuide() {
  const state = useState<LearningGuideState>('learning-guide', createLearningGuideState)
  const loaded = useState('learning-guide-loaded', () => false)
  const router = useRouter()
  function persist() {
    if (import.meta.client) {
      try {
        localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(state.value))
      } catch {}
    }
  }
  function load() {
    if (loaded.value || !import.meta.client) return
    try {
      state.value = readLearningGuideState(localStorage.getItem(GUIDE_STORAGE_KEY))
    } catch {}
    loaded.value = true
  }
  function pause() {
    state.value.status = 'paused'
    state.value.waiting = false
    persist()
  }
  function finish() {
    state.value.status = 'completed'
    persist()
  }
  async function start() {
    load()
    state.value = { ...createLearningGuideState(), status: 'active' }
    persist()
    await router.push('/words')
  }
  return { state, loaded, load, persist, pause, finish, start }
}

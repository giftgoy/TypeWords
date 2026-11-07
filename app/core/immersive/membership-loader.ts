import { withAppBaseURL } from '../utils/base-url'
import type { DictionaryMembershipIndex } from './dictionary-membership'

let pending: Promise<DictionaryMembershipIndex> | undefined
export function loadDictionaryMembership() {
  return (pending ||= fetch(withAppBaseURL('/dicts/en/word/dictionary-membership.json'), {
    cache: 'no-cache',
    signal: AbortSignal.timeout(15000),
  })
    .then(async response => {
      if (!response.ok) throw new Error('词典归属索引加载失败，请重试。')
      const index = await response.json()
      if (index.v !== 1 || !Array.isArray(index.dictionaries) || !index.words) throw new Error('词典索引版本不兼容。')
      return index as DictionaryMembershipIndex
    })
    .catch(error => {
      pending = undefined
      throw error
    }))
}

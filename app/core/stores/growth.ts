import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { withAppBaseURL } from '../utils/base-url'
import type { Dict } from '../types/types'

export function dictionaryGrowthId(dict: Partial<Dict>): string {
  return String(dict.sourceId || dict.enName || dict.id || '')
}

export const useGrowthStore = defineStore('growth', () => {
  const state = ref<any>({ revision: -1, now: 0, rounds: [], plans: {} })
  const catalog = ref<any[]>([])
  const error = ref('')
  const loaded = ref(false)
  const receivedAt = ref(Date.now())
  const current = computed<any>(() => state.value.rounds.find((r: any) => r.current))
  const heldWords = computed(
    () => new Set<string>(current.value && current.value.awards.length < 7 ? current.value.wordIds : [])
  )
  const registrations = new Map<string, Promise<any>>()
  let loading: Promise<any> | undefined
  let flushing: Promise<void> | undefined
  let flushingContacts: Promise<void> | undefined
  const outboxKey = 'typewords-growth-settlement-outbox-v1'
  const contactKey = 'typewords-growth-contact-outbox-v1'

  async function flushContacts() {
    if (flushingContacts) return flushingContacts
    flushingContacts = (async () => {
      const pending = JSON.parse(localStorage.getItem(contactKey) || '[]')
      for (const event of pending) {
        accept(await request('', event))
        const latest = JSON.parse(localStorage.getItem(contactKey) || '[]')
        localStorage.setItem(contactKey, JSON.stringify(latest.filter(row => row.eventId !== event.eventId)))
      }
    })().finally(() => {
      flushingContacts = undefined
    })
    return flushingContacts
  }

  function queued(): any[] {
    if (!import.meta.client) return []
    try {
      return JSON.parse(localStorage.getItem(outboxKey) || '[]')
    } catch {
      return []
    }
  }
  async function flushSettlements() {
    if (flushing) return flushing
    flushing = (async () => {
      for (const item of queued()) {
        await act(item.plan)
        await act(item.settlement)
        localStorage.setItem(
          outboxKey,
          JSON.stringify(queued().filter(row => row.settlement.sessionId !== item.settlement.sessionId))
        )
      }
    })().finally(() => {
      flushing = undefined
    })
    return flushing
  }

  function accept(data: any) {
    if (data.revision >= state.value.revision) {
      state.value = data
      receivedAt.value = Date.now()
    }
    loaded.value = true
    error.value = ''
    return data
  }
  async function request(path = '', body?: any) {
    const response = await fetch(withAppBaseURL('/api/data/growth' + path), {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || '成长记录暂时无法保存，请重试。')
    return data
  }
  async function load() {
    if (loading) return loading
    loading = request()
      .then(accept)
      .then(async data => {
        await flushContacts()
        await flushSettlements()
        return data
      })
      .catch(e => {
        error.value = e.message
        throw e
      })
      .finally(() => {
        loading = undefined
      })
    return loading
  }
  async function act(body: any) {
    try {
      if (body.op === 'start' || body.op === 'answer') await flushContacts()
      return accept(await request('', body))
    } catch (e: any) {
      error.value = e.message
      throw e
    }
  }
  async function loadCatalog() {
    if (!catalog.value.length) catalog.value = await request('/catalog')
  }
  async function ensurePlan(dict: Partial<Dict>, ignore = new Set<string>()) {
    const id = dictionaryGrowthId(dict)
    if (!id || dict.system || !dict.words?.length || dict.language !== 'en') return
    if (state.value.plans[id]) return state.value.plans[id]
    if (!registrations.has(id)) {
      const words = [...new Set(dict.words.map(w => w.word.trim().toLowerCase()))]
      const targets = words.filter(w => !ignore.has(w))
      registrations.set(
        id,
        act({
          op: 'plan',
          dictionaryId: id,
          name: dict.name,
          targets,
          excluded: words.length - targets.length,
          historicalPercent: dict.length ? ((dict.lastLearnIndex || 0) * 100) / dict.length : 0,
        })
          .then(data => data.plans[id])
          .finally(() => registrations.delete(id))
      )
    }
    return registrations.get(id)
  }
  async function settleDictionary(dict: Dict, words: string[], sessionId: string, ignore: Set<string>) {
    const id = dictionaryGrowthId(dict)
    if (!id || dict.system || dict.language !== 'en' || !dict.words.length) return
    const all = [...new Set(dict.words.map(w => w.word.trim().toLowerCase()))]
    const targets = all.filter(w => !ignore.has(w))
    const item = {
      plan: {
        op: 'plan',
        dictionaryId: id,
        name: dict.name,
        targets,
        excluded: all.length - targets.length,
        historicalPercent: dict.length ? ((dict.lastLearnIndex || 0) * 100) / dict.length : 0,
      },
      settlement: { op: 'settle', dictionaryId: id, words, sessionId },
    }
    const pending = queued()
    if (!pending.some(row => row.settlement.sessionId === sessionId))
      localStorage.setItem(outboxKey, JSON.stringify([...pending, item]))
    await flushSettlements()
  }
  async function contact(words: string[], eventId: string) {
    if (!current.value || current.value.awards.length === 7 || !words.some(w => heldWords.value.has(w.toLowerCase())))
      return
    const pending = JSON.parse(localStorage.getItem(contactKey) || '[]')
    if (!pending.some(row => row.eventId === eventId))
      localStorage.setItem(
        contactKey,
        JSON.stringify([...pending, { op: 'contact', words, eventId, roundId: current.value.id }])
      )
    await flushContacts()
  }
  async function exportBackup() {
    const data = await request('/backup')
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'TypeWords-growth-' + new Date().toISOString().slice(0, 10) + '.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  async function importBackup(file: File) {
    const data = JSON.parse(await file.text())
    return accept(await request('/backup', data))
  }
  return {
    state,
    receivedAt,
    catalog,
    error,
    loaded,
    current,
    heldWords,
    load,
    act,
    loadCatalog,
    ensurePlan,
    settleDictionary,
    contact,
    exportBackup,
    importBackup,
  }
})

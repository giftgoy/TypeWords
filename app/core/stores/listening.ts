import { defineStore } from 'pinia'
import type { ListeningItem, ListeningOrder, ListeningScope } from '../word/listening-queue.ts'

/**
 * 磨耳朵的播放状态。
 * 放在全局 store 里，切换页面时不会中断（播放器挂在 layout 上，见 WordListeningPlayer）。
 */

export interface ListeningOptions {
  scope: ListeningScope
  order: ListeningOrder
  /** 读完单词后读中文释义 */
  readMeaning: boolean
  /** 读第一条例句 */
  readExample: boolean
  /** 每个词之间的停顿（秒） */
  pauseSeconds: number
  /** 语速倍率 */
  rate: number
  /** 盲听：界面上不显示拼写，逼自己靠听 */
  blind: boolean
}

export type ListeningStage = 'idle' | 'word' | 'meaning' | 'example' | 'gap'

export interface ListeningState {
  items: ListeningItem[]
  index: number
  playing: boolean
  /** 播放器面板是否展开 */
  expanded: boolean
  stage: ListeningStage
  options: ListeningOptions
  message: string
}

const OPTIONS_KEY = 'typewords:listening-options'

export const getDefaultListeningOptions = (): ListeningOptions => ({
  scope: 'current',
  order: 'sequence',
  readMeaning: true,
  readExample: false,
  pauseSeconds: 2,
  rate: 1,
  blind: false,
})

function loadOptions(): ListeningOptions {
  const defaults = getDefaultListeningOptions()
  try {
    const raw = localStorage.getItem(OPTIONS_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<ListeningOptions>
    return {
      ...defaults,
      ...parsed,
      pauseSeconds: clamp(Number(parsed.pauseSeconds ?? defaults.pauseSeconds), 0, 10),
      rate: clamp(Number(parsed.rate ?? defaults.rate), 0.5, 2),
    }
  } catch {
    return defaults
  }
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export const useListeningStore = defineStore('listening', {
  state: (): ListeningState => ({
    items: [],
    index: 0,
    playing: false,
    expanded: false,
    stage: 'idle',
    options: getDefaultListeningOptions(),
    message: '',
  }),
  getters: {
    current(state): ListeningItem | null {
      return state.items[state.index] ?? null
    },
    total(state): number {
      return state.items.length
    },
  },
  actions: {
    /** 首次进入页面时从 localStorage 恢复选项（只读一次，避免覆盖用户当下的改动） */
    restoreOptions() {
      if (!import.meta.client) return
      this.options = loadOptions()
    },
    setOptions(patch: Partial<ListeningOptions>) {
      this.options = { ...this.options, ...patch }
      if (import.meta.client) {
        try {
          localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options))
        } catch {
          /* 存储受限时只影响记忆，不影响播放 */
        }
      }
    },
    setQueue(items: ListeningItem[]) {
      this.items = items
      this.index = Math.min(this.index, Math.max(0, items.length - 1))
    },
    setIndex(index: number) {
      if (!this.items.length) {
        this.index = 0
        return
      }
      this.index = ((index % this.items.length) + this.items.length) % this.items.length
    },
    setPlaying(playing: boolean) {
      this.playing = playing
      if (!playing) this.stage = 'idle'
    },
    setStage(stage: ListeningStage) {
      this.stage = stage
    },
    setMessage(message: string) {
      this.message = message
    },
    toggleExpanded(expanded?: boolean) {
      this.expanded = expanded ?? !this.expanded
    },
  },
})

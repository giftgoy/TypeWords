import { defineStore } from 'pinia'
import type { ListeningItem, ListeningOrder, ListeningScope } from '../word/listening-queue.ts'

/**
 * 磨耳朵的播放状态。
 * 放在全局 store 里，切换页面时不会中断（播放器挂在 layout 上，见 WordListeningPlayer）。
 */

export interface ListeningOptions {
  scope: ListeningScope
  order: ListeningOrder
  /** 每轮最多听多少个词，0 表示全部（当前词库几千个词不该一口气全听） */
  limit: number
  /** 从哪个词开始（队列序），空串 = 第一个 */
  startWord: string
  /** 听到哪个词为止（含），空串 = 队尾（循环）；设了终点播完最后一个就停 */
  endWord: string
  /** 读完单词后读中文释义 */
  readMeaning: boolean
  /** 读例句（rotateExample 关闭时恒读第一句） */
  readExample: boolean
  /** 读完例句后读一条包含当前单词的词块 */
  readChunk: boolean
  /** 例句按轮次轮换，每轮换下一条 */
  rotateExample: boolean
  /** 每个词之间的停顿（秒） */
  pauseSeconds: number
  /** 语速倍率 */
  rate: number
  /** 盲听：界面上不显示拼写，逼自己靠听 */
  blind: boolean
}

export type ListeningStage = 'idle' | 'word' | 'meaning' | 'example' | 'chunk' | 'gap'

export interface ListeningState {
  items: ListeningItem[]
  index: number
  playing: boolean
  /** 播放器面板是否展开 */
  expanded: boolean
  stage: ListeningStage
  options: ListeningOptions
  message: string
  /** 当前朗读的词块（词块朗读时给界面展示），没有就是 null */
  currentChunk: { word: string; cn: string } | null
  /** 例句/词块的轮次计数，驱动下一次轮换 */
  rotation: number
  /** 随机排序的固定种子，0 表示未初始化 */
  queueSeed: number
}

const OPTIONS_KEY = 'typewords:listening-options'

export const getDefaultListeningOptions = (): ListeningOptions => ({
  scope: 'current',
  order: 'sequence',
  limit: 20,
  startWord: '',
  endWord: '',
  readMeaning: true,
  readExample: false,
  readChunk: false,
  rotateExample: false,
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
    const str = (value: unknown) => (typeof value === 'string' ? value : '')
    return {
      ...defaults,
      ...parsed,
      startWord: str(parsed.startWord),
      endWord: str(parsed.endWord),
      limit: clamp(Number(parsed.limit ?? defaults.limit), 0, 10000),
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
    currentChunk: null,
    rotation: 0,
    queueSeed: 0,
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
    /** 记录当前正在朗读的词块（界面展示用），null 表示这一轮没有词块 */
    setCurrentChunk(chunk: { word: string; cn: string } | null) {
      this.currentChunk = chunk
    },
    /** 例句/词块读完一轮就 +1，驱动下一次轮换 */
    setRotation(n: number) {
      this.rotation = n
    },
    /** 随机排序种子：整个会话固定一个，重建队列时顺序不再乱跳 */
    ensureQueueSeed(): number {
      if (!this.queueSeed) {
        this.queueSeed = (Date.now() % 2147483647) + 1
      }
      return this.queueSeed
    },
    toggleExpanded(expanded?: boolean) {
      this.expanded = expanded ?? !this.expanded
    },
  },
})

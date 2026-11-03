export interface PronunciationCallbacks {
  onPlay?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

/** One playback attempt; stale events and duplicate media errors must not advance a new word. */
export function startPronunciation(
  options: PronunciationCallbacks & {
    audio: HTMLAudioElement
    source: string
    volume: number
    rate: number
    isCurrent: () => boolean
    fallback: (callbacks: PronunciationCallbacks) => void
    timeoutMs?: number
  }
) {
  const { audio } = options
  const timeoutMs = options.timeoutMs ?? 5000
  let finished = false
  let fallbackStarted = false
  let timer: ReturnType<typeof setTimeout>
  const current = () => !finished && options.isCurrent()
  function fail(message: string) {
    clearTimeout(timer)
    if (!current()) return
    finished = true
    options.onError?.(message)
  }
  function played() {
    clearTimeout(timer)
    if (current()) options.onPlay?.()
  }
  function ended() {
    clearTimeout(timer)
    if (!current()) return
    finished = true
    options.onEnd?.()
  }
  function fallback(cause?: unknown) {
    if (!current() || fallbackStarted) return
    clearTimeout(timer)
    if ((cause as { name?: string })?.name === 'NotAllowedError') {
      fail('浏览器尚未允许播放声音，请点击“重试发音”。')
      return
    }
    fallbackStarted = true
    audio.onerror = null
    audio.onplay = null
    audio.onended = null
    audio.pause()
    timer = setTimeout(() => fail('发音暂时不可用。可以重试、检查声音设置，或查看单词继续练习。'), timeoutMs)
    try {
      options.fallback({ onPlay: played, onEnd: ended, onError: fail })
    } catch {
      fail('发音暂时不可用，请重试或查看单词继续练习。')
    }
  }
  audio.src = options.source
  audio.volume = options.volume
  audio.playbackRate = options.rate
  audio.onplay = played
  audio.onended = ended
  audio.onerror = () => fallback()
  timer = setTimeout(() => fallback(), timeoutMs)
  try {
    Promise.resolve(audio.play()).catch(fallback)
  } catch (cause) {
    fallback(cause)
  }
}

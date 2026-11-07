import { useGrowthStore } from '@/core/stores/growth'

export default defineNuxtPlugin(nuxtApp => {
  nuxtApp.hook('app:mounted', () => {
    const growth = useGrowthStore()
    let timer: ReturnType<typeof setTimeout> | undefined
    let visible = new Set<string>()
    let currentRound = ''
    async function scan() {
      if (document.hidden || !growth.current || growth.current.awards.length === 7) return
      if (currentRound !== growth.current.id) {
        visible.clear()
        currentRound = growth.current.id
      }
      const found = new Set<string>()
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const el = node.parentElement
        if (!el || el.closest('[data-growth-player],script,style,[aria-hidden="true"],.word-shadow')) continue
        const tokens = node.textContent?.toLowerCase().match(/[a-z]+(?:['-][a-z]+)*/g) || []
        const matches = tokens.filter(w => growth.heldWords.has(w))
        if (!matches.length) continue
        const box = el.getBoundingClientRect()
        if (
          box.width <= 0 ||
          box.height <= 0 ||
          box.bottom < 0 ||
          box.top > innerHeight ||
          box.right < 0 ||
          box.left > innerWidth
        )
          continue
        if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
        const style = getComputedStyle(el)
        if (style.visibility === 'hidden' || style.opacity === '0' || style.display === 'none') continue
        matches.forEach(w => found.add(w))
      }
      const added = [...found].filter(w => !visible.has(w))
      visible = found
      if (added.length) await growth.contact(added, crypto.randomUUID()).catch(() => {})
    }
    function schedule() {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        void scan()
      }, 500)
    }
    void growth
      .load()
      .then(schedule)
      .catch(() => {})
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true })
    window.addEventListener('scroll', schedule, { passive: true, capture: true })
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden)
        void growth
          .load()
          .then(schedule)
          .catch(() => {})
    })
    nuxtApp.hook('page:finish', () => {
      visible.clear()
      void growth
        .load()
        .then(schedule)
        .catch(() => {})
    })
  })
})

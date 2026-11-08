<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { STAR_COLORS, STAR_LEVEL_LABEL, type Star, type StarLevel } from '@/core/tech-tree/galaxy'

const props = defineProps<{
  stars: Star[]
  dictName: string
}>()

const emit = defineEmits<{ (e: 'select', star: Star): void }>()

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const hovered = ref<{ star: Star; x: number; y: number } | null>(null)
const zoomLabel = ref('100%')

type View = { x: number; y: number; k: number }
const view: View = { x: 0, y: 0, k: 0.4 }

let ctx: CanvasRenderingContext2D | null = null
let dpr = 1
let width = 0
let height = 0
let frame = 0
let observer: ResizeObserver | null = null
let sprites: Record<StarLevel, HTMLCanvasElement> | null = null
let spritePale: HTMLCanvasElement | null = null
let backgroundStars: { x: number; y: number; r: number; a: number }[] = []

const LEVELS: StarLevel[] = ['new', 'learning', 'review', 'strong', 'mastered']

const counts = computed(() => {
  const map: Record<StarLevel, number> = { new: 0, learning: 0, review: 0, strong: 0, mastered: 0 }
  props.stars.forEach(star => (map[star.level] += 1))
  return map
})

const litCount = computed(() => counts.value.strong + counts.value.mastered)

function makeSprite(core: string, glow: string) {
  const size = 96
  const sprite = document.createElement('canvas')
  sprite.width = size
  sprite.height = size
  const sctx = sprite.getContext('2d')!
  const half = size / 2
  const gradient = sctx.createRadialGradient(half, half, 0, half, half, half)
  gradient.addColorStop(0, glow)
  gradient.addColorStop(0.22, glow)
  gradient.addColorStop(0.45, glow.replace(/[\d.]+\)$/, '0.22)'))
  gradient.addColorStop(0.72, glow.replace(/[\d.]+\)$/, '0.05)'))
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  sctx.fillStyle = gradient
  sctx.fillRect(0, 0, size, size)
  sctx.beginPath()
  sctx.fillStyle = core
  sctx.arc(half, half, half * 0.2, 0, Math.PI * 2)
  sctx.fill()
  return sprite
}

function buildSprites() {
  if (typeof document === 'undefined') return
  sprites = LEVELS.reduce(
    (acc, level) => {
      acc[level] = makeSprite(STAR_COLORS[level].core, STAR_COLORS[level].glow)
      return acc
    },
    {} as Record<StarLevel, HTMLCanvasElement>
  )
  // 未学的星里掺一点冷白，星场才不会像一片同色的灰点
  spritePale = makeSprite('#e2e8f0', 'rgba(226, 232, 240, 0.32)')
}

function buildBackground() {
  backgroundStars = Array.from({ length: 260 }, (_, index) => ({
    x: Math.cos(index * 12.9898) * 1400,
    y: Math.sin(index * 78.233) * 900,
    r: 0.4 + ((index * 37) % 10) / 12,
    a: 0.08 + ((index * 17) % 10) / 40,
  }))
}

function resize() {
  const el = root.value
  const cv = canvas.value
  if (!el || !cv) return
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  width = rect.width
  height = rect.height
  dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = Math.round(width * dpr)
  cv.height = Math.round(height * dpr)
  cv.style.width = `${width}px`
  cv.style.height = `${height}px`
  ctx = cv.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  requestDraw()
}

function fit() {
  const galaxyR = 1160
  const k = Math.min(width / (galaxyR * 2.05), height / (galaxyR * 1.35), 1.2)
  view.k = k
  view.x = width / 2
  view.y = height / 2
  syncZoomLabel()
  requestDraw()
}

function syncZoomLabel() {
  zoomLabel.value = `${Math.round(view.k * 100)}%`
}

function requestDraw() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    draw()
  })
}

// 点亮数量不多时才开呼吸动画，避免几千颗星每帧重绘
let twinkleRaf = 0
let lastTwinkle = 0

function startTwinkle() {
  if (twinkleRaf || !canvas.value) return
  const step = (ts: number) => {
    if (ts - lastTwinkle > 33) {
      lastTwinkle = ts
      draw(ts)
    }
    twinkleRaf = requestAnimationFrame(step)
  }
  twinkleRaf = requestAnimationFrame(step)
}

function stopTwinkle() {
  if (twinkleRaf) cancelAnimationFrame(twinkleRaf)
  twinkleRaf = 0
  requestDraw()
}

watch(
  litCount,
  count => {
    if (count > 0 && count <= 1200) startTwinkle()
    else stopTwinkle()
  },
  { immediate: true }
)

function draw(time = 0) {
  if (!ctx) return
  ctx.clearRect(0, 0, width, height)

  // 星云底色（屏幕空间，不随缩放跳动）
  const nebula = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.62)
  nebula.addColorStop(0, 'rgba(99, 102, 241, 0.16)')
  nebula.addColorStop(0.45, 'rgba(56, 189, 248, 0.08)')
  nebula.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = nebula
  ctx.fillRect(0, 0, width, height)

  // 星系盘：压扁的椭圆辉光，让旋臂有依托
  ctx.save()
  ctx.translate(view.x, view.y)
  ctx.scale(1, 0.62)
  const diskRadius = 1080 * view.k
  const disk = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(60, diskRadius))
  disk.addColorStop(0, 'rgba(129, 140, 248, 0.14)')
  disk.addColorStop(0.5, 'rgba(56, 189, 248, 0.06)')
  disk.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = disk
  ctx.beginPath()
  ctx.arc(0, 0, Math.max(60, diskRadius), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const toScreenX = (x: number) => x * view.k + view.x
  const toScreenY = (y: number) => y * view.k + view.y

  // 星系核心的一点辉光
  const coreRadius = Math.max(70, 150 * view.k)
  const core = ctx.createRadialGradient(view.x, view.y, 0, view.x, view.y, coreRadius)
  core.addColorStop(0, 'rgba(199, 210, 254, 0.38)')
  core.addColorStop(0.45, 'rgba(99, 102, 241, 0.14)')
  core.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, width, height)

  // 远处的背景星，给一点深度
  ctx.save()
  backgroundStars.forEach(bg => {
    ctx!.globalAlpha = bg.a
    ctx!.fillStyle = '#c7d2fe'
    ctx!.beginPath()
    ctx!.arc(toScreenX(bg.x), toScreenY(bg.y), Math.max(0.4, bg.r * view.k), 0, Math.PI * 2)
    ctx!.fill()
  })
  ctx.restore()

  if (!sprites) buildSprites()

  const sorted = props.stars
  for (let i = 0; i < sorted.length; i++) {
    const star = sorted[i]
    const px = toScreenX(star.x)
    const py = toScreenY(star.y)
    if (px < -40 || py < -40 || px > width + 40 || py > height + 40) continue
    const sprite = star.level === 'new' && star.phase > 3.7 && spritePale ? spritePale : sprites![star.level]
    const size = Math.max(3, star.size * 7 * Math.min(view.k, 1.6))
    const twinkle = star.score > 0.55 ? 0.84 + 0.16 * Math.sin(time / 560 + star.phase) : 1
    ctx.globalAlpha = Math.min(1, star.alpha * twinkle)
    ctx.drawImage(sprite, px - size / 2, py - size / 2, size, size)
  }
  ctx.globalAlpha = 1

  if (hovered.value) {
    const { star } = hovered.value
    const px = toScreenX(star.x)
    const py = toScreenY(star.y)
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.9)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(px, py, 10, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function worldFromEvent(event: PointerEvent | WheelEvent | MouseEvent) {
  const el = root.value
  if (!el) return { x: 0, y: 0 }
  const rect = el.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left - view.x) / view.k,
    y: (event.clientY - rect.top - view.y) / view.k,
  }
}

function findStar(world: { x: number; y: number }): Star | null {
  const threshold = 14 / view.k
  let best: Star | null = null
  let bestDist = threshold * threshold
  for (const star of props.stars) {
    const dx = star.x - world.x
    const dy = star.y - world.y
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      bestDist = dist
      best = star
    }
  }
  return best
}

function onPointerMove(event: PointerEvent) {
  if (dragging) {
    view.x = dragStart.x + (event.clientX - dragOrigin.x)
    view.y = dragStart.y + (event.clientY - dragOrigin.y)
    requestDraw()
    return
  }
  const star = findStar(worldFromEvent(event))
  if (star) {
    const el = root.value!
    const rect = el.getBoundingClientRect()
    hovered.value = { star, x: event.clientX - rect.left, y: event.clientY - rect.top }
  } else {
    hovered.value = null
  }
  requestDraw()
}

let dragging = false
const dragOrigin = { x: 0, y: 0 }
const dragStart = { x: 0, y: 0 }

function onPointerDown(event: PointerEvent) {
  dragging = true
  dragOrigin.x = event.clientX
  dragOrigin.y = event.clientY
  dragStart.x = view.x
  dragStart.y = view.y
  ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onPointerUp(event: PointerEvent) {
  dragging = false
  ;(event.target as HTMLElement).releasePointerCapture?.(event.pointerId)
}

function onClick(event: MouseEvent) {
  const star = findStar(worldFromEvent(event))
  if (star) emit('select', star)
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  const el = root.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const cx = event.clientX - rect.left
  const cy = event.clientY - rect.top
  const worldX = (cx - view.x) / view.k
  const worldY = (cy - view.y) / view.k
  const factor = Math.exp(-event.deltaY * 0.0016)
  const nextK = Math.min(8, Math.max(0.08, view.k * factor))
  view.k = nextK
  view.x = cx - worldX * nextK
  view.y = cy - worldY * nextK
  syncZoomLabel()
  requestDraw()
}

function zoomBy(factor: number) {
  const cx = width / 2
  const cy = height / 2
  const worldX = (cx - view.x) / view.k
  const worldY = (cy - view.y) / view.k
  view.k = Math.min(8, Math.max(0.08, view.k * factor))
  view.x = cx - worldX * view.k
  view.y = cy - worldY * view.k
  syncZoomLabel()
  requestDraw()
}

defineExpose({ fit, zoomBy })

onMounted(() => {
  buildSprites()
  buildBackground()
  resize()
  fit()
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      resize()
      requestDraw()
    })
    if (root.value) observer.observe(root.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  if (frame) cancelAnimationFrame(frame)
  if (twinkleRaf) cancelAnimationFrame(twinkleRaf)
  twinkleRaf = 0
})

watch(
  () => props.stars,
  () => {
    requestDraw()
  }
)
</script>

<template>
  <div ref="root" class="tt-stars">
    <canvas
      ref="canvas"
      class="tt-stars__canvas"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @wheel="onWheel"
      @click="onClick"
    ></canvas>

    <div class="tt-stars__hud">
      <div class="tt-stars__title">
        <b>{{ dictName }}</b>
        <span>{{ stars.length }} 颗星 · {{ litCount }} 已点亮</span>
      </div>
      <ul class="tt-stars__legend">
        <li v-for="level in LEVELS" :key="level">
          <i :style="{ background: STAR_COLORS[level].core, boxShadow: `0 0 6px ${STAR_COLORS[level].glow}` }"></i>
          {{ STAR_LEVEL_LABEL[level] }} · {{ counts[level] }}
        </li>
      </ul>
    </div>

    <div class="tt-stars__zoom">
      <button type="button" aria-label="放大" @click="zoomBy(1.35)">＋</button>
      <span>{{ zoomLabel }}</span>
      <button type="button" aria-label="缩小" @click="zoomBy(1 / 1.35)">−</button>
      <button type="button" class="tt-stars__reset" @click="fit">复位</button>
    </div>

    <div v-if="hovered" class="tt-stars__tooltip" :style="{ left: `${hovered.x + 14}px`, top: `${hovered.y + 12}px` }">
      <b>{{ hovered.star.word }}</b>
      <span v-if="hovered.star.meaning">{{ hovered.star.meaning }}</span>
      <em>{{ STAR_LEVEL_LABEL[hovered.star.level] }} · {{ Math.round(hovered.star.score * 100) }}%</em>
    </div>

    <div class="tt-stars__hint">滚轮缩放 · 拖拽平移 · 悬停看词 · 点星星打开词条</div>
  </div>
</template>

<style scoped lang="scss">
.tt-stars {
  position: relative;
  height: 100%;
  width: 100%;
  border-radius: 0.9rem;
  overflow: hidden;
  border: 1px solid var(--color-line);
  background: radial-gradient(circle at 50% 45%, #101826 0%, #080c14 55%, #05070c 100%);
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
}

.tt-stars__canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.tt-stars__hud {
  position: absolute;
  left: 0.8rem;
  top: 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  pointer-events: none;
}

.tt-stars__title {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  color: #e2e8f0;

  b {
    font-size: 0.85rem;
    font-weight: 700;
  }

  span {
    font-size: 0.68rem;
    color: #94a3b8;
  }
}

.tt-stars__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.7rem;
  margin-top: 0.15rem;
  font-size: 0.66rem;
  color: #94a3b8;

  li {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
  }

  i {
    width: 0.42rem;
    height: 0.42rem;
    border-radius: 50%;
    display: inline-block;
  }
}

.tt-stars__zoom {
  position: absolute;
  right: 0.8rem;
  bottom: 0.8rem;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.68rem;
  color: #cbd5e1;

  button {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 0.4rem;
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(15, 23, 42, 0.75);
    color: #e2e8f0;
    line-height: 1;
    cursor: pointer;
  }

  span {
    min-width: 2.4rem;
    text-align: center;
  }
}

.tt-stars__reset {
  width: auto !important;
  padding: 0 0.5rem;
}

.tt-stars__tooltip {
  position: absolute;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.35rem 0.55rem;
  border-radius: 0.45rem;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(148, 163, 184, 0.35);
  color: #e2e8f0;
  max-width: 15rem;

  b {
    font-size: 0.78rem;
  }

  span {
    font-size: 0.68rem;
    color: #cbd5e1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  em {
    font-size: 0.64rem;
    font-style: normal;
    color: #94a3b8;
  }
}

.tt-stars__hint {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 0.55rem;
  font-size: 0.64rem;
  color: #64748b;
  pointer-events: none;
}
</style>

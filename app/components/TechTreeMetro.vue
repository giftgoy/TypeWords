<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TreeNodeView } from '@/core/tech-tree/tree'
import { METRO_CANVAS, METRO_ROUTES, METRO_STATIONS, metroColorOf, metroTransfers } from '@/core/tech-tree/metro'

const props = defineProps<{
  nodes: TreeNodeView[]
  selectedId: string
}>()

const emit = defineEmits<{ (e: 'select', id: string): void }>()

const nodeMap = computed(() => new Map(props.nodes.map(node => [node.id, node])))
const transfers = metroTransfers()

const width = METRO_CANVAS.width
const height = METRO_CANVAS.height

// ── 缩放与平移 ─────────────────────────────────────────────
const svgEl = ref<SVGSVGElement | null>(null)
const view = ref({ x: 0, y: 0, k: 1 })
const MIN_K = 0.55
const MAX_K = 3.4

const transform = computed(() => `translate(${view.value.x} ${view.value.y}) scale(${view.value.k})`)

function clientToSvg(clientX: number, clientY: number) {
  const svg = svgEl.value
  if (!svg) return { x: 0, y: 0 }
  const rect = svg.getBoundingClientRect()
  const scaleX = width / rect.width
  const scaleY = height / rect.height
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
}

function zoomAt(factor: number, clientX?: number, clientY?: number) {
  const svg = svgEl.value
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const anchor = clientToSvg(
    clientX ?? rect.left + rect.width / 2,
    clientY ?? rect.top + rect.height / 2
  )
  const next = Math.min(MAX_K, Math.max(MIN_K, view.value.k * factor))
  const ratio = next / view.value.k
  view.value = {
    k: next,
    x: anchor.x - (anchor.x - view.value.x) * ratio,
    y: anchor.y - (anchor.y - view.value.y) * ratio,
  }
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY)
}

let dragging = false
let dragStart = { x: 0, y: 0 }
let origin = { x: 0, y: 0 }

function onPointerDown(event: PointerEvent) {
  dragging = true
  dragStart = { x: event.clientX, y: event.clientY }
  origin = { x: view.value.x, y: view.value.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging) return
  const svg = svgEl.value
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const dx = (event.clientX - dragStart.x) * (width / rect.width)
  const dy = (event.clientY - dragStart.y) * (height / rect.height)
  view.value = { ...view.value, x: origin.x + dx, y: origin.y + dy }
}

function onPointerUp(event: PointerEvent) {
  dragging = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}

function resetView() {
  view.value = { x: 0, y: 0, k: 1 }
}

const zoomPercent = computed(() => `${Math.round(view.value.k * 100)}%`)

function stationPoint(id: string) {
  return METRO_STATIONS[id] ?? { x: 0, y: 0 }
}

function orthPath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  if (Math.abs(dy) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  const r = 16
  const mx = a.x + dx / 2
  const sx = dx > 0 ? 1 : -1
  const sy = dy > 0 ? 1 : -1
  return [
    `M ${a.x} ${a.y}`,
    `H ${mx - sx * r}`,
    `Q ${mx} ${a.y} ${mx} ${a.y + sy * r}`,
    `V ${b.y - sy * r}`,
    `Q ${mx} ${b.y} ${mx + sx * r} ${b.y}`,
    `H ${b.x}`,
  ].join(' ')
}

function pathThrough(ids: string[]) {
  const parts: string[] = []
  for (let i = 0; i < ids.length - 1; i++) {
    const seg = orthPath(stationPoint(ids[i]), stationPoint(ids[i + 1]))
    parts.push(i === 0 ? seg : seg.replace(/^M [^ ]+ [^ ]+ /, ''))
  }
  return parts.join(' ')
}

type RouteView = {
  id: string
  name: string
  color: string
  branch: boolean
  d: string
  litD: string
  litLength: number
  active: boolean
}

const routes = computed<RouteView[]>(() =>
  METRO_ROUTES.map(route => {
    const states = route.stations.map(id => nodeMap.value.get(id))
    let litCount = 0
    states.forEach(node => {
      if (node?.state === 'lit') litCount++
    })
    // 已点亮的部分从线路起点连到最远的那个亮点站
    let litEnd = 0
    states.forEach((node, index) => {
      if (node?.state === 'lit') litEnd = Math.max(litEnd, index)
    })
    return {
      id: route.id,
      name: route.name,
      color: route.color,
      branch: Boolean(route.branch),
      d: pathThrough(route.stations),
      litD: litEnd > 0 ? pathThrough(route.stations.slice(0, litEnd + 1)) : '',
      litLength: litCount,
      active: route.stations.includes(props.selectedId),
    }
  })
)

function labelLines(name: string) {
  if (name.length <= 10) return [name]
  const cut = name.split('·')
  if (cut.length === 2) return [cut[0].trim(), cut[1].trim()]
  return [name.slice(0, 10), name.slice(10)]
}

function progressDash(node: TreeNodeView) {
  const r = 15
  const circumference = 2 * Math.PI * r
  return `${(node.progress / 100) * circumference} ${circumference}`
}

function stateClass(node: TreeNodeView) {
  return `is-${node.state}`
}
</script>

<template>
  <div class="tt-metro">
    <div class="tt-metro__legend">
      <span v-for="route in METRO_ROUTES.filter(item => !item.branch)" :key="route.id" class="tt-metro__line">
        <i :style="{ background: route.color }"></i>
        {{ route.name.split(' · ')[0] }}
      </span>
      <span class="tt-metro__hint">细线是支线 · 双环是换乘站</span>
    </div>

    <div class="tt-metro__scroll">
      <svg
        ref="svgEl"
        class="tt-metro__svg"
        :viewBox="`0 0 ${width} ${height}`"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="词典地铁线路图"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
      >
        <defs>
          <filter id="metro-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g :transform="transform">
          <!-- 换乘通道 -->
          <line
            x1="530"
            y1="320"
            x2="390"
            y2="630"
            class="tt-metro__transfer-link"
            aria-hidden="true"
          />

          <!-- 线路底色 -->
          <path
            v-for="route in routes"
            :key="`${route.id}-base`"
            :d="route.d"
            class="tt-metro__track"
            :class="{ 'is-branch': route.branch, 'is-active': route.active }"
            :style="{ '--line': route.color }"
          />

          <!-- 已经点亮的区段 -->
          <path
            v-for="route in routes"
            :key="`${route.id}-lit`"
            :d="route.litD"
            class="tt-metro__track is-lit"
            :class="{ 'is-branch': route.branch }"
            :style="{ '--line': route.color }"
          />

        <!-- 站点 -->
        <g
          v-for="node in nodes"
          :key="node.id"
          class="tt-metro__station"
          :class="[stateClass(node), { 'is-transfer': transfers.has(node.id), 'is-selected': node.id === selectedId }]"
          :transform="`translate(${stationPoint(node.id).x}, ${stationPoint(node.id).y})`"
          @click="emit('select', node.id)"
        >
          <circle class="tt-metro__halo" r="24" :style="{ '--line': metroColorOf(node.id) }" />
          <circle
            v-if="node.progress > 0"
            class="tt-metro__progress"
            r="15"
            :stroke-dasharray="progressDash(node)"
            :style="{ '--line': metroColorOf(node.id) }"
          />
          <circle v-if="transfers.has(node.id)" class="tt-metro__ring" r="11" :style="{ '--line': metroColorOf(node.id) }" />
          <circle class="tt-metro__dot" r="7" :style="{ '--line': metroColorOf(node.id) }" />
          <text
            v-for="(line, index) in labelLines(node.name)"
            :key="index"
            class="tt-metro__label"
            :y="26 + index * 13"
            text-anchor="middle"
          >
            {{ line }}
          </text>
        </g>
        </g>
      </svg>

      <div class="tt-metro__zoom">
        <button type="button" aria-label="放大" @click="zoomAt(1.25)">＋</button>
        <span>{{ zoomPercent }}</span>
        <button type="button" aria-label="缩小" @click="zoomAt(1 / 1.25)">−</button>
        <button type="button" class="tt-metro__reset" @click="resetView">复位</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tt-metro {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--color-line);
  border-radius: 0.9rem;
  background: var(--color-card-bg);
  overflow: hidden;
}

.tt-metro__legend {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  flex-wrap: wrap;
  padding: 0.55rem 0.8rem;
  border-bottom: 1px solid var(--color-line);
  font-size: 0.7rem;
  color: var(--color-sub-text);
}

.tt-metro__line {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;

  i {
    width: 0.9rem;
    height: 4px;
    border-radius: 999px;
    display: inline-block;
  }
}

.tt-metro__hint {
  margin-left: auto;
  font-size: 0.66rem;
  opacity: 0.8;
}

.tt-metro__scroll {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  overflow: hidden;
}

.tt-metro__svg {
  width: 100%;
  height: 100%;
  max-height: 100%;
  cursor: grab;
  touch-action: none;
  user-select: none;

  &:active {
    cursor: grabbing;
  }
}

.tt-metro__zoom {
  position: absolute;
  right: 0.9rem;
  bottom: 0.8rem;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.68rem;
  color: var(--color-sub-text);

  button {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 0.4rem;
    border: 1px solid var(--color-line);
    background: var(--color-card-bg);
    color: var(--color-main-text);
    line-height: 1;
    cursor: pointer;

    &:hover {
      background: var(--color-second);
    }
  }

  span {
    min-width: 2.4rem;
    text-align: center;
  }
}

.tt-metro__reset {
  width: auto !important;
  padding: 0 0.5rem;
}

.tt-metro__transfer-link {
  stroke: var(--color-sub-text);
  stroke-width: 2;
  stroke-dasharray: 4 5;
  opacity: 0.35;
  vector-effect: non-scaling-stroke;
}

.tt-metro__track {
  fill: none;
  stroke: var(--line);
  stroke-width: 9;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.34;
  vector-effect: non-scaling-stroke;
  transition: opacity 0.2s ease;

  &.is-branch {
    stroke-width: 6;
  }

  &.is-lit {
    opacity: 0.95;
    filter: url(#metro-glow);
  }

  &.is-active {
    opacity: 0.62;
    stroke-width: 10;
  }
}

.tt-metro__station {
  cursor: pointer;

  &:hover .tt-metro__dot {
    r: 8;
  }
}

.tt-metro__halo {
  fill: var(--line);
  opacity: 0;
  transition: opacity 0.18s ease;
}

.tt-metro__station.is-selected .tt-metro__halo {
  opacity: 0.16;
}

.tt-metro__ring {
  fill: var(--color-card-bg);
  stroke: var(--line);
  stroke-width: 2.4;
}

.tt-metro__dot {
  fill: var(--color-card-bg);
  stroke: var(--line);
  stroke-width: 3.2;
  transition: fill 0.2s ease;
}

.tt-metro__progress {
  fill: none;
  stroke: var(--line);
  stroke-width: 2;
  stroke-linecap: round;
  opacity: 0.5;
  transform: rotate(-90deg);
}

.tt-metro__station.is-lit .tt-metro__dot {
  fill: var(--line);
}

.tt-metro__station.is-active .tt-metro__dot {
  fill: var(--line);
  fill-opacity: 0.4;
}

.tt-metro__station.is-locked .tt-metro__dot {
  stroke-dasharray: 2.2 2.6;
}

.tt-metro__label {
  font-size: 10.5px;
  fill: var(--color-sub-text);
  paint-order: stroke;
  stroke: var(--color-card-bg);
  stroke-width: 3px;
  user-select: none;
}

.tt-metro__station.is-lit .tt-metro__label {
  fill: var(--color-main-text);
  font-weight: 600;
}

.tt-metro__station.is-locked .tt-metro__label {
  opacity: 0.55;
}
</style>

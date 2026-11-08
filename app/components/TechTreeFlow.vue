<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MarkerType, VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import { accentColor, type TreeNodeView } from '@/core/tech-tree/tree'

const props = defineProps<{
  nodes: TreeNodeView[]
  selectedId: string
}>()

const emit = defineEmits<{ (e: 'select', id: string): void }>()

const CARD_W = 196
const COL_GAP = 76
const ROW_GAP = 46
const ROW_H = 104

/** 拖过的节点记住位置，切视图或缩放都不会被重置 */
const moved = ref<Record<string, { x: number; y: number }>>({})

const flowNodes = computed<Node[]>(() =>
  props.nodes.map(node => ({
    id: node.id,
    type: 'tech',
    draggable: true,
    position: moved.value[node.id] ?? {
      x: node.tier * (CARD_W + COL_GAP),
      y: node.lane * (ROW_H + ROW_GAP),
    },
    data: { node },
    class: node.id === props.selectedId ? 'is-picked' : '',
  }))
)

const flowEdges = computed<Edge[]>(() => {
  const byId = new Map(props.nodes.map(node => [node.id, node]))
  return props.nodes.flatMap(node =>
    node.deps
      .filter(dep => byId.has(dep))
      .map(dep => {
        const lit = byId.get(dep)?.state === 'lit'
        return {
          id: `${dep}->${node.id}`,
          source: dep,
          target: node.id,
          type: 'default',
          animated: lit,
          markerEnd: MarkerType.ArrowClosed,
          style: {
            stroke: lit ? '#10b981' : 'rgba(140, 152, 168, 0.55)',
            strokeWidth: lit ? 2.2 : 1.4,
          },
        } as Edge
      })
  )
})

const stateColor: Record<string, string> = {
  lit: '#10b981',
  active: '#0c8ce9',
  unlocked: '#94a3b8',
  locked: '#cbd5e1',
}

function miniMapColor(node: Node) {
  return stateColor[(node.data as { node: TreeNodeView }).node.state] ?? '#94a3b8'
}

const { setViewport, fitView, getViewport } = useVueFlow()

const root = ref<HTMLElement | null>(null)
let centered = false

/** 先让 Vue Flow 框住这个节点，再按真实 DOM 位置补一次偏移，保证真的居中 */
function centerOn(id: string) {
  const node = props.nodes.find(item => item.id === id) ?? props.nodes[0]
  if (!node) return
  requestAnimationFrame(() => {
    fitView({ nodes: [node.id], maxZoom: 0.95, padding: 0.35, duration: 0 })
    requestAnimationFrame(() => {
      const el = root.value
      const target = el?.querySelector<HTMLElement>(`.vue-flow__node[data-id="${node.id}"]`)
      if (!el || !target) return
      const box = el.getBoundingClientRect()
      const rect = target.getBoundingClientRect()
      const viewport = getViewport()
      setViewport({
        x: viewport.x + (box.left + box.width / 2) - (rect.left + rect.width / 2),
        y: viewport.y + (box.top + box.height / 2) - (rect.top + rect.height / 2),
        zoom: viewport.zoom,
      })
    })
  })
}

/** 全览：把整张图缩进一屏 */
function fitAll() {
  const el = root.value
  if (!el || !props.nodes.length || !el.clientWidth) return
  const maxTier = Math.max(...props.nodes.map(n => n.tier))
  const maxLane = Math.max(...props.nodes.map(n => n.lane))
  const contentW = maxTier * (CARD_W + COL_GAP) + CARD_W
  const contentH = maxLane * (ROW_H + ROW_GAP) + ROW_H
  const pad = 32
  const zoom = Math.max(
    0.22,
    Math.min(1.1, (el.clientWidth - pad * 2) / contentW, (el.clientHeight - pad * 2) / contentH)
  )
  setViewport({
    x: (el.clientWidth - contentW * zoom) / 2,
    y: (el.clientHeight - contentH * zoom) / 2,
    zoom,
  })
}

function relayout() {
  moved.value = {}
  requestAnimationFrame(() => centerOn(props.selectedId || props.nodes[0]?.id || ''))
}

function onNodeClick(payload: { node: Node }) {
  emit('select', payload.node.id)
}

function onDragStop(payload: { node: Node }) {
  moved.value = { ...moved.value, [payload.node.id]: { ...payload.node.position } }
}

defineExpose({ relayout, fitAll, centerOn })

function firstCenter() {
  if (centered) return
  const el = root.value
  if (!el || !el.clientWidth || !props.nodes.length) return
  centered = true
  centerOn(props.selectedId || props.nodes[0]?.id || '')
}

watch(() => props.nodes.length, async () => {
  await nextTick()
  requestAnimationFrame(() => firstCenter())
})

let observer: ResizeObserver | null = null

onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(() => firstCenter())
  if (root.value) observer.observe(root.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div ref="root" class="tt-flow">
    <VueFlow
      :nodes="flowNodes"
      :edges="flowEdges"
      :min-zoom="0.25"
      :max-zoom="1.8"
      :nodes-connectable="false"
      :default-viewport="{ x: 0, y: 0, zoom: 0.9 }"
      :pan-on-drag="[0, 1]"
      :zoom-on-double-click="false"
      @node-click="onNodeClick"
      @node-drag-stop="onDragStop"
    >
      <template #node-tech="{ data }">
        <div class="tt-card" :class="[`is-${data.node.state}`, { 'is-picked': data.node.id === selectedId }]">
          <span
            class="tt-card__ring"
            :style="{ '--accent': accentColor(data.node.accent), '--pct': `${data.node.progress * 3.6}deg` }"
          >
            <span class="tt-card__icon">{{ data.node.icon }}</span>
          </span>
          <span class="tt-card__body">
            <span class="tt-card__name">{{ data.node.name }}</span>
            <span class="tt-card__meta">
              <template v-if="data.node.state === 'locked'">前置未点亮</template>
              <template v-else-if="data.node.installed && data.node.progress === 0">
                已添加 · {{ data.node.length }} {{ data.node.side === 'word' ? '词' : '篇' }}
              </template>
              <template v-else>
                {{ data.node.learned }} / {{ data.node.length }} {{ data.node.side === 'word' ? '词' : '篇' }}
              </template>
            </span>
            <span class="tt-card__bar"><i :style="{ width: `${data.node.progress}%` }"></i></span>
          </span>
        </div>
      </template>

      <Background :gap="22" :size="1.2" pattern-color="rgba(120, 134, 152, 0.35)" />
      <Controls position="bottom-left" />
      <MiniMap pannable zoomable :node-color="miniMapColor" :height="110" :width="170" />
    </VueFlow>
  </div>
</template>

<style scoped lang="scss">
.tt-flow {
  height: 100%;
  width: 100%;
  border-radius: 0.9rem;
  overflow: hidden;
  border: 1px solid var(--color-line);
  background:
    radial-gradient(circle at 18% 22%, rgba(99, 102, 241, 0.1), transparent 45%),
    radial-gradient(circle at 82% 78%, rgba(16, 185, 129, 0.1), transparent 48%),
    var(--color-second);
}

.tt-card {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 196px;
  padding: 0.7rem 0.75rem;
  border-radius: 0.85rem;
  border: 1px solid var(--color-line);
  background: var(--color-card-bg);
  color: var(--color-main-text);
  cursor: pointer;
  transition:
    box-shadow 0.18s ease,
    border-color 0.18s ease;

  &.is-lit {
    border-color: color-mix(in srgb, #10b981 60%, var(--color-line));
    box-shadow:
      0 0 0 1px rgba(16, 185, 129, 0.12),
      0 0 24px rgba(16, 185, 129, 0.28);
  }

  &.is-locked {
    opacity: 0.6;
    border-style: dashed;
  }

  &.is-picked {
    border-color: var(--color-select-bg);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-select-bg) 35%, transparent);
  }
}

.tt-card__ring {
  position: relative;
  flex: 0 0 auto;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: conic-gradient(var(--accent) var(--pct, 0deg), color-mix(in srgb, var(--accent) 16%, transparent) 0);

  &::after {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--color-card-bg);
  }
}

.tt-card__icon {
  position: relative;
  z-index: 1;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--accent);
  max-width: 2rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tt-card__body {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  min-width: 0;
  flex: 1 1 auto;
}

.tt-card__name {
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.2;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.tt-card__meta {
  font-size: 0.66rem;
  color: var(--color-sub-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tt-card__bar {
  display: block;
  height: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    background: var(--accent);
  }
}

:deep(.vue-flow__minimap) {
  border-radius: 0.6rem;
  border: 1px solid var(--color-line);
  background: var(--color-card-bg);
}

:deep(.vue-flow__controls) {
  border-radius: 0.5rem;
  overflow: hidden;
  box-shadow: none;
  border: 1px solid var(--color-line);
}

:deep(.vue-flow__controls-button) {
  background: var(--color-card-bg);
  border-bottom: 1px solid var(--color-line);
  width: 1.65rem;
  height: 1.65rem;

  svg {
    fill: var(--color-main-text);
    max-width: 0.75rem;
    max-height: 0.75rem;
  }

  &:hover {
    background: var(--color-second);
  }
}

:deep(.vue-flow__edge-path) {
  transition: stroke 0.2s ease;
}
</style>

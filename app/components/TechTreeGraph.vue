<script setup lang="ts">
import { computed } from 'vue'
import { accentColor, type TreeEdge, type TreeNodeView } from '@/core/tech-tree/tree'

const props = defineProps<{
  nodes: TreeNodeView[]
  selectedId: string
  zoom: number
}>()

const emit = defineEmits<{ (e: 'select', id: string): void }>()

const NODE_W = 196
const NODE_H = 100
const GAP_X = 78
const GAP_Y = 32
const PAD_X = 28
const PAD_Y = 26

const maxTier = computed(() => props.nodes.reduce((max, node) => Math.max(max, node.tier), 0))
const maxLane = computed(() => props.nodes.reduce((max, node) => Math.max(max, node.lane), 0))

const width = computed(() => PAD_X * 2 + maxTier.value * (NODE_W + GAP_X) + NODE_W)
const height = computed(() => PAD_Y * 2 + maxLane.value * (NODE_H + GAP_Y) + NODE_H)

const geo = computed(() => {
  const map = new Map<string, { x: number; y: number }>()
  props.nodes.forEach(node => {
    map.set(node.id, {
      x: PAD_X + node.tier * (NODE_W + GAP_X),
      y: PAD_Y + node.lane * (NODE_H + GAP_Y),
    })
  })
  return map
})

const edges = computed<TreeEdge[]>(() => {
  const byId = new Map(props.nodes.map(node => [node.id, node]))
  const list: TreeEdge[] = []
  props.nodes.forEach(node => {
    node.deps.forEach(dep => {
      const source = byId.get(dep)
      if (!source) return
      list.push({ from: dep, to: node.id, lit: source.state === 'lit' })
    })
  })
  return list
})

function edgePath(edge: TreeEdge): string {
  const from = geo.value.get(edge.from)
  const to = geo.value.get(edge.to)
  if (!from || !to) return ''
  const x1 = from.x + NODE_W
  const y1 = from.y + NODE_H / 2
  const x2 = to.x
  const y2 = to.y + NODE_H / 2
  const bend = Math.max(36, (x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

function isEdgeActive(edge: TreeEdge): boolean {
  return props.selectedId === edge.from || props.selectedId === edge.to
}

function nodeStyle(node: TreeNodeView) {
  const point = geo.value.get(node.id)
  if (!point) return {}
  return {
    left: `${point.x}px`,
    top: `${point.y}px`,
    width: `${NODE_W}px`,
    height: `${NODE_H}px`,
    '--node-accent': accentColor(node.accent),
  }
}

function ringStyle(node: TreeNodeView) {
  const value = Math.max(0, Math.min(100, node.progress))
  return { '--ring-progress': `${value * 3.6}deg` }
}

defineExpose({ width, height })
</script>

<template>
  <div class="tt-viewport">
    <div
      class="tt-canvas"
      :style="{ width: `${width}px`, height: `${height}px`, transform: `scale(${zoom})` }"
      role="group"
      aria-label="学习科技树"
    >
      <svg class="tt-edges" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
        <path
          v-for="edge in edges"
          :key="`${edge.from}->${edge.to}`"
          :d="edgePath(edge)"
          class="tt-edge"
          :class="{ 'is-lit': edge.lit, 'is-active': isEdgeActive(edge) }"
        />
      </svg>

      <button
        v-for="node in nodes"
        :key="node.id"
        type="button"
        class="tt-node"
        :class="[`is-${node.state}`, { 'is-selected': node.id === selectedId, 'is-article': node.side === 'article' }]"
        :style="nodeStyle(node)"
        :aria-pressed="node.id === selectedId"
        @click="emit('select', node.id)"
      >
        <span class="tt-node__ring" :style="ringStyle(node)">
          <span class="tt-node__icon">{{ node.icon }}</span>
        </span>
        <span class="tt-node__body">
          <span class="tt-node__name">{{ node.name }}</span>
          <span class="tt-node__meta">
            <template v-if="node.state === 'locked'">前置未点亮</template>
            <template v-else-if="node.installed && node.progress === 0">
              已添加 · {{ node.length }} {{ node.side === 'word' ? '词' : '篇' }}
            </template>
            <template v-else>
              {{ node.learned }} / {{ node.length }} {{ node.side === 'word' ? '词' : '篇' }}
            </template>
          </span>
          <span class="tt-node__bar">
            <i :style="{ width: `${node.progress}%` }"></i>
          </span>
        </span>
        <svg v-if="node.state === 'locked'" class="tt-node__lock" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M7 10V7a5 5 0 0 1 10 0v3"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
          <rect x="4.5" y="10" width="15" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tt-viewport {
  position: relative;
  overflow: auto;
  border-radius: 0.9rem;
  background:
    radial-gradient(circle at 12% 18%, rgba(99, 102, 241, 0.09), transparent 42%),
    radial-gradient(circle at 88% 76%, rgba(16, 185, 129, 0.08), transparent 46%),
    var(--color-second);
  border: 1px solid var(--color-line);
}

.tt-canvas {
  position: relative;
  transform-origin: top left;
  transition: transform 0.16s ease-out;
}

.tt-edges {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.tt-edge {
  fill: none;
  stroke: var(--color-line);
  stroke-width: 2;
  stroke-linecap: round;
  opacity: 0.9;
  transition:
    stroke 0.2s ease,
    opacity 0.2s ease;

  &.is-lit {
    stroke: rgba(16, 185, 129, 0.75);
    stroke-width: 2.6;
  }

  &.is-active {
    stroke: var(--color-select-bg);
    opacity: 1;
  }
}

.tt-node {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.7rem 0.75rem;
  border-radius: 0.85rem;
  border: 1px solid var(--color-line);
  background: var(--color-card-bg);
  color: var(--color-main-text);
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
  }

  &.is-selected {
    border-color: var(--color-select-bg);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-select-bg) 35%, transparent);
  }

  &.is-lit {
    border-color: color-mix(in srgb, var(--node-accent) 55%, var(--color-line));
    background: color-mix(in srgb, var(--node-accent) 8%, var(--color-card-bg));
  }

  &.is-locked {
    opacity: 0.62;
    border-style: dashed;
    padding-right: 1.7rem;
    cursor: pointer;
  }

  &.is-article .tt-node__icon {
    border-radius: 0.45rem;
  }
}

.tt-node__ring {
  position: relative;
  flex: 0 0 auto;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: conic-gradient(
    var(--node-accent) var(--ring-progress, 0deg),
    color-mix(in srgb, var(--node-accent) 16%, transparent) 0
  );

  &::after {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--color-card-bg);
  }
}

.tt-node__icon {
  position: relative;
  z-index: 1;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--node-accent);
  max-width: 2.1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tt-node__body {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  flex: 1 1 auto;
}

.tt-node__name {
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1.2;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.tt-node__meta {
  font-size: 0.68rem;
  color: var(--color-sub-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tt-node__bar {
  display: block;
  height: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--node-accent) 18%, transparent);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--node-accent);
    transition: width 0.3s ease;
  }
}

.tt-node__lock {
  flex: 0 0 auto;
  width: 1rem;
  height: 1rem;
  color: var(--color-sub-text);
}
</style>

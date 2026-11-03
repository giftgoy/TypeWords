<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ modelValue?: boolean; width?: string }>(), {
  modelValue: true,
  width: '18rem',
})
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const anchorRef = ref<HTMLElement>()
const modalRef = ref<HTMLElement>()
const position = ref({ left: '0px', top: '0px', visibility: 'hidden' as 'hidden' | 'visible' })

watch(
  () => props.modelValue,
  async (visible, _, onCleanup) => {
    if (!visible) return
    position.value.visibility = 'hidden'
    await nextTick()
    const anchor = anchorRef.value?.parentElement
    const modal = modalRef.value
    if (!anchor || !modal || !props.modelValue) return
    const update = () => {
      void computePosition(anchor, modal, {
        strategy: 'fixed',
        placement: 'bottom',
        middleware: [
          offset(8),
          flip({ padding: 12 }),
          shift({ padding: 12, crossAxis: true }),
          size({
            padding: 12,
            apply({ availableHeight, elements }) {
              elements.floating.style.maxHeight = Math.max(0, availableHeight) + 'px'
            },
          }),
        ],
      }).then(({ x, y }) => {
        if (modal === modalRef.value && props.modelValue) {
          position.value = { left: x + 'px', top: y + 'px', visibility: 'visible' }
        }
      })
    }
    const cleanup = autoUpdate(anchor, modal, update)
    modal.focus({ preventScroll: true })
    onCleanup(() => {
      cleanup()
      anchor.querySelector('button')?.focus({ preventScroll: true })
    })
  },
  { immediate: true, flush: 'post' }
)
</script>

<template>
  <span ref="anchorRef" hidden></span>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="modelValue"
        ref="modalRef"
        v-bind="$attrs"
        class="mini-modal"
        :style="{ width, ...position }"
        role="dialog"
        tabindex="-1"
        @keydown.esc.stop.prevent="emit('update:modelValue', false)"
      >
        <slot></slot>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss">
.mini-row-title {
  @apply text-center text-base font-bold mb-2;
  color: var(--color-font-1);
}

.mini-row {
  @apply min-h-10 flex justify-between items-center gap-space text-base text-font-1 word-break-keep-all;
  color: var(--color-font-1);
}

.mini-modal {
  background: var(--color-card-bg);
  box-sizing: border-box;
  padding: var(--space) 1rem;
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 24px);
  overflow: auto;
  overscroll-behavior: contain;
  outline: none;
  @apply shadow-lg rounded-xl;
  position: fixed;
  z-index: 1100;
}
</style>

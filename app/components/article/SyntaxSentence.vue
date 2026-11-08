<script setup lang="ts">
import type { SyntaxSentence } from '@/core/syntax/analyze'

withDefaults(
  defineProps<{
    sentence: SyntaxSentence
    showSyntax?: boolean
    /** hover：默认隐藏、悬停显示；always：常显；hidden：完全藏起来 */
    cnMode?: 'hover' | 'always' | 'hidden'
  }>(),
  { showSyntax: true, cnMode: 'hover' }
)
</script>

<template>
  <span class="syntax-sentence" :class="{ 'is-plain': !showSyntax }">
    <template v-for="(chunk, chunkIndex) in sentence.chunks" :key="chunkIndex">
      <span
        v-if="chunk.kind === 'modifier' && showSyntax"
        class="syntax-modifier"
        :class="{ 'is-block': chunk.breakBefore }"
      >
        <span v-for="(part, partIndex) in chunk.parts" :key="partIndex">{{ part.text }}</span>
      </span>
      <template v-else>
        <span
          v-for="(part, partIndex) in chunk.parts"
          :key="partIndex"
          :class="showSyntax ? `syntax-${part.role}` : ''"
          >{{ part.text }}</span
        >
      </template>
    </template>

    <span v-if="sentence.cn && cnMode !== 'hidden'" class="syntax-cn" :class="`is-${cnMode}`">{{ sentence.cn }}</span>
    {{ ' ' }}
  </span>
</template>

<style scoped lang="scss">
.syntax-sentence {
  white-space: pre-wrap;
  position: relative;
}

.syntax-subject {
  color: #1d4ed8;
  font-weight: 600;
}

.syntax-predicate {
  color: #dc2626;
  font-weight: 600;
}

.syntax-complement {
  color: inherit;
}

.syntax-modifier {
  color: var(--color-sub-text);

  &.is-block {
    display: block;
    break-before: column;
    margin: 0.35rem 0 0.45rem;
    padding: 0.15rem 0.55rem 0.2rem 0.6rem;
    border-left: 3px solid rgba(99, 102, 241, 0.55);
    border-radius: 0 0.35rem 0.35rem 0;
    background: rgba(99, 102, 241, 0.07);
    font-size: 0.94em;
    line-height: 1.55;
  }
}

.syntax-cn {
  display: block;
  margin-top: 0.3rem;
  font-size: 0.82em;
  line-height: 1.6;
  color: var(--color-sub-text);
  transition: opacity 0.18s ease;
  font-family: var(--zh-article-family, inherit);

  /* 悬停模式走浮层，不占版面：否则每句下面都留一行看不见的中文 */
  &.is-hover {
    position: absolute;
    left: 0;
    top: calc(100% + 3px);
    z-index: 6;
    width: max-content;
    max-width: min(46rem, 72vw);
    margin-top: 0;
    padding: 0.4rem 0.65rem;
    border-radius: 0.45rem;
    border: 1px solid var(--color-line);
    background: var(--color-card-bg);
    box-shadow: 0 10px 26px rgba(15, 23, 42, 0.16);
    opacity: 0;
    pointer-events: none;
    white-space: normal;
    text-align: left;
  }

  &.is-always {
    opacity: 1;
  }
}

.syntax-sentence:hover .syntax-cn.is-hover {
  opacity: 1;
}

:global(html.dark) .syntax-subject {
  color: #93b4ff;
}

:global(html.dark) .syntax-predicate {
  color: #ff8f8f;
}

:global(html.dark) .syntax-modifier.is-block {
  border-left-color: rgba(129, 140, 248, 0.65);
  background: rgba(129, 140, 248, 0.12);
}

.is-plain .syntax-modifier.is-block {
  display: inline;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font-size: inherit;
  color: inherit;
}
</style>

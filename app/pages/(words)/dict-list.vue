<script setup lang="ts">
import ResourceMarket from '@/components/ResourceMarket.vue'

useSeoMeta({ title: '词典市场 · TypeWords', description: '按考试和使用场景浏览词库，预览真实词条，一键添加到学习库。' })
</script>

<template>
  <ResourceMarket kind="word" />
</template>

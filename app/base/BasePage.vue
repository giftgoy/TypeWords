<script setup lang="ts">

</script>

<template>
  <div class="flex justify-center">
    <div class="page 3xl:w-[50vw] 2xl:w-[60vw] xl:w-[70vw] lg:w-[75vw]">
      <slot></slot>
    </div>
  </div>
</template>

<style scoped lang="scss">
.page {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding-inline: 1rem;
  min-height: calc(100dvh - 1.2rem);
  margin-top: 1.2rem;
}


@media (max-width: 768px) {
  .page {
    width: 100%;
    margin-top: 0.5rem;
    min-height: calc(100dvh - var(--mobile-nav-height) - 1.5rem);
    padding: 0 0.5rem;
    box-sizing: border-box;
  }
}

// 超小屏幕适配
@media (max-width: 480px) {
  .page {
    margin-top: 0.3rem;
    min-height: calc(100dvh - var(--mobile-nav-height) - 1rem);
    padding: 0 0.3rem;
  }
}
</style>

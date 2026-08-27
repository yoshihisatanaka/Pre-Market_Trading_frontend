<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app">
    <header class="app__header">
      <RouterLink to="/" class="app__brand">US Stock Order</RouterLink>
      <nav class="app__nav">
        <RouterLink to="/">注文一覧</RouterLink>
      </nav>
    </header>

    <main class="app__main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app__header {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-3) var(--space-5);
  background-color: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.app__brand {
  font-size: var(--font-size-lg);
  font-weight: 700;
  color: var(--color-text);
  text-decoration: none;
}

.app__nav {
  display: flex;
  gap: var(--space-4);
  font-size: var(--font-size-sm);
}

.app__main {
  flex: 1;
  padding: var(--space-5);
}
</style>

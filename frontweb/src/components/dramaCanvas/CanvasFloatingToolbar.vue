<template>
  <div class="canvas-floating-toolbar nodrag nopan">
    <span class="toolbar-label">Tạo nhanh</span>
    <el-button size="small" @click="create('storyboard')">Storyboard</el-button>
    <el-button size="small" @click="create('character')">Nhân vật</el-button>
    <el-button size="small" @click="create('scene')">Scene</el-button>
    <el-button size="small" @click="create('prop')">Đạo cụ</el-button>
    <el-button size="small" @click="create('episode')">Tập</el-button>
  </div>
</template>

<script setup>
import { useCanvasContext } from '@/composables/useCanvasContext'

const ctx = useCanvasContext()

function create(type) {
  ctx?.openCreateDialog?.(type)
}
</script>

<style scoped>
.canvas-floating-toolbar {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid #3f3f46;
  background: rgba(24, 24, 27, 0.94);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  flex-wrap: wrap;
  max-width: calc(100% - 24px);
}
.toolbar-label {
  font-size: 11px;
  color: #71717a;
  margin-right: 4px;
  white-space: nowrap;
}
</style>

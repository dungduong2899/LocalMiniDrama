<template>
  <div v-if="outline" class="outline-panel">
    <h3 class="outline-title">Đề cương phân tập <el-tag v-if="statusLabel" size="small">{{ statusLabel }}</el-tag></h3>

    <el-alert v-for="(w, i) in warnings" :key="'w' + i" :title="w" type="warning" show-icon :closable="false" style="margin-bottom: 8px" />

    <div class="plot-points">
      <div class="pp-head">Mốc truyện ({{ outline.plot_points.length }})</div>
      <el-tag v-for="p in outline.plot_points" :key="p.id" size="small" style="margin: 2px">{{ p.id }}: {{ p.text }}</el-tag>
    </div>

    <el-table :data="outline.episodes" size="small" style="width: 100%; margin-top: 10px">
      <el-table-column label="Tập" width="60">
        <template #default="{ row }">
          <span>{{ row.episode }}</span>
          <el-tooltip v-if="episodeFailed(row.episode)" :content="failReason(row.episode)" placement="top">
            <el-tag type="danger" size="small" style="margin-left:4px">Gate 1</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="Tiêu đề" width="140">
        <template #default="{ row }"><el-input v-model="row.title" size="small" @change="emitUpdate" /></template>
      </el-table-column>
      <el-table-column label="Mốc truyện" width="180">
        <template #default="{ row }">
          <el-select v-model="row.plot_point_ids" multiple size="small" style="width:100%" @change="emitUpdate">
            <el-option v-for="p in outline.plot_points" :key="p.id" :label="p.id" :value="p.id" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="Hook mở đầu (3-5s)">
        <template #default="{ row }"><el-input v-model="row.opening_hook" size="small" type="textarea" :rows="2" @change="emitUpdate" /></template>
      </el-table-column>
      <el-table-column label="Cliffhanger">
        <template #default="{ row }"><el-input v-model="row.cliffhanger" size="small" type="textarea" :rows="2" @change="emitUpdate" /></template>
      </el-table-column>
      <el-table-column width="110">
        <template #default="{ row }">
          <el-button v-if="episodeFailed(row.episode)" type="danger" size="small" plain :loading="writing" @click="$emit('rewrite-episode', row.episode)">
            Viết lại tập
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="row gap" style="margin-top: 10px">
      <el-button type="primary" :loading="writing" @click="$emit('confirm')">Chốt đề cương &amp; viết kịch bản</el-button>
      <el-button plain @click="$emit('regenerate')">Tạo lại đề cương</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  outline: { type: Object, default: null },
  coverage: { type: Object, default: null },
  warnings: { type: Array, default: () => [] },
  writing: { type: Boolean, default: false },
  status: { type: String, default: '' },
})
const emit = defineEmits(['update:outline', 'confirm', 'rewrite-episode', 'regenerate'])

const statusLabel = computed(() => ({ draft: 'Bản nháp', edited: 'Đã sửa', confirmed: 'Đã chốt' }[props.status] || ''))

function emitUpdate() {
  emit('update:outline', props.outline)
}
function episodeFailed(n) {
  const c = props.coverage && props.coverage[n]
  return !!c && ((c.missing_ids || []).length > 0 || c.hook_ok === false || c.cliffhanger_ok === false)
}
function failReason(n) {
  const c = props.coverage?.[n] || {}
  const parts = []
  if ((c.missing_ids || []).length) parts.push(`Thiếu mốc: ${c.missing_ids.join(', ')}`)
  if (c.hook_ok === false) parts.push('Mở đầu chưa đúng hook')
  if (c.cliffhanger_ok === false) parts.push('Kết chưa đúng cliffhanger')
  if (c.notes) parts.push(c.notes)
  return parts.join(' · ') || 'Chưa đạt Gate 1'
}
</script>

<style scoped>
.outline-panel { margin-top: 14px; padding: 12px; border: 1px solid var(--el-border-color); border-radius: 8px; }
.outline-title { margin: 0 0 8px; font-size: 15px; }
.pp-head { font-size: 13px; color: var(--el-text-color-secondary); margin-bottom: 4px; }
</style>

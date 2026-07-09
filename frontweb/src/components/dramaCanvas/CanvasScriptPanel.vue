<template>
  <div
    class="canvas-node-panel script-panel nodrag nopan nowheel"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @mouseup.stop
    @wheel.stop
  >
    <div class="panel-head">
      <span>Kịch bản · Tập {{ episode?.episode_number ?? '?' }}</span>
      <div class="head-right">
        <span v-if="busyLabel" class="busy-tag">{{ busyLabel }}</span>
        <el-button link size="small" @click.stop="closePanel">Thu gọn</el-button>
      </div>
    </div>

    <p class="flow-hint">Điểm bắt đầu: viết kịch bản → trích nhân vật/scene/đạo cụ → AI tạo storyboard → tạo ảnh/video</p>

    <el-form label-position="left" label-width="44px" size="small" class="compact-form">
      <el-form-item label="Tiêu đề tập">
        <el-input v-model="form.title" placeholder="Tập N" />
      </el-form-item>
      <el-form-item label="Kịch bản">
        <el-input
          v-model="form.scriptContent"
          type="textarea"
          :rows="6"
          resize="vertical"
          placeholder="Dán hoặc soạn kịch bản của tập này ở đây…"
          class="script-textarea"
        />
      </el-form-item>
    </el-form>

    <div class="stats-row">
      <span>Tư liệu: {{ charCount }} nhân vật · {{ sceneCount }} scene · {{ propCount }} đạo cụ</span>
      <span class="len">{{ scriptLen }} ký tự</span>
    </div>

    <div class="panel-actions">
      <el-button size="small" type="primary" :loading="saving" @click.stop="onSave">Lưu kịch bản</el-button>
      <el-button size="small" :loading="extracting" @click.stop="onExtractChars">Trích nhân vật</el-button>
      <el-button size="small" :loading="extracting" @click.stop="onExtractScenes">Trích scene</el-button>
      <el-button size="small" :loading="extracting" @click.stop="onExtractProps">Trích đạo cụ</el-button>
      <el-button size="small" type="warning" :loading="extracting" @click.stop="onExtractAll">Trích tất cả</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useCanvasContext } from '@/composables/useCanvasContext'

const props = defineProps({
  episode: { type: Object, required: true },
  nodeId: { type: String, required: true },
})

const ctx = useCanvasContext()
const saving = ref(false)
const extracting = ref(false)
const form = reactive({
  title: '',
  scriptContent: '',
})

const charCount = computed(() => (ctx?.drama?.value?.characters || []).length)
const sceneCount = computed(() => (ctx?.drama?.value?.scenes || []).length)
const propCount = computed(() => (ctx?.drama?.value?.props || []).length)
const scriptLen = computed(() => (form.scriptContent || '').length)

const busyLabel = computed(() => {
  const map = ctx?.nodeStatus?.map
  return map?.[props.nodeId]?.message || ''
})

function syncForm(ep) {
  form.title = ep?.title || `Tập ${ep?.episode_number ?? ''}`
  form.scriptContent = ep?.script_content || ''
}

watch(() => props.episode, (ep) => syncForm(ep), { immediate: true, deep: true })

function closePanel() {
  ctx?.clearFocusedNode?.()
}

function getScriptApi() {
  return ctx?.scriptActions
}

async function onSave() {
  if (!form.scriptContent.trim()) {
    ElMessage.warning('Vui lòng nhập nội dung kịch bản trước')
    return
  }
  saving.value = true
  try {
    await getScriptApi()?.saveScript?.(props.episode.id, {
      scriptContent: form.scriptContent,
      title: form.title,
    })
  } catch (e) {
    ElMessage.error(e?.message || 'Lưu thất bại')
  } finally {
    saving.value = false
  }
}

async function runExtract(fn) {
  extracting.value = true
  try {
    await fn()
  } catch (e) {
    if (e?.message) ElMessage.error(e.message)
  } finally {
    extracting.value = false
  }
}

async function onExtractChars() {
  await runExtract(() =>
    getScriptApi()?.extractCharacters?.(props.episode.id, form.scriptContent)
  )
}

async function onExtractScenes() {
  await runExtract(() => getScriptApi()?.extractScenes?.(props.episode.id))
}

async function onExtractProps() {
  await runExtract(() => getScriptApi()?.extractProps?.(props.episode.id))
}

async function onExtractAll() {
  if (!form.scriptContent.trim()) {
    ElMessage.warning('Vui lòng nhập kịch bản trước')
    return
  }
  await runExtract(() =>
    getScriptApi()?.extractAll?.(props.episode.id, form.scriptContent)
  )
}
</script>

<style scoped>
.script-panel {
  margin-top: 10px;
  width: min(520px, 92vw);
  padding: 10px 14px 12px;
  border-radius: 12px;
  border: 1px solid rgba(251, 191, 36, 0.45);
  background: rgba(15, 15, 18, 0.97);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  color: #fcd34d;
  margin-bottom: 6px;
}
.head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.busy-tag {
  font-size: 10px;
  color: #93c5fd;
}
.flow-hint {
  margin: 0 0 10px;
  font-size: 10px;
  line-height: 1.45;
  color: #71717a;
}
.compact-form :deep(.el-form-item) {
  margin-bottom: 8px;
}
.compact-form :deep(.el-form-item__label) {
  color: #71717a;
  font-size: 11px;
}
.compact-form :deep(.el-textarea__inner) {
  resize: vertical;
  min-height: 120px;
  line-height: 1.5;
}
.stats-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: #a1a1aa;
  margin-bottom: 8px;
}
.len {
  color: #71717a;
}
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(63, 63, 70, 0.6);
}
.panel-actions :deep(.el-button) {
  margin: 0;
}
</style>

<template>
  <div
    class="canvas-node-panel asset-panel nodrag nopan nowheel"
    :class="'kind-' + kind"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @mouseup.stop
    @wheel.stop
  >
    <div class="panel-head">
      <span>{{ kindLabel }}</span>
      <el-button link size="small" @click.stop="closePanel">Thu gọn</el-button>
    </div>

    <div class="panel-body">
      <div class="preview-col">
        <div class="preview-box">
          <img v-if="previewUrl && !generating" :src="previewUrl" alt="" />
          <div v-else-if="!generating" class="preview-empty">{{ kindIcon }}</div>
          <div v-if="generating || nodeBusy" class="preview-loading">
            <span class="spinner" />
            <span>{{ nodeBusy?.message || 'Đang tạo ảnh tham chiếu…' }}</span>
          </div>
        </div>
        <div v-if="entityStatus" class="entity-status" :class="'st-' + entityStatus">{{ entityStatusLabel }}</div>
      </div>

      <div class="form-col">
        <el-form label-position="left" label-width="44px" size="small" class="panel-form compact-form">
          <template v-if="kind === 'character'">
            <div class="form-row-2">
              <el-form-item label="Tên" class="flex-1">
                <el-input v-model="form.name" placeholder="Tên nhân vật" />
              </el-form-item>
              <el-form-item label="Loại" class="type-field">
                <el-select
                  v-model="form.role"
                  clearable
                  placeholder="Loại"
                  teleported
                  popper-class="canvas-panel-popper"
                  @visible-change="onSelectVisibleChange"
                >
                  <el-option label="Nhân vật chính" value="main" />
                  <el-option label="Nhân vật phụ" value="supporting" />
                </el-select>
              </el-form-item>
            </div>
            <el-form-item label="Ngoại hình">
              <el-input
                v-model="form.appearance"
                type="textarea"
                :rows="2"
                resize="vertical"
                placeholder="Mô tả ngoại hình"
              />
            </el-form-item>
            <el-form-item label="Mô tả">
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="2"
                resize="vertical"
                placeholder="Mô tả nhân vật"
              />
            </el-form-item>
          </template>

          <template v-else-if="kind === 'scene'">
            <div class="form-row-2">
              <el-form-item label="Địa điểm" class="flex-1">
                <el-input v-model="form.location" placeholder="Địa điểm của scene" />
              </el-form-item>
              <el-form-item label="Thời gian" class="time-field">
                <el-input v-model="form.time" placeholder="Ban ngày / đêm" />
              </el-form-item>
            </div>
            <el-form-item label="Mô tả">
              <el-input
                v-model="form.prompt"
                type="textarea"
                :rows="2"
                resize="vertical"
                placeholder="Mô tả scene"
              />
            </el-form-item>
          </template>

          <template v-else>
            <el-form-item label="Tên">
              <el-input v-model="form.name" placeholder="Tên đạo cụ" />
            </el-form-item>
            <el-form-item label="Mô tả">
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="2"
                resize="vertical"
                placeholder="Mô tả đạo cụ"
              />
            </el-form-item>
            <el-form-item label="Prompt">
              <el-input
                v-model="form.prompt"
                type="textarea"
                :rows="2"
                resize="vertical"
                placeholder="Prompt tạo ảnh"
              />
            </el-form-item>
          </template>
        </el-form>
      </div>
    </div>

    <div class="panel-actions">
      <el-button size="small" :loading="saving" @click.stop="saveAsset">Lưu</el-button>
      <el-button
        v-if="canGenerate || generating"
        size="small"
        type="primary"
        :loading="generating"
        @click.stop="generateImage"
      >
        Tạo ảnh tham chiếu
      </el-button>
      <el-button size="small" plain @click.stop="highlightRelated">Storyboard liên quan</el-button>
      <el-button size="small" type="danger" plain @click.stop="deleteAsset">Xoá</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { characterAPI } from '@/api/characters'
import { sceneAPI } from '@/api/scenes'
import { propAPI } from '@/api/props'
import { useCanvasContext } from '@/composables/useCanvasContext'
import { generateAssetReferenceImage } from '@/composables/useCanvasAssetGenerate'
import { assetImageUrl } from '@/utils/mediaUrl'

const props = defineProps({
  kind: { type: String, required: true },
  entity: { type: Object, required: true },
  nodeId: { type: String, required: true },
})

const ctx = useCanvasContext()
const saving = ref(false)
const generating = ref(false)
const form = reactive({
  name: '',
  role: '',
  appearance: '',
  description: '',
  location: '',
  time: '',
  prompt: '',
})

const kindLabel = computed(() => {
  const map = { character: 'Nhân vật', scene: 'Scene', prop: 'Đạo cụ' }
  return map[props.kind] || 'Tư liệu'
})

const kindIcon = computed(() => {
  const map = { character: '👤', scene: '🏞', prop: '🎭' }
  return map[props.kind] || '📦'
})

const previewUrl = computed(() => assetImageUrl(props.entity))
const canGenerate = computed(() => !previewUrl.value)
const entityStatus = computed(() => props.entity?.status || '')
const entityStatusLabel = computed(() => {
  const s = entityStatus.value
  const map = { pending: 'Chờ tạo', processing: 'Đang tạo', completed: 'Hoàn tất', failed: 'Thất bại' }
  return map[s] || (previewUrl.value ? 'Đã có ảnh tham chiếu' : 'Chưa có ảnh tham chiếu')
})

const nodeBusy = computed(() => {
  const map = ctx?.nodeStatus?.map
  return map ? map[props.nodeId] : null
})

function syncForm(entity) {
  form.name = entity?.name || ''
  form.role = entity?.role || ''
  form.appearance = entity?.appearance || ''
  form.description = entity?.description || ''
  form.location = entity?.location || ''
  form.time = entity?.time || ''
  form.prompt = entity?.prompt || entity?.polished_prompt || ''
}

watch(() => props.entity, (e) => syncForm(e), { immediate: true, deep: true })

function onSelectVisibleChange(open) {
  if (open) ctx?.suppressPaneClick?.()
  else ctx?.suppressPaneClick?.(400)
}

function closePanel() {
  ctx?.clearFocusedNode?.()
}

async function saveAsset() {
  saving.value = true
  ctx?.nodeStatus?.set(props.nodeId, { step: 'save', message: 'Đang lưu…' })
  try {
    if (props.kind === 'character') {
      if (!form.name.trim()) {
        ElMessage.warning('Vui lòng nhập tên nhân vật')
        return
      }
      await characterAPI.update(props.entity.id, {
        name: form.name.trim(),
        role: form.role || undefined,
        appearance: form.appearance.trim() || undefined,
        description: form.description.trim() || undefined,
      })
    } else if (props.kind === 'scene') {
      if (!form.location.trim()) {
        ElMessage.warning('Vui lòng nhập địa điểm scene')
        return
      }
      await sceneAPI.update(props.entity.id, {
        location: form.location.trim(),
        time: form.time.trim() || undefined,
        prompt: form.prompt.trim() || undefined,
      })
    } else {
      if (!form.name.trim()) {
        ElMessage.warning('Vui lòng nhập tên đạo cụ')
        return
      }
      await propAPI.update(props.entity.id, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        prompt: form.prompt.trim() || undefined,
      })
    }
    ElMessage.success('Đã lưu')
    await ctx?.refreshDrama?.(true)
  } catch (e) {
    ElMessage.error(e?.message || 'Lưu thất bại')
  } finally {
    saving.value = false
    if (!generating.value) ctx?.nodeStatus?.clear(props.nodeId)
  }
}

async function deleteAsset() {
  const label = props.kind === 'scene'
    ? (props.entity.location || 'Chưa đặt tên')
    : (props.entity.name || 'Chưa đặt tên')
  try {
    await ElMessageBox.confirm(`Bạn có chắc muốn xoá "${label.slice(0, 20)}"?`, 'Xác nhận xoá', {
      type: 'warning',
      confirmButtonText: 'Xoá',
      cancelButtonText: 'Huỷ',
    })
    if (props.kind === 'character') {
      await characterAPI.delete(props.entity.id)
    } else if (props.kind === 'scene') {
      await sceneAPI.delete(props.entity.id)
    } else {
      await propAPI.delete(props.entity.id)
    }
    ctx?.clearFocusedNode?.()
    ElMessage.success('Đã xoá')
    await ctx?.refresh?.()
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error(e?.message || 'Xoá thất bại')
  }
}

async function generateImage() {
  generating.value = true
  try {
    await generateAssetReferenceImage(ctx, {
      kind: props.kind,
      entity: props.entity,
      nodeId: props.nodeId,
    })
    ElMessage.success('Đã tạo ảnh tham chiếu')
  } catch (e) {
    ElMessage.error(e?.message || 'Tạo thất bại')
  } finally {
    generating.value = false
  }
}

function highlightRelated() {
  ctx?.setHighlightAsset?.(props.nodeId)
}
</script>

<style scoped>
.asset-panel {
  margin-top: 10px;
  width: min(520px, 92vw);
  padding: 10px 14px 12px;
  border-radius: 12px;
  border: 1px solid rgba(52, 211, 153, 0.4);
  background: rgba(15, 15, 18, 0.97);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  color: #6ee7b7;
  margin-bottom: 10px;
}
.panel-body {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.preview-col {
  flex-shrink: 0;
  width: 108px;
}
.preview-box {
  position: relative;
  width: 108px;
  height: 108px;
  border-radius: 10px;
  overflow: hidden;
  background: #09090b;
  border: 1px solid #3f3f46;
}
.preview-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.preview-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  opacity: 0.65;
}
.preview-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(9, 9, 11, 0.82);
  font-size: 10px;
  color: #d4d4d8;
  text-align: center;
  padding: 6px;
}
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-top-color: #34d399;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
.entity-status {
  margin-top: 6px;
  font-size: 10px;
  text-align: center;
  color: #71717a;
}
.entity-status.st-processing { color: #60a5fa; }
.entity-status.st-completed { color: #34d399; }
.entity-status.st-failed { color: #f87171; }
.form-col {
  flex: 1;
  min-width: 0;
}
.compact-form :deep(.el-form-item) {
  margin-bottom: 6px;
}
.compact-form :deep(.el-form-item__label) {
  color: #71717a;
  font-size: 11px;
  padding-right: 6px;
}
.compact-form :deep(.el-input__wrapper),
.compact-form :deep(.el-select__wrapper) {
  min-height: 28px;
}
.compact-form :deep(.el-textarea__inner) {
  resize: vertical;
  min-height: 52px;
  line-height: 1.45;
}
.form-row-2 {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.flex-1 { flex: 1; min-width: 0; }
.type-field { width: 108px; flex-shrink: 0; }
.time-field { width: 96px; flex-shrink: 0; }
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(63, 63, 70, 0.6);
}
.panel-actions :deep(.el-button) {
  margin: 0;
}
.kind-scene { border-color: rgba(96, 165, 250, 0.45); }
.kind-scene .panel-head { color: #93c5fd; }
.kind-scene .spinner { border-top-color: #93c5fd; }
.kind-prop { border-color: rgba(251, 191, 36, 0.45); }
.kind-prop .panel-head { color: #fcd34d; }
.kind-prop .spinner { border-top-color: #fcd34d; }
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

<style>
.canvas-panel-popper {
  z-index: 4000 !important;
}
.canvas-panel-popper.el-select__popper .el-select-dropdown__wrap {
  max-height: 168px !important;
}
</style>

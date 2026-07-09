<template>
  <div class="scene-model-map-page">
    <div class="page-header">
      <div class="header-left">
        <p class="page-desc">
          Cấu hình route model AI cho các scene nghiệp vụ khác nhau. Khi gọi generateText có truyền scene_key, hệ thống sẽ ưu tiên dùng model được cấu hình tại đây.
        </p>
      </div>
      <div class="header-right">
        <el-button type="primary" @click="openAdd">
          <el-icon><Plus /></el-icon>
          Thêm cấu hình scene nghiệp vụ
        </el-button>
      </div>
    </div>

    <div v-if="loading" v-loading="true" class="loading-wrap" />
    
    <template v-else>
      <el-table
        :data="list"
        stripe
        style="width: 100%"
      >
        <el-table-column prop="key" label="Scene key (scene_key)" min-width="220">
          <template #default="{ row }">
            <div class="">
              <code class="scene-key">{{ row.key }}</code>
              <span class="scene-key-label">{{ getSceneKeyLabel(row.key) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="service_type" label="Loại dịch vụ" width="120">
          <template #default="{ row }">
            <el-tag :type="serviceTypeTagType(row.service_type)" size="small">
              {{ serviceTypeLabel(row.service_type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="config_name" label="Cấu hình AI" min-width="180">
          <template #default="{ row }">
            <span v-if="row.config_id">{{ row.config_name || 'Cấu hình #' + row.config_id }}</span>
            <el-tag v-else type="info" size="small">Dùng cấu hình mặc định</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="model_override" label="Ghi đè model" min-width="180">
          <template #default="{ row }">
            <span v-if="row.model_override" class="model-override">{{ row.model_override }}</span>
            <span v-else class="text-muted">Dùng model mặc định của cấu hình</span>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="Mô tả" min-width="200" show-overflow-tooltip />
        <el-table-column label="Thao tác" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">Sửa</el-button>
            <el-button link type="danger" size="small" @click="onDelete(row)">Xoá</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="list.length === 0" description="Chưa có cấu hình ánh xạ scene-model" />
    </template>

    <!-- Add/Edit dialog -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingKey ? 'Sửa ánh xạ scene nghiệp vụ' : 'Thêm ánh xạ scene nghiệp vụ'"
      width="560px"
      :close-on-click-modal="false"
      @closed="resetForm"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item prop="key" label="Scene key">
          <el-select
            v-model="form.key"
            filterable
            allow-create
            default-first-option
            placeholder="Chọn hoặc nhập scene key"
            style="width: 100%"
            :disabled="!!editingKey"
            @change="onKeyChange"
          >
            <el-option
              v-for="k in predefinedKeys"
              :key="k.value"
              :label="k.label"
              :value="k.value"
            />
          </el-select>
          <p class="field-tip">Dùng để nhận diện scene nghiệp vụ trong code, khi chọn sẽ tự động đặt loại dịch vụ tương ứng</p>
        </el-form-item>

        <el-form-item prop="service_type" label="Loại dịch vụ">
          <el-select v-model="form.service_type" placeholder="Chọn loại dịch vụ" style="width: 100%" disabled>
            <el-option label="Text/Hội thoại" value="text" />
            <el-option label="Text-to-image" value="image" />
            <el-option label="Tạo ảnh storyboard" value="storyboard_image" />
            <el-option label="Tạo video" value="video" />
            <el-option label="TTS" value="tts" />
          </el-select>
          <p class="field-tip">Được scene key tự động xác định, không thể thay đổi</p>
        </el-form-item>

        <el-form-item label="Cấu hình AI">
          <el-select
            v-model="form.config_id"
            clearable
            placeholder="Chọn cấu hình AI (bỏ trống để dùng mặc định)"
            style="width: 100%"
            @change="onConfigChange"
          >
            <el-option
              v-for="c in filteredConfigs"
              :key="c.id"
              :label="`${c.name} (${c.provider})`"
              :value="c.id"
            />
          </el-select>
          <p class="field-tip">Chỉ định cấu hình dịch vụ AI cụ thể, bỏ trống sẽ dùng cấu hình mặc định của loại dịch vụ đó</p>
        </el-form-item>

        <el-form-item label="Ghi đè model">
          <el-select
            v-model="form.model_override"
            clearable
            placeholder="Chọn model (bỏ trống để dùng mặc định của cấu hình)"
            style="width: 100%"
            :disabled="!selectedConfigModels.length"
          >
            <el-option
              v-for="m in selectedConfigModels"
              :key="m"
              :label="m"
              :value="m"
            />
          </el-select>
          <p class="field-tip">
            {{ selectedConfigModels.length ? 'Chọn từ danh sách model khả dụng của cấu hình này' : 'Vui lòng chọn cấu hình AI trước' }}
          </p>
        </el-form-item>
        <el-form-item prop="description" label="Mô tả">
          <el-input
            v-model="form.description"
            placeholder="Nhập mô tả scene để dễ hiểu mục đích sử dụng"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">Huỷ</el-button>
        <el-button type="primary" :loading="saving" @click="save">Lưu</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { sceneModelMapAPI } from '@/api/sceneModelMap'
import { aiAPI } from '@/api/ai'
import { getSelectableModels } from '@/utils/modelSelection'

const loading = ref(false)
const saving = ref(false)
const list = ref([])
const configs = ref([])
const dialogVisible = ref(false)
const editingKey = ref(null)
const formRef = ref(null)

const form = ref({
  key: '',
  description: '',
  service_type: 'text',
  config_id: null,
  model_override: ''
})

const rules = {
  key: [{ required: true, message: 'Vui lòng nhập scene key', trigger: 'blur' }],
  service_type: [{ required: true, message: 'Vui lòng chọn loại dịch vụ', trigger: 'change' }]
}

// Predefined scene keys và loại dịch vụ tương ứng
const predefinedKeys = [
  { value: 'image_polish', label: 'image_polish - Trau chuốt prompt ảnh storyboard', service_type: 'text' },
  // Hiện tại app chỉ có sẵn 1 scene key: image_polish
  // Các scene key bên dưới đã được thêm vào các API tương ứng
  { value: 'role_image_polish', label: 'role_image_polish - Trau chuốt prompt ảnh nhân vật', service_type: 'text' },
  { value: 'prop_image_polish', label: 'prop_image_polish - Trau chuốt prompt ảnh đạo cụ', service_type: 'text' },
  { value: 'scene_image_polish', label: 'scene_image_polish - Trau chuốt prompt ảnh scene', service_type: 'text' },
  { value: 'role_extraction', label: 'role_extraction - Trích xuất nhân vật', service_type: 'text' },
  { value: 'prop_extraction', label: 'prop_extraction - Trích xuất đạo cụ', service_type: 'text' },
  { value: 'scene_extraction', label: 'scene_extraction - Trích xuất scene', service_type: 'text' },
  { value: 'storyboard_extraction', label: 'storyboard_extraction - Tạo storyboard', service_type: 'text' },
  { value: 'identity_anchors', label: 'identity_anchors - Trích xuất điểm neo hình ảnh nhân vật', service_type: 'text' },
  { value: 'frame_prompt', label: 'frame_prompt - Tạo prompt frame', service_type: 'text' },
  { value: 'novel_import', label: 'novel_import - Nhập tiểu thuyết và chuyển thể', service_type: 'text' },
  { value: 'story_generation', label: 'story_generation - Tạo câu chuyện', service_type: 'text' },
  //  Các loại dịch vụ khác... chưa triển khai
  // Tạo ảnh
  // { value: 'role_image_gen', label: 'role_image_gen - Tạo ảnh nhân vật', service_type: 'image' },
  // { value: 'prop_image_gen', label: 'prop_image_gen - Tạo ảnh đạo cụ', service_type: 'image' },
  // { value: 'scene_image_gen', label: 'scene_image_gen - Tạo ảnh scene', service_type: 'image' },
  // { value: 'storyboard_image_gen', label: 'storyboard_image_gen - Tạo ảnh storyboard', service_type: 'image' },
  // { value: 'video_frame_gen', label: 'video_frame_gen - Tạo video từ frame', service_type: 'video' },// Tạo video từ frame đầu/cuối
  // { value: 'video_full_gen', label: 'video_full_gen - Tạo video toàn năng', service_type: 'video' },// Tạo video chế độ toàn năng
]

// Lọc cấu hình theo loại dịch vụ
const filteredConfigs = computed(() => {
  const currentServiceType = form.value.service_type
  console.log('filteredConfigs computed, service_type:', currentServiceType, 'configs:', configs.value.length)
  const filtered = configs.value.filter(c => {
    const match = c.service_type === currentServiceType && c.is_active
    console.log('  config:', c.name, 'service_type:', c.service_type, 'match:', match)
    return match
  })
  console.log('  filtered result:', filtered.length)
  return filtered
})

// Lấy danh sách model khả dụng của cấu hình đang chọn
const selectedConfigModels = computed(() => {
  return getSelectableModels(configs.value, form.value.service_type, form.value.config_id)
})

function serviceTypeLabel(type) {
  const map = {
    text: 'Text/Hội thoại',
    image: 'Text-to-image',
    storyboard_image: 'Tạo ảnh storyboard',
    video: 'Tạo video',
    tts: 'TTS'
  }
  return map[type] || type
}

function serviceTypeTagType(type) {
  const map = {
    text: 'primary',
    image: 'success',
    storyboard_image: 'warning',
    video: 'danger',
    tts: 'info'
  }
  return map[type] || ''
}

// Lấy label của scene key
function getSceneKeyLabel(key) {
  const matched = predefinedKeys.find(k => k.value === key)
  if (matched) {
    // Trích xuất phần mô tả từ label (bỏ prefix key)
    return matched.label.replace(matched.value + ' - ', '')
  }
  return ''
}

// Tự động đặt loại dịch vụ khi scene key thay đổi
function onKeyChange(key) {
  console.log('onKeyChange called with key:', key)
  const matched = predefinedKeys.find(k => k.value === key)
  console.log('matched predefined key:', matched)
  if (matched) {
    form.value.service_type = matched.service_type
    console.log('service_type set to:', form.value.service_type)
  }
  // Reset lựa chọn cấu hình và model
  form.value.config_id = null
  form.value.model_override = ''
}

// Reset lựa chọn model khi cấu hình thay đổi
function onConfigChange(configId) {
  form.value.model_override = ''
}

async function load() {
  loading.value = true
  try {
    const [mapsData, configsData] = await Promise.all([
      sceneModelMapAPI.list(),
      aiAPI.list()
    ])
    configs.value = configsData || []
    console.log('Loaded configs:', configs.value.map(c => ({ id: c.id, name: c.name, service_type: c.service_type, is_active: c.is_active })))
    
    // Gộp tên cấu hình
    list.value = (mapsData || []).map(item => {
      const config = configs.value.find(c => c.id === item.config_id)
      return {
        ...item,
        config_name: config?.name || null
      }
    })
  } catch (err) {
    ElMessage.error('Tải ánh xạ scene-model thất bại: ' + (err.message || 'Lỗi không rõ'))
  } finally {
    loading.value = false
  }
}

function openAdd() {
  editingKey.value = null
  form.value = {
    key: '',
    description: '',
    service_type: 'text',
    config_id: null,
    model_override: ''
  }
  dialogVisible.value = true
}

function openEdit(row) {
  editingKey.value = row.key
  form.value = {
    key: row.key,
    description: row.description || '',
    service_type: row.service_type || 'text',
    config_id: row.config_id || null,
    model_override: row.model_override || ''
  }
  dialogVisible.value = true
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const body = {
      description: form.value.description,
      service_type: form.value.service_type,
      config_id: form.value.config_id || null,
      model_override: form.value.model_override || null
    }
    
    if (editingKey.value) {
      await sceneModelMapAPI.update(editingKey.value, body)
      ElMessage.success('Đã cập nhật')
    } else {
      await sceneModelMapAPI.create({ ...body, key: form.value.key })
      ElMessage.success('Đã tạo')
    }
    dialogVisible.value = false
    await load()
  } catch (err) {
    ElMessage.error('Lưu thất bại: ' + (err.message || 'Lỗi không rõ'))
  } finally {
    saving.value = false
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(
      `Bạn có chắc muốn xoá cấu hình ánh xạ model của scene "${row.key}"?`,
      'Xác nhận xoá',
      { type: 'warning' }
    )
    await sceneModelMapAPI.delete(row.key)
    ElMessage.success('Đã xoá')
    await load()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('Xoá thất bại: ' + (err.message || 'Lỗi không rõ'))
    }
  }
}

function resetForm() {
  formRef.value?.resetFields()
}

onMounted(() => {
  load()
})
</script>

<style scoped>
.scene-model-map-page {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page-desc {
  margin: 0;
  color: #666;
  font-size: 14px;
  line-height: 1.6;
}

.loading-wrap {
  padding: 40px;
}

.scene-key {
  background: #f5f7fa;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: #409eff;
  width: fit-content;
}

.scene-key-label {
  font-size: 12px;
  color: #666;
}

.model-override {
  background: #e6f7ff;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: #096dd9;
}

.text-muted {
  color: #999;
  font-size: 13px;
}

.field-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: #999;
  line-height: 1.4;
}
</style>

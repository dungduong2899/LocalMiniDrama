<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="420px"
    destroy-on-close
    @closed="resetForm"
  >
    <el-form label-position="top" size="default" @submit.prevent="onSubmit">
      <template v-if="type === 'storyboard'">
        <el-form-item label="Tiêu đề storyboard">
          <el-input v-model="form.title" placeholder="Để trống sẽ tự đặt tên" />
        </el-form-item>
        <el-form-item label="Mô tả (tuỳ chọn)">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="Mô tả ngắn gọn" />
        </el-form-item>
      </template>

      <template v-else-if="type === 'episode'">
        <el-form-item label="Tiêu đề tập">
          <el-input v-model="form.title" placeholder="Để trống sẽ tự đặt tên" />
        </el-form-item>
      </template>

      <template v-else-if="type === 'character'">
        <el-form-item label="Tên nhân vật" required>
          <el-input v-model="form.name" placeholder="Bắt buộc" />
        </el-form-item>
        <el-form-item label="Loại nhân vật">
          <el-select v-model="form.role" placeholder="Tuỳ chọn" clearable style="width: 100%">
            <el-option label="Nhân vật chính" value="main" />
            <el-option label="Nhân vật phụ" value="supporting" />
          </el-select>
        </el-form-item>
        <el-form-item label="Mô tả ngoại hình">
          <el-input v-model="form.appearance" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="Mô tả">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
      </template>

      <template v-else-if="type === 'scene'">
        <el-form-item label="Địa điểm scene" required>
          <el-input v-model="form.location" placeholder="Bắt buộc, ví dụ: phòng khách" />
        </el-form-item>
        <el-form-item label="Thời gian">
          <el-input v-model="form.time" placeholder="Ví dụ: ban ngày, ban đêm" />
        </el-form-item>
        <el-form-item label="Mô tả scene">
          <el-input v-model="form.prompt" type="textarea" :rows="3" />
        </el-form-item>
      </template>

      <template v-else-if="type === 'prop'">
        <el-form-item label="Tên đạo cụ" required>
          <el-input v-model="form.name" placeholder="Bắt buộc" />
        </el-form-item>
        <el-form-item label="Mô tả">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="Prompt">
          <el-input v-model="form.prompt" type="textarea" :rows="2" />
        </el-form-item>
      </template>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">Huỷ</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">Tạo</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  type: { type: String, default: 'storyboard' },
  onSubmit: { type: Function, default: null },
})

const emit = defineEmits(['update:modelValue', 'submit'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const submitting = ref(false)
const form = reactive({
  title: '',
  description: '',
  name: '',
  role: '',
  appearance: '',
  location: '',
  time: '',
  prompt: '',
})

const dialogTitle = computed(() => {
  const map = {
    storyboard: 'Tạo storyboard',
    episode: 'Tạo tập',
    character: 'Tạo nhân vật',
    scene: 'Tạo scene',
    prop: 'Tạo đạo cụ',
  }
  return map[props.type] || 'Tạo mới'
})

function resetForm() {
  form.title = ''
  form.description = ''
  form.name = ''
  form.role = ''
  form.appearance = ''
  form.location = ''
  form.time = ''
  form.prompt = ''
  submitting.value = false
}

watch(() => props.type, () => resetForm())

function validate() {
  if (props.type === 'character' || props.type === 'prop') {
    if (!form.name.trim()) {
      ElMessage.warning('Vui lòng nhập tên')
      return false
    }
  }
  if (props.type === 'scene' && !form.location.trim()) {
    ElMessage.warning('Vui lòng nhập địa điểm scene')
    return false
  }
  return true
}

async function onSubmit() {
  if (!validate()) return
  submitting.value = true
  try {
    const handler = props.onSubmit || ((form) => emit('submit', form))
    await handler({ ...form })
  } finally {
    submitting.value = false
  }
}
</script>

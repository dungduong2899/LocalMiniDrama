<template>
  <div class="voice-library-page">
    <header class="page-header">
      <div class="header-left">
        <el-button text @click="$router.back()">
          <el-icon><ArrowLeft /></el-icon>
          Quay lại
        </el-button>
        <h2 class="page-title">Quản lý lồng tiếng</h2>
      </div>
    </header>

    <el-tabs v-model="activeTab" class="voice-tabs">
      <el-tab-pane label="Thư viện voice" name="library">
        <div class="filter-bar">
          <el-select v-model="filterGender" placeholder="Giới tính" clearable style="width: 120px" @change="loadVoices">
            <el-option label="Nam" value="male" />
            <el-option label="Nữ" value="female" />
            <el-option label="Trung tính" value="neutral" />
          </el-select>
          <el-select v-model="filterSource" placeholder="Nguồn" clearable style="width: 140px" @change="loadVoices">
            <el-option label="ElevenLabs clone" value="elevenlabs" />
            <el-option label="Voice design" value="design" />
            <el-option label="Tải lên" value="upload" />
          </el-select>
        </div>
        <div v-loading="voicesLoading" class="voice-grid">
          <div v-for="v in voices" :key="v.id" class="voice-card">
            <div class="voice-card-name">
              {{ v.name }}
              <el-tag v-if="v.id === defaultNarrationId" size="small" type="warning" class="narr-badge">🎙 Narration mặc định</el-tag>
            </div>
            <div class="voice-card-meta">
              <el-tag v-if="v.gender" size="small">{{ v.gender }}</el-tag>
              <el-tag v-if="v.age_range" size="small" type="info">{{ v.age_range }}</el-tag>
              <el-tag size="small" type="success">{{ sourceLabel(v.source) }}</el-tag>
            </div>
            <div class="voice-card-desc">{{ v.description }}</div>
            <div class="voice-card-actions">
              <el-button size="small" @click="playAudio(v.sample_url)">
                <el-icon><VideoPlay /></el-icon>Nghe thử
              </el-button>
              <el-button size="small" @click="downloadVoiceMp3(v)">
                <el-icon><Download /></el-icon>Tải MP3
              </el-button>
              <el-button
                size="small"
                :type="v.id === defaultNarrationId ? 'warning' : 'default'"
                @click="toggleDefaultNarration(v)"
              >
                {{ v.id === defaultNarrationId ? 'Bỏ narration mặc định' : 'Đặt làm narration mặc định' }}
              </el-button>
              <el-button size="small" type="danger" plain @click="confirmDeleteVoice(v)">Xoá</el-button>
            </div>
          </div>
          <div v-if="!voicesLoading && voices.length === 0" class="voice-empty">Chưa có voice, vui lòng vào «Clone import» hoặc «Voice design» để thêm</div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="Clone import (ElevenLabs)" name="import">
        <el-form :model="importForm" label-width="90px" class="voice-form">
          <el-form-item label="Voice ID"><el-input v-model="importForm.voice_id" placeholder="ElevenLabs voice_id" /></el-form-item>
          <el-form-item label="Tên"><el-input v-model="importForm.name" placeholder="Tên hiển thị, ví dụ Rachel (giọng Anh nhẹ nhàng)" /></el-form-item>
          <el-form-item label="Mô tả"><el-input v-model="importForm.description" type="textarea" :rows="2" placeholder="Mô tả tự do, dùng để AI match nhân vật" /></el-form-item>
          <el-form-item label="Giới tính">
            <el-select v-model="importForm.gender" placeholder="Chọn giới tính" style="width: 160px">
              <el-option label="Nam" value="male" />
              <el-option label="Nữ" value="female" />
              <el-option label="Trung tính" value="neutral" />
            </el-select>
          </el-form-item>
          <el-form-item label="Độ tuổi">
            <el-select v-model="importForm.age_range" placeholder="Chọn độ tuổi" style="width: 160px">
              <el-option label="Trẻ em" value="child" />
              <el-option label="Thanh niên" value="young" />
              <el-option label="Người lớn" value="adult" />
              <el-option label="Người lớn tuổi" value="elderly" />
            </el-select>
          </el-form-item>
          <el-form-item label="Tag"><el-input v-model="importForm.tagsInput" placeholder="Ngăn bởi dấu phẩy, ví dụ gentle,mature" /></el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="importing" @click="doImport">Nhập và clone</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="Voice design" name="design">
        <el-form :model="designForm" label-width="90px" class="voice-form">
          <el-form-item label="Attributes">
            <el-input v-model="designForm.instruct" type="textarea" :rows="2" placeholder='Ví dụ: "female, low pitch, gentle, british accent"' />
          </el-form-item>
          <el-form-item label="Text nghe thử"><el-input v-model="designForm.sample_text" placeholder="Để trống sẽ dùng text mặc định" /></el-form-item>
          <el-form-item>
            <el-button :loading="designPreviewing" @click="doDesignPreview">Tạo bản nghe thử</el-button>
          </el-form-item>
          <template v-if="designPreview">
            <el-form-item label="Kết quả nghe thử">
              <el-button @click="playAudio(designPreview.sample_url)"><el-icon><VideoPlay /></el-icon>Phát</el-button>
              <el-button @click="downloadAdhocMp3(designPreview.sample_url, designForm.name || 'design_preview')">
                <el-icon><Download /></el-icon>Tải MP3
              </el-button>
            </el-form-item>
            <el-form-item label="Tên"><el-input v-model="designForm.name" placeholder="Tên hiển thị" /></el-form-item>
            <el-form-item label="Mô tả"><el-input v-model="designForm.description" type="textarea" :rows="2" /></el-form-item>
            <el-form-item label="Giới tính">
              <el-select v-model="designForm.gender" placeholder="Chọn giới tính" style="width: 160px">
                <el-option label="Nam" value="male" />
                <el-option label="Nữ" value="female" />
                <el-option label="Trung tính" value="neutral" />
              </el-select>
            </el-form-item>
            <el-form-item label="Độ tuổi">
              <el-select v-model="designForm.age_range" placeholder="Chọn độ tuổi" style="width: 160px">
                <el-option label="Trẻ em" value="child" />
                <el-option label="Thanh niên" value="young" />
                <el-option label="Người lớn" value="adult" />
                <el-option label="Người lớn tuổi" value="elderly" />
              </el-select>
            </el-form-item>
            <el-form-item label="Tag"><el-input v-model="designForm.tagsInput" placeholder="Ngăn bởi dấu phẩy" /></el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="designSaving" @click="doDesignSave">Lưu vào thư viện voice</el-button>
            </el-form-item>
          </template>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="Bàn test voice" name="test">
        <el-form label-width="90px" class="voice-form">
          <el-form-item label="Chọn voice">
            <el-select v-model="testVoiceId" placeholder="Chọn voice để nghe thử" style="width: 280px">
              <el-option v-for="v in voices" :key="v.id" :label="v.name" :value="v.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="Text test"><el-input v-model="testText" type="textarea" :rows="3" placeholder="Nhập nội dung bất kỳ" /></el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="testing" @click="doTest">Nghe thử</el-button>
            <el-button v-if="testSampleUrl" :loading="downloading" @click="downloadTestSample">
              <el-icon><Download /></el-icon>Tải MP3
            </el-button>
          </el-form-item>
          <el-form-item v-if="testSampleUrl" label="Kết quả">
            <audio controls :src="testSampleUrl" style="width: 100%; max-width: 480px" />
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, VideoPlay, Download } from '@element-plus/icons-vue'
import { voiceLibraryAPI } from '@/api/voiceLibrary'

const activeTab = ref('library')

const voices = ref([])
const voicesLoading = ref(false)
const filterGender = ref('')
const filterSource = ref('')
const defaultNarrationId = ref(null)

function sourceLabel(source) {
  if (source === 'elevenlabs') return 'ElevenLabs clone'
  if (source === 'design') return 'Voice design'
  return 'Tải lên'
}

async function loadVoices() {
  voicesLoading.value = true
  try {
    const data = await voiceLibraryAPI.list({ gender: filterGender.value || undefined, source: filterSource.value || undefined })
    voices.value = data?.items || []
    const found = voices.value.find((v) => v.is_default_narration)
    defaultNarrationId.value = found ? found.id : null
  } catch (e) {
    ElMessage.error(e.message || 'Tải thư viện voice thất bại')
  } finally {
    voicesLoading.value = false
  }
}

async function toggleDefaultNarration(voice) {
  const isCurrent = voice.id === defaultNarrationId.value
  try {
    const data = await voiceLibraryAPI.setDefaultNarration(isCurrent ? null : voice.id)
    defaultNarrationId.value = data?.voice?.id || null
    ElMessage.success(isCurrent ? 'Đã bỏ narration mặc định' : `Đã đặt «${voice.name}» làm narration mặc định`)
  } catch (e) {
    ElMessage.error(e.message || 'Đặt narration mặc định thất bại')
  }
}

let previewAudio = null

function playAudio(url) {
  if (!url) return
  if (previewAudio) {
    previewAudio.pause()
    previewAudio = null
  }
  const a = new Audio(url)
  previewAudio = a
  a.addEventListener('ended', () => {
    if (previewAudio === a) previewAudio = null
  })
  a.play().catch(() => {
    ElMessage.error('Phát thất bại')
    if (previewAudio === a) previewAudio = null
  })
}

function sanitizeFilename(s) {
  return String(s || 'voice').replace(/[^\w一-龥.-]+/g, '_').slice(0, 80) || 'voice'
}

// Downloads a URL as MP3 through the browser. `apiUrl` MUST hit a backend
// endpoint that returns real MP3 bytes (ffmpeg-transcoded server-side) so the
// file plays on any device — no client-side ext renaming.
async function downloadMp3FromApi(apiUrl, filename) {
  if (!apiUrl) { ElMessage.warning('Không có audio để tải'); return }
  try {
    const resp = await fetch(apiUrl)
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`
      try {
        const errBody = await resp.json()
        msg = errBody?.error?.message || errBody?.message || msg
      } catch (_) {}
      throw new Error(msg)
    }
    const blob = await resp.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = `${sanitizeFilename(filename)}.mp3`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(objUrl), 60_000)
  } catch (e) {
    ElMessage.error(e.message || 'Tải xuống thất bại')
  }
}

function downloadVoiceMp3(voice) {
  return downloadMp3FromApi(voiceLibraryAPI.downloadLibraryMp3Url(voice.id), voice.name)
}

function downloadAdhocMp3(sampleUrl, filename) {
  if (!sampleUrl) { ElMessage.warning('Không có audio để tải'); return Promise.resolve() }
  // sample_url looks like "/static/voice_library/tmp/preview_xxxxx.wav"; extract the path after /static/.
  const m = /\/static\/(.+)$/i.exec(sampleUrl)
  const relPath = m ? m[1] : sampleUrl.replace(/^\/+/, '')
  return downloadMp3FromApi(voiceLibraryAPI.downloadAdhocMp3Url(relPath, filename), filename)
}

async function confirmDeleteVoice(voice) {
  try {
    await ElMessageBox.confirm(`Bạn có chắc muốn xoá voice «${voice.name}»?`, 'Xác nhận xoá', { type: 'warning' })
  } catch (_) { return }
  try {
    await voiceLibraryAPI.delete(voice.id)
    ElMessage.success('Đã xoá')
    loadVoices()
  } catch (e) {
    const detail = e.response?.data?.error
    if (detail?.code === 'IN_USE') {
      try {
        await ElMessageBox.confirm(detail.message, 'Voice đang được sử dụng', { type: 'warning', confirmButtonText: 'Vẫn xoá' })
      } catch (_) { return }
      try {
        await voiceLibraryAPI.delete(voice.id, true)
        ElMessage.success('Đã xoá, đã gỡ liên kết lồng tiếng của các nhân vật liên quan')
        loadVoices()
      } catch (e2) {
        ElMessage.error(e2.message || 'Xoá thất bại')
      }
      return
    }
    ElMessage.error(e.message || 'Xoá thất bại')
  }
}

const importForm = ref({ voice_id: '', name: '', description: '', gender: '', age_range: '', tagsInput: '' })
const importing = ref(false)

async function doImport() {
  if (!importForm.value.voice_id?.trim()) { ElMessage.warning('Vui lòng nhập ElevenLabs voice_id'); return }
  if (!importForm.value.name?.trim()) { ElMessage.warning('Vui lòng nhập tên'); return }
  importing.value = true
  try {
    await voiceLibraryAPI.importElevenLabs({
      voice_id: importForm.value.voice_id.trim(),
      name: importForm.value.name.trim(),
      description: importForm.value.description || null,
      gender: importForm.value.gender || null,
      age_range: importForm.value.age_range || null,
      tags: importForm.value.tagsInput ? importForm.value.tagsInput.split(',').map((s) => s.trim()).filter(Boolean) : [],
    })
    ElMessage.success('Nhập thành công')
    importForm.value = { voice_id: '', name: '', description: '', gender: '', age_range: '', tagsInput: '' }
    activeTab.value = 'library'
    loadVoices()
  } catch (e) {
    ElMessage.error(e.message || 'Nhập thất bại')
  } finally {
    importing.value = false
  }
}

const designForm = ref({ instruct: '', sample_text: '', name: '', description: '', gender: '', age_range: '', tagsInput: '' })
const designPreviewing = ref(false)
const designSaving = ref(false)
const designPreview = ref(null)

async function doDesignPreview() {
  if (!designForm.value.instruct?.trim()) { ElMessage.warning('Vui lòng nhập mô tả attributes'); return }
  designPreviewing.value = true
  designPreview.value = null
  try {
    const data = await voiceLibraryAPI.designPreview({
      instruct: designForm.value.instruct.trim(),
      sample_text: designForm.value.sample_text || undefined,
    })
    designPreview.value = data
    playAudio(data.sample_url)
  } catch (e) {
    ElMessage.error(e.message || 'Tạo bản nghe thử thất bại')
  } finally {
    designPreviewing.value = false
  }
}

async function doDesignSave() {
  if (!designPreview.value) { ElMessage.warning('Vui lòng tạo bản nghe thử trước'); return }
  if (!designForm.value.name?.trim()) { ElMessage.warning('Vui lòng nhập tên'); return }
  designSaving.value = true
  try {
    await voiceLibraryAPI.designSave({
      temp_path: designPreview.value.temp_path,
      instruct: designPreview.value.instruct,
      sample_text: designPreview.value.sample_text,
      name: designForm.value.name.trim(),
      description: designForm.value.description || null,
      gender: designForm.value.gender || null,
      age_range: designForm.value.age_range || null,
      tags: designForm.value.tagsInput ? designForm.value.tagsInput.split(',').map((s) => s.trim()).filter(Boolean) : [],
    })
    ElMessage.success('Đã lưu vào thư viện voice')
    designForm.value = { instruct: '', sample_text: '', name: '', description: '', gender: '', age_range: '', tagsInput: '' }
    designPreview.value = null
    activeTab.value = 'library'
    loadVoices()
  } catch (e) {
    ElMessage.error(e.message || 'Lưu thất bại')
  } finally {
    designSaving.value = false
  }
}

const testVoiceId = ref(null)
const testText = ref('')
const testing = ref(false)
const testSampleUrl = ref('')
const downloading = ref(false)

async function doTest() {
  if (!testVoiceId.value) { ElMessage.warning('Vui lòng chọn voice'); return }
  if (!testText.value?.trim()) { ElMessage.warning('Vui lòng nhập text test'); return }
  testing.value = true
  try {
    const data = await voiceLibraryAPI.test(testVoiceId.value, testText.value.trim())
    testSampleUrl.value = data.sample_url
    playAudio(data.sample_url)
  } catch (e) {
    ElMessage.error(e.message || 'Nghe thử thất bại')
  } finally {
    testing.value = false
  }
}

async function downloadTestSample() {
  if (!testSampleUrl.value) return
  downloading.value = true
  try {
    const voice = voices.value.find((v) => v.id === testVoiceId.value)
    const voiceLabel = voice ? voice.name : `voice-${testVoiceId.value}`
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    await downloadAdhocMp3(testSampleUrl.value, `${voiceLabel}_${stamp}`)
  } finally {
    downloading.value = false
  }
}

onMounted(() => {
  loadVoices()
})
</script>

<style scoped>
.voice-library-page { min-height: 100vh; padding: 20px 32px; }
.page-header { display: flex; align-items: center; margin-bottom: 16px; }
.header-left { display: flex; align-items: center; gap: 12px; }
.page-title { margin: 0; font-size: 20px; }
.filter-bar { display: flex; gap: 12px; margin-bottom: 16px; }
.voice-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.voice-card { border: 1px solid var(--el-border-color); border-radius: 8px; padding: 14px; }
.voice-card-name { font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
.voice-card-name .narr-badge { font-size: 11px; }
.voice-card-meta { display: flex; gap: 6px; margin-bottom: 8px; }
.voice-card-desc { color: var(--el-text-color-secondary); font-size: 13px; min-height: 36px; margin-bottom: 10px; }
.voice-card-actions { display: flex; gap: 8px; }
.voice-empty { grid-column: 1 / -1; text-align: center; color: var(--el-text-color-secondary); padding: 40px 0; }
.voice-form { max-width: 480px; }
</style>

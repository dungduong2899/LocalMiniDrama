<template>
  <div class="sd2-asset-mgmt tab-content">
    <el-alert type="info" :closable="false" class="sd2-intro" show-icon>
      <template #title>
        <span>
          Kết nối BytePlus ModelArk / Volcano Ark <strong>thư viện tài sản riêng</strong> (tư liệu <code>Asset://</code> dùng bởi Seedance 2.0, v.v.).
          Sau khi cấu hình xong, hãy nhấn <strong>"Lưu vào cấu hình AI"</strong> bên dưới. Trang sáng tạo "SD2 Auth" sẽ ưu tiên dùng "Jimeng2 character auth"; nếu chưa cấu hình thì dùng cấu hình thư viện tài sản chính thức lưu ở đây.
          Luồng chính thức: <a href="https://docs.byteplus.com/en/docs/ModelArk/2318270" target="_blank" rel="noopener">CreateAssetGroup</a>
          → CreateAsset → List / Get / Update / Delete.
          Các endpoint có <code>?Action=</code> là <strong>OpenAPI control plane</strong>, phải dùng
          <a href="https://console.volcengine.com/iam/keymanage" target="_blank" rel="noopener">Access Key (AK/SK)</a> trên console để ký, không dùng ARK API Key cho inference làm Bearer, nếu không sẽ báo Invalid Authorization (xem
          <a href="https://docs.byteplus.com/en/docs/ModelArk/1298459" target="_blank" rel="noopener">hướng dẫn xác thực</a>).
          Nếu đã gọi được API nhưng trả <strong>403</strong> có <code>not authorized</code> / <code>ark:CreateAssetGroup</code>, tức IAM user tương ứng AK <strong>thiếu policy</strong>: trên console gán cho user đó quyền quản lý ModelArk private asset / asset group (xem
          <a href="https://docs.byteplus.com/en/docs/ModelArk/1263493" target="_blank" rel="noopener">IAM Access Control</a>), đừng dùng quyền tối giản chỉ "chạy inference".
        </span>
      </template>
    </el-alert>

    <el-form label-width="120px" class="sd2-form">
      <el-form-item label="Base URL">
        <el-input
          v-model="baseUrl"
          placeholder="Phải chứa /api/v3, ví dụ https://ark.ap-southeast-1.byteplusapi.com/api/v3 (nếu chỉ điền domain, backend sẽ thử tự bổ sung)"
          clearable
        />
        <p class="field-hint">OpenAPI và inference thường dùng chung prefix <code>/api/v3</code>; nếu chỉ điền domain có thể dẫn tới sai route, ProjectName không có hiệu lực.</p>
      </el-form-item>
      <el-form-item label="Kiểu xác thực">
        <el-radio-group v-model="authMode">
          <el-radio-button value="volc_sign">Ký AK/SK (OpenAPI chính thức)</el-radio-button>
          <el-radio-button value="bearer">Bearer Inference Key</el-radio-button>
        </el-radio-group>
        <p class="field-hint">Khi chọn path "OpenAPI chính thức", dùng mục này và điền AK/SK; chọn "Bearer" chỉ phù hợp với proxy <code>/asset/…</code>.</p>
      </el-form-item>
      <el-form-item v-if="authMode === 'bearer'" label="API Key">
        <el-input v-model="apiKey" type="password" show-password placeholder="ARK inference / proxy API Key" clearable />
      </el-form-item>
      <template v-else>
        <el-form-item label="Access Key ID">
          <el-input v-model="accessKeyId" placeholder="IAM Access Key ID trên console" clearable />
        </el-form-item>
        <el-form-item label="Secret Key">
          <el-input v-model="secretAccessKey" type="password" show-password placeholder="Secret Access Key" clearable />
        </el-form-item>
        <el-form-item label="Region">
          <el-input v-model="signRegion" placeholder="Có thể trống: ark nội địa thường là cn-beijing; BytePlus quốc tế thường là ap-southeast-1" clearable />
        </el-form-item>
      </template>
      <el-form-item label="Path mode">
        <el-select v-model="pathMode" style="width: 100%">
          <el-option label="OpenAPI chính thức: POST {Base}?Action=…&Version=… (mặc định Volcano/BytePlus)" value="open_api_query" />
          <el-option label="Path: POST {Base}/asset/{Action} (một số proxy)" value="asset_subpath" />
          <el-option label="Phẳng: POST {Base}/{Action}" value="flat" />
        </el-select>
        <p class="field-hint">API chính thức phải có <code>Action</code> trong Query; nếu dùng AnyFast hoặc proxy tự xây thì chọn chế độ proxy.</p>
      </el-form-item>
      <el-form-item label="API Version">
        <el-input v-model="apiVersion" placeholder="Mặc định 2024-01-01 (chỉ dùng cho OpenAPI chính thức)" clearable />
      </el-form-item>
      <el-form-item v-if="pathMode === 'open_api_query'" label="Tên project">
        <el-input
          v-model="projectName"
          placeholder='Trùng chính xác với định danh "project" trên console (phân biệt hoa/thường, dấu gạch dưới, v.v.)'
          clearable
        />
        <p class="field-hint">
          Sẽ ghi vào <code>ProjectName</code> ở <strong>Query</strong> và <strong>JSON Body</strong> (ký cùng với Action).
          Nếu vẫn báo 403 và trong text có <code>project/*</code>, thường do IAM chưa cấp quyền cho action này; hãy kiểm tra policy có bao gồm project của bạn (hoặc <code>project/*</code>) không, thông báo lỗi có thể không thay thế bằng tên project cụ thể.
        </p>
      </el-form-item>
      <el-form-item label="model (tuỳ chọn)">
        <el-input v-model="billingModel" placeholder="Một số proxy yêu cầu billing model, ví dụ volc-asset; kết nối trực tiếp chính thức có thể để trống" clearable />
      </el-form-item>
      <el-form-item label="Điền từ cấu hình">
        <el-select
          v-model="fillConfigId"
          filterable
          clearable
          placeholder="Chọn cấu hình video đã lưu (Volcano, v.v.)"
          style="width: 100%"
          @change="onFillFromSaved"
        >
          <el-option
            v-for="c in videoLikeConfigs"
            :key="c.id"
            :label="`${c.name} · ${c.base_url || ''}`"
            :value="c.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="Asset Group Id mặc định">
        <el-input
          v-model="assetGroupIdForCert"
          placeholder="SD2 auth ở trang sáng tạo sẽ ghi vào group này; có thể chọn asset group bên trái để tự điền"
          clearable
        />
        <p class="field-hint">Bắt buộc khi lưu vào cấu hình AI. Cùng group Id với danh sách "Asset" bên dưới.</p>
      </el-form-item>
      <el-form-item label=" ">
        <div class="sd2-save-row">
          <el-button type="primary" :loading="savingConfig" @click="saveToAiConfig">
            Lưu vào cấu hình AI
          </el-button>
          <span v-if="savedConfigId" class="sd2-saved-hint">
            Đã liên kết cấu hình #{{ savedConfigId }} (SD2 auth trang sáng tạo dùng khi chưa cấu hình "Jimeng2 character auth")
          </span>
        </div>
      </el-form-item>
    </el-form>

    <el-row :gutter="16">
      <el-col :span="11">
        <div class="panel-title">Asset Group</div>
        <div class="panel-actions">
          <el-button type="primary" size="small" :loading="loadingGroups" @click="refreshGroups">Làm mới danh sách</el-button>
          <el-button type="success" size="small" @click="openCreateGroup">Tạo group</el-button>
        </div>
        <el-table
          :data="groupRows"
          size="small"
          stripe
          highlight-current-row
          max-height="320"
          @current-change="onGroupRowChange"
        >
          <el-table-column prop="Id" label="Id" min-width="120" show-overflow-tooltip />
          <el-table-column prop="Name" label="Tên" min-width="100" show-overflow-tooltip />
          <el-table-column label="Thao tác" width="168" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="getGroupDetail(row)">Chi tiết</el-button>
              <el-button link type="primary" size="small" @click="openEditGroup(row)">Sửa</el-button>
              <el-button link type="danger" size="small" @click="deleteGroup(row)">Xoá</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-col>
      <el-col :span="13">
        <div class="panel-title">Asset (cần Group Id)</div>
        <div class="panel-actions row-gap">
          <el-input v-model="assetGroupIdInput" placeholder="Group Id, hoặc chọn một dòng bên trái" clearable style="flex: 1; min-width: 140px" />
          <el-button type="primary" size="small" :loading="loadingAssets" @click="refreshAssets">Làm mới</el-button>
          <el-button type="success" size="small" @click="openCreateAsset">Tạo asset</el-button>
        </div>
        <el-table :data="assetRows" size="small" stripe max-height="320">
          <el-table-column prop="Id" label="Id" min-width="120" show-overflow-tooltip />
          <el-table-column prop="Name" label="Tên" min-width="90" show-overflow-tooltip />
          <el-table-column prop="AssetType" label="Loại" width="88" />
          <el-table-column label="Thao tác" width="168" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="getAssetDetail(row)">Chi tiết</el-button>
              <el-button link type="primary" size="small" @click="openEditAsset(row)">Sửa</el-button>
              <el-button link type="danger" size="small" @click="deleteAsset(row)">Xoá</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-col>
    </el-row>

    <div class="panel-title" style="margin-top: 16px">Response gần nhất (debug)</div>
    <el-input v-model="lastRawJson" type="textarea" :rows="6" readonly class="mono" />

    <!-- Tạo asset group -->
    <el-dialog v-model="dlgGroupCreate" title="CreateAssetGroup" width="480px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="Name" required>
          <el-input v-model="formGroupName" placeholder="Tên asset group" />
        </el-form-item>
        <el-form-item label="JSON mở rộng">
          <el-input v-model="formGroupExtraJson" type="textarea" :rows="3" placeholder='Tuỳ chọn, merge vào request body, ví dụ {"Description":"..."}' />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgGroupCreate = false">Huỷ</el-button>
        <el-button type="primary" :loading="dlgLoading" @click="submitCreateGroup">Gửi</el-button>
      </template>
    </el-dialog>

    <!-- Sửa asset group -->
    <el-dialog v-model="dlgGroupEdit" title="UpdateAssetGroup" width="520px" destroy-on-close>
      <el-alert type="warning" :closable="false" title="Điền các field cần cập nhật theo tài liệu chính thức; bên dưới là sửa tên thông dụng." style="margin-bottom: 12px" />
      <el-form label-width="100px">
        <el-form-item label="Id" required>
          <el-input v-model="editGroupId" disabled />
        </el-form-item>
        <el-form-item label="Name">
          <el-input v-model="editGroupName" />
        </el-form-item>
        <el-form-item label="JSON đầy đủ">
          <el-input v-model="editGroupFullJson" type="textarea" :rows="6" placeholder='Nếu điền thì sẽ ưu tiên dùng nguyên đoạn làm request body (phải có Id)' />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgGroupEdit = false">Huỷ</el-button>
        <el-button type="primary" :loading="dlgLoading" @click="submitUpdateGroup">Gửi</el-button>
      </template>
    </el-dialog>

    <!-- Tạo asset -->
    <el-dialog v-model="dlgAssetCreate" title="CreateAsset" width="520px" destroy-on-close>
      <el-form label-width="110px">
        <el-form-item label="GroupId" required>
          <el-input v-model="formAssetGroupId" placeholder="Asset Group Id" />
        </el-form-item>
        <el-form-item label="Name" required>
          <el-input v-model="formAssetName" />
        </el-form-item>
        <el-form-item label="AssetType">
          <el-select v-model="formAssetType" style="width: 100%">
            <el-option label="Image" value="Image" />
            <el-option label="Video" value="Video" />
            <el-option label="Audio" value="Audio" />
          </el-select>
        </el-form-item>
        <el-form-item label="model">
          <el-input v-model="formAssetModel" placeholder="Video nên dùng volc-asset-video; audio dùng volc-asset-audio; ảnh có thể để trống" clearable />
        </el-form-item>
        <el-form-item label="URL">
          <el-input v-model="formAssetUrl" type="textarea" :rows="2" placeholder="URL public / data:image/...;base64,..." />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgAssetCreate = false">Huỷ</el-button>
        <el-button type="primary" :loading="dlgLoading" @click="submitCreateAsset">Gửi</el-button>
      </template>
    </el-dialog>

    <!-- Sửa asset -->
    <el-dialog v-model="dlgAssetEdit" title="UpdateAsset" width="520px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="Id" required>
          <el-input v-model="editAssetId" disabled />
        </el-form-item>
        <el-form-item label="Name">
          <el-input v-model="editAssetName" />
        </el-form-item>
        <el-form-item label="JSON đầy đủ">
          <el-input v-model="editAssetFullJson" type="textarea" :rows="6" placeholder="Nếu điền thì dùng nguyên đoạn làm request body (phải có Id)" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgAssetEdit = false">Huỷ</el-button>
        <el-button type="primary" :loading="dlgLoading" @click="submitUpdateAsset">Gửi</el-button>
      </template>
    </el-dialog>

    <!-- JSON chi tiết -->
    <el-dialog v-model="dlgDetail" title="Chi tiết" width="640px" destroy-on-close>
      <el-input :model-value="detailJson" type="textarea" :rows="16" readonly class="mono" />
      <template #footer>
        <el-button type="primary" @click="dlgDetail = false">Đóng</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { aiAPI } from '@/api/ai'

const props = defineProps({
  /** Danh sách cấu hình AI (đồng nguồn với trang AI Config), dùng để điền nhanh Base / Key */
  configs: { type: Array, default: () => [] },
})

const emit = defineEmits(['saved'])

const baseUrl = ref('')
const apiKey = ref('')
const pathMode = ref('open_api_query')
const apiVersion = ref('2024-01-01')
/** Query param tuỳ chọn ProjectName cho OpenAPI (ứng với project trên console, giúp IAM chính xác tới project/tên_project cụ thể thay vì project/*) */
const projectName = ref('')
const authMode = ref('volc_sign')
const accessKeyId = ref('')
const secretAccessKey = ref('')
const signRegion = ref('')
/** Chỉ merge vào request List / Create, tránh ảnh hưởng Get/Update/Delete */
const billingModel = ref('')
const fillConfigId = ref(null)
const savedConfigId = ref(null)
const savingConfig = ref(false)
/** Asset group mà SD2 auth trang sáng tạo ghi vào mặc định */
const assetGroupIdForCert = ref('')
const loadingGroups = ref(false)
const loadingAssets = ref(false)
const dlgLoading = ref(false)
const lastRawJson = ref('')
const assetGroupIdInput = ref('')
const lastListGroupsPayload = ref(null)
const lastListAssetsPayload = ref(null)

const dlgGroupCreate = ref(false)
const formGroupName = ref('')
const formGroupExtraJson = ref('')

const dlgGroupEdit = ref(false)
const editGroupId = ref('')
const editGroupName = ref('')
const editGroupFullJson = ref('')

const dlgAssetCreate = ref(false)
const formAssetGroupId = ref('')
const formAssetName = ref('')
const formAssetType = ref('Image')
const formAssetModel = ref('')
const formAssetUrl = ref('')

const dlgAssetEdit = ref(false)
const editAssetId = ref('')
const editAssetName = ref('')
const editAssetFullJson = ref('')

const dlgDetail = ref(false)
const detailJson = ref('')

const videoLikeConfigs = computed(() => {
  const rows = props.configs || []
  return rows.filter((c) => {
    if (c.service_type !== 'video') return false
    const u = (c.base_url || '').toLowerCase()
    const p = (c.api_protocol || '').toLowerCase()
    return (
      p.includes('volc') ||
      u.includes('volces.com') ||
      u.includes('byteplus') ||
      u.includes('byteplustech') ||
      u.includes('/ark')
    )
  })
})

const savedModelArkConfigs = computed(() => {
  return (props.configs || []).filter((c) => c.service_type === 'model_ark_asset')
})

function parseSettingsJson(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function loadFromSavedRow(row) {
  if (!row) return
  savedConfigId.value = row.id
  baseUrl.value = (row.base_url || '').replace(/\/$/, '')
  apiKey.value = row.api_key || ''
  const s = parseSettingsJson(row.settings)
  authMode.value = s.auth_mode || 'volc_sign'
  pathMode.value = s.path_mode || 'open_api_query'
  apiVersion.value = s.api_version || '2024-01-01'
  projectName.value = s.project_name || ''
  billingModel.value = s.billing_model || ''
  assetGroupIdForCert.value = s.asset_group_id || ''
  accessKeyId.value = s.access_key_id || ''
  secretAccessKey.value = s.secret_access_key || ''
  signRegion.value = s.sign_region || ''
  if (assetGroupIdForCert.value) assetGroupIdInput.value = assetGroupIdForCert.value
}

function applyDefaultSavedConfig() {
  const rows = savedModelArkConfigs.value
  if (!rows.length) return
  const pick = rows.find((c) => c.is_default) || rows[0]
  loadFromSavedRow(pick)
}

watch(
  () => props.configs,
  () => {
    if (!savedConfigId.value) applyDefaultSavedConfig()
    else {
      const row = (props.configs || []).find((c) => c.id === savedConfigId.value)
      if (row) loadFromSavedRow(row)
    }
  },
  { immediate: true }
)

onMounted(() => {
  applyDefaultSavedConfig()
})

async function saveToAiConfig() {
  const w = connWarn()
  if (!connReady() || w) {
    ElMessage.warning(w || 'Vui lòng hoàn tất thông tin kết nối trước')
    return
  }
  if (!assetGroupIdForCert.value.trim()) {
    ElMessage.warning('Vui lòng điền Asset Group Id mặc định (SD2 auth trang sáng tạo cần)')
    return
  }
  const settings = {
    auth_mode: authMode.value,
    path_mode: pathMode.value,
    api_version: apiVersion.value.trim() || '2024-01-01',
    project_name: projectName.value.trim(),
    billing_model: billingModel.value.trim(),
    asset_group_id: assetGroupIdForCert.value.trim(),
  }
  if (authMode.value === 'volc_sign') {
    settings.access_key_id = accessKeyId.value.trim()
    settings.secret_access_key = secretAccessKey.value.trim()
    if (signRegion.value.trim()) settings.sign_region = signRegion.value.trim()
  }
  const payload = {
    service_type: 'model_ark_asset',
    name: 'SD2 Asset Library',
    provider: 'model_ark',
    base_url: baseUrl.value.trim(),
    api_key: authMode.value === 'bearer' ? apiKey.value : '',
    model: ['-'],
    default_model: '-',
    priority: 10,
    is_default: true,
    settings: JSON.stringify(settings),
  }
  savingConfig.value = true
  try {
    if (savedConfigId.value) {
      await aiAPI.update(savedConfigId.value, payload)
      ElMessage.success('Đã cập nhật cấu hình AI')
    } else {
      const created = await aiAPI.create(payload)
      savedConfigId.value = created?.id ?? null
      ElMessage.success('Đã lưu vào cấu hình AI')
    }
    emit('saved')
  } catch (_) {
    /* request đã báo lỗi thống nhất */
  } finally {
    savingConfig.value = false
  }
}

function setLastJson(obj) {
  try {
    lastRawJson.value = JSON.stringify(obj, null, 2)
  } catch (_) {
    lastRawJson.value = String(obj)
  }
}

function extractRows(resp) {
  if (!resp) return []
  if (Array.isArray(resp)) return resp
  const keys = [
    'Items',
    'List',
    'AssetGroups',
    'Assets',
    'Groups',
    'Data',
  ]
  for (const k of keys) {
    if (Array.isArray(resp[k])) return resp[k]
  }
  const r = resp.Result || resp.result
  if (r && typeof r === 'object') {
    for (const k of keys) {
      if (Array.isArray(r[k])) return r[k]
    }
  }
  return []
}

const groupRows = computed(() => extractRows(lastListGroupsPayload.value))
const assetRows = computed(() => extractRows(lastListAssetsPayload.value))

function onFillFromSaved(id) {
  if (id == null || id === '') return
  const c = (props.configs || []).find((x) => x.id === id)
  if (!c) return
  baseUrl.value = (c.base_url || '').replace(/\/$/, '')
  apiKey.value = c.api_key || ''
  ElMessage.success('Đã điền Base URL và API Key từ cấu hình đã chọn')
}

function onGroupRowChange(row) {
  if (row && row.Id) {
    assetGroupIdInput.value = row.Id
    if (!assetGroupIdForCert.value.trim()) assetGroupIdForCert.value = row.Id
  }
}

function mergeBillingModel(payload, withModel) {
  const p = { ...(payload || {}) }
  if (withModel && billingModel.value.trim() && !String(p.model || '').trim()) {
    p.model = billingModel.value.trim()
  }
  return p
}

function connReady() {
  if (!baseUrl.value.trim()) return false
  if (authMode.value === 'volc_sign') {
    return !!(accessKeyId.value.trim() && secretAccessKey.value.trim())
  }
  return !!apiKey.value.trim()
}

function connWarn() {
  if (!baseUrl.value.trim()) return 'Vui lòng điền Base URL trước'
  if (authMode.value === 'volc_sign') {
    if (!accessKeyId.value.trim() || !secretAccessKey.value.trim()) {
      return 'OpenAPI chính thức cần điền Access Key ID và Secret Access Key (IAM trên console, không phải API Key inference)'
    }
  } else if (!apiKey.value.trim()) {
    return 'Vui lòng điền API Key trước'
  }
  if (authMode.value === 'volc_sign' && pathMode.value !== 'open_api_query') {
    return 'Ký AK/SK cần đi kèm với path mode "OpenAPI chính thức"'
  }
  return ''
}

async function call(action, payload, opts = {}) {
  const { withBillingModel = false } = opts
  const body = {
    base_url: baseUrl.value.trim(),
    action,
    path_mode: pathMode.value,
    api_version: apiVersion.value.trim() || undefined,
    auth_mode: authMode.value,
    payload: mergeBillingModel(payload, withBillingModel),
  }
  if (pathMode.value === 'open_api_query' && projectName.value.trim()) {
    body.project_name = projectName.value.trim()
  }
  if (authMode.value === 'bearer') {
    body.api_key = apiKey.value
  } else {
    body.access_key_id = accessKeyId.value.trim()
    body.secret_access_key = secretAccessKey.value.trim()
    if (signRegion.value.trim()) body.sign_region = signRegion.value.trim()
  }
  return aiAPI.modelArkAsset(body)
}

async function refreshGroups() {
  const w = connWarn()
  if (!connReady() || w) {
    ElMessage.warning(w || 'Vui lòng hoàn tất thông tin kết nối trước')
    return
  }
  loadingGroups.value = true
  try {
    const body = {
      PageNumber: 1,
      PageSize: 50,
      /** Filter, Filter.GroupType đều bắt buộc cho ListAssetGroups chính thức; AIGC là loại thường dùng cho private asset library */
      Filter: {
        GroupType: 'AIGC',
      },
    }
    const data = await call('ListAssetGroups', body, { withBillingModel: true })
    lastListGroupsPayload.value = data
    setLastJson(data)
  } catch (e) {
    lastListGroupsPayload.value = null
  } finally {
    loadingGroups.value = false
  }
}

async function refreshAssets() {
  const gid = assetGroupIdInput.value.trim()
  const w = connWarn()
  if (!connReady() || w) {
    ElMessage.warning(w || 'Vui lòng hoàn tất thông tin kết nối trước')
    return
  }
  if (!gid) {
    ElMessage.warning('Vui lòng điền hoặc chọn Asset Group Id')
    return
  }
  loadingAssets.value = true
  try {
    const body = {
      PageNumber: 1,
      PageSize: 50,
      Filter: {
        GroupType: 'AIGC',
        GroupIds: [gid],
      },
    }
    const data = await call('ListAssets', body, { withBillingModel: true })
    lastListAssetsPayload.value = data
    setLastJson(data)
  } catch (e) {
    lastListAssetsPayload.value = null
  } finally {
    loadingAssets.value = false
  }
}

function openCreateGroup() {
  formGroupName.value = ''
  formGroupExtraJson.value = ''
  dlgGroupCreate.value = true
}

async function submitCreateGroup() {
  if (!formGroupName.value.trim()) {
    ElMessage.warning('Vui lòng điền Name')
    return
  }
  dlgLoading.value = true
  try {
    let extra = {}
    if (formGroupExtraJson.value.trim()) {
      try {
        extra = JSON.parse(formGroupExtraJson.value)
      } catch (_) {
        ElMessage.error('JSON mở rộng không hợp lệ')
        return
      }
    }
    const payload = { Name: formGroupName.value.trim(), ...extra }
    const data = await call('CreateAssetGroup', payload, { withBillingModel: true })
    setLastJson(data)
    ElMessage.success('Đã tạo')
    dlgGroupCreate.value = false
    await refreshGroups()
  } finally {
    dlgLoading.value = false
  }
}

async function getGroupDetail(row) {
  dlgLoading.value = true
  try {
    const data = await call('GetAssetGroup', { Id: row.Id })
    detailJson.value = JSON.stringify(data, null, 2)
    dlgDetail.value = true
    setLastJson(data)
  } finally {
    dlgLoading.value = false
  }
}

function openEditGroup(row) {
  editGroupId.value = row.Id
  editGroupName.value = row.Name || ''
  editGroupFullJson.value = ''
  dlgGroupEdit.value = true
}

async function submitUpdateGroup() {
  dlgLoading.value = true
  try {
    let payload
    if (editGroupFullJson.value.trim()) {
      try {
        payload = JSON.parse(editGroupFullJson.value)
      } catch (_) {
        ElMessage.error('JSON đầy đủ không hợp lệ')
        return
      }
    } else {
      payload = { Id: editGroupId.value, Name: editGroupName.value }
    }
    const data = await call('UpdateAssetGroup', payload)
    setLastJson(data)
    ElMessage.success('Đã cập nhật')
    dlgGroupEdit.value = false
    await refreshGroups()
  } finally {
    dlgLoading.value = false
  }
}

async function deleteGroup(row) {
  try {
    await ElMessageBox.confirm(`Bạn có chắc muốn xoá asset group "${row.Name || row.Id}"?`, 'DeleteAssetGroup', {
      type: 'warning',
    })
  } catch (_) {
    return
  }
  dlgLoading.value = true
  try {
    const data = await call('DeleteAssetGroup', { Id: row.Id })
    setLastJson(data)
    ElMessage.success('Đã xoá')
    if (assetGroupIdInput.value === row.Id) assetGroupIdInput.value = ''
    await refreshGroups()
  } finally {
    dlgLoading.value = false
  }
}

function openCreateAsset() {
  formAssetGroupId.value = assetGroupIdInput.value.trim()
  formAssetName.value = ''
  formAssetType.value = 'Image'
  formAssetModel.value = ''
  formAssetUrl.value = ''
  dlgAssetCreate.value = true
}

async function submitCreateAsset() {
  if (!formAssetGroupId.value.trim() || !formAssetName.value.trim()) {
    ElMessage.warning('Vui lòng điền GroupId và Name')
    return
  }
  dlgLoading.value = true
  try {
    const payload = {
      GroupId: formAssetGroupId.value.trim(),
      Name: formAssetName.value.trim(),
      AssetType: formAssetType.value,
    }
    if (formAssetUrl.value.trim()) payload.URL = formAssetUrl.value.trim()
    if (formAssetModel.value.trim()) payload.model = formAssetModel.value.trim()
    const data = await call('CreateAsset', payload, { withBillingModel: true })
    setLastJson(data)
    ElMessage.success('Đã tạo')
    dlgAssetCreate.value = false
    await refreshAssets()
  } finally {
    dlgLoading.value = false
  }
}

async function getAssetDetail(row) {
  dlgLoading.value = true
  try {
    const data = await call('GetAsset', { Id: row.Id })
    detailJson.value = JSON.stringify(data, null, 2)
    dlgDetail.value = true
    setLastJson(data)
  } finally {
    dlgLoading.value = false
  }
}

function openEditAsset(row) {
  editAssetId.value = row.Id
  editAssetName.value = row.Name || ''
  editAssetFullJson.value = ''
  dlgAssetEdit.value = true
}

async function submitUpdateAsset() {
  dlgLoading.value = true
  try {
    let payload
    if (editAssetFullJson.value.trim()) {
      try {
        payload = JSON.parse(editAssetFullJson.value)
      } catch (_) {
        ElMessage.error('JSON đầy đủ không hợp lệ')
        return
      }
    } else {
      payload = { Id: editAssetId.value, Name: editAssetName.value }
    }
    const data = await call('UpdateAsset', payload)
    setLastJson(data)
    ElMessage.success('Đã cập nhật')
    dlgAssetEdit.value = false
    await refreshAssets()
  } finally {
    dlgLoading.value = false
  }
}

async function deleteAsset(row) {
  try {
    await ElMessageBox.confirm(`Bạn có chắc muốn xoá asset "${row.Name || row.Id}"?`, 'DeleteAsset', { type: 'warning' })
  } catch (_) {
    return
  }
  dlgLoading.value = true
  try {
    const data = await call('DeleteAsset', { Id: row.Id })
    setLastJson(data)
    ElMessage.success('Đã xoá')
    await refreshAssets()
  } finally {
    dlgLoading.value = false
  }
}
</script>

<style scoped>
.sd2-asset-mgmt {
  max-width: 1100px;
}
.sd2-intro {
  margin-bottom: 14px;
}
.sd2-intro code {
  font-size: 12px;
}
.sd2-form {
  margin-bottom: 8px;
  max-width: 720px;
}
.field-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.field-hint code {
  font-size: 11px;
}
.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}
.panel-actions.row-gap {
  flex-wrap: nowrap;
}
.mono :deep(textarea) {
  font-family: Menlo, Consolas, monospace;
  font-size: 12px;
}
.sd2-save-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
.sd2-saved-hint {
  font-size: 12px;
  color: #67c23a;
  line-height: 1.5;
}
</style>

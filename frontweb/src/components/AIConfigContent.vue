<template>
  <div class="ai-config-content">
    <el-tabs v-model="activeTab" class="config-tabs">
      <el-tab-pane label="Cấu hình AI" name="configs">
        <div class="tab-content">
          <!-- Chế độ thường -->
          <div v-if="!vendorLock.enabled" class="content-actions">
            <div class="actions-left">
              <el-button type="primary" @click="openAdd">
                <el-icon><Plus /></el-icon>
                Thêm cấu hình
              </el-button>
              <el-button plain @click="exportConfigs">
                <el-icon><Download /></el-icon>
                Xuất cấu hình
              </el-button>
              <el-button plain @click="triggerImport">
                <el-icon><Upload /></el-icon>
                Nhập cấu hình
              </el-button>
              <input ref="importFileRef" type="file" accept=".json" style="display:none" @change="importConfigs" />
              <el-button type="success" plain @click="openOneKeyVolc">
                <el-icon><MagicStick /></el-icon>
                Cấu hình nhanh Volcengine
              </el-button>
              <el-button type="success" plain @click="openOneKeyAgnes">
                <el-icon><MagicStick /></el-icon>
                Cấu hình nhanh Agnes
              </el-button>
              <el-button type="info" plain @click="openOneKeyTongyi">
                <el-icon><MagicStick /></el-icon>
                Cấu hình nhanh Tongyi
                <span class="one-key-not-recommended">Không khuyến nghị</span>
              </el-button>
            </div>
            <div class="actions-right">
              <transition name="fade-slide">
                <el-button
                  v-if="selectedRows.length > 0"
                  type="danger"
                  :loading="batchDeleting"
                  @click="onBatchDelete"
                >
                  <el-icon><Delete /></el-icon>
                  Xoá đã chọn ({{ selectedRows.length }})
                </el-button>
              </transition>
            </div>
          </div>
          <!-- Chế độ khoá provider -->
          <div v-else class="vendor-lock-bar">
            <el-alert
              type="info"
              :closable="false"
              class="vendor-lock-tip"
            >
              <template #title>
                <span>🔒 Đang ở chế độ khoá provider, dịch vụ AI do admin cấu hình chung. Bạn chỉ có thể sửa <b>API Key</b> và <b>model mặc định</b>.</span>
              </template>
            </el-alert>
            <el-button type="primary" size="small" class="vendor-bulk-key-btn" @click="openBulkKey">
              <el-icon><Key /></el-icon>
              Đổi Key hàng loạt
            </el-button>
          </div>
          <p class="default-tip">Mỗi loại dịch vụ chỉ có một cấu hình mặc định: text dùng để tạo kịch bản; text-to-image dùng cho ảnh nhân vật/scene/đạo cụ; storyboard image dùng cho ảnh storyboard (hỗ trợ ảnh tham chiếu); video dùng để tạo video; TTS dùng cho lồng tiếng storyboard; Jimeng2 character auth dùng cho SD2 auth ở trang sáng tạo (gateway Token); SD2 asset dùng cho tài sản riêng của ModelArk chính thức (dùng cho SD2 auth khi chưa cấu hình Jimeng2 character auth).</p>
          <el-table
            v-loading="loading"
            :data="list"
            stripe
            style="width: 100%"
            @selection-change="onSelectionChange"
          >
            <el-table-column v-if="!vendorLock.enabled" type="selection" width="46" />
            <el-table-column prop="name" label="Tên" min-width="130" />
            <el-table-column prop="provider" label="Provider" width="96" />
            <el-table-column prop="base_url" label="Base URL" min-width="170" show-overflow-tooltip />
            <el-table-column prop="default_model" label="Model mặc định" min-width="130" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.default_model || (Array.isArray(row.model) && row.model[0]) || '—' }}
              </template>
            </el-table-column>
            <el-table-column prop="service_type" label="Loại" width="148">
              <template #default="{ row }">
                <span :class="['type-badge', 'type-' + row.service_type]">
                  <el-icon class="type-icon">
                    <ChatDotRound v-if="row.service_type === 'text'" />
                    <Picture v-else-if="row.service_type === 'image'" />
                    <Film v-else-if="row.service_type === 'storyboard_image'" />
                    <VideoCamera v-else-if="row.service_type === 'video'" />
                    <Microphone v-else-if="row.service_type === 'tts'" />
                    <Key v-else-if="row.service_type === 'jimeng2_character_auth'" />
                    <Folder v-else-if="row.service_type === 'model_ark_asset'" />
                  </el-icon>
                  {{ serviceTypeLabel(row.service_type) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="is_default" label="Mặc định" width="60">
              <template #default="{ row }">
                <el-tag v-if="row.is_default" type="success" size="small">✓</el-tag>
                <span v-else class="no-default">—</span>
              </template>
            </el-table-column>
            <el-table-column label="Thao tác" width="180" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openTest(row)">Test</el-button>
                <el-button link type="primary" size="small" @click="onRowEdit(row)">{{ vendorLock.enabled ? 'Sửa Key' : 'Sửa' }}</el-button>
                <el-button v-if="!vendorLock.enabled" link type="danger" size="small" @click="onDelete(row)">Xoá</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
      <el-tab-pane label="Prompt nâng cao" name="prompts">
        <div class="tab-content">
          <PromptEditor />
        </div>
      </el-tab-pane>
      <el-tab-pane label="Scene nghiệp vụ" name="sceneModelMap">
        <div class="tab-content">
          <SceneModelMap />
        </div>
      </el-tab-pane>
      <el-tab-pane label="Cài đặt Generate" name="generation">
        <div class="tab-content generation-settings">
          <div class="gs-section-title">⚡ Cài đặt concurrency generate</div>
          <p class="gs-desc">Điều khiển số lượng task chạy song song trong pipeline "Tạo video nhanh" và "Bổ sung và tạo". Concurrency càng cao càng nhanh, nhưng quá cao có thể trigger rate limit của API (lỗi 429). Chọn theo quota API của bạn.</p>

          <div class="gs-row">
            <span class="gs-label">Concurrency ảnh</span>
            <el-select
              v-model="genConcurrencyInput"
              filterable
              allow-create
              default-first-option
              placeholder="Chọn hoặc nhập concurrency"
              style="width: 180px"
              @change="onConcurrencyChange"
            >
              <el-option label="1 (tuần tự, ổn định nhất)" :value="1" />
              <el-option label="2" :value="2" />
              <el-option label="3 (mặc định)" :value="3" />
              <el-option label="5" :value="5" />
              <el-option label="8" :value="8" />
              <el-option label="10" :value="10" />
            </el-select>
            <span class="gs-unit">task chạy đồng thời</span>
          </div>

          <div class="gs-row" style="margin-top: 10px">
            <span class="gs-label">Concurrency video</span>
            <el-select
              v-model="genVideoConcurrencyInput"
              filterable
              allow-create
              default-first-option
              placeholder="Chọn hoặc nhập concurrency"
              style="width: 180px"
              @change="onVideoConcurrencyChange"
            >
              <el-option label="1 (tuần tự, ổn định nhất)" :value="1" />
              <el-option label="2" :value="2" />
              <el-option label="3 (mặc định)" :value="3" />
              <el-option label="5" :value="5" />
              <el-option label="8" :value="8" />
              <el-option label="10" :value="10" />
            </el-select>
            <span class="gs-unit">task chạy đồng thời</span>
          </div>

          <div style="margin-top: 14px">
            <el-button
              type="primary"
              size="small"
              :loading="genSettingSaving"
              @click="saveGenerationSettings"
            >Lưu</el-button>
          </div>
          <el-alert
            v-if="genSettingSaved"
            type="success"
            title="Đã lưu"
            :closable="false"
            show-icon
            style="margin-top: 12px; width: fit-content"
          />
          <div class="gs-tip-box">
            <div class="gs-tip-title">📌 Phạm vi áp dụng</div>
            <ul class="gs-tip-list">
              <li>Concurrency ảnh: bước 2 ảnh nhân vật, bước 4 ảnh scene, bước 6 ảnh storyboard</li>
              <li>Concurrency video: bước 7 video storyboard</li>
            </ul>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="Asset SD2" name="sd2_assets">
        <div class="tab-content">
          <Sd2AssetManagement :configs="list" @saved="loadList" />
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- Thêm/Sửa -->
    <el-dialog
      v-model="dialogVisible"
      :title="vendorLock.enabled ? 'Sửa API Key / Model mặc định' : (editingId ? 'Sửa cấu hình' : 'Thêm cấu hình')"
      width="520px"
      :close-on-click-modal="false"
      @closed="resetForm"
    >
      <!-- Chế độ khoá: chỉ hiển thị api_key và default_model -->
      <template v-if="vendorLock.enabled">
        <el-descriptions :column="1" border style="margin-bottom: 16px">
          <el-descriptions-item label="Tên">{{ form.name }}</el-descriptions-item>
          <el-descriptions-item label="Loại">{{ serviceTypeLabel(form.service_type) }}</el-descriptions-item>
          <el-descriptions-item label="Provider">{{ form.provider }}</el-descriptions-item>
        </el-descriptions>
        <el-form ref="formRef" :model="form" label-width="100px">
          <el-form-item prop="api_key" :rules="[{ required: true, message: 'Vui lòng nhập API Key', trigger: 'blur' }]">
            <template #label><span class="form-label-tip">API Key</span></template>
            <el-input
              v-model="form.api_key"
              type="password"
              :placeholder="form.provider === 'jimeng_ai_api' ? 'Jimeng Session, nhiều account phân cách bằng dấu phẩy' : 'Nhập API key của bạn'"
              show-password
            />
          </el-form-item>
          <el-form-item>
            <template #label><span class="form-label-tip">Model mặc định</span></template>
            <el-select v-model="form.default_model" clearable style="width: 100%">
              <el-option v-for="m in formModelList" :key="m" :label="m" :value="m" />
            </el-select>
            <p class="field-tip">Model dùng khi gọi thực tế, có thể chọn từ danh sách preset.</p>
          </el-form-item>
          <el-form-item>
            <template #label>
              <span class="form-label-tip">Đặt làm mặc định
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      Mỗi loại dịch vụ chỉ có một cấu hình "mặc định".<br>
                      Khi generate, hệ thống ưu tiên dùng cấu hình mặc định, nên set ít nhất một cấu hình mặc định cho mỗi loại.
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-switch v-model="form.is_default" />
          </el-form-item>
        </el-form>
      </template>

      <!-- Chế độ thường: form đầy đủ -->
      <el-form v-else ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item prop="service_type">
          <template #label>
            <span class="form-label-tip">Loại dịch vụ
              <el-tooltip placement="top" :show-arrow="true" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    <b>Text/Chat</b>: dùng cho AI tạo kịch bản<br>
                    <b>Text to image</b>: tạo ảnh nhân vật, scene, đạo cụ (không hỗ trợ ảnh tham chiếu)<br>
                    <b>Storyboard image</b>: tạo ảnh storyboard, hỗ trợ ảnh tham chiếu nhân vật<br>
                    <b>Video generation</b>: tạo video clip từ ảnh storyboard<br>
                    <b>TTS</b>: tự động tạo voice cho lời thoại storyboard (dùng khi bấm nút lồng tiếng storyboard)<br>
                    <b>Jimeng2 character auth</b>: đăng ký ảnh chính của nhân vật vào thư viện tư liệu Jimeng (SD2 auth), chỉ điền gateway URL và Token
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select v-model="form.service_type" placeholder="Chọn loại" style="width: 100%" @change="onServiceTypeChange">
            <el-option label="Text/Chat" value="text" />
            <el-option label="Text to image" value="image" />
            <el-option label="Storyboard image" value="storyboard_image" />
            <el-option label="Video generation" value="video" />
            <el-option label="TTS" value="tts" />
            <el-option label="Jimeng2 character auth" value="jimeng2_character_auth" />
          </el-select>
        </el-form-item>
        <el-form-item prop="provider">
          <template #label>
            <span class="form-label-tip">Provider
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    Chọn provider preset từ dropdown, Base URL và danh sách model sẽ tự điền.<br>
                    Hoặc nhập tên provider tuỳ chỉnh (cần điền thủ công các field khác).<br>
                    <b>Khuyến nghị</b>: Tongyi Qianwen / Volcengine, truy cập ổn định ở Trung Quốc.
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select
            v-model="form.provider"
            placeholder="Chọn provider preset (tự động điền URL và model)"
            clearable
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            @change="onProviderChange"
          >
            <el-option
              v-for="p in availableProviderOptions"
              :key="p.id"
              :label="p.name"
              :value="p.id"
              :class="p.id === '__custom__' ? 'provider-custom-option' : ''"
            />
          </el-select>
        </el-form-item>
        <!-- API protocol: chỉ hiển thị cho image/storyboard/video, provider preset sẽ auto-fill; provider tuỳ chỉnh bắt buộc chọn -->
        <el-form-item v-if="form.service_type !== 'text' && form.service_type !== 'tts' && form.service_type !== 'jimeng2_character_auth'">
          <template #label>
            <span class="form-label-tip">API protocol
              <el-icon class="tip-icon" style="cursor:pointer;color:#409eff" @click="showProtocolHelp = true"><QuestionFilled /></el-icon>
            </span>
          </template>
          <el-select v-model="form.api_protocol" style="width: 100%" placeholder="Chọn API protocol (provider tuỳ chỉnh bắt buộc)" clearable>
            <el-option label="OpenAI compatible (mặc định của hầu hết proxy)" value="openai" />
            <el-option label="Volcengine (Doubao Seedream / Seedance)" value="volcengine" />
            <el-option label="Volcengine Jimeng Seedance Omni (Ark multi-ref, Seedance 2.0...)" value="volcengine_omni" />
            <el-option label="Tongyi Wanxiang DashScope" value="dashscope" />
            <el-option label="Google Gemini (ảnh / Veo video)" value="gemini" />
            <el-option label="Sora proxy (multipart/form-data, seconds+size)" value="sora" />
            <el-option label="Veo3 compatible (JSON, images+enhance_prompt, auto dịch English)" value="veo3" />
            <el-option label="Vidu video" value="vidu" />
            <el-option label="Kling Omni-Video (chính thức api-beijing / ffir proxy, O1 omni)" value="kling_omni" />
            <el-option label="xAI Grok Imagine (chính thức prompt + aspect_ratio, /v1/videos/generations)" value="xai" />
            <el-option label="NanoBanana" value="nano_banana" />
          </el-select>
        </el-form-item>

        <!-- Dialog trợ giúp API protocol -->
        <el-dialog v-model="showProtocolHelp" title="Giải thích API protocol" width="700px" top="5vh">
          <div class="protocol-help">
            <div class="ph-section-title">🖼 Protocol ảnh / storyboard</div>
            <el-collapse accordion>
              <el-collapse-item name="openai-img">
                <template #title><span class="ph-tag ph-tag-img">Ảnh</span> OpenAI compatible — mặc định của hầu hết proxy</template>
                <div class="ph-body">
                  <b>Áp dụng cho:</b> OpenAI chính thức, các loại proxy (ChatFire, SiliconFlow...)<br>
                  <b>Endpoint:</b> <code>POST /v1/images/generations</code><br>
                  <pre>{ "model": "dall-e-3", "prompt": "...", "n": 1, "size": "1024x1024" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="volcengine-img">
                <template #title><span class="ph-tag ph-tag-img">Ảnh</span> Volcengine — Doubao Seedream</template>
                <div class="ph-body">
                  <b>Endpoint:</b> <code>POST /api/v3/images/generations</code><br>
                  <b>Base URL:</b> <code>https://ark.cn-beijing.volces.com/api/v3</code><br>
                  <pre>{ "model": "doubao-seedream-4-5-251128", "prompt": "...", "size": "1024x1024" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="dashscope-img">
                <template #title><span class="ph-tag ph-tag-img">Ảnh</span> Tongyi Wanxiang DashScope</template>
                <div class="ph-body">
                  <b>Base URL:</b> <code>https://dashscope.aliyuncs.com</code><br>
                  <b>Endpoint:</b> <code>POST /api/v1/services/aigc/text2image/image-synthesis</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="gemini-img">
                <template #title><span class="ph-tag ph-tag-img">Ảnh</span> Google Gemini</template>
                <div class="ph-body">
                  <b>Xác thực:</b> URL param <code>?key=API_KEY</code><br>
                  <b>Endpoint:</b> <code>POST /v1beta/models/{model}:generateContent</code>
                </div>
              </el-collapse-item>
            </el-collapse>

            <div class="ph-section-title" style="margin-top:16px">🎬 Protocol video</div>
            <el-collapse accordion>
              <el-collapse-item name="openai-vid">
                <template #title><span class="ph-tag ph-tag-vid">Video</span> OpenAI compatible — định dạng mảng content</template>
                <div class="ph-body">
                  <b>Áp dụng cho:</b> các loại proxy video (ChatFire...)<br>
                  <b>Endpoint:</b> tuỳ chỉnh, ví dụ <code>POST /v1/video/create</code><br>
                  <pre>{ "model": "sora-2-pro",
  "content": [
    { "type": "text", "text": "..." },
    { "type": "image_url", "image_url": { "url": "https://..." }, "role": "reference_image" }
  ],
  "ratio": "9:16", "duration": 5, "watermark": false, "resolution": "720p" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="sora-vid">
                <template #title><span class="ph-tag ph-tag-vid">Video</span> Sora proxy — multipart/form-data</template>
                <div class="ph-body">
                  <b>Áp dụng cho:</b> proxy dùng format Sora API<br>
                  <b>Endpoint mặc định:</b> <code>POST /v1/videos</code> (create), <code>GET /v1/videos/{taskId}</code> (query)<br>
                  <b>Định dạng request:</b> multipart/form-data (không phải JSON)<br>
                  <pre>model       = "sora-2"
prompt      = "..."
seconds     = "4" | "8" | "12"
size        = "720x1280" | "1280x720" | "1024x1792" | "1792x1024"
watermark   = "false"
private     = "false"
input_reference = (file ảnh, tuỳ chọn)</pre>
                  <b>Lưu ý:</b> ảnh tham chiếu sẽ tự động resize khớp với size trước khi upload.
                </div>
              </el-collapse-item>
              <el-collapse-item name="veo3-vid">
                <template #title><span class="ph-tag ph-tag-vid">Video</span> Veo3 compatible — images + enhance_prompt</template>
                <div class="ph-body">
                  <b>Áp dụng cho:</b> API JSON của các model dòng Veo3<br>
                  <b>Endpoint mặc định:</b> <code>POST /v1/video/create</code> (create), <code>GET /v1/video/query?id={taskId}</code> (query)<br>
                  <pre>{ "model": "veo3.1",
  "prompt": "...",
  "enhance_prompt": true,
  "images": ["data:image/jpeg;base64,..."]
}</pre>
                  <b>Lưu ý:</b> <code>enhance_prompt: true</code> sẽ tự động dịch prompt sang tiếng Anh. Ảnh localhost sẽ tự động convert sang base64 inline.
                </div>
              </el-collapse-item>
              <el-collapse-item name="volcengine-vid">
                <template #title><span class="ph-tag ph-tag-vid">Video</span> Volcengine — Doubao Seedance</template>
                <div class="ph-body">
                  <b>Endpoint:</b> <code>POST …/contents/generations/tasks</code> (khớp với backend)<br>
                  <b>Base URL:</b> <code>https://ark.cn-beijing.volces.com/api/v3</code><br>
                  <pre>{ "model": "doubao-seedance-1-5-pro-251215",
  "content": [{ "type": "text", "text": "..." }],
  "ratio": "9:16", "duration": 5,
  "watermark": false, "resolution": "720p" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="volcengine-omni-vid">
                <template #title><span class="ph-tag ph-tag-vid">Video</span> Volcengine Jimeng Seedance Omni (multi-ref)</template>
                <div class="ph-body">
                  <b>Áp dụng:</b> Ark Seedance 2.0... hỗ trợ pipeline omni với nhiều ảnh tham chiếu; dùng cùng storyboard "chế độ Omni", prompt <code>@image1</code>…<br>
                  <b>Endpoint:</b> <code>POST {base}/contents/generations/tasks</code>, poll <code>GET {base}/contents/generations/tasks/{taskId}</code><br>
                  <b>Provider:</b> vẫn chọn "Volcengine", <b>API protocol</b> chọn mục này; model điền endpoint console (ví dụ <code>doubao-seedance-2-0-260128</code>, dựa theo console).<br>
                  <pre>{ "model": "doubao-seedance-2-0-260128",
  "task_type": "i2v",
  "content": [
    { "type": "text", "text": "… @image1 … @image2 …" },
    { "type": "image_url", "image_url": { "url": "https://..." } },
    { "type": "image_url", "image_url": { "url": "https://..." }, "role": "reference_image" }
  ],
  "ratio": "9:16", "duration": 8, "watermark": false }</pre>
                  <b>Ghi chú:</b> ở chế độ Omni tất cả đều là ảnh tham chiếu (scene, nhân vật...), mỗi ảnh đều có <code>role: reference_image</code>; tối đa 9 ảnh, duration của Seedance 2.x snap 4-15 giây.
                </div>
              </el-collapse-item>
              <el-collapse-item name="dashscope-vid">
                <template #title><span class="ph-tag ph-tag-vid">Video</span> Tongyi Wanxiang DashScope</template>
                <div class="ph-body">
                  <b>Base URL:</b> <code>https://dashscope.aliyuncs.com</code><br>
                  <b>Endpoint:</b> <code>POST /api/v1/services/aigc/video-generation/video-synthesis</code><br>
                  <pre>{ "model": "wan2.2-kf2v-flash",
  "input": { "prompt": "...", "img_url": "https://..." },
  "parameters": { "size": "1280*720", "duration": 5 } }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="gemini-vid">
                <template #title><span class="ph-tag ph-tag-vid">Video</span> Google Gemini — Veo video</template>
                <div class="ph-body">
                  <b>Xác thực:</b> URL param <code>?key=API_KEY</code><br>
                  <b>Endpoint:</b> <code>POST /v1beta/models/{model}:generateVideo</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="vidu-vid">
                <template #title><span class="ph-tag ph-tag-vid">Video</span> Vidu</template>
                <div class="ph-body">
                  <b>Áp dụng cho:</b> Vidu chính thức và các API tương thích<br>
                  <b>Xác thực:</b> <code>Authorization: Token {api_key}</code> (không phải Bearer)<br>
                  <b>Endpoint mặc định:</b> <code>POST /ent/v2/img2video</code> (create), <code>GET /ent/v2/tasks/{taskId}/creations</code> (query)<br>
                  <pre>{ "model": "viduq3-pro",
  "images": ["https://..."],
  "prompt": "...",
  "duration": 5,
  "resolution": "720p",
  "movement_amplitude": "auto",
  "audio": false,
  "watermark": false
}</pre>
                  <b>Lưu ý:</b> api.vidu.cn chính thức dùng <code>Token</code>, proxy dùng <code>Bearer</code>, hệ thống tự nhận diện. Ảnh localhost tự upload lên image host.
                </div>
              </el-collapse-item>
              <el-collapse-item name="jimeng-ai-api-vid">
                <template #title><span class="ph-tag ph-tag-vid">Video</span> Jimeng AI API (self-hosted)</template>
                <div class="ph-body">
                  <b>Giải thích:</b> cần tự deploy <code>jimeng-free-api-all</code> hoặc dịch vụ Jimeng OpenAI-compatible tương tự (ví dụ <code>http://127.0.0.1:8000</code>). Hệ thống chỉ đóng vai trò client forward request.<br>
                  <b>Base URL:</b> điền địa chỉ root của dịch vụ, không kèm slash cuối.<br>
                  <b>API Key:</b> điền <b>Session</b> của Jimeng web; nhiều account phân cách bằng <b>dấu phẩy</b>, dịch vụ đối tác sẽ luân phiên dùng.<br>
                  <b>Path mặc định:</b> <code>POST /v1/videos/generations</code> (có thể override ở "Endpoint"). Seedance multi-image cần ảnh tham chiếu storyboard; response đồng bộ <code>data[0].url</code>.
                </div>
              </el-collapse-item>
            </el-collapse>
          </div>
          <template #footer>
            <el-button @click="showProtocolHelp = false">Đóng</el-button>
          </template>
        </el-dialog>
        <el-form-item prop="name">
          <template #label>
            <span class="form-label-tip">Tên
              <el-tooltip content="Tên hiển thị của cấu hình, dùng để phân biệt các cấu hình trong danh sách, có thể tự tạo sau khi chọn provider." placement="top" popper-class="cfg-tip-popper">
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input v-model="form.name" placeholder="Ví dụ: OpenAI text-image, có thể tự tạo" />
        </el-form-item>
        <el-form-item prop="base_url">
          <template #label>
            <span class="form-label-tip">{{ form.service_type === 'jimeng2_character_auth' ? 'Gateway URL' : 'Base URL' }}
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    <template v-if="form.service_type === 'jimeng2_character_auth'">
                      <b>Địa chỉ root</b> của gateway thư viện tư liệu Jimeng (không kèm path <code>/api/business/v1</code>). Phải khớp với deployment thực tế của thư viện tư liệu.
                    </template>
                    <template v-else>
                      Địa chỉ API endpoint, tự động điền sau khi chọn provider preset, thường không cần sửa.<br>
                      Ví dụ: https://dashscope.aliyuncs.com
                    </template>
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            v-model="form.base_url"
            :placeholder="form.service_type === 'jimeng2_character_auth' ? 'Ví dụ https://your-gateway.com' : 'Tự động điền sau khi chọn provider preset, có thể sửa'"
          />
        </el-form-item>
        <el-form-item prop="api_key">
          <template #label>
            <span class="form-label-tip">{{ form.service_type === 'jimeng2_character_auth' ? 'Token' : 'API Key' }}
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    <template v-if="form.service_type === 'jimeng2_character_auth'">
                      Token <code>Authorization: Bearer …</code> theo yêu cầu của thư viện tư liệu, được gateway hoặc Jimeng cấp.
                    </template>
                    <template v-else>
                      API key đăng ký ở platform AI tương ứng, dùng để xác thực.<br>
                      Tongyi: <b>dashscope.aliyuncs.com</b><br>
                      Volcengine: <b>console.volcengine.com/ark</b>
                    </template>
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            v-model="form.api_key"
            type="password"
            :placeholder="form.service_type === 'jimeng2_character_auth' ? 'Bearer Token' : (form.provider === 'jimeng_ai_api' ? 'Jimeng Session, nhiều account phân cách bằng dấu phẩy' : 'API key')"
            show-password
          />
        </el-form-item>
        <el-form-item v-if="form.service_type === 'jimeng2_character_auth'">
          <template #label><span class="form-label-tip">Danh sách tư liệu</span></template>
          <div class="jimeng2-assets-actions">
            <el-button type="primary" plain :loading="jimeng2AssetsLoading" @click="openJimeng2MaterialAssetsDialog">
              Liệt kê tư liệu
            </el-button>
            <span class="field-tip jimeng2-assets-tip">
              Gọi gateway
              <code>GET /api/business/v1/assets</code>
              , khớp với
              <a href="https://83zi.com/sd2realperson.html" target="_blank" rel="noopener noreferrer">tài liệu API quản lý tư liệu</a>
              (dùng gateway URL và Token trong form hiện tại, không cần lưu trước).
            </span>
          </div>
        </el-form-item>
        <el-alert
          v-if="form.service_type === 'jimeng2_character_auth'"
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 12px"
          title="Dùng cho trang sáng tạo 'Tạo nhân vật → SD2 auth'"
          description="Sau khi lưu, hệ thống đọc gateway và Token từ đây, gọi POST /api/business/v1/assets để đăng ký ảnh nhân vật; có thể dùng 'Liệt kê tư liệu' để kiểm tra trạng thái tư liệu. Ảnh chính của nhân vật cần là địa chỉ http(s) truy cập được từ internet (image host hoặc storage.base_url của service này)."
        />
        <template v-if="form.service_type === 'video' && form.api_protocol === 'kling_omni'">
          <el-form-item>
            <template #label><span class="form-label-tip">AccessKey</span></template>
            <el-input
              v-model="form.kling_access_key"
              type="password"
              show-password
              placeholder="AccessKey của Kling open platform (đi cặp với SecretKey, có thể bỏ trống API Key phía trên)"
              autocomplete="off"
            />
            <p class="field-tip">
              Quy tắc JWT chính thức xem tại
              <a href="https://klingai.com/document-api/apiReference/commonInfo" target="_blank" rel="noopener noreferrer">commonInfo</a>
              (<a href="https://app.klingai.com/cn/dev/document-api/apiReference/commonInfo" target="_blank" rel="noopener noreferrer">bản tiếng Trung</a>).
              Backend dùng HS256 (<code>iss</code>=AccessKey, <code>exp</code>, <code>nbf</code>) khớp với ví dụ chính thức để tạo Token.
              Nếu API trả về <code>1000 Authorization signature is invalid</code>: kiểm tra AccessKey/SecretKey không bị đảo, không có khoảng trắng thừa; và thử tick "SecretKey là Base64" bên dưới;
              region của Base URL (<code>api-beijing.klingai.com</code> / <code>api-singapore.klingai.com</code>) phải khớp với region của key.
            </p>
          </el-form-item>
          <el-form-item>
            <template #label><span class="form-label-tip">SecretKey</span></template>
            <el-input
              v-model="form.kling_secret_key"
              type="password"
              show-password
              placeholder="SecretKey của Kling open platform"
              autocomplete="off"
            />
            <el-checkbox v-model="form.kling_secret_key_base64" style="margin-top: 8px; display: block">
              SecretKey là chuỗi Base64 (decode ra binary rồi mới dùng để sign; nếu vẫn báo signature invalid thì toggle mục này thử lại)
            </el-checkbox>
            <p class="field-tip">
              Domain chính thức: <code>POST {base}/v1/videos/omni-video</code>, poll
              <code>GET {base}/v1/videos/omni-video/{taskId}</code>; proxy như Feier vẫn là
              <code>/kling/v1/videos/omni-video</code> và
              <code>/kling/v1/images/omni-image/{taskId}</code>. Chi tiết xem
              <a href="https://klingai.com/document-api/apiReference/model/OmniVideo" target="_blank" rel="noopener noreferrer">OmniVideo</a>.
            </p>
          </el-form-item>
        </template>
        <!-- Field riêng của TTS: voice ID và MiniMax Group ID -->
        <template v-if="form.service_type === 'tts'">
          <el-form-item>
            <template #label>
              <span class="form-label-tip">Voice ID
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      Voice ID dùng cho TTS.<br>
                      <b>Voice phổ biến của MiniMax:</b><br>
                      female-shaonv (thiếu nữ), female-chengshu (trưởng thành)<br>
                      male-qingxin (nam thanh thoát), male-zhicheng (nam trầm)<br>
                      audiobook_female_2 (audiobook nữ), audiobook_male_1 (audiobook nam)
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-select
              v-model="form.voice_id"
              filterable
              allow-create
              default-first-option
              placeholder="Chọn hoặc nhập voice ID"
              style="width: 100%"
            >
              <el-option-group label="MiniMax giọng nữ">
                <el-option label="female-shaonv (thiếu nữ)" value="female-shaonv" />
                <el-option label="female-chengshu (trưởng thành)" value="female-chengshu" />
                <el-option label="female-tianmei (ngọt ngào)" value="female-tianmei" />
                <el-option label="audiobook_female_2 (audiobook)" value="audiobook_female_2" />
              </el-option-group>
              <el-option-group label="MiniMax giọng nam">
                <el-option label="male-qingxin (thanh thoát)" value="male-qingxin" />
                <el-option label="male-zhicheng (trầm)" value="male-zhicheng" />
                <el-option label="audiobook_male_1 (audiobook)" value="audiobook_male_1" />
              </el-option-group>
            </el-select>
            <p class="field-tip">MiniMax bắt buộc điền; nếu bỏ trống mặc định female-shaonv.</p>
          </el-form-item>
          <el-form-item>
            <template #label>
              <span class="form-label-tip">Group ID
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      GroupId của account MiniMax, được đính kèm trong URL param khi gọi API T2A v2.<br>
                      Đăng nhập <b>platform.minimaxi.com</b> → Account settings → xem GroupId.
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-input v-model="form.group_id" placeholder="MiniMax GroupId, ví dụ 1234567890" />
            <p class="field-tip">Chỉ MiniMax T2A cần field này.</p>
          </el-form-item>
        </template>

        <!-- Cấu hình endpoint: video bắt buộc (provider tuỳ chỉnh); image/storyboard chỉ điền khi dùng proxy hoặc provider đặc biệt -->
        <template v-if="form.service_type !== 'text' && form.service_type !== 'tts' && form.service_type !== 'jimeng2_character_auth'">
          <el-form-item>
            <template #label>
              <span class="form-label-tip">Submit endpoint
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      Path API, được nối vào sau Base URL.<br>
                      <b>Provider preset</b> (Volcengine / Tongyi / NanoBanana) để trống, hệ thống tự suy luận.<br>
                      <b>Video provider tuỳ chỉnh</b> bắt buộc điền, ví dụ /v1/videos/generations<br>
                      <b>NanoBanana proxy</b> điền path proxy, ví dụ /fal-ai/nano-banana
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-input v-model="form.endpoint" :placeholder="form.service_type === 'video' ? 'Video provider tuỳ chỉnh bắt buộc, ví dụ /v1/videos/generations; preset để trống' : 'Điền khi dùng proxy hoặc provider đặc biệt, ví dụ /fal-ai/nano-banana; preset để trống'" />
          </el-form-item>
          <el-form-item>
            <template #label>
              <span class="form-label-tip">Query endpoint
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      Path API để query trạng thái task, {taskId} sẽ được thay thế bằng task ID thực tế.<br>
                      <b>Provider preset</b> để trống, hệ thống tự suy luận.<br>
                      <b>Video provider tuỳ chỉnh</b> bắt buộc điền, ví dụ /v1/video/tasks/{taskId}<br>
                      <b>Image/NanoBanana</b> proxy nếu không hỗ trợ polling có thể để trống
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-input v-model="form.query_endpoint" placeholder="Video provider tuỳ chỉnh bắt buộc, ví dụ /v1/video/tasks/{taskId}; preset để trống" />
          </el-form-item>
        </template>

        <!-- Xem trước địa chỉ API: tự động hiển thị sau khi chọn provider/protocol, giúp người dùng kiểm tra -->
        <div v-if="endpointPreviewInfo" class="endpoint-preview-box" :class="{ 'ep-box-gemini': endpointPreviewInfo.isGemini }">
          <div class="ep-preview-header">
            <span>📌 Hệ thống sẽ dùng các địa chỉ API sau</span>
            <span v-if="endpointPreviewInfo.isGemini" class="ep-auto-badge ep-badge-gemini">Gemini cố định</span>
            <span v-else-if="endpointPreviewInfo.isJimeng2Auth" class="ep-auto-badge">Jimeng2 character auth</span>
            <span v-else-if="endpointPreviewInfo.isAuto && form.service_type !== 'text'" class="ep-auto-badge">Tự suy luận</span>
          </div>
          <div class="ep-row">
            <span class="ep-label">Submit URL:</span>
            <code class="ep-url">{{ endpointPreviewInfo.submit }}</code>
          </div>
          <div v-if="endpointPreviewInfo.query" class="ep-row">
            <span class="ep-label">Query URL:</span>
            <code class="ep-url">{{ endpointPreviewInfo.query }}</code>
          </div>
          <p v-if="endpointPreviewInfo.isGemini" class="ep-tip ep-tip-warn">
            ⚠️ Endpoint Gemini được hệ thống sinh cố định theo tên model, các field "Submit endpoint" và "Query endpoint" phía trên không có hiệu lực với Gemini, dù điền cũng không dùng.
          </p>
          <p v-else-if="endpointPreviewInfo.isJimeng2Auth" class="ep-tip">"SD2 auth" của nhân vật sẽ gọi các URL này để đăng ký tư liệu (POST tạo, GET query trạng thái).</p>
          <p v-else class="ep-tip">Đây là địa chỉ gọi thực tế hệ thống suy luận (có thể điền thủ công các field endpoint phía trên để override)</p>
        </div>

        <template v-if="form.service_type !== 'jimeng2_character_auth'">
        <el-form-item>
          <template #label>
            <span class="form-label-tip">Danh sách model
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    Danh sách model available của provider này, nhiều model phân cách bằng dấu phẩy hoặc xuống dòng.<br>
                    Có thể chọn nhanh từ dropdown "Thêm model preset" phía trên, hoặc nhập thủ công.
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <div class="model-row">
            <el-select
              v-model="presetModelPick"
              placeholder="Thêm model preset"
              clearable
              filterable
              style="width: 220px; margin-bottom: 8px"
              @change="onPresetModelSelect"
            >
              <el-option v-for="m in availableModels" :key="m" :label="m" :value="m" />
            </el-select>
          </div>
          <el-input v-model="form.modelText" type="textarea" :rows="2" placeholder="Tự động điền sau khi chọn provider preset, có thể sửa; nhiều model phân cách bằng dấu phẩy hoặc xuống dòng" />
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="form-label-tip">Model mặc định
              <el-tooltip content="Khi có nhiều model, chọn model nào sẽ được gọi thực tế để generate. Nên chọn model phản hồi nhanh, chất lượng tốt." placement="top" popper-class="cfg-tip-popper">
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select
            v-model="form.default_model"
            :placeholder="formModelList.length ? 'Chọn một model từ danh sách phía trên làm mặc định khi generate' : 'Vui lòng điền danh sách model phía trên trước'"
            clearable
            style="width: 100%"
          >
            <el-option v-for="m in formModelList" :key="m" :label="m" :value="m" />
          </el-select>
          <p class="field-tip">Khi cấu hình này được chọn làm "mặc định", việc tạo kịch bản/ảnh/video sẽ dùng model chỉ định ở đây.</p>
        </el-form-item>
        <el-form-item v-if="isDeepSeekOfficialForm">
          <template #label>
            <span class="form-label-tip">Chế độ thinking
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    Model chính thức DeepSeek V4 dùng param thinking để điều khiển chế độ thinking.<br>
                    Tắt thinking tương ứng với deepseek-chat cũ; bật thinking tương ứng với deepseek-reasoner cũ.
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <div class="deepseek-settings">
            <el-radio-group v-model="form.deepseek_thinking">
              <el-radio-button label="disabled">Tắt thinking</el-radio-button>
              <el-radio-button label="enabled">Bật thinking</el-radio-button>
            </el-radio-group>
            <el-select
              v-if="form.deepseek_thinking === 'enabled'"
              v-model="form.deepseek_reasoning_effort"
              style="width: 140px"
            >
              <el-option label="high" value="high" />
              <el-option label="max" value="max" />
            </el-select>
          </div>
          <p class="field-tip">Tên model cũ chính thức sẽ deprecate vào 2026-07-24; cấu hình mới nên dùng deepseek-v4-flash hoặc deepseek-v4-pro.</p>
        </el-form-item>
        </template>
        <el-form-item>
          <template #label>
            <span class="form-label-tip">Priority
              <el-tooltip content="Khi cùng một loại dịch vụ có nhiều cấu hình, số càng lớn thì càng được ưu tiên gọi. Mặc định 0, thường set 10 là được." placement="top" popper-class="cfg-tip-popper">
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input-number v-model="form.priority" :min="0" :max="999" />
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="form-label-tip">Đặt làm mặc định
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    Mỗi loại dịch vụ chỉ có một cấu hình "mặc định".<br>
                    Khi generate, hệ thống ưu tiên dùng cấu hình mặc định, nên set ít nhất một cấu hình mặc định cho mỗi loại.
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-switch v-model="form.is_default" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">Huỷ</el-button>
        <el-button type="primary" :loading="saving" @click="submit">Xác nhận</el-button>
      </template>
    </el-dialog>

    <!-- Cấu hình nhanh Tongyi -->
    <el-dialog
      v-model="oneKeyTongyiVisible"
      title="Cấu hình nhanh Tongyi Qianwen / Wanxiang (không khuyến nghị)"
      width="520px"
      :close-on-click-modal="false"
      @closed="oneKeyTongyiKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 Sẽ tự động tạo các cấu hình sau</div>
          <ul class="one-key-list">
            <li><b>Text/Chat</b>: Tongyi Qianwen (qwen-plus) — tạo kịch bản</li>
            <li><b>Text to image</b>: Tongyi Wanxiang (wan2.6-image) — ảnh nhân vật/scene/đạo cụ</li>
            <li><b>Text to image</b>: Tongyi Qianwen Image (qwen-image-max) — tuỳ chọn thay thế cho ảnh nhân vật/scene</li>
            <li><b>Storyboard image</b>: Tongyi Wanxiang (wan2.6-image) — hỗ trợ ảnh tham chiếu nhân vật</li>
            <li><b>Video generation</b>: Tongyi Wanxiang (wan2.2-kf2v-flash) — tạo video clip</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 Cách đăng ký API Key</div>
          <ol class="one-key-list">
            <li>Truy cập Alibaba Cloud Bailian console: <a href="https://bailian.console.aliyun.com/" target="_blank" class="one-key-link">bailian.console.aliyun.com</a></li>
            <li>Đăng ký/đăng nhập tài khoản Alibaba Cloud, kích hoạt dịch vụ "Bailian" (user mới có free quota)</li>
            <li>Menu bên trái bấm "API Key" → "Create API Key"</li>
            <li>Copy Key vừa tạo (format: <code>sk-xxxxxxxx</code>) và dán vào ô dưới</li>
          </ol>
          <p class="one-key-note">💡 Một Key Tongyi đồng thời hỗ trợ text, image, video và tất cả dịch vụ khác</p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyTongyiKey"
            type="password"
            placeholder="Vui lòng nhập Tongyi (DashScope) API Key, format: sk-xxxxxxxx"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="oneKeyTongyiVisible = false">Huỷ</el-button>
        <el-button type="success" :loading="oneKeyTongyiSaving" :disabled="!oneKeyTongyiKey.trim()" @click="submitOneKeyTongyi">
          Xác nhận, tạo cấu hình nhanh
        </el-button>
      </template>
    </el-dialog>

    <!-- Cấu hình nhanh Volcengine -->
    <el-dialog
      v-model="oneKeyVolcVisible"
      title="Cấu hình nhanh Volcengine (Ark)"
      width="520px"
      :close-on-click-modal="false"
      @closed="oneKeyVolcKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 Sẽ tự động tạo các cấu hình sau</div>
          <ul class="one-key-list">
            <li><b>Text/Chat</b>: DeepSeek V3 (deepseek-v3-2-251201) — tạo kịch bản</li>
            <li><b>Text to image</b>: Jimeng 4.5 (doubao-seedream-4-5-251128) — ảnh nhân vật/scene/đạo cụ</li>
            <li><b>Storyboard image</b>: Jimeng 4.5 (doubao-seedream-4-5-251128) — hỗ trợ ảnh tham chiếu nhân vật</li>
            <li><b>Video generation</b>: Jimeng Seedance 1.5 Pro — tạo video clip</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 Cách đăng ký API Key</div>
          <ol class="one-key-list">
            <li>Truy cập Volcengine Ark console: <a href="https://console.volcengine.com/ark" target="_blank" class="one-key-link">console.volcengine.com/ark</a></li>
            <li>Đăng ký/đăng nhập tài khoản ByteDance Volcengine (user mới có free token quota)</li>
            <li>Menu bên trái bấm "API Key management" → "Create API Key"</li>
            <li>Copy Key vừa tạo và dán vào ô dưới</li>
          </ol>
          <p class="one-key-note">💡 Một Key của Ark platform đồng thời hỗ trợ Doubao text, Jimeng image và video và tất cả dịch vụ khác</p>
          <p class="one-key-note">⚠️ Video generation cần "kích hoạt" model tương ứng (Jimeng Seedance) trên console trước khi dùng</p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyVolcKey"
            type="password"
            placeholder="Vui lòng nhập Volcengine (Ark) API Key"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="oneKeyVolcVisible = false">Huỷ</el-button>
        <el-button type="success" :loading="oneKeyVolcSaving" :disabled="!oneKeyVolcKey.trim()" @click="submitOneKeyVolc">
          Xác nhận, tạo cấu hình nhanh
        </el-button>
      </template>
    </el-dialog>

    <!-- Cấu hình nhanh Agnes -->
    <el-dialog
      v-model="oneKeyAgnesVisible"
      title="Cấu hình nhanh Agnes AI"
      width="520px"
      :close-on-click-modal="false"
      @closed="oneKeyAgnesKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 Sẽ tự động tạo các cấu hình sau</div>
          <ul class="one-key-list">
            <li><b>Text/Chat</b>: Agnes 2.0 Flash (agnes-2.0-flash) — tạo kịch bản</li>
            <li><b>Text to image</b>: Agnes Image 2.1 Flash — ảnh nhân vật/scene/đạo cụ</li>
            <li><b>Storyboard image</b>: Agnes Image 2.1 Flash — hỗ trợ sửa với ảnh tham chiếu</li>
            <li><b>Video generation</b>: Agnes Video V2.0 (agnes-video-v2.0) — tạo video clip</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 Cách đăng ký API Key</div>
          <ol class="one-key-list">
            <li>Truy cập Agnes platform: <a href="https://platform.agnes-ai.com/settings/apiKeys" target="_blank" class="one-key-link">platform.agnes-ai.com/settings/apiKeys</a></li>
            <li>Đăng ký/đăng nhập tài khoản, vào Settings → API Keys</li>
            <li>Bấm "Create new secret key" để tạo key</li>
            <li>Copy Key và dán vào ô dưới</li>
          </ol>
          <p class="one-key-note">💡 Một Key đồng thời hỗ trợ text, image, video; tài liệu API xem tại <a href="https://agnes-ai.com/doc/agnes-20-flash" target="_blank" class="one-key-link">agnes-ai.com/doc</a></p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyAgnesKey"
            type="password"
            placeholder="Vui lòng nhập Agnes API Key"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="oneKeyAgnesVisible = false">Huỷ</el-button>
        <el-button type="success" :loading="oneKeyAgnesSaving" :disabled="!oneKeyAgnesKey.trim()" @click="submitOneKeyAgnes">
          Xác nhận, tạo cấu hình nhanh
        </el-button>
      </template>
    </el-dialog>

    <!-- Jimeng2 character auth: danh sách tư liệu -->
    <el-dialog
      v-model="jimeng2AssetsDialogVisible"
      title="Danh sách thư viện tư liệu (GET /api/business/v1/assets)"
      width="720px"
      class="jimeng2-assets-dialog"
      destroy-on-close
      @closed="onJimeng2AssetsDialogClosed"
    >
      <p class="field-tip" style="margin-top: 0">
        Tài liệu:
        <a href="https://83zi.com/sd2realperson.html" target="_blank" rel="noopener noreferrer">SilvaMux Material Management API</a>
        ; chỉ tư liệu có <code>status=active</code> mới có thể dùng cho reference của Seedance 2.0 video.
      </p>
      <el-table v-loading="jimeng2AssetsLoading" :data="jimeng2AssetsRows" stripe max-height="420" empty-text="Chưa có dữ liệu hoặc chưa load">
        <el-table-column prop="id" label="Asset ID" min-width="120" show-overflow-tooltip />
        <el-table-column prop="name" label="Tên" width="100" show-overflow-tooltip />
        <el-table-column prop="asset_type" label="Loại" width="88" />
        <el-table-column prop="status" label="Trạng thái" width="96">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : row.status === 'failed' ? 'danger' : 'info'" size="small">
              {{ row.status || '—' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="asset_url" label="asset_url" min-width="160" show-overflow-tooltip />
        <el-table-column prop="url" label="URL gốc" min-width="120" show-overflow-tooltip />
        <el-table-column prop="created_at" label="Thời gian tạo" width="160" show-overflow-tooltip />
      </el-table>
      <div v-if="jimeng2AssetsHasMore" style="margin-top: 12px; text-align: center">
        <el-button :loading="jimeng2AssetsLoading" @click="loadMoreJimeng2MaterialAssets">Tải thêm</el-button>
      </div>
      <template #footer>
        <el-button @click="jimeng2AssetsDialogVisible = false">Đóng</el-button>
      </template>
    </el-dialog>

    <!-- Test kết nối -->
    <el-dialog v-model="testVisible" title="Test kết nối" width="420px">
      <p v-if="testResult === null">Đang test...</p>
      <template v-else-if="testResult">
        <el-alert
          v-if="testServiceType === 'image' || testServiceType === 'storyboard_image' || testServiceType === 'video'"
          type="success"
          title="Kết nối thành công"
          description="API Key hợp lệ, mạng đã kết nối. Lưu ý: test chỉ xác thực tính hợp lệ của Key, không thực sự tạo ảnh/video, khi tên model sai, account chưa kích hoạt tính năng đó hoặc quota không đủ thì việc tạo thực tế vẫn có thể lỗi."
          show-icon
          :closable="false"
        />
        <el-alert
          v-else
          type="success"
          title="Kết nối thành công"
          description="API text generation đã phản hồi bình thường."
          show-icon
          :closable="false"
        />
      </template>
      <el-alert v-else type="error" :title="testError || 'Kết nối thất bại'" show-icon :closable="false" />
      <template #footer>
        <el-button @click="testVisible = false">Đóng</el-button>
      </template>
    </el-dialog>

    <!-- Đổi Key hàng loạt (chế độ khoá) -->
    <el-dialog v-model="bulkKeyVisible" title="Đổi Key hàng loạt" width="440px" :close-on-click-modal="false">
      <el-alert
        type="warning"
        :closable="false"
        style="margin-bottom: 16px"
        title="Thao tác này sẽ thay thế API Key của tất cả cấu hình, vui lòng xác nhận Key mới khả dụng trước khi submit."
        show-icon
      />
      <el-form label-width="80px">
        <el-form-item label="API Key mới">
          <el-input
            v-model="bulkKeyInput"
            type="password"
            show-password
            placeholder="Dán API Key mới"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bulkKeyVisible = false">Huỷ</el-button>
        <el-button type="primary" :loading="bulkKeySaving" :disabled="!bulkKeyInput.trim()" @click="submitBulkKey">Xác nhận thay thế</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, MagicStick, QuestionFilled, Download, Upload, Delete, ChatDotRound, Picture, Film, VideoCamera, Key, Microphone, Folder } from '@element-plus/icons-vue'
import { aiAPI } from '@/api/ai'
import { generationSettingsAPI } from '@/api/prompts'
import PromptEditor from '@/components/PromptEditor.vue'
import SceneModelMap from '@/components/SceneModelMap.vue'
import Sd2AssetManagement from '@/components/Sd2AssetManagement.vue'

const activeTab = ref('configs')
const importFileRef = ref(null)

// ---- Cài đặt generate ----
const genConcurrencyInput = ref(3)
const genVideoConcurrencyInput = ref(3)
const genSettingSaving = ref(false)
const genSettingSaved = ref(false)

async function loadGenerationSettings() {
  try {
    const res = await generationSettingsAPI.get()
    genConcurrencyInput.value = res?.concurrency ?? 3
    genVideoConcurrencyInput.value = res?.video_concurrency ?? 3
  } catch (_) {}
}

function onConcurrencyChange(val) {
  const n = Number(val)
  if (!isNaN(n) && n >= 1) genConcurrencyInput.value = Math.min(20, Math.max(1, Math.round(n)))
}

function onVideoConcurrencyChange(val) {
  const n = Number(val)
  if (!isNaN(n) && n >= 1) genVideoConcurrencyInput.value = Math.min(20, Math.max(1, Math.round(n)))
}

async function saveGenerationSettings() {
  const n = Number(genConcurrencyInput.value)
  const nv = Number(genVideoConcurrencyInput.value)
  if (isNaN(n) || n < 1 || n > 20) {
    ElMessage.warning('Concurrency ảnh vui lòng nhập số nguyên trong khoảng 1-20')
    return
  }
  if (isNaN(nv) || nv < 1 || nv > 20) {
    ElMessage.warning('Concurrency video vui lòng nhập số nguyên trong khoảng 1-20')
    return
  }
  genSettingSaving.value = true
  genSettingSaved.value = false
  try {
    await generationSettingsAPI.update({ concurrency: Math.round(n), video_concurrency: Math.round(nv) })
    genSettingSaved.value = true
    setTimeout(() => { genSettingSaved.value = false }, 2000)
  } catch (e) {
    ElMessage.error('Lưu thất bại: ' + (e?.message || ''))
  } finally {
    genSettingSaving.value = false
  }
}
const loading = ref(false)
const list = ref([])
const selectedRows = ref([])
const batchDeleting = ref(false)
const vendorLock = ref({ enabled: false, config_file: '' })
const dialogVisible = ref(false)
const editingId = ref(null)
const saving = ref(false)
const showProtocolHelp = ref(false)
const bulkKeyVisible = ref(false)
const bulkKeyInput = ref('')
const bulkKeySaving = ref(false)
const jimeng2AssetsDialogVisible = ref(false)
const jimeng2AssetsLoading = ref(false)
const jimeng2AssetsRows = ref([])
const jimeng2AssetsHasMore = ref(false)
const jimeng2AssetsNextCursor = ref(null)
const formRef = ref(null)
const form = ref({
  service_type: 'text',
  name: '',
  provider: '',
  api_protocol: '',
  base_url: '',
  api_key: '',
  endpoint: '',
  query_endpoint: '',
  modelText: '',
  default_model: '',
  deepseek_thinking: 'disabled',
  deepseek_reasoning_effort: 'high',
  priority: 0,
  is_default: false,
  // Kling Omni chính thức AK/SK (lưu ở settings, backend tạo JWT)
  kling_access_key: '',
  kling_secret_key: '',
  kling_secret_key_base64: false,
  // Field riêng của TTS
  voice_id: '',
  group_id: '',
})
const presetModelPick = ref('')

const formModelList = computed(() => parseModelText(form.value.modelText))

// Đảm bảo dropdown "Model mặc định khi generate" có option để chọn và giá trị đã chọn nằm trong list, nếu không sẽ không hiển thị hoặc thay đổi không hiệu lực
watch(
  () => [formModelList.value, form.value.default_model],
  () => {
    const list = formModelList.value
    if (list.length === 0) return
    const current = form.value.default_model
    if (!current || !list.includes(current)) {
      form.value.default_model = list[0] || ''
    }
  },
  { immediate: true }
)

function onServiceTypeChange() {
  const st = form.value.service_type || 'text'
  if (st === 'jimeng2_character_auth') {
    if (!form.value.provider || form.value.provider === CUSTOM_PROVIDER_SENTINEL) {
      form.value.provider = 'jimeng_material_api'
    }
    const p = form.value.provider
    const pcfg = (providerConfigs.jimeng2_character_auth || []).find((x) => x.id === p)
    if (pcfg) {
      if (!form.value.base_url?.trim()) form.value.base_url = getBaseUrlForProvider(p)
      form.value.modelText = '-'
      form.value.default_model = '-'
      form.value.endpoint = ''
      form.value.query_endpoint = ''
      form.value.api_protocol = ''
    }
    if (!editingId.value && !form.value.name?.trim()) {
      form.value.name = 'Jimeng2 character auth'
    }
    return
  }
  const listByType = providerConfigs[st] || []
  const current = form.value.provider
  if (!current || !listByType.some((p) => p.id === current)) {
    form.value.provider = ''
    form.value.base_url = ''
    form.value.modelText = ''
    form.value.default_model = ''
  }
}

function onPresetModelSelect(value) {
  if (!value) return
  const listParsed = parseModelText(form.value.modelText)
  if (listParsed.includes(value)) {
    presetModelPick.value = ''
    return
  }
  const append = listParsed.length ? '\n' + value : value
  form.value.modelText = (form.value.modelText || '').trim() + append
  presetModelPick.value = ''
}
const rules = computed(() => ({
  service_type: [{ required: true, message: 'Vui lòng chọn loại dịch vụ', trigger: 'change' }],
  name: [{ required: true, message: 'Vui lòng nhập tên', trigger: 'blur' }],
  provider: [{ required: true, message: 'Vui lòng chọn hoặc nhập provider', trigger: 'change' }],
  base_url: [{ required: true, message: 'Vui lòng nhập Base URL', trigger: 'blur' }],
  api_key: [
    {
      validator: (_rule, v, cb) => {
        const st = form.value.service_type
        if (st === 'jimeng2_character_auth') {
          if (v != null && String(v).trim()) return cb()
          return cb(new Error('Vui lòng nhập Token'))
        }
        const proto = form.value.api_protocol
        const ak = (form.value.kling_access_key || '').trim()
        const sk = (form.value.kling_secret_key || '').trim()
        if (st === 'video' && proto === 'kling_omni' && ak && sk) return cb()
        if (v != null && String(v).trim()) return cb()
        cb(new Error('Vui lòng nhập API Key, hoặc dùng AccessKey + SecretKey chính thức (có thể bỏ trống API Key)'))
      },
      trigger: 'blur',
    },
  ],
}))
const testVisible = ref(false)
const testResult = ref(null)
const testServiceType = ref('')
const testError = ref('')
const oneKeyTongyiVisible = ref(false)
const oneKeyTongyiKey = ref('')
const oneKeyTongyiSaving = ref(false)
const oneKeyVolcVisible = ref(false)
const oneKeyVolcKey = ref('')
const oneKeyVolcSaving = ref(false)
const oneKeyAgnesVisible = ref(false)
const oneKeyAgnesKey = ref('')
const oneKeyAgnesSaving = ref(false)

/** Provider và model preset (khớp với frontend tham chiếu) */
const providerConfigs = {
  text: [
    { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'] },
    { id: 'volcengine', name: 'Volcengine', models: ['deepseek-v3-2-251201', 'doubao-1-5-pro-32k-250115', 'kimi-k2-thinking-251104'] },
    // { id: 'chatfire', name: 'Chatfire', models: ['gemini-3-flash-preview', 'claude-sonnet-4-5-20250929', 'doubao-seed-1-8-251228'] },
    { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-pro', 'gemini-3-flash-preview'] },
    { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
    { id: 'qwen', name: 'Tongyi Qianwen', models: ['qwen3-max', 'qwen-plus', 'qwen-flash'] },
    { id: 'agnes', name: 'Agnes AI', models: ['agnes-2.0-flash'] }
  ],
  image: [
    { id: 'volcengine', name: 'Volcengine', models: ['doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828'] },
    { id: 'kling', name: 'Kling', models: ['kling-image', 'kling-omni-image'] },
    { id: 'nano_banana', name: 'NanoBanana', models: ['nano-banana-2', 'nano-banana-pro', 'nano-banana'] },
    // { id: 'chatfire', name: 'Chatfire', models: ['nano-banana-pro', 'doubao-seedream-4-5-251128', 'qwen-image'] },
    { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'] },
    { id: 'openai', name: 'OpenAI', models: ['dall-e-3', 'dall-e-2'] },
    { id: 'dashscope', name: 'Tongyi Wanxiang', models: ['wan2.6-image', 'qwen-image-edit-plus-2026-01-09', 'qwen-image-edit-plus', 'qwen-image-edit-max'] },
    { id: 'qwen_image', name: 'Tongyi Qianwen', models: ['qwen-image-max', 'qwen-image-plus', 'qwen-image'] },
    { id: 'agnes', name: 'Agnes AI', models: ['agnes-image-2.1-flash', 'agnes-image-2.0-flash'] }
  ],
  storyboard_image: [
    { id: 'dashscope', name: 'Tongyi Wanxiang', models: ['wan2.6-image', 'qwen-image-edit-plus-2026-01-09', 'qwen-image-edit-plus', 'qwen-image-edit-max'] },
    { id: 'volcengine', name: 'Volcengine', models: ['doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828'] },
    { id: 'kling', name: 'Kling', models: ['kling-image', 'kling-omni-image'] },
    { id: 'nano_banana', name: 'NanoBanana', models: ['nano-banana-2', 'nano-banana-pro', 'nano-banana'] },
    // { id: 'chatfire', name: 'Chatfire', models: ['nano-banana-pro', 'doubao-seedream-4-5-251128', 'qwen-image'] },
    { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'] },
    { id: 'openai', name: 'OpenAI', models: ['dall-e-3', 'dall-e-2'] },
    { id: 'agnes', name: 'Agnes AI', models: ['agnes-image-2.1-flash', 'agnes-image-2.0-flash'] }
  ],
  video: [
    { id: 'klingai', name: 'Kling chính thức Omni (api-beijing.klingai.com)', models: ['kling-video-o1', 'kling-v3-omni'] },
    { id: 'ffir', name: 'Feier API / Kling Omni-Video (ffir.cn)', models: ['kling-video-o1', 'kling-v3-omni'] },
    { id: 'kling', name: 'Kling', models: ['kling-omni-video', 'kling-video', 'kling-motion-control'] },
    { id: 'vidu', name: 'Vidu', models: ['viduq2', 'viduq2-pro', 'viduq2-turbo', 'viduq3-pro'] },
    { id: 'volces', name: 'Volcengine', models: ['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-1-5-pro-251215', 'doubao-seedance-1-0-lite-i2v-250428', 'doubao-seedance-1-0-lite-t2v-250428', 'doubao-seedance-1-0-pro-250528', 'doubao-seedance-1-0-pro-fast-251015'] },
    // { id: 'chatfire', name: 'Chatfire', models: ['doubao-seedance-1-5-pro-251215', 'doubao-seedance-1-0-lite-i2v-250428', 'doubao-seedance-1-0-lite-t2v-250428', 'doubao-seedance-1-0-pro-250528', 'doubao-seedance-1-0-pro-fast-251015', 'sora-2', 'sora-2-pro'] },
    { id: 'minimax', name: 'MiniMax Hailuo', models: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02'] },
    { id: 'gemini', name: 'Google Gemini (Veo)', models: ['veo-3.1-generate-preview', 'veo-3.0-generate-preview', 'veo-3.0-fast-generate-preview'] },
    { id: 'dashscope', name: 'Tongyi Wanxiang', models: ['wan2.6-r2v-flash', 'wan2.6-t2v', 'wan2.2-kf2v-flash', 'wan2.6-i2v-flash', 'wanx2.1-vace-plus'] },
    {
      id: 'jimeng_ai_api',
      name: 'Jimeng AI API (Jimeng free API self-hosted)',
      models: [
        'jimeng-video-seedance-2.0',
        'seedance-2.0',
        'jimeng-video-seedance-2.0-fast',
        'jimeng-video-3.0',
        'jimeng-video-3.0-pro',
        'jimeng-video-3.5-pro',
      ],
    },
    { id: 'openai', name: 'OpenAI', models: ['sora-2', 'sora-2-pro'] },
    { id: 'xai', name: 'xAI Grok Imagine', models: ['grok-imagine-video'] },
    { id: 'agnes', name: 'Agnes AI', models: ['agnes-video-v2.0'] },
  ],
  tts: [
    { id: 'minimax', name: 'MiniMax T2A', models: ['speech-02-hd', 'speech-02-turbo'] },
    { id: 'omnivoice', name: 'OmniVoice (local)', models: ['omnivoice'] },
    { id: 'elevenlabs', name: 'ElevenLabs (chỉ dùng cho voice cloning từ mẫu)', models: ['eleven_multilingual_v2'] },
  ],
  jimeng2_character_auth: [
    { id: 'jimeng_material_api', name: 'Jimeng Business Material API (/api/business/v1)', models: ['-'] },
  ],
}

/** Provider id → API protocol mặc định */
const providerProtocolMap = {
  // image / storyboard_image
  volcengine: 'volcengine',
  volces: 'volcengine',
  volc: 'volcengine',
  nano_banana: 'nano_banana',
  dashscope: 'dashscope',
  qwen_image: 'dashscope',
  gemini: 'gemini',
  google: 'gemini',
  kling: 'kling',
  ffir: 'kling_omni',
  klingai: 'kling_omni',
  // video
  vidu: 'vidu',
  xai: 'xai',
  grok: 'xai',
  minimax: 'openai',
  openai: 'openai',
  chatfire: 'openai',
  qwen: 'openai',
  deepseek: 'openai',
  agnes: 'openai',
  jimeng_ai_api: 'jimeng_ai_api',
  jimeng_material_api: '',
}

/** Provider id → Base URL mặc định (khớp với frontend tham chiếu AIConfigDialog 757-775) */
function getBaseUrlForProvider(provider) {
  if (!provider) return ''
  const p = String(provider).toLowerCase()
  if (p === 'gemini' || p === 'google') return 'https://generativelanguage.googleapis.com'
  if (p === 'minimax') return 'https://api.minimaxi.com/v1'
  if (p === 'volces' || p === 'volcengine') return 'https://ark.cn-beijing.volces.com/api/v3'
  if (p === 'openai') return 'https://api.openai.com/v1'
  if (p === 'deepseek') return 'https://api.deepseek.com'
  if (p === 'dashscope') return 'https://dashscope.aliyuncs.com'
  if (p === 'qwen_image') return 'https://dashscope.aliyuncs.com'
  if (p === 'qwen') return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  if (p === 'nano_banana') return 'https://api.nanobananaapi.ai'
  if (p === 'vidu') return 'https://api.vidu.cn'
  if (p === 'kling') return 'https://api.klingai.com'
  if (p === 'klingai') return 'https://api-beijing.klingai.com'
  if (p === 'ffir') return 'https://ffir.cn'
  if (p === 'jimeng_ai_api') return 'http://127.0.0.1:8000'
  if (p === 'jimeng_material_api') return 'https://silvamux.tingyutech.com'
  if (p === 'xai' || p === 'grok') return 'https://api.x.ai'
  if (p === 'agnes') return 'https://apihub.agnes-ai.com/v1'
  if (p === 'omnivoice') return 'http://127.0.0.1:8712'
  if (p === 'elevenlabs') return 'https://api.elevenlabs.io/v1'
  return 'https://api.chatfire.site/v1'
}

const CUSTOM_PROVIDER_SENTINEL = '__custom__'

function parseSettings(settings) {
  if (!settings) return {}
  if (typeof settings === 'object') return settings
  try {
    const parsed = JSON.parse(settings)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function isDeepSeekOfficial(provider, baseUrl) {
  const p = String(provider || '').trim().toLowerCase()
  const base = String(baseUrl || '').trim().toLowerCase()
  return p === 'deepseek' || base.includes('api.deepseek.com')
}

function resolveDeepSeekFormSettings(row) {
  const s = parseSettings(row?.settings)
  const nested = s.deepseek && typeof s.deepseek === 'object' ? s.deepseek : {}
  let thinking = s.deepseek_thinking || s.thinking || nested.thinking || nested.type || ''
  const model = String(row?.default_model || '').toLowerCase()
  if (!thinking && model === 'deepseek-chat') thinking = 'disabled'
  if (!thinking && model === 'deepseek-reasoner') thinking = 'enabled'
  if (thinking !== 'enabled' && thinking !== 'disabled') thinking = 'disabled'

  let effort = s.deepseek_reasoning_effort || s.reasoning_effort || nested.reasoning_effort || nested.effort || 'high'
  effort = String(effort).toLowerCase() === 'max' ? 'max' : 'high'
  return { thinking, effort }
}

const isDeepSeekOfficialForm = computed(() => (
  form.value.service_type === 'text'
  && isDeepSeekOfficial(form.value.provider, form.value.base_url)
))

/** Danh sách provider preset cho loại dịch vụ hiện tại (khi edit nếu provider hiện tại không có trong list thì bổ sung; luôn thêm entry tuỳ chỉnh ở cuối) */
const availableProviderOptions = computed(() => {
  const st = form.value.service_type || 'text'
  const listByType = providerConfigs[st] || []
  const current = form.value.provider
  let result = [...listByType]
  if (editingId.value && current && current !== CUSTOM_PROVIDER_SENTINEL && !listByType.some((p) => p.id === current)) {
    result = [{ id: current, name: current + ' (hiện tại)', models: [] }, ...result]
  }
  result.push({ id: CUSTOM_PROVIDER_SENTINEL, name: '✏️ Tuỳ chỉnh (nhập trực tiếp tên provider)', models: [] })
  return result
})

/** Danh sách model preset của provider hiện tại (dùng cho việc thêm model preset) */
const availableModels = computed(() => {
  const st = form.value.service_type
  const provider = form.value.provider
  if (!st || !provider) return []
  const p = (providerConfigs[st] || []).find((x) => x.id === provider)
  return p?.models || []
})

/** Suy luận địa chỉ API sẽ dùng thực tế dựa trên provider/protocol/base_url hiện tại, để user kiểm tra */
const endpointPreviewInfo = computed(() => {
  const { provider, api_protocol, base_url, service_type, endpoint, query_endpoint } = form.value
  const p = String(provider || '').toLowerCase()
  const proto = api_protocol || providerProtocolMap[p] || ''
  const base = (base_url || '').replace(/\/$/, '')

  if (service_type === 'jimeng2_character_auth') {
    const root = base || '(Vui lòng điền Gateway URL)'
    const hasReal = !root.startsWith('(')
    return {
      submit: `${root}/api/business/v1/assets`,
      query: hasReal ? `${root}/api/business/v1/assets/{assetId}` : null,
      isAuto: true,
      isJimeng2Auth: true,
    }
  }

  if (!base && !proto && !p) return null

  let submitPath = '', queryPath = ''

  if (service_type === 'text') {
    submitPath = '/chat/completions'
  } else if (service_type === 'tts') {
    if (p === 'minimax') {
      submitPath = '/t2a_v2?GroupId={group_id}'
    } else {
      submitPath = endpoint || '/tts'
    }
  } else if (service_type === 'image' || service_type === 'storyboard_image') {
    if (endpoint) {
      submitPath = endpoint
    } else if (proto === 'volcengine' || p === 'volcengine' || p === 'volces') {
      submitPath = '/images/generations'
    } else if (proto === 'dashscope' || p === 'dashscope' || p === 'qwen_image') {
      submitPath = '/api/v1/services/aigc/multimodal-generation/generation'
    } else if (proto === 'gemini' || p === 'gemini') {
      const m = form.value.default_model || '{model_name}'
      submitPath = `/v1beta/models/${m}:generateContent?key=***`
      return { submit: base + submitPath, query: null, isAuto: true, isGemini: true }
    } else if (proto === 'nano_banana' || p === 'nano_banana') {
      submitPath = '/v1/images/generations'  // nano_banana base_url không có /v1
    } else if (proto === 'kling' || p === 'kling' || p === 'klingai') {
      submitPath = '/v1/images/generations'
    } else {
      submitPath = '/images/generations'  // openai compatible: base_url đã có /v1
    }
    } else if (service_type === 'video') {
    if (endpoint) {
      submitPath = endpoint
    } else if (proto === 'volcengine_omni') {
      submitPath = '/contents/generations/tasks'
    } else if (proto === 'volcengine' || p === 'volces' || p === 'volcengine') {
      submitPath = '/videos/generations'
    } else if (proto === 'dashscope' || p === 'dashscope') {
      submitPath = '/api/v1/services/aigc/video-generation/video-synthesis'
    } else if (proto === 'gemini' || p === 'gemini') {
      const m = form.value.default_model || '{model_name}'
      return {
        submit: `${base}/v1beta/models/${m}:predictLongRunning  (API Key đặt ở header: x-goog-api-key)`,
        query: `${base}/v1beta/{operationName}  (operationName được trả về từ response submit)`,
        isAuto: true,
        isGemini: true
      }
    } else if (proto === 'vidu' || p === 'vidu') {
      submitPath = '/ent/v2/img2video'
    } else if (proto === 'sora') {
      submitPath = '/v1/videos'
    } else if (proto === 'agnes' || p === 'agnes') {
      submitPath = '/videos'
    } else if (proto === 'xai') {
      submitPath = '/v1/videos/generations'
    } else if (proto === 'veo3') {
      submitPath = '/v1/video/create'
    } else if (proto === 'jimeng_ai_api' || p === 'jimeng_ai_api') {
      submitPath = endpoint || '/v1/videos/generations'
      return {
        submit: (base || '(Vui lòng điền Base URL)') + submitPath + '  (Bearer là Jimeng Session, có thể nhiều account phân cách bằng dấu phẩy; response đồng bộ data[0].url)',
        query: null,
        isAuto: true,
      }
    } else if (proto === 'kling_omni' || p === 'ffir' || p === 'klingai') {
      const omniFfir = p === 'ffir' || /ffir\.cn/i.test(base)
      const omniKlingOfficial = p === 'klingai' || /api(-beijing|-singapore)?\.klingai\.com/i.test(base)
      submitPath = omniFfir ? '/kling/v1/videos/omni-video' : omniKlingOfficial ? '/v1/videos/omni-video' : '/kling/v1/videos/omni-video'
    } else if (proto === 'kling' || p === 'kling' || p === 'klingai') {
      submitPath = '/v1/videos/text2video (T2V) hoặc /v1/videos/image2video (I2V)'
    } else if (p === 'minimax') {
      submitPath = '/video_generation'  // minimax base_url đã có /v1
    } else {
      submitPath = '/v1/video/create'
    }

    if (query_endpoint) {
      queryPath = query_endpoint
    } else if (proto === 'volcengine_omni') {
      queryPath = '/contents/generations/tasks/{taskId}'
    } else if (proto === 'volcengine' || p === 'volces' || p === 'volcengine') {
      queryPath = '/tasks/{taskId}/info'
    } else if (proto === 'dashscope' || p === 'dashscope') {
      queryPath = '/api/v1/tasks/{taskId}/info'
    } else if (proto === 'vidu' || p === 'vidu') {
      queryPath = '/ent/v2/tasks/{taskId}/creations'
    } else if (proto === 'sora') {
      queryPath = '/v1/videos/{taskId}'
    } else if (proto === 'agnes' || p === 'agnes') {
      queryPath = '/videos/{taskId}'
    } else if (proto === 'xai') {
      queryPath = '/v1/videos/{taskId}'
    } else if (proto === 'veo3') {
      queryPath = '/v1/video/query?id={taskId}'
    } else if (proto === 'kling_omni' || p === 'ffir' || p === 'klingai') {
      const omniFfirQ = p === 'ffir' || /ffir\.cn/i.test(base)
      const omniKlingOfficialQ = p === 'klingai' || /api(-beijing|-singapore)?\.klingai\.com/i.test(base)
      queryPath = omniFfirQ
        ? '/kling/v1/images/omni-image/{taskId}'
        : omniKlingOfficialQ
          ? '/v1/videos/omni-video/{taskId}'
          : '/kling/v1/images/omni-image/{taskId}'
    } else if (proto === 'kling' || p === 'kling' || p === 'klingai') {
      queryPath = '/v1/videos/{videoType}/{taskId} (tự chọn theo loại task)'
    } else if (p === 'minimax') {
      queryPath = '/query/video_generation?task_id={taskId}'  // minimax base_url đã có /v1
    } else if (proto !== 'gemini' && p !== 'gemini') {
      queryPath = '/v1/video/query?id={taskId}'
    }
  }

  const submitUrl = base ? (base + submitPath) : ('(Chưa điền Base URL)' + submitPath)
  const queryUrl = queryPath ? (base ? base + queryPath : '(Chưa điền Base URL)' + queryPath) : null

  if (!submitPath) return null
  return {
    submit: submitUrl,
    query: queryUrl,
    isAuto: !endpoint  // Endpoint được tự suy luận (không phải user tự điền)
  }
})

function onProviderChange(providerId) {
  if (providerId === CUSTOM_PROVIDER_SENTINEL) {
    form.value.provider = ''
    form.value.api_protocol = ''
    form.value.base_url = ''
    form.value.modelText = ''
    form.value.default_model = ''
    return
  }
  const st = form.value.service_type || 'text'
  const p = (providerConfigs[st] || []).find((x) => x.id === providerId)
  if (!p) {
    form.value.base_url = ''
    form.value.modelText = ''
    form.value.default_model = ''
    return
  }
  form.value.base_url = getBaseUrlForProvider(providerId)
  form.value.modelText = (p.models || []).join('\n')
  form.value.default_model = (p.models && p.models[0]) || ''
  if (providerId === 'deepseek') {
    form.value.deepseek_thinking = 'disabled'
    form.value.deepseek_reasoning_effort = 'high'
  }
  // Tự động điền API protocol
  form.value.api_protocol = providerProtocolMap[providerId] || (st === 'text' ? '' : 'openai')
  if (st === 'video' && providerId === 'jimeng_ai_api') {
    form.value.endpoint = ''
    form.value.query_endpoint = ''
  }
  if (st === 'video' && (providerId === 'ffir' || providerId === 'klingai')) {
    if (providerId === 'ffir') {
      form.value.endpoint = '/kling/v1/videos/omni-video'
      form.value.query_endpoint = '/kling/v1/images/omni-image/{taskId}'
    } else {
      form.value.endpoint = '/v1/videos/omni-video'
      form.value.query_endpoint = '/v1/videos/omni-video/{taskId}'
    }
  }
  if (st === 'video' && providerId === 'agnes') {
    form.value.api_protocol = 'agnes'
    form.value.endpoint = '/videos'
    form.value.query_endpoint = '/videos/{taskId}'
  }
  if (!editingId.value) {
    form.value.name = (p.name || providerId) + ' ' + serviceTypeLabel(st)
  }
}

/** Preset dùng cho cấu hình nhanh Tongyi */
const TONGYI_CONFIGS = [
  { service_type: 'text', name: 'Tongyi Qianwen', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', provider: 'qwen', model: ['qwen-plus'] },
  { service_type: 'image', name: 'Tongyi Wanxiang text-to-image', base_url: 'https://dashscope.aliyuncs.com', provider: 'dashscope', model: ['wan2.6-image'] },
  { service_type: 'image', name: 'Tongyi Qianwen text-to-image', base_url: 'https://dashscope.aliyuncs.com', provider: 'qwen_image', model: ['qwen-image-max', 'qwen-image-plus', 'qwen-image'] },
  { service_type: 'storyboard_image', name: 'Tongyi Wanxiang storyboard image', base_url: 'https://dashscope.aliyuncs.com', provider: 'dashscope', model: ['wan2.6-image'] },
  { service_type: 'video', name: 'Tongyi Wanxiang', base_url: 'https://dashscope.aliyuncs.com', provider: 'dashscope', model: ['wan2.2-kf2v-flash'] }
]

/** Preset dùng cho cấu hình nhanh Volcengine */
const VOLCENGINE_CONFIGS = [
  { service_type: 'text', name: 'Volcengine text', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volcengine', model: ['deepseek-v3-2-251201', 'doubao-1-5-pro-32k-250115', 'kimi-k2-thinking-251104'] },
  { service_type: 'image', name: 'Volcengine Jimeng text-to-image', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volcengine', model: ['doubao-seedream-4-5-251128'] },
  { service_type: 'storyboard_image', name: 'Volcengine Jimeng storyboard image', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volcengine', model: ['doubao-seedream-4-5-251128'] },
  { service_type: 'video', name: 'Volcengine Jimeng video', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volces', model: ['doubao-seedance-1-5-pro-251215'] }
]

/** Preset dùng cho cấu hình nhanh Agnes */
const AGNES_CONFIGS = [
  { service_type: 'text', name: 'Agnes text', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'openai', model: ['agnes-2.0-flash'] },
  { service_type: 'image', name: 'Agnes text-to-image', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'openai', model: ['agnes-image-2.1-flash'] },
  { service_type: 'storyboard_image', name: 'Agnes storyboard image', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'openai', model: ['agnes-image-2.1-flash'] },
  { service_type: 'video', name: 'Agnes video', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'agnes', endpoint: '/videos', query_endpoint: '/videos/{taskId}', model: ['agnes-video-v2.0'] },
]

function serviceTypeLabel(t) {
  const map = {
    text: 'Text',
    image: 'Text to image',
    storyboard_image: 'Storyboard image',
    video: 'Video',
    tts: 'TTS',
    jimeng2_character_auth: 'Jimeng2 character auth',
    model_ark_asset: 'SD2 asset',
  }
  return map[t] || t
}

function onRowEdit(row) {
  if (row.service_type === 'model_ark_asset') {
    activeTab.value = 'sd2_assets'
    ElMessage.info('Vui lòng sửa cấu hình này trong tab "Quản lý SD2 asset"')
    return
  }
  openEdit(row)
}

async function loadList() {
  loading.value = true
  try {
    list.value = await aiAPI.list()
  } catch (_) {
    list.value = []
  } finally {
    loading.value = false
  }
}

function parseModelText(text) {
  if (!text || !String(text).trim()) return []
  return String(text)
    .split(/[\n,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function resetForm() {
  editingId.value = null
  presetModelPick.value = ''
  form.value = {
    service_type: 'text',
    name: '',
    provider: '',
    api_protocol: '',
    base_url: '',
    api_key: '',
    endpoint: '',
    query_endpoint: '',
    modelText: '',
    default_model: '',
    deepseek_thinking: 'disabled',
    deepseek_reasoning_effort: 'high',
    priority: 0,
    is_default: true,  // Khi tạo mới, mặc định tick "Đặt làm mặc định", giúp dễ hiểu cấu hình nào đang được dùng
    voice_id: '',
    group_id: '',
    kling_access_key: '',
    kling_secret_key: '',
    kling_secret_key_base64: false,
  }
  formRef.value?.resetFields?.()
}

function openAdd() {
  resetForm()
  dialogVisible.value = true
}

function openEdit(row) {
  editingId.value = row.id
  const model = Array.isArray(row.model) ? row.model : (row.model ? [row.model] : [])
  const modelList = model.map((m) => String(m).trim()).filter(Boolean)
  const defaultInList = row.default_model && modelList.includes(row.default_model)
  // TTS / Kling Omni... parse từ settings
  let voice_id = row.voice_id || ''
  let group_id = row.group_id || ''
  let kling_access_key = ''
  let kling_secret_key = ''
  let kling_secret_key_base64 = false
  const deepseekSettings = resolveDeepSeekFormSettings(row)
  if (row.settings) {
    try {
      const s = JSON.parse(row.settings)
      if (row.service_type === 'tts') {
        voice_id = s.voice_id || voice_id
        group_id = s.group_id || group_id
      }
      if (row.service_type === 'video' && row.api_protocol === 'kling_omni') {
        kling_access_key = s.kling_access_key || ''
        kling_secret_key = s.kling_secret_key || ''
        kling_secret_key_base64 = !!s.kling_secret_key_base64
      }
    } catch (_) {}
  }
  form.value = {
    service_type: row.service_type,
    name: row.name,
    provider: row.provider,
    api_protocol: row.api_protocol || '',
    base_url: row.base_url,
    api_key: row.api_key,
    endpoint: row.endpoint || '',
    query_endpoint: row.query_endpoint || '',
    modelText: modelList.join('\n'),
    default_model: defaultInList ? row.default_model : (modelList[0] || ''),
    deepseek_thinking: deepseekSettings.thinking,
    deepseek_reasoning_effort: deepseekSettings.effort,
    priority: row.priority ?? 0,
    is_default: !!row.is_default,
    voice_id,
    group_id,
    kling_access_key,
    kling_secret_key,
    kling_secret_key_base64,
  }
  dialogVisible.value = true
}

async function submit() {
  await formRef.value?.validate?.().catch(() => {})
  saving.value = true
  try {
    let modelList = parseModelText(form.value.modelText)
    if (form.value.service_type === 'jimeng2_character_auth' && modelList.length === 0) {
      modelList = ['-']
    }
    const defaultModel = form.value.default_model && modelList.includes(form.value.default_model)
      ? form.value.default_model
      : modelList[0] || null
    // TTS / Kling Omni chính thức AKSK / DeepSeek V4 param được đóng gói vào settings
    let settings = undefined
    if (form.value.service_type === 'tts') {
      const s = {}
      if (form.value.voice_id) s.voice_id = form.value.voice_id
      if (form.value.group_id) s.group_id = form.value.group_id
      settings = Object.keys(s).length ? JSON.stringify(s) : null
    } else if (form.value.service_type === 'video' && form.value.api_protocol === 'kling_omni') {
      let baseS = {}
      if (editingId.value) {
        const prev = list.value.find((r) => r.id === editingId.value)
        if (prev?.settings) {
          try {
            baseS = JSON.parse(prev.settings)
          } catch (_) {}
        }
      }
      if ((form.value.kling_access_key || '').trim()) baseS.kling_access_key = form.value.kling_access_key.trim()
      else delete baseS.kling_access_key
      if ((form.value.kling_secret_key || '').trim()) baseS.kling_secret_key = form.value.kling_secret_key.trim()
      else delete baseS.kling_secret_key
      if (form.value.kling_secret_key_base64) baseS.kling_secret_key_base64 = true
      else delete baseS.kling_secret_key_base64
      settings = Object.keys(baseS).length ? JSON.stringify(baseS) : null
    } else if (isDeepSeekOfficialForm.value) {
      const prev = editingId.value ? list.value.find((r) => r.id === editingId.value) : null
      const baseS = parseSettings(prev?.settings)
      baseS.deepseek_thinking = form.value.deepseek_thinking === 'enabled' ? 'enabled' : 'disabled'
      if (baseS.deepseek_thinking === 'enabled') {
        baseS.deepseek_reasoning_effort = form.value.deepseek_reasoning_effort === 'max' ? 'max' : 'high'
      } else {
        delete baseS.deepseek_reasoning_effort
      }
      settings = Object.keys(baseS).length ? JSON.stringify(baseS) : null
    }
    const payload = {
      service_type: form.value.service_type,
      name: form.value.name,
      provider: form.value.provider,
      api_protocol: form.value.api_protocol || '',
      base_url: form.value.base_url,
      api_key: form.value.api_key,
      endpoint: form.value.endpoint || '',
      query_endpoint: form.value.query_endpoint || '',
      model: modelList,
      default_model: defaultModel,
      priority: form.value.priority,
      is_default: form.value.is_default,
      ...(settings !== undefined ? { settings } : {}),
    }
    if (editingId.value) {
      await aiAPI.update(editingId.value, payload)
      ElMessage.success('Đã lưu')
    } else {
      await aiAPI.create(payload)
      ElMessage.success('Đã thêm')
    }
    dialogVisible.value = false
    await loadList()
  } catch (e) {
    // request đã xử lý lỗi thống nhất
  } finally {
    saving.value = false
  }
}

function openBulkKey() {
  bulkKeyInput.value = ''
  bulkKeyVisible.value = true
}

async function submitBulkKey() {
  const key = bulkKeyInput.value.trim()
  if (!key) return
  bulkKeySaving.value = true
  try {
    const res = await aiAPI.bulkUpdateKey(key)
    ElMessage.success(res?.message || 'API Key của tất cả cấu hình đã được cập nhật')
    bulkKeyVisible.value = false
    await loadList()
  } catch (_) {
  } finally {
    bulkKeySaving.value = false
  }
}

function onJimeng2AssetsDialogClosed() {
  jimeng2AssetsRows.value = []
  jimeng2AssetsNextCursor.value = null
  jimeng2AssetsHasMore.value = false
}

async function fetchJimeng2MaterialAssets(firstPage) {
  if (!form.value.base_url?.trim() || !form.value.api_key?.trim()) {
    ElMessage.warning('Vui lòng điền Gateway URL và Token trước')
    return
  }
  if (firstPage) {
    jimeng2AssetsRows.value = []
    jimeng2AssetsNextCursor.value = null
    jimeng2AssetsHasMore.value = false
    jimeng2AssetsDialogVisible.value = true
  }
  jimeng2AssetsLoading.value = true
  try {
    const data = await aiAPI.listJimeng2MaterialAssets({
      base_url: form.value.base_url.trim(),
      api_key: form.value.api_key,
      limit: 20,
      cursor: firstPage ? undefined : jimeng2AssetsNextCursor.value || undefined,
    })
    const items = Array.isArray(data?.items) ? data.items : []
    if (firstPage) {
      jimeng2AssetsRows.value = items
    } else {
      jimeng2AssetsRows.value = [...jimeng2AssetsRows.value, ...items]
    }
    jimeng2AssetsNextCursor.value = data?.next_cursor ?? null
    jimeng2AssetsHasMore.value = !!data?.has_more
  } catch (_) {
    /* request interceptor đã ElMessage */
  } finally {
    jimeng2AssetsLoading.value = false
  }
}

function openJimeng2MaterialAssetsDialog() {
  fetchJimeng2MaterialAssets(true)
}

function loadMoreJimeng2MaterialAssets() {
  if (!jimeng2AssetsHasMore.value || !jimeng2AssetsNextCursor.value) return
  fetchJimeng2MaterialAssets(false)
}

async function openTest(row) {
  if (row.service_type === 'jimeng2_character_auth') {
    ElMessage.info('Jimeng2 character auth không cần test tại đây; sau khi lưu vui lòng bấm "SD2 auth" trong "Tạo nhân vật" ở trang sáng tạo để xác minh.')
    return
  }
  if (row.service_type === 'model_ark_asset') {
    ElMessage.info('SD2 asset vui lòng vào tab "Quản lý SD2 asset" dùng "Làm mới danh sách" để xác minh kết nối.')
    return
  }
  testVisible.value = true
  testResult.value = null
  testError.value = ''
  testServiceType.value = row.service_type || 'text'
  try {
    await aiAPI.testConnection({
      base_url: row.base_url,
      api_key: row.api_key,
      model: Array.isArray(row.model) ? row.model[0] : row.model,
      provider: row.provider,
      endpoint: row.endpoint,
      service_type: row.service_type,
      settings: row.settings
    })
    testResult.value = true
  } catch (e) {
    testResult.value = false
    testError.value = e?.message || 'Request thất bại'
  }
}

async function onDelete(row) {
  await ElMessageBox.confirm(`Bạn có chắc muốn xoá cấu hình "${row.name}"?`, 'Xác nhận xoá', {
    type: 'warning'
  })
  try {
    await aiAPI.delete(row.id)
    ElMessage.success('Đã xoá')
    await loadList()
  } catch (_) {}
}

function onSelectionChange(rows) {
  selectedRows.value = rows
}

async function onBatchDelete() {
  if (!selectedRows.value.length) return
  await ElMessageBox.confirm(
    `Bạn có chắc muốn xoá ${selectedRows.value.length} cấu hình đã chọn? Thao tác này không thể khôi phục.`,
    'Xác nhận xoá hàng loạt',
    { type: 'warning', confirmButtonText: 'Xác nhận xoá', confirmButtonClass: 'el-button--danger' }
  )
  batchDeleting.value = true
  let success = 0, failed = 0
  for (const row of selectedRows.value) {
    try {
      await aiAPI.delete(row.id)
      success++
    } catch (_) { failed++ }
  }
  batchDeleting.value = false
  selectedRows.value = []
  ElMessage.success(`Đã xoá ${success} cấu hình${failed ? `, ${failed} thất bại` : ''}`)
  await loadList()
}

function openOneKeyTongyi() {
  oneKeyTongyiKey.value = ''
  oneKeyTongyiVisible.value = true
}

async function submitOneKeyTongyi() {
  const apiKey = oneKeyTongyiKey.value.trim()
  if (!apiKey) return
  oneKeyTongyiSaving.value = true
  try {
    for (const cfg of TONGYI_CONFIGS) {
      const models = cfg.model || []
      await aiAPI.create({
        service_type: cfg.service_type,
        name: cfg.name,
        provider: cfg.provider,
        base_url: cfg.base_url,
        api_key: apiKey,
        model: models,
        default_model: models[0] || null,
        priority: 10,
        is_default: true
      })
    }
    ElMessage.success('Đã tạo cấu hình Tongyi cho text, text-to-image, storyboard image, video')
    oneKeyTongyiVisible.value = false
    await loadList()
  } catch (_) {
    // Lỗi đã được request xử lý thống nhất
  } finally {
    oneKeyTongyiSaving.value = false
  }
}

function openOneKeyVolc() {
  oneKeyVolcKey.value = ''
  oneKeyVolcVisible.value = true
}

async function submitOneKeyVolc() {
  const apiKey = oneKeyVolcKey.value.trim()
  if (!apiKey) return
  oneKeyVolcSaving.value = true
  try {
    for (const cfg of VOLCENGINE_CONFIGS) {
      const models = cfg.model || []
      await aiAPI.create({
        service_type: cfg.service_type,
        name: cfg.name,
        provider: cfg.provider,
        base_url: cfg.base_url,
        api_key: apiKey,
        model: models,
        default_model: models[0] || null,
        priority: 10,
        is_default: true
      })
    }
    ElMessage.success('Đã tạo cấu hình Volcengine cho text, text-to-image, storyboard image, video')
    oneKeyVolcVisible.value = false
    await loadList()
  } catch (_) {
    // Lỗi đã được request xử lý thống nhất
  } finally {
    oneKeyVolcSaving.value = false
  }
}

function openOneKeyAgnes() {
  oneKeyAgnesKey.value = ''
  oneKeyAgnesVisible.value = true
}

async function submitOneKeyAgnes() {
  const apiKey = oneKeyAgnesKey.value.trim()
  if (!apiKey) return
  oneKeyAgnesSaving.value = true
  try {
    for (const cfg of AGNES_CONFIGS) {
      const models = cfg.model || []
      await aiAPI.create({
        service_type: cfg.service_type,
        name: cfg.name,
        provider: cfg.provider,
        api_protocol: cfg.api_protocol || '',
        base_url: cfg.base_url,
        api_key: apiKey,
        model: models,
        default_model: models[0] || null,
        endpoint: cfg.endpoint || '',
        query_endpoint: cfg.query_endpoint || '',
        priority: 10,
        is_default: true
      })
    }
    ElMessage.success('Đã tạo cấu hình Agnes cho text, text-to-image, storyboard image, video')
    oneKeyAgnesVisible.value = false
    await loadList()
  } catch (_) {
    // Lỗi đã được request xử lý thống nhất
  } finally {
    oneKeyAgnesSaving.value = false
  }
}

async function exportConfigs() {
  try {
    const configs = await aiAPI.list()
    const exportData = configs.map(({ id, created_at, updated_at, ...rest }) => rest)
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-configs-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`Đã xuất ${exportData.length} cấu hình`)
  } catch (e) {
    ElMessage.error('Xuất thất bại')
  }
}

function triggerImport() {
  importFileRef.value?.click()
}

async function importConfigs(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const configs = JSON.parse(text)
    if (!Array.isArray(configs)) {
      ElMessage.error('Định dạng file không đúng, cần JSON array')
      return
    }
    let success = 0
    let failed = 0
    for (const cfg of configs) {
      try {
        const models = Array.isArray(cfg.model) ? cfg.model : (cfg.model ? [cfg.model] : [])
        await aiAPI.create({
          service_type: cfg.service_type,
          name: cfg.name,
          provider: cfg.provider,
          api_protocol: cfg.api_protocol || null,
          base_url: cfg.base_url,
          api_key: cfg.api_key || '',
          endpoint: cfg.endpoint || null,
          query_endpoint: cfg.query_endpoint || null,
          model: models,
          default_model: cfg.default_model || null,
          priority: cfg.priority ?? 0,
          is_default: !!cfg.is_default,
          settings: cfg.settings || null
        })
        success++
      } catch (_) {
        failed++
      }
    }
    ElMessage.success(`Nhập hoàn tất: ${success} thành công${failed ? `, ${failed} thất bại` : ''}`)
    await loadList()
  } catch (e) {
    ElMessage.error('Nhập thất bại: ' + (e.message || 'Lỗi parse file'))
  } finally {
    event.target.value = ''
  }
}

async function loadVendorLock() {
  try {
    vendorLock.value = await aiAPI.getVendorLock()
  } catch (_) {
    vendorLock.value = { enabled: false, config_file: '' }
  }
}

onMounted(() => {
  loadVendorLock()
  loadList()
  loadGenerationSettings()
})
</script>

<style>
.provider-custom-option {
  border-top: 1px solid var(--el-border-color-light, #e4e7ed);
  margin-top: 4px;
  padding-top: 4px;
  color: var(--el-color-primary, #409eff) !important;
  font-style: italic;
}
</style>

<style scoped>
.ai-config-content {
  padding: 0;
}
.config-tabs {
  margin-top: -4px;
}
.tab-content {
  padding-top: 16px;
  max-height: calc(100vh - 320px);
  overflow-y: auto;
}
.content-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 16px;
}
.actions-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.actions-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Transition animation */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease;
}
.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

/* Type badge */
.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid transparent;
}
.type-icon {
  font-size: 13px;
  flex-shrink: 0;
}

/* Text/Chat — blue */
.type-text {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
  border-color: rgba(59, 130, 246, 0.25);
}
/* Text to image — green */
.type-image {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.25);
}
/* Storyboard image — purple */
.type-storyboard_image {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
  border-color: rgba(139, 92, 246, 0.25);
}
/* Video — orange */
.type-video {
  background: rgba(249, 115, 22, 0.12);
  color: #f97316;
  border-color: rgba(249, 115, 22, 0.25);
}
.jimeng2-assets-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  width: 100%;
}
.jimeng2-assets-tip {
  flex: 1;
  min-width: 200px;
  margin: 0;
  line-height: 1.5;
}

.type-jimeng2_character_auth {
  background: rgba(20, 184, 166, 0.14);
  color: #0d9488;
  border-color: rgba(20, 184, 166, 0.28);
}

.type-model_ark_asset {
  background: rgba(99, 102, 241, 0.12);
  color: #6366f1;
  border-color: rgba(99, 102, 241, 0.25);
}

.no-default {
  color: #9ca3af;
  font-size: 13px;
}
.one-key-tip {
  margin: 0 0 12px;
  color: #606266;
  font-size: 13px;
  line-height: 1.5;
}
.one-key-not-recommended {
  margin-left: 4px;
  padding: 0 5px;
  font-size: 11px;
  line-height: 18px;
  border-radius: 4px;
  color: var(--el-color-warning, #e6a23c);
  background: var(--el-color-warning-light-9, #fdf6ec);
  border: 1px solid var(--el-color-warning-light-7, #f5dab1);
  vertical-align: middle;
}
.one-key-help {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.one-key-section {
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 8px;
  padding: 12px 14px;
}
.one-key-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  margin-bottom: 8px;
}
.one-key-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
  line-height: 1.8;
}
.one-key-list li {
  margin-bottom: 2px;
}
.one-key-link {
  color: var(--el-color-primary, #409eff);
  text-decoration: none;
}
.one-key-link:hover {
  text-decoration: underline;
}
.one-key-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.5;
}
.one-key-note + .one-key-note {
  margin-top: 4px;
}
code {
  background: var(--el-fill-color, #f0f2f5);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  font-family: monospace;
}
.cfg-tip-content code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
  font-family: monospace;
}
.default-tip {
  margin: 0 0 16px;
  padding: 10px 12px;
  background: #f0f9ff;
  border-radius: 6px;
  font-size: 13px;
  color: #0369a1;
  line-height: 1.5;
}
.vendor-lock-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.vendor-lock-bar .vendor-lock-tip {
  flex: 1;
  margin-bottom: 0;
}
.vendor-bulk-key-btn {
  white-space: nowrap;
  flex-shrink: 0;
  color: #fff !important;
}
.vendor-lock-tip {
  margin-bottom: 16px;
}
.model-row { margin-bottom: 4px; }
.deepseek-settings {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.field-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
}
.form-label-tip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.ph-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  padding: 4px 0 6px;
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 4px;
}
.ph-tag {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  margin-right: 6px;
  font-weight: 600;
  vertical-align: middle;
}
.ph-tag-img {
  background: #ecf5ff;
  color: #409eff;
  border: 1px solid #b3d8ff;
}
.ph-tag-vid {
  background: #f0f9eb;
  color: #67c23a;
  border: 1px solid #b3e19d;
}
.protocol-help .ph-body {
  font-size: 13px;
  line-height: 1.7;
  color: #303133;
}
.protocol-help .ph-body pre {
  background: #f5f7fa;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  margin: 6px 0 2px;
  white-space: pre-wrap;
  word-break: break-all;
}
.protocol-help .ph-body code {
  background: #f0f2f5;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
}
.tip-icon {
  font-size: 13px;
  color: #909399;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
}
.tip-icon:hover {
  color: #409eff;
}
.endpoint-preview-box {
  background: #f0f7ff;
  border: 1px solid #c6e0ff;
  border-radius: 6px;
  padding: 10px 14px;
  margin: -4px 0 14px;
  font-size: 12px;
}
.ep-preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #409eff;
  margin-bottom: 8px;
  font-size: 12px;
}
.ep-auto-badge {
  background: #e6f1ff;
  color: #409eff;
  border: 1px solid #b3d8ff;
  border-radius: 3px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 400;
}
.ep-row {
  display: flex;
  align-items: flex-start;
  margin-bottom: 5px;
  gap: 6px;
  line-height: 1.5;
}
.ep-row:last-of-type {
  margin-bottom: 0;
}
.ep-label {
  flex-shrink: 0;
  color: #606266;
  min-width: 68px;
}
.ep-url {
  word-break: break-all;
  color: #303133;
  background: rgba(255,255,255,0.7);
  border: 1px solid #dce8fa;
  border-radius: 3px;
  padding: 1px 6px;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 11.5px;
  line-height: 1.6;
}
.ep-tip {
  margin: 8px 0 0;
  font-size: 11px;
  color: #909399;
  line-height: 1.4;
}
.ep-tip-warn {
  color: #e6a23c;
}
.ep-box-gemini {
  background: #fffbf0;
  border-color: #f5dfa0;
}
.ep-box-gemini .ep-preview-header {
  color: #b8860b;
}
.ep-badge-gemini {
  background: #fef6e0;
  color: #b8860b;
  border-color: #f0d080;
}
.generation-settings {
  max-width: 600px;
}
.gs-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}
.gs-desc {
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
  margin-bottom: 20px;
}
.gs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.gs-label {
  font-size: 13px;
  color: #303133;
  font-weight: 500;
  white-space: nowrap;
}
.gs-unit {
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
}
.gs-tip-box {
  margin-top: 20px;
  background: #f5f7fa;
  border-radius: 8px;
  padding: 14px 16px;
  font-size: 13px;
}
.gs-tip-title {
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}
.gs-tip-list {
  margin: 0 0 8px 16px;
  padding: 0;
  color: #606266;
  line-height: 1.8;
}
.gs-tip-note {
  color: #909399;
  font-size: 12px;
}
</style>

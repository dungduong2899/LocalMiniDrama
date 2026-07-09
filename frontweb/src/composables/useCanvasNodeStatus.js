import { reactive } from 'vue'

/** Trạng thái thao tác node canvas (tạo ảnh/tạo video/tạo ảnh tham chiếu, v.v.) */
export function createCanvasNodeStatusStore() {
  const map = reactive({})

  function set(nodeId, payload) {
    if (!nodeId) return
    if (!payload) {
      delete map[nodeId]
      return
    }
    map[nodeId] = {
      step: payload.step || 'busy',
      message: payload.message || 'Đang xử lý…',
      at: Date.now(),
    }
  }

  function clear(nodeId) {
    if (nodeId) delete map[nodeId]
  }

  function get(nodeId) {
    return nodeId ? map[nodeId] || null : null
  }

  function isBusy(nodeId) {
    return !!get(nodeId)
  }

  return { map, set, clear, get, isBusy }
}

export const CANVAS_NODE_STATUS_LABELS = {
  image: 'Đang tạo ảnh',
  video: 'Đang tạo video',
  audio: 'Đang lồng tiếng',
  polish: 'Đang chỉnh sửa',
  save: 'Đang lưu',
  ref_image: 'Tạo ảnh tham chiếu',
  generate_sb: 'AI tạo storyboard',
  save_script: 'Lưu kịch bản',
  extract_chars: 'Trích xuất nhân vật',
  extract_scenes: 'Trích xuất scene',
  extract_props: 'Trích xuất đạo cụ',
  extract_all: 'Trích xuất tất cả',
}

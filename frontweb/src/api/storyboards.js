import request from '@/utils/request'

/**
 * @param {string} url
 * @param {object} body
 * @param {(delta: string) => void} [onDelta]
 * @returns {Promise<{ universal_segment_text: string }>}
 */
function postUniversalSegmentNdjsonStream(url, body, onDelta) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(body || {}),
  }).then(async (res) => {
    if (!res.ok) {
      let msg = `Yêu cầu thất bại (${res.status})`
      try {
        const j = await res.json()
        if (j?.error?.message) msg = j.error.message
      } catch (_) {
        try {
          const t = await res.text()
          if (t) msg = t.slice(0, 200)
        } catch (_) {}
      }
      throw new Error(msg)
    }
    const reader = res.body && res.body.getReader()
    if (!reader) throw new Error('Trình duyệt không hỗ trợ đọc stream')
    const dec = new TextDecoder()
    let buf = ''
    let finalText = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let obj
        try {
          obj = JSON.parse(line)
        } catch (_) {
          continue
        }
        if (obj.type === 'delta' && obj.text && typeof onDelta === 'function') onDelta(String(obj.text))
        if (obj.type === 'error') throw new Error(obj.message || 'Yêu cầu thất bại')
        if (obj.type === 'done') {
          finalText = (obj.universal_segment_text && String(obj.universal_segment_text).trim()) || ''
        }
      }
    }
    const tail = buf.trim()
    if (tail) {
      try {
        const obj = JSON.parse(tail)
        if (obj.type === 'error') throw new Error(obj.message || 'Yêu cầu thất bại')
        if (obj.type === 'done') finalText = (obj.universal_segment_text && String(obj.universal_segment_text).trim()) || finalText
      } catch (e) {
        if (e instanceof Error && e.message && !e.message.includes('JSON')) throw e
      }
    }
    return { universal_segment_text: finalText }
  })
}

export const storyboardsAPI = {
  get(id) {
    return request.get(`/storyboards/${id}`)
  },
  create(data) {
    return request.post('/storyboards', data)
  },
  update(id, data) {
    return request.put(`/storyboards/${id}`, data)
  },
  delete(id) {
    return request.delete(`/storyboards/${id}`)
  },
  generateFramePrompt(id, data) {
    return request.post(`/storyboards/${id}/frame-prompt`, data)
  },
  getFramePrompts(id) {
    return request.get(`/storyboards/${id}/frame-prompts`)
  },
  /** Lưu/ghi đè prompt của frame đầu hoặc frame cuối (dùng khi người dùng sửa thủ công rồi lưu) */
  saveFramePrompt(id, frameType, data) {
    return request.put(`/storyboards/${id}/frame-prompts/${frameType}`, data || {})
  },
  polishPrompt(id) {
    return request.post(`/storyboards/${id}/polish-prompt`, {})
  },
  /** Chế độ toàn năng: AI tạo mô tả segment dựa trên nội dung storyboard (không stream, tương thích cũ) */
  generateUniversalSegmentPrompt(id, body = {}) {
    return request.post(`/storyboards/${id}/universal-segment-prompt`, body)
  },
  /** Tạo bằng chế độ toàn năng: NDJSON stream, tuỳ chọn body.duration, body.force_without_reference_images */
  generateUniversalSegmentPromptStream(id, body, onDelta) {
    return postUniversalSegmentNdjsonStream(
      `/api/v1/storyboards/${id}/universal-segment-prompt-stream`,
      body,
      onDelta
    )
  },
  /**
   * Trau chuốt segment toàn năng dạng stream: dòng NDJSON {type:'delta',text} / {type:'done',universal_segment_text} / {type:'error',message}
   * body.draft_universal_segment_text là toàn bộ nội dung vùng soạn thảo hiện tại; tuỳ chọn duration, force_without_reference_images
   */
  polishUniversalSegmentPromptStream(id, body, onDelta) {
    return postUniversalSegmentNdjsonStream(
      `/api/v1/storyboards/${id}/universal-segment-polish-stream`,
      body,
      onDelta
    )
  },
  insertBefore(id) {
    return request.post(`/storyboards/${id}/insert-before`, {})
  },
  batchInferParams(episodeId, overwrite = false) {
    return request.post('/storyboards/batch-infer-params', { episode_id: episodeId, overwrite })
  },
  upscale(id) {
    return request.post(`/storyboards/${id}/upscale`, {})
  },
  /** Nối frame cuối: trích xuất frame cuối của video storyboard hiện tại, đặt làm frame đầu của storyboard kế tiếp */
  linkTailFrame(id, data) {
    return request.post(`/storyboards/${id}/link-tail-frame`, data || {})
  },
  /** Tạo lại/tối ưu layout_description của storyboard này bằng AI (hợp đồng bố cục không gian), tự tham chiếu storyboard trước/sau */
  regenerateLayoutDescription(id) {
    return request.post(`/storyboards/${id}/regenerate-layout-description`, {})
  },
  /** Dựng lại video_prompt của storyboard theo quy tắc mới nhất của backend (có neo voice, không gọi AI) */
  rebuildVideoPrompt(id) {
    return request.post(`/storyboards/${id}/rebuild-video-prompt`, {})
  },
  /** Tách theo lời thoại/narration thành nhiều storyboard (mỗi storyboard chỉ một người nói hoặc chỉ narration ngoài hình) */
  splitByAudio(id) {
    return request.post(`/storyboards/${id}/split-by-audio`, {})
  },
}

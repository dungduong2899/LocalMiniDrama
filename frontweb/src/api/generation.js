import request from '@/utils/request'

export const generationAPI = {
  /**
   * @param {string|number} dramaId
   * @param {{ episode_id?: string|number, outline?: string, count?: number, model?: string }} [options] - episode_id dùng để liên kết với tập này, outline là tóm tắt/kịch bản
   */
  generateCharacters(dramaId, options = {}) {
    const body = { drama_id: dramaId }
    if (options.episode_id != null) body.episode_id = options.episode_id
    if (options.outline != null && String(options.outline).trim()) body.outline = options.outline
    if (options.count != null) body.count = options.count
    if (options.model != null) body.model = options.model
    return request.post('/generation/characters', body)
  },
  /** Tạo kịch bản từ outline + phong cách/thể loại/số tập; khi truyền drama_id sẽ tạo bất đồng bộ và lưu DB, trả về { task_id, status } */
  generateStory(body) {
    return request.post('/generation/story', body)
  }
}

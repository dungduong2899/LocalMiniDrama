import request from '@/utils/request'

export const uploadAPI = {
  /**
   * Tải ảnh lên, trả về { url, local_path }. Cần truyền đối tượng File.
   * @param {File} file
   * @param {{ dramaId?: number|string|null }} [opts] khi có drama id sẽ ghi vào projects/…/uploads/, ngược lại vẫn dùng uploads/ ở gốc
   */
  uploadImage(file, opts = {}) {
    const form = new FormData()
    form.append('file', file)
    const did = opts.dramaId
    if (did != null && did !== '' && Number(did) > 0) {
      form.append('drama_id', String(did))
    }
    return request.post('/upload/image', form, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  /**
   * Trích xuất mô tả đặc trưng của entity từ ảnh (base64 data URL hoặc http URL), không phụ thuộc entity ID có sẵn.
   * entityType: 'character' | 'scene' | 'prop'
   * imageUrl: data:image/xxx;base64,... hoặc http URL
   */
  extractDescriptionFromImage(entityType, imageUrl, entityName) {
    return request.post('/extract-description-from-image', {
      entity_type: entityType,
      image_url: imageUrl,
      entity_name: entityName || undefined,
    })
  }
}

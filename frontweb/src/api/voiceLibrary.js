// frontweb/src/api/voiceLibrary.js
import request from '@/utils/request'

export const voiceLibraryAPI = {
  list(params) {
    return request.get('/voice-library', { params })
  },
  importElevenLabs(data) {
    return request.post('/voice-library/import-elevenlabs', data)
  },
  designPreview(data) {
    return request.post('/voice-library/design/preview', data)
  },
  designSave(data) {
    return request.post('/voice-library/design/save', data)
  },
  test(id, text) {
    return request.post(`/voice-library/${id}/test`, { text })
  },
  delete(id, force) {
    return request.delete(`/voice-library/${id}`, { params: force ? { force: 1 } : {} })
  }
}

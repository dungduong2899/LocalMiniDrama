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
  },
  getDefaultNarration() {
    return request.get('/voice-library/default-narration')
  },
  setDefaultNarration(voiceId) {
    return request.put('/voice-library/default-narration', { voice_id: voiceId })
  },
  // Returns the API base URL for the MP3 download endpoints (used by <a href>
  // downloads that must bypass the axios wrapper's JSON parsing).
  downloadLibraryMp3Url(voiceId) {
    return `/api/v1/voice-library/${voiceId}/download-mp3`
  },
  downloadAdhocMp3Url(relPath, name) {
    const q = new URLSearchParams({ path: relPath || '' })
    if (name) q.set('name', name)
    return `/api/v1/voice-library/download-mp3?${q.toString()}`
  }
}

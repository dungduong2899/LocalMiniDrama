import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { generationAPI } from '@/api/generation'

/**
 * Quản lý đề cương phân tập: tạo / sửa / chốt & viết kịch bản / viết lại 1 tập / Gate 1 coverage.
 */
export function useStoryOutline() {
  const outline = ref(null) // { plot_points, episode_count_suggestion, episode_count_reason, episodes }
  const coverage = ref(null) // { [episodeNumber]: { missing_ids, hook_ok, cliffhanger_ok, notes } }
  const outlineStatus = ref('') // draft | edited | confirmed
  const warnings = ref([])
  const generating = ref(false)
  const writing = ref(false)

  async function loadOutline(dramaId) {
    if (!dramaId) return
    try {
      const row = await generationAPI.getStoryOutline(dramaId)
      if (row && row.content) {
        outline.value = row.content
        coverage.value = row.coverage || null
        outlineStatus.value = row.status || ''
      }
    } catch (_) {}
  }

  async function generateOutline({ dramaId, premise, style, type, episodeCount }) {
    generating.value = true
    try {
      const res = await generationAPI.generateStoryOutline({
        drama_id: dramaId,
        premise,
        style: style || undefined,
        type: type || undefined,
        episode_count: episodeCount || 1,
      })
      outline.value = res.outline
      coverage.value = null
      outlineStatus.value = 'draft'
      warnings.value = res.warnings || []
      return { ok: true }
    } catch (e) {
      ElMessage.error(e.message || 'Tạo đề cương thất bại')
      return { ok: false, error: e.message }
    } finally {
      generating.value = false
    }
  }

  async function saveOutline(dramaId) {
    if (!outline.value) return { ok: false }
    try {
      const row = await generationAPI.saveStoryOutline(dramaId, outline.value)
      outlineStatus.value = row.status || 'edited'
      return { ok: true }
    } catch (e) {
      ElMessage.error(e.message || 'Lưu đề cương thất bại')
      return { ok: false, error: e.message }
    }
  }

  /** Chốt đề cương rồi viết toàn bộ (hoặc danh sách tập chỉ định). pollTask/meta do FilmCreate truyền vào. */
  async function confirmAndWrite({ dramaId, episodeNumbers, pollTask, meta, onSaved }) {
    const saved = await saveOutline(dramaId)
    if (!saved.ok) return { ok: false }
    writing.value = true
    try {
      const res = await generationAPI.generateStoryFromOutline({
        drama_id: dramaId,
        episode_numbers: episodeNumbers || undefined,
      })
      const taskId = res?.task_id
      if (!taskId) {
        ElMessage.error('Không khởi động được task viết kịch bản')
        return { ok: false }
      }
      const pollRes = await pollTask(taskId, onSaved, meta)
      if (pollRes?.status !== 'completed') {
        return { ok: false, error: pollRes?.error || 'Viết kịch bản thất bại' }
      }
      await loadOutline(dramaId)
      const parsed = typeof pollRes?.result === 'string'
        ? (() => { try { return JSON.parse(pollRes.result) } catch { return {} } })()
        : (pollRes?.result || {})
      const failed = parsed.gate1_failed_episodes || []
      if (failed.length > 0) {
        ElMessage.warning(`Gate 1: tập ${failed.join(', ')} chưa phủ đủ mốc truyện — xem cảnh báo đỏ để viết lại`)
      } else {
        ElMessage.success('Đã viết xong kịch bản, tất cả tập pass Gate 1')
      }
      return { ok: true, failedEpisodes: failed }
    } catch (e) {
      ElMessage.error(e.message || 'Viết kịch bản thất bại')
      return { ok: false, error: e.message }
    } finally {
      writing.value = false
    }
  }

  function rewriteEpisode({ dramaId, episodeNumber, pollTask, meta, onSaved }) {
    return confirmAndWrite({ dramaId, episodeNumbers: [episodeNumber], pollTask, meta, onSaved })
  }

  return {
    outline, coverage, outlineStatus, warnings, generating, writing,
    loadOutline, generateOutline, saveOutline, confirmAndWrite, rewriteEpisode,
  }
}

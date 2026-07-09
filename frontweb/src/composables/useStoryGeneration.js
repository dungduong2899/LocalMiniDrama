import { ElMessage } from 'element-plus'
import { dramaAPI } from '@/api/drama'
import { generationAPI } from '@/api/generation'
import { stylePromptMetadataForSave } from '@/constants/styleOptions'
import { GEN_RESOURCE } from '@/stores/generationTaskStore'

/**
 * Từ story premise gọi AI tạo kịch bản nhiều tập rồi ghi vào drama (tương ứng FilmCreate.onGenerateStory)
 * Việc tạo và lưu do task async của backend xử lý, rời trang vẫn tiếp tục lưu vào DB.
 * @returns {Promise<{ ok: boolean, dramaId?: number, episodeCount?: number, error?: string }>}
 */
export async function runGenerateStoryFromPremise({
  premise,
  storyStyle,
  storyType,
  storyEpisodeCount,
  scriptTitle,
  generationStyle,
  projectAspectRatio,
  store,
  router,
  route,
  loadDrama,
  savedCurrentEpisodeNumber,
  selectedEpisodeId,
  onEpisodeSelect,
  storyGenerating,
  scriptGenerating,
  pollTask,
  replaceRouteWhenNew = true,
  onComplete,
  /** Khi true sẽ không gọi loadDrama sau khi lưu tập/premise (dùng cho trang quản lý kịch bản, tạo xong router.push thẳng vào trang sáng tác) */
  skipPostLoad = false,
}) {
  const text = (premise || '').trim()
  if (!text) {
    ElMessage.warning('Vui lòng nhập story premise trước')
    return { ok: false }
  }

  storyGenerating.value = true
  try {
    let dramaId = store.dramaId
    if (!dramaId) {
      const drama = await dramaAPI.create({
        title: scriptTitle || 'Câu chuyện mới',
        description: text,
        genre: storyType || undefined,
        style: generationStyle || undefined,
        metadata: {
          ...stylePromptMetadataForSave(generationStyle),
          story_style: storyStyle || undefined,
          aspect_ratio: projectAspectRatio || '16:9',
        },
      })
      store.setDrama(drama)
      dramaId = drama.id
      if (replaceRouteWhenNew && route?.params?.id === 'new' && router) {
        router.replace('/film/' + dramaId)
      }
    }

    const dramaTitle = store.drama?.title || scriptTitle || 'Dự án'
    const meta = {
      dramaId,
      episodeId: store.currentEpisode?.id ?? selectedEpisodeId?.value ?? 0,
      dramaTitle,
      episodeNumber: store.currentEpisode?.episode_number ?? 1,
      resourceType: GEN_RESOURCE.GENERATE_STORY,
      resourceId: Number(dramaId),
      label: `${dramaTitle} tạo kịch bản`,
    }

    scriptGenerating.value = true
    try {
      const res = await generationAPI.generateStory({
        drama_id: dramaId,
        premise: text,
        style: storyStyle || undefined,
        type: storyType || undefined,
        episode_count: storyEpisodeCount || 1,
        title: scriptTitle || undefined,
        summary: text,
        genre: storyType || undefined,
        drama_style: generationStyle || undefined,
        metadata: {
          ...stylePromptMetadataForSave(generationStyle),
          story_style: storyStyle || undefined,
          aspect_ratio: projectAspectRatio || '16:9',
        },
      })

      const taskId = res?.task_id
      if (!taskId) {
        ElMessage.error('Không khởi động được task tạo kịch bản')
        return { ok: false }
      }

      const pollRes = await pollTask(taskId, () => loadDrama?.(), meta)
      if (pollRes?.status !== 'completed') {
        return { ok: false, error: pollRes?.error || 'Tạo kịch bản thất bại' }
      }

      savedCurrentEpisodeNumber.value = 1

      if (!skipPostLoad) {
        await loadDrama()

        const firstEp = (store.drama?.episodes || [])[0]
        if (firstEp) {
          selectedEpisodeId.value = firstEp.id
          onEpisodeSelect(firstEp.id)
        }
      }

      const parsedResult = typeof pollRes?.result === 'string'
        ? (() => { try { return JSON.parse(pollRes.result) } catch { return {} } })()
        : (pollRes?.result || {})
      const n = (store.drama?.episodes || []).length || parsedResult.episode_count || 1
      if (!skipPostLoad) {
        ElMessage.success(n > 1 ? `Đã tạo kịch bản, tổng ${n} tập, đã chọn mặc định tập 1` : 'Đã tạo và lưu kịch bản')
      } else {
        ElMessage.success(n > 1 ? `Đã tạo kịch bản, tổng ${n} tập` : 'Đã tạo và lưu kịch bản')
      }
      if (typeof onComplete === 'function') {
        onComplete({ episodeCount: n, dramaId })
      }
      return { ok: true, dramaId, episodeCount: n }
    } catch (e) {
      ElMessage.error(e.message || 'Tạo kịch bản thất bại')
      return { ok: false, error: e.message }
    } finally {
      scriptGenerating.value = false
    }
  } catch (e) {
    ElMessage.error(e.message || 'Tạo câu chuyện thất bại')
    return { ok: false, error: e.message }
  } finally {
    storyGenerating.value = false
  }
}

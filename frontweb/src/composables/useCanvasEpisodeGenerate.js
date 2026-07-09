import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dramaAPI } from '@/api/drama'
import { storyboardsAPI } from '@/api/storyboards'
import { taskAPI } from '@/api/task'
import { parseDramaMetadata } from '@/utils/canvasLayout'
import { getDramaGenerationOptions } from '@/utils/canvasWorkflow'
import { runImageStep, runVideoStep } from '@/composables/useCanvasWorkflowRunner'
import { hasStoryboardImage, hasStoryboardVideo } from '@/utils/storyboardMedia'
import { CANVAS_NODE_STATUS_LABELS } from '@/composables/useCanvasNodeStatus'

async function pollTask(taskId, onTick, maxAttempts = 450, interval = 2000) {
  if (!taskId) return { status: 'completed' }
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, interval))
    try {
      const t = await taskAPI.get(taskId)
      if (t.status === 'completed') return { status: 'completed', result: t.result }
      if (t.status === 'failed') {
        return { status: 'failed', error: t.error?.message || t.error || 'Task thất bại' }
      }
      onTick?.()
    } catch (e) {
      if (i === maxAttempts - 1) return { status: 'failed', error: e.message || 'Polling thất bại' }
    }
  }
  return { status: 'timeout', error: 'Task timeout' }
}

/** Chế độ canvas: AI tạo storyboard cho tập hiện tại + tạo ảnh/tạo video hàng loạt */
export function useCanvasEpisodeGenerate(deps) {
  const {
    drama,
    filterEpisodeId,
    imagesBySbId,
    videosBySbId,
    refreshCanvas,
    nodeStatus,
  } = deps

  const episodeGenerating = ref(false)
  const episodeGenProgress = ref('')

  function getEpisode() {
    const epId = filterEpisodeId.value
    if (!epId) return null
    return (drama.value?.episodes || []).find((ep) => ep.id === epId) || null
  }

  function getStoryboardsForEpisode() {
    return getEpisode()?.storyboards || []
  }

  function buildStoryboardApiOptions() {
    const meta = parseDramaMetadata(drama.value?.metadata)
    const gen = getDramaGenerationOptions(drama.value)
    const ep = getEpisode()
    const scriptLen = (ep?.script_content || '').trim().length
    let videoDuration
    if (meta.video_clip_duration) {
      videoDuration = Number(meta.video_clip_duration)
    } else if (scriptLen > 0) {
      videoDuration = Math.max(10, Math.round(10 + (scriptLen / 600) * 60))
    }
    return {
      style: gen.style || undefined,
      aspect_ratio: gen.aspectRatio,
      video_duration: videoDuration,
      include_narration: !!meta.storyboard_include_narration,
      universal_omni_storyboard: !!meta.storyboard_universal_omni,
    }
  }

  function setSbBusy(sb, step, message) {
    const sbNodeId = `sb:${sb.id}`
    nodeStatus?.set(sbNodeId, { step, message })
    if (step === 'image') nodeStatus?.set(`sbimg:${sb.id}`, { step, message })
    if (step === 'video') nodeStatus?.set(`sbvid:${sb.id}`, { step, message })
  }

  function clearSbBusy(sb) {
    nodeStatus?.clear(`sb:${sb.id}`)
    nodeStatus?.clear(`sbimg:${sb.id}`)
    nodeStatus?.clear(`sbvid:${sb.id}`)
  }

  function clearEpisodeSbBusy() {
    for (const sb of getStoryboardsForEpisode()) clearSbBusy(sb)
  }

  function getGenOpts() {
    return {
      ...getDramaGenerationOptions(drama.value),
      imagesBySbId: imagesBySbId.value,
    }
  }

  async function aiGenerateStoryboards() {
    const ep = getEpisode()
    if (!ep) {
      ElMessage.warning('Vui lòng chọn một tập ở thanh trên trước (AI tạo cho kịch bản của từng tập)')
      return
    }
    if (!(ep.script_content || '').trim()) {
      ElMessage.warning('Tập này chưa có kịch bản, vui lòng viết hoặc nhập kịch bản ở chế độ danh sách trước')
      return
    }
    const existing = getStoryboardsForEpisode()
    if (existing.length > 0) {
      try {
        await ElMessageBox.confirm(
          `Tập ${ep.episode_number || ''} đã có ${existing.length} storyboard. Tạo lại có thể thêm hoặc ghi đè nội dung, bạn có muốn tiếp tục?`,
          'AI tạo storyboard',
          { type: 'warning', confirmButtonText: 'Tiếp tục tạo' }
        )
      } catch {
        return
      }
    }

    episodeGenerating.value = true
    episodeGenProgress.value = 'AI đang phân tích kịch bản để tạo storyboard…'
    for (const sb of existing) {
      setSbBusy(sb, 'generate_sb', CANVAS_NODE_STATUS_LABELS.generate_sb)
    }
    const refreshTimer = setInterval(() => refreshCanvas(true), 2000)
    try {
      const res = await dramaAPI.generateStoryboard(ep.id, buildStoryboardApiOptions())
      const taskId = res?.task_id ?? (typeof res === 'string' ? res : null)
      if (taskId) {
        const polled = await pollTask(taskId, () => refreshCanvas(true))
        if (polled.status !== 'completed') {
          throw new Error(polled.error || 'Tạo storyboard thất bại')
        }
        if (polled.result?.truncated) {
          ElMessage.warning('Kết quả AI có thể bị cắt, vui lòng kiểm tra số lượng storyboard đã đủ chưa')
        }
      }
      await refreshCanvas(true)
      await storyboardsAPI.batchInferParams(ep.id, false).catch(() => {})
      const count = getStoryboardsForEpisode().length
      ElMessage.success(`Đã tạo xong storyboard, tổng ${count} cảnh`)
    } catch (e) {
      ElMessage.error(e?.message || 'AI tạo storyboard thất bại')
    } finally {
      clearInterval(refreshTimer)
      clearEpisodeSbBusy()
      episodeGenerating.value = false
      episodeGenProgress.value = ''
    }
  }

  async function batchGenerateImages() {
    const ep = getEpisode()
    if (!ep) {
      ElMessage.warning('Vui lòng chọn tập trước')
      return
    }
    const boards = getStoryboardsForEpisode()
    const todo = boards.filter(
      (sb) => sb.creation_mode !== 'universal' && !hasStoryboardImage(sb, imagesBySbId.value, drama.value)
    )
    if (!todo.length) {
      ElMessage.info('Tất cả storyboard của tập hiện tại đã có ảnh (storyboard chế độ universal chuyển thẳng sang tạo video)')
      return
    }
    try {
      await ElMessageBox.confirm(
        `Sẽ lần lượt tạo ảnh cho ${todo.length} storyboard, có thể mất thời gian, bạn có muốn tiếp tục?`,
        'Tạo ảnh storyboard hàng loạt',
        { type: 'info', confirmButtonText: 'Bắt đầu' }
      )
    } catch {
      return
    }

    episodeGenerating.value = true
    let ok = 0
    let failed = 0
    try {
      for (let i = 0; i < todo.length; i++) {
        const sb = todo[i]
        episodeGenProgress.value = `Tạo ảnh hàng loạt ${i + 1}/${todo.length}: storyboard #${sb.storyboard_number ?? sb.id}`
        setSbBusy(sb, 'image', `${CANVAS_NODE_STATUS_LABELS.image} ${i + 1}/${todo.length}`)
        try {
          await runImageStep(drama.value, sb, getGenOpts())
          ok++
          await refreshCanvas(true)
        } catch (e) {
          failed++
          ElMessage.error(`Storyboard #${sb.storyboard_number ?? sb.id} tạo ảnh thất bại: ${e?.message || e}`)
        } finally {
          clearSbBusy(sb)
        }
      }
      if (failed === 0) ElMessage.success(`Đã tạo ảnh hàng loạt xong, tổng ${ok} cảnh`)
      else ElMessage.warning(`Hoàn tất ${ok} cảnh, thất bại ${failed} cảnh`)
    } finally {
      episodeGenerating.value = false
      episodeGenProgress.value = ''
    }
  }

  async function batchGenerateVideos() {
    const ep = getEpisode()
    if (!ep) {
      ElMessage.warning('Vui lòng chọn tập trước')
      return
    }
    const boards = getStoryboardsForEpisode()
    const todo = boards.filter((sb) => !hasStoryboardVideo(sb, videosBySbId.value))
    if (!todo.length) {
      ElMessage.info('Tất cả storyboard của tập hiện tại đã có video')
      return
    }
    try {
      await ElMessageBox.confirm(
        `Sẽ lần lượt tạo video cho ${todo.length} storyboard, bạn có muốn tiếp tục?`,
        'Tạo video storyboard hàng loạt',
        { type: 'info', confirmButtonText: 'Bắt đầu' }
      )
    } catch {
      return
    }

    episodeGenerating.value = true
    let ok = 0
    let failed = 0
    try {
      for (let i = 0; i < todo.length; i++) {
        const sb = todo[i]
        episodeGenProgress.value = `Tạo video hàng loạt ${i + 1}/${todo.length}: storyboard #${sb.storyboard_number ?? sb.id}`
        setSbBusy(sb, 'video', `${CANVAS_NODE_STATUS_LABELS.video} ${i + 1}/${todo.length}`)
        try {
          await runVideoStep(drama.value, sb, getGenOpts())
          ok++
          await refreshCanvas(true)
        } catch (e) {
          failed++
          ElMessage.error(`Storyboard #${sb.storyboard_number ?? sb.id} tạo video thất bại: ${e?.message || e}`)
        } finally {
          clearSbBusy(sb)
        }
      }
      if (failed === 0) ElMessage.success(`Đã tạo video hàng loạt xong, tổng ${ok} cảnh`)
      else ElMessage.warning(`Hoàn tất ${ok} cảnh, thất bại ${failed} cảnh`)
    } finally {
      episodeGenerating.value = false
      episodeGenProgress.value = ''
    }
  }

  return {
    episodeGenerating,
    episodeGenProgress,
    aiGenerateStoryboards,
    batchGenerateImages,
    batchGenerateVideos,
  }
}

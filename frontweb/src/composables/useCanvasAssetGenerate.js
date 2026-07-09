import { taskAPI } from '@/api/task'
import { characterAPI } from '@/api/characters'
import { sceneAPI } from '@/api/scenes'
import { propAPI } from '@/api/props'
import { assetImageUrl } from '@/utils/mediaUrl'
import { CANVAS_NODE_STATUS_LABELS } from '@/composables/useCanvasNodeStatus'

async function pollTask(taskId, onTick, maxAttempts = 450, interval = 2000) {
  if (!taskId) return { status: 'completed' }
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, interval))
    onTick?.()
    try {
      const t = await taskAPI.get(taskId)
      if (t.status === 'completed') return { status: 'completed', result: t.result }
      if (t.status === 'failed') {
        return { status: 'failed', error: t.error?.message || t.error || 'Task thất bại' }
      }
    } catch (e) {
      if (i === maxAttempts - 1) return { status: 'failed', error: e.message || 'Polling thất bại' }
    }
  }
  return { status: 'timeout', error: 'Task timeout' }
}

async function pollUntilHasImage(findEntity, maxAttempts = 120, interval = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    const entity = findEntity()
    if (entity && assetImageUrl(entity)) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

/**
 * Tạo ảnh tham chiếu cho tư liệu (kèm polling), đồng thời đồng bộ trạng thái busy của node lên card preview
 */
export async function generateAssetReferenceImage(ctx, { kind, entity, nodeId }) {
  const nodeStatus = ctx?.nodeStatus
  const drama = ctx?.drama?.value
  nodeStatus?.set(nodeId, { step: 'ref_image', message: CANVAS_NODE_STATUS_LABELS.ref_image })

  try {
    let res
    if (kind === 'character') {
      res = await characterAPI.generateImage(entity.id)
    } else if (kind === 'scene') {
      res = await sceneAPI.generateImage({ scene_id: entity.id, drama_id: drama?.id })
    } else {
      res = await propAPI.generateImage(entity.id)
    }

    const taskId = res?.image_generation?.task_id ?? res?.task_id
    if (taskId) {
      const polled = await pollTask(taskId, () => ctx?.refreshDrama?.(true))
      if (polled.status !== 'completed') throw new Error(polled.error || 'Tạo thất bại')
    } else {
      await ctx?.refreshDrama?.(true)
      const ok = await pollUntilHasImage(() => {
        const list = kind === 'character'
          ? ctx?.drama?.value?.characters
          : kind === 'scene'
            ? ctx?.drama?.value?.scenes
            : ctx?.drama?.value?.props
        return (list || []).find((x) => Number(x.id) === Number(entity.id))
      })
      if (!ok) throw new Error('Tạo timeout, vui lòng làm mới để xem lại')
    }
    await ctx?.refresh?.(true)
    return { ok: true }
  } finally {
    nodeStatus?.clear(nodeId)
  }
}

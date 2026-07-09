import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { dramaAPI } from '@/api/drama'
import { generationAPI } from '@/api/generation'
import { propAPI } from '@/api/props'
import { taskAPI } from '@/api/task'
import { getDramaGenerationOptions } from '@/utils/canvasWorkflow'
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

export function scriptNodeId(episodeId) {
  return `script:${episodeId}`
}

function buildEpisodesPayload(drama, episodeId, patch) {
  return (drama?.episodes || []).map((ep, i) => {
    const base = {
      episode_number: ep.episode_number ?? i + 1,
      title: ep.title || `Tập ${ep.episode_number ?? i + 1}`,
      script_content: ep.script_content || '',
      description: ep.description ?? null,
      duration: ep.duration ?? 0,
    }
    if (Number(ep.id) === Number(episodeId)) {
      return { ...base, ...patch }
    }
    return base
  })
}

/** Canvas: chỉnh sửa kịch bản + trích xuất nhân vật/scene/đạo cụ từ kịch bản */
export function useCanvasScript(deps) {
  const { drama, dramaId, refreshCanvas, nodeStatus } = deps
  const scriptBusy = ref(false)

  function setScriptBusy(episodeId, step, message) {
    nodeStatus?.set(scriptNodeId(episodeId), { step, message })
  }

  function clearScriptBusy(episodeId) {
    nodeStatus?.clear(scriptNodeId(episodeId))
  }

  async function runExtractTask(taskId, label) {
    if (!taskId) {
      await refreshCanvas(true)
      return
    }
    const polled = await pollTask(taskId, () => refreshCanvas(true))
    if (polled.status !== 'completed') {
      throw new Error(polled.error || `${label} thất bại`)
    }
    await refreshCanvas(true)
  }

  async function saveScript(episodeId, { scriptContent, title }) {
    const did = dramaId.value
    const d = drama.value
    if (!did || !d || !episodeId) throw new Error('Thiếu dự án hoặc tập')

    scriptBusy.value = true
    setScriptBusy(episodeId, 'save_script', CANVAS_NODE_STATUS_LABELS.save_script)
    try {
      const payload = buildEpisodesPayload(d, episodeId, {
        script_content: (scriptContent || '').trim(),
        title: (title || '').trim() || undefined,
      })
      await dramaAPI.saveEpisodes(did, payload)
      await refreshCanvas(true)
      ElMessage.success('Đã lưu kịch bản')
    } finally {
      scriptBusy.value = false
      clearScriptBusy(episodeId)
    }
  }

  async function _extractCharacters(episodeId, scriptContent) {
    const did = dramaId.value
    const outline = (scriptContent || '').trim() || undefined
    const res = await generationAPI.generateCharacters(did, {
      episode_id: episodeId,
      outline,
    })
    await runExtractTask(res?.task_id, 'Trích xuất nhân vật')
  }

  async function _extractScenes(episodeId) {
    const style = getDramaGenerationOptions(drama.value).style || undefined
    const res = await dramaAPI.extractBackgrounds(episodeId, {
      model: undefined,
      style,
      language: 'zh',
    })
    await runExtractTask(res?.task_id, 'Trích xuất scene')
  }

  async function _extractProps(episodeId) {
    const res = await propAPI.extractFromScript(episodeId)
    await runExtractTask(res?.task_id, 'Trích xuất đạo cụ')
  }

  async function extractCharacters(episodeId, scriptContent) {
    if (!dramaId.value || !episodeId) throw new Error('Vui lòng chọn tập trước')
    scriptBusy.value = true
    setScriptBusy(episodeId, 'extract_chars', CANVAS_NODE_STATUS_LABELS.extract_chars)
    try {
      await _extractCharacters(episodeId, scriptContent)
      ElMessage.success('Đã trích xuất nhân vật')
    } finally {
      scriptBusy.value = false
      clearScriptBusy(episodeId)
    }
  }

  async function extractScenes(episodeId) {
    if (!episodeId) throw new Error('Vui lòng chọn tập trước')
    scriptBusy.value = true
    setScriptBusy(episodeId, 'extract_scenes', CANVAS_NODE_STATUS_LABELS.extract_scenes)
    try {
      await _extractScenes(episodeId)
      ElMessage.success('Đã trích xuất scene')
    } finally {
      scriptBusy.value = false
      clearScriptBusy(episodeId)
    }
  }

  async function extractProps(episodeId) {
    if (!episodeId) throw new Error('Vui lòng chọn tập trước')
    scriptBusy.value = true
    setScriptBusy(episodeId, 'extract_props', CANVAS_NODE_STATUS_LABELS.extract_props)
    try {
      await _extractProps(episodeId)
      ElMessage.success('Đã trích xuất đạo cụ')
    } finally {
      scriptBusy.value = false
      clearScriptBusy(episodeId)
    }
  }

  async function extractAll(episodeId, scriptContent) {
    if (!episodeId) throw new Error('Vui lòng chọn tập trước')
    const content = (scriptContent || '').trim()
    if (!content) throw new Error('Vui lòng nhập nội dung kịch bản trước')

    scriptBusy.value = true
    let didWork = false
    try {
      if ((drama.value?.characters || []).length === 0) {
        setScriptBusy(episodeId, 'extract_chars', '1/3 Trích xuất nhân vật…')
        await _extractCharacters(episodeId, content)
        didWork = true
      }
      if ((drama.value?.scenes || []).length === 0) {
        setScriptBusy(episodeId, 'extract_scenes', '2/3 Trích xuất scene…')
        await _extractScenes(episodeId)
        didWork = true
      }
      if ((drama.value?.props || []).length === 0) {
        setScriptBusy(episodeId, 'extract_props', '3/3 Trích xuất đạo cụ…')
        await _extractProps(episodeId)
        didWork = true
      }

      if (!didWork) {
        ElMessage.info('Nhân vật, scene, đạo cụ đều đã có, không cần trích xuất lại')
      } else {
        ElMessage.success(
          `Đã trích xuất: ${(drama.value?.characters || []).length} nhân vật · ${(drama.value?.scenes || []).length} scene · ${(drama.value?.props || []).length} đạo cụ`
        )
      }
    } catch (e) {
      ElMessage.error(e?.message || 'Trích xuất thất bại')
      throw e
    } finally {
      scriptBusy.value = false
      clearScriptBusy(episodeId)
    }
  }

  return {
    scriptBusy,
    saveScript,
    extractCharacters,
    extractScenes,
    extractProps,
    extractAll,
  }
}

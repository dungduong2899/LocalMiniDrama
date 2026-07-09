import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { dramaAPI } from '@/api/drama'
import { storyboardsAPI } from '@/api/storyboards'
import { sceneAPI } from '@/api/scenes'
import { propAPI } from '@/api/props'

/** Gộp nhân vật cấp drama và nhân vật đã gán cho tập hiện tại, tránh drama.characters bị cắt khi lưu layout */
function collectExistingCharacters(dramaData, episodeId) {
  const map = new Map()
  for (const c of dramaData?.characters || []) {
    if (c?.id != null) map.set(Number(c.id), c)
  }
  if (episodeId != null) {
    const ep = (dramaData?.episodes || []).find((e) => Number(e.id) === Number(episodeId))
    for (const c of ep?.characters || []) {
      if (c?.id != null && !map.has(Number(c.id))) map.set(Number(c.id), c)
    }
  }
  return [...map.values()]
}

function toCharacterSavePayload(c) {
  return {
    id: c.id,
    name: c.name || '',
    role: c.role || undefined,
    description: c.description || undefined,
    personality: c.personality || undefined,
    appearance: c.appearance || undefined,
    image_url: c.image_url || undefined,
    local_path: c.local_path || undefined,
  }
}

/** Tạo entity mới trong canvas (dùng chung API với chế độ danh sách) */
export function useCanvasCrud(deps) {
  const {
    drama,
    filterEpisodeId,
    layoutCache,
    focusedNodeId,
    refreshCanvas,
    persistCanvasState,
  } = deps

  const createDialogVisible = ref(false)
  const createDialogType = ref('storyboard')
  /** Toạ độ trên canvas khi tạo qua menu chuột phải { x, y } */
  const pendingFlowPosition = ref(null)

  function resolveEpisodeId() {
    if (filterEpisodeId.value) return filterEpisodeId.value
    const eps = drama.value?.episodes || []
    if (eps.length === 1) return eps[0].id
    return null
  }

  function openCreateDialog(type, flowPosition = null) {
    if (['storyboard', 'character', 'scene', 'prop'].includes(type) && !resolveEpisodeId()) {
      ElMessage.warning('Vui lòng chọn tập trước (hoặc đảm bảo dự án có ít nhất một tập)')
      return
    }
    createDialogType.value = type
    pendingFlowPosition.value = flowPosition
    createDialogVisible.value = true
  }

  async function saveNodePosition(nodeId, pos) {
    if (!pos || !nodeId) return
    const prev = layoutCache.value || { version: 1, nodes: {} }
    layoutCache.value = {
      ...prev,
      version: 1,
      nodes: {
        ...(prev.nodes || {}),
        [nodeId]: { x: pos.x, y: pos.y },
      },
    }
    await persistCanvasState({ layoutOnly: true })
  }

  async function focusAfterCreate(nodeId) {
    await refreshCanvas()
    if (nodeId) focusedNodeId.value = nodeId
    pendingFlowPosition.value = null
  }

  async function createStoryboard(form) {
    const episodeId = resolveEpisodeId()
    if (!episodeId) throw new Error('Vui lòng chọn tập trước')

    const boards = (drama.value?.episodes || [])
      .find((ep) => ep.id === episodeId)?.storyboards || []
    const maxNum = boards.reduce((max, sb) => Math.max(max, sb.storyboard_number || 0), 0)
    const nextNum = maxNum + 1
    const title = (form.title || '').trim() || `Cảnh ${nextNum}`

    const sb = await storyboardsAPI.create({
      episode_id: episodeId,
      storyboard_number: nextNum,
      title,
      description: (form.description || '').trim() || '',
    })

    const nodeId = `sb:${sb.id}`
    const pos = pendingFlowPosition.value
    if (pos) await saveNodePosition(nodeId, pos)
    await focusAfterCreate(nodeId)
    ElMessage.success('Đã thêm storyboard')
    return sb
  }

  async function createEpisode(form) {
    const dramaId = drama.value?.id
    if (!dramaId) throw new Error('Dự án chưa được tải')

    const list = drama.value.episodes || []
    const nextNum = list.length > 0
      ? Math.max(...list.map((ep) => Number(ep.episode_number) || 0), 0) + 1
      : 1
    const title = (form.title || '').trim() || `Tập ${nextNum}`

    const updated = list.map((ep, i) => ({
      episode_number: ep.episode_number ?? i + 1,
      title: ep.title || `Tập ${ep.episode_number ?? i + 1}`,
      script_content: ep.script_content || '',
      description: ep.description ?? null,
      duration: ep.duration ?? 0,
    }))
    updated.push({
      episode_number: nextNum,
      title,
      script_content: '',
      description: null,
      duration: 0,
    })

    await dramaAPI.saveEpisodes(dramaId, updated)
    await refreshCanvas()

    const newEp = (drama.value?.episodes || []).find((ep) => Number(ep.episode_number) === nextNum)
    if (newEp?.id) {
      filterEpisodeId.value = newEp.id
      const pos = pendingFlowPosition.value
      if (pos) await saveNodePosition(`episode:${newEp.id}`, pos)
      await refreshCanvas()
    }
    pendingFlowPosition.value = null
    ElMessage.success(`Đã thêm ${title}`)
  }

  async function createCharacter(form) {
    const dramaId = drama.value?.id
    const episodeId = resolveEpisodeId()
    if (!dramaId) throw new Error('Dự án chưa được tải')

    const beforeIds = new Set((drama.value?.characters || []).map((c) => c.id))

    const existing = collectExistingCharacters(drama.value, episodeId).map(toCharacterSavePayload)

    const name = form.name.trim()
    await dramaAPI.saveCharacters(dramaId, {
      characters: [...existing, {
        name,
        role: form.role?.trim() || undefined,
        description: form.description?.trim() || undefined,
        appearance: form.appearance?.trim() || undefined,
      }],
      episode_id: episodeId ?? undefined,
    })

    await refreshCanvas()
    const newChar = (drama.value?.characters || []).find((c) => !beforeIds.has(c.id))
      || (drama.value?.characters || []).find((c) => c.name === name)
    const nodeId = newChar?.id ? `char:${newChar.id}` : null
    const pos = pendingFlowPosition.value
    if (nodeId && pos) await saveNodePosition(nodeId, pos)
    await focusAfterCreate(nodeId)
    ElMessage.success('Đã thêm nhân vật')
  }

  async function createScene(form) {
    const dramaId = drama.value?.id
    const episodeId = resolveEpisodeId()
    if (!dramaId) throw new Error('Dự án chưa được tải')

    const scene = await sceneAPI.create({
      drama_id: dramaId,
      episode_id: episodeId ?? undefined,
      location: form.location.trim(),
      time: form.time?.trim() || undefined,
      prompt: form.prompt?.trim() || undefined,
    })

    const sceneId = scene?.id ?? scene?.scene?.id
    const nodeId = sceneId ? `scene:${sceneId}` : null
    const pos = pendingFlowPosition.value
    if (nodeId && pos) await saveNodePosition(nodeId, pos)
    await focusAfterCreate(nodeId)
    ElMessage.success('Đã thêm scene')
  }

  async function createProp(form) {
    const dramaId = drama.value?.id
    const episodeId = resolveEpisodeId()
    if (!dramaId) throw new Error('Dự án chưa được tải')

    const prop = await propAPI.create({
      drama_id: dramaId,
      episode_id: episodeId ?? undefined,
      name: form.name.trim(),
      description: form.description?.trim() || undefined,
      prompt: form.prompt?.trim() || undefined,
    })

    const propId = prop?.id ?? prop?.prop?.id
    const nodeId = propId ? `prop:${propId}` : null
    const pos = pendingFlowPosition.value
    if (nodeId && pos) await saveNodePosition(nodeId, pos)
    await focusAfterCreate(nodeId)
    ElMessage.success('Đã thêm đạo cụ')
  }

  async function submitCreate(form) {
    const type = createDialogType.value
    if (type === 'storyboard') await createStoryboard(form)
    else if (type === 'episode') await createEpisode(form)
    else if (type === 'character') await createCharacter(form)
    else if (type === 'scene') await createScene(form)
    else if (type === 'prop') await createProp(form)
    createDialogVisible.value = false
  }

  return {
    createDialogVisible,
    createDialogType,
    pendingFlowPosition,
    openCreateDialog,
    submitCreate,
    resolveEpisodeId,
  }
}

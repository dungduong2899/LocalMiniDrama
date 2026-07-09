import { GEN_RESOURCE } from '@/stores/generationTaskStore'

export function buildExtractTaskMeta(store, dramaId, episodeId, resourceType, labelSuffix) {
  const dramaTitle = store.drama?.title || ''
  const ep = store.drama?.episodes?.find((e) => Number(e.id) === Number(episodeId))
    || (Number(store.currentEpisode?.id) === Number(episodeId) ? store.currentEpisode : null)
  const epNum = ep?.episode_number ?? store.currentEpisode?.episode_number
  const epLabel = dramaTitle ? `${dramaTitle} · Tập ${epNum ?? ''}` : `Tập ${epNum ?? ''}`
  return {
    dramaId,
    episodeId,
    dramaTitle,
    episodeNumber: epNum,
    resourceType,
    resourceId: episodeId,
    label: `${epLabel} ${labelSuffix}`,
  }
}

export function isEpisodeExtractRunning(genStore, dramaId, episodeId, resourceType) {
  if (dramaId == null || episodeId == null || !genStore) return false
  return genStore.isRunning({
    dramaId,
    episodeId,
    resourceType,
    resourceId: episodeId,
  })
}

/**
 * Đồng bộ các task đang chạy của tập hiện tại từ global task store về các loading Sets local trong FilmCreate.
 */
export function syncGeneratingSetsFromStore(genStore, dramaId, episodeId, sets) {
  if (dramaId == null || episodeId == null || !genStore) return

  const running = genStore.getRunningForEpisode(dramaId, episodeId)
  const runningCharIds = new Set()
  const runningPropIds = new Set()
  const runningSceneIds = new Set()
  const runningSbImageIds = new Set()
  const runningSbFirstIds = new Set()
  const runningSbLastIds = new Set()
  const runningSbVideoIds = new Set()

  for (const t of running) {
    const id = t.resourceId
    if (id == null) continue
    switch (t.resourceType) {
      case GEN_RESOURCE.CHAR_IMAGE:
        runningCharIds.add(id)
        sets.generatingCharIds?.add(id)
        break
      case GEN_RESOURCE.PROP_IMAGE:
        runningPropIds.add(id)
        sets.generatingPropIds?.add(id)
        break
      case GEN_RESOURCE.SCENE_IMAGE:
        runningSceneIds.add(id)
        sets.generatingSceneIds?.add(id)
        break
      case GEN_RESOURCE.SB_IMAGE:
        runningSbImageIds.add(id)
        sets.generatingSbImageIds?.add(id)
        break
      case GEN_RESOURCE.SB_FIRST_IMAGE:
        runningSbFirstIds.add(id)
        sets.generatingSbFirstImageIds?.add(id)
        break
      case GEN_RESOURCE.SB_LAST_IMAGE:
        runningSbLastIds.add(id)
        sets.generatingSbLastImageIds?.add(id)
        break
      case GEN_RESOURCE.SB_VIDEO:
        runningSbVideoIds.add(id)
        sets.generatingSbVideoIds?.add(id)
        break
      default:
        break
    }
  }

  // Xoá loading local mà trong store đã không còn running (tránh entry zombie)
  if (sets.generatingCharIds) {
    for (const id of [...sets.generatingCharIds]) {
      if (!runningCharIds.has(id)) sets.generatingCharIds.delete(id)
    }
  }
  if (sets.generatingPropIds) {
    for (const id of [...sets.generatingPropIds]) {
      if (!runningPropIds.has(id)) sets.generatingPropIds.delete(id)
    }
  }
  if (sets.generatingSceneIds) {
    for (const id of [...sets.generatingSceneIds]) {
      if (!runningSceneIds.has(id)) sets.generatingSceneIds.delete(id)
    }
  }
  if (sets.generatingSbImageIds) {
    for (const id of [...sets.generatingSbImageIds]) {
      if (!runningSbImageIds.has(id)) sets.generatingSbImageIds.delete(id)
    }
  }
  if (sets.generatingSbFirstImageIds) {
    for (const id of [...sets.generatingSbFirstImageIds]) {
      if (!runningSbFirstIds.has(id)) sets.generatingSbFirstImageIds.delete(id)
    }
  }
  if (sets.generatingSbLastImageIds) {
    for (const id of [...sets.generatingSbLastImageIds]) {
      if (!runningSbLastIds.has(id)) sets.generatingSbLastImageIds.delete(id)
    }
  }
  if (sets.generatingSbVideoIds) {
    for (const id of [...sets.generatingSbVideoIds]) {
      if (!runningSbVideoIds.has(id)) sets.generatingSbVideoIds.delete(id)
    }
  }
}

export function buildEpisodeContext(store, dramaId, episodeId) {
  const drama = store.drama
  const ep = drama?.episodes?.find((e) => Number(e.id) === Number(episodeId))
    || (Number(store.currentEpisode?.id) === Number(episodeId) ? store.currentEpisode : null)
  return {
    dramaId,
    episodeId,
    dramaTitle: drama?.title || '',
    episodeNumber: ep?.episode_number ?? store.currentEpisode?.episode_number,
    storyboards: ep?.storyboards || store.storyboards || [],
    characters: ep?.characters || store.characters || [],
    scenes: ep?.scenes || store.scenes || [],
    props: ep?.props || store.props || [],
    allCharacters: collectDramaAssets(drama, 'characters'),
    allProps: collectDramaAssets(drama, 'props'),
    allScenes: collectDramaAssets(drama, 'scenes'),
  }
}

function collectDramaAssets(drama, field) {
  const seen = new Set()
  const out = []
  for (const ep of drama?.episodes || []) {
    for (const item of ep[field] || []) {
      const id = item?.id
      if (id == null || seen.has(id)) continue
      seen.add(id)
      out.push(item)
    }
  }
  return out
}

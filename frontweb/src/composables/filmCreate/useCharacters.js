import { ref, reactive, watch, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { characterAPI } from '@/api/characters'
import { characterLibraryAPI } from '@/api/characterLibrary'
import { dramaAPI } from '@/api/drama'
import { generationAPI } from '@/api/generation'
import { uploadAPI } from '@/api/upload'
import { useGenerationTaskStore, GEN_RESOURCE } from '@/stores/generationTaskStore'
import { buildExtractTaskMeta, isEpisodeExtractRunning } from '@/composables/useGenerationTaskSync'

/**
 * Composable quản lý nhân vật
 * @param {object} deps - Dependencies dùng chung
 * @param {object} deps.store - Pinia store
 * @param {import('vue').ComputedRef} deps.dramaId
 * @param {import('vue').ComputedRef} deps.currentEpisodeId
 * @param {Function} deps.getSelectedStyle - Lấy phong cách tạo hiện tại
 * @param {Function} deps.loadDrama - Tải lại dữ liệu phim
 * @param {Function} deps.pollTask - Poll task bất đồng bộ
 * @param {Function} deps.pollUntilResourceHasImage - Chờ resource có ảnh
 * @param {Function} deps.hasAssetImage - Kiểm tra resource có ảnh hay không
 */
export function useCharacters(deps) {
  const { store, dramaId, currentEpisodeId, getSelectedStyle, loadDrama, pollTask, pollUntilResourceHasImage, hasAssetImage } = deps
  const genStore = useGenerationTaskStore()

  function buildCharImageMeta(char) {
    const dramaTitle = store.drama?.title || ''
    const epNum = store.currentEpisode?.episode_number
    const epLabel = dramaTitle ? `${dramaTitle} · Tập ${epNum ?? ''}` : `Tập ${epNum ?? ''}`
    return {
      dramaId: dramaId.value,
      episodeId: currentEpisodeId.value,
      dramaTitle,
      episodeNumber: epNum,
      resourceType: GEN_RESOURCE.CHAR_IMAGE,
      resourceId: char.id,
      label: `${epLabel} Ảnh nhân vật: ${char.name || char.id}`,
    }
  }

  function dataUrlToFile(dataUrl, filename) {
    const arr = dataUrl.split(',')
    const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/png'
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) u8arr[n] = bstr.charCodeAt(n)
    return new File([u8arr], filename || 'reference.png', { type: mime })
  }

  // ── Trạng thái dialog nhân vật ─────────────────────────────────────
  const showEditCharacter = ref(false)
  const editCharacterForm = ref(null)
  const editCharacterSaving = ref(false)
  const editCharacterPromptGenerating = ref(false)
  const extractingCharAppearance = ref(false)
  const extractingAnchors = ref(false)
  const addCharRefImage = ref(null)   // { dataUrl, filename }
  const addCharRefFileInput = ref(null)
  let editCharacterPollTimer = null

  // ── Trạng thái tạo nhân vật ──────────────────────────────────────
  /** True chỉ khi task "trích xuất nhân vật" của tập hiện tại đang chạy (theo tập, đổi tập không hiển thị loading nhầm) */
  const charactersGenerating = computed(() =>
    isEpisodeExtractRunning(genStore, dramaId.value, currentEpisodeId.value, GEN_RESOURCE.EXTRACT_CHARACTERS)
  )
  const generatingCharIds = reactive(new Set())
  const sd2CertifyingId = ref(null)
  const showCharSd2Cert = ref(false)
  const charSd2CertPayload = ref(null)
  const sd2VoiceUploadingId = ref(null)

  // ── Trạng thái thư viện nhân vật ────────────────────────────────────────
  const showCharLibrary = ref(false)
  const charLibraryList = ref([])
  const charLibraryLoading = ref(false)
  const charLibraryPage = ref(1)
  const charLibraryPageSize = ref(20)
  const charLibraryTotal = ref(0)
  const charLibraryKeyword = ref('')
  const showEditCharLibrary = ref(false)
  const editCharLibraryForm = ref(null)
  const editCharLibrarySaving = ref(false)
  const addingCharToLibraryId = ref(null)
  const addingCharToMaterialId = ref(null)
  const addingCharFromLibraryId = ref(null)
  let charLibraryKeywordTimer = null

  /** Tab dialog thư viện nhân vật: library | drama | team */
  const charLibraryTab = ref('library')
  const dramaAllCharList = ref([])
  const dramaAllCharLoading = ref(false)
  const dramaAllCharPage = ref(1)
  const dramaAllCharPageSize = ref(20)
  const dramaAllCharTotal = ref(0)
  const dramaAllCharKeyword = ref('')
  let dramaAllCharKeywordTimer = null


  // ── Hằng số ──────────────────────────────────────────────
  const CHAR_ROLE_LABEL = { main: 'Nhân vật chính', supporting: 'Nhân vật phụ', minor: 'Vai phụ' }
  function charRoleLabel(role) { return CHAR_ROLE_LABEL[role] || role || '' }

  // ── Hàm chính ──────────────────────────────────────────
  async function onGenerateCharacters() {
    if (!store.dramaId) return
    const epId = currentEpisodeId.value
    if (!epId) {
      ElMessage.warning('Vui lòng chọn tập trước')
      return
    }
    const meta = buildExtractTaskMeta(store, dramaId.value, epId, GEN_RESOURCE.EXTRACT_CHARACTERS, 'Trích xuất nhân vật')
    genStore.markRunning(meta)
    try {
      const outline =
        (store.scriptContent || '').toString().trim() || undefined
      const res = await generationAPI.generateCharacters(store.dramaId, {
        episode_id: epId,
        outline: outline || undefined
      })
      const taskId = res?.task_id
      if (taskId) {
        await pollTask(taskId, () => loadDrama(), meta)
        ElMessage.success('Đã tạo nhân vật xong')
      } else {
        await loadDrama()
      }
    } catch (e) {
      ElMessage.error(e.message || 'Tạo thất bại')
    } finally {
      genStore.markDone(meta)
    }
  }

  function openAddCharacter() {
    editCharacterForm.value = {
      name: '',
      role: '',
      appearance: '',
      personality: '',
      description: '',
      polished_prompt: ''
    }
    showEditCharacter.value = true
  }

  function stopCharacterPromptPoll() {
    if (editCharacterPollTimer) {
      clearInterval(editCharacterPollTimer)
      editCharacterPollTimer = null
    }
  }

  function editCharacter(char) {
    stopCharacterPromptPoll()
    editCharacterForm.value = {
      id: char.id,
      name: char.name || '',
      role: char.role || '',
      appearance: char.appearance || '',
      personality: char.personality || '',
      description: char.description || '',
      polished_prompt: char.polished_prompt || '',
      image_url: char.image_url || '',
      local_path: char.local_path || '',
      ref_image: char.ref_image || '',
      identity_anchors: char.identity_anchors || '',
      stages: char.stages ? (typeof char.stages === 'string' ? char.stages : JSON.stringify(char.stages, null, 2)) : '',
    }
    showEditCharacter.value = true
    if (!char.polished_prompt && char.id && (char.appearance || char.description)) {
      editCharacterPromptGenerating.value = true
      let elapsed = 0
      editCharacterPollTimer = setInterval(async () => {
        elapsed += 3
        try {
          const res = await characterAPI.get(char.id)
          const prompt = res?.character?.polished_prompt
          if (prompt) {
            if (editCharacterForm.value?.id === char.id) {
              editCharacterForm.value.polished_prompt = prompt
            }
            stopCharacterPromptPoll()
            editCharacterPromptGenerating.value = false
          } else if (elapsed >= 60) {
            stopCharacterPromptPoll()
            editCharacterPromptGenerating.value = false
          }
        } catch (_) {
          stopCharacterPromptPoll()
          editCharacterPromptGenerating.value = false
        }
      }, 3000)
    }
  }

  async function saveCharRefImageIfAny(characterId) {
    const refImg = addCharRefImage.value
    if (!refImg || !characterId) return
    try {
      const file = dataUrlToFile(refImg.dataUrl, refImg.filename || 'reference.png')
      const uploadRes = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
      const refPath = uploadRes.local_path || uploadRes.url || ''
      await characterAPI.putRefImage(characterId, refPath)
    } catch (e) {
      console.warn('[saveCharRefImage] failed to save reference image:', e.message)
    }
  }

  async function submitEditCharacter() {
    const form = editCharacterForm.value
    if (!form?.name?.trim() || !store.dramaId) return
    editCharacterSaving.value = true
    try {
      if (form.id) {
        await characterAPI.update(form.id, {
          name: form.name.trim(),
          role: form.role || undefined,
          appearance: form.appearance || undefined,
          personality: form.personality || undefined,
          description: form.description || undefined,
          polished_prompt: form.polished_prompt || undefined,
          stages: form.stages ? form.stages.trim() || undefined : undefined
        })
        await saveCharRefImageIfAny(form.id)
        ElMessage.success('Đã lưu nhân vật')
      } else {
        const existing = (store.drama?.characters || []).map((c) => ({
          id: c.id,
          name: c.name || '',
          role: c.role || undefined,
          description: c.description || undefined,
          personality: c.personality || undefined,
          appearance: c.appearance || undefined,
          image_url: c.image_url || undefined,
          local_path: c.local_path || undefined
        }))
        await dramaAPI.saveCharacters(store.dramaId, {
          characters: [...existing, {
            name: form.name.trim(),
            role: form.role || undefined,
            appearance: form.appearance || undefined,
            personality: form.personality || undefined,
            description: form.description || undefined
          }],
          episode_id: currentEpisodeId.value ?? undefined
        })
        await loadDrama()
        if (addCharRefImage.value) {
          const newChar = (store.drama?.characters || []).find(c => c.name === form.name.trim())
          if (newChar?.id) await saveCharRefImageIfAny(newChar.id)
        }
        ElMessage.success('Đã thêm nhân vật')
      }
      await loadDrama()
      showEditCharacter.value = false
    } catch (e) {
      ElMessage.error(e.message || (form.id ? 'Lưu thất bại' : 'Thêm thất bại'))
    } finally {
      editCharacterSaving.value = false
    }
  }

  async function doGenerateCharacterPrompt() {
    const form = editCharacterForm.value
    if (!form?.id) return
    editCharacterPromptGenerating.value = true
    try {
      const res = await characterAPI.generatePrompt(form.id)
      if (res?.polished_prompt) {
        form.polished_prompt = res.polished_prompt
        ElMessage.success('Đã tạo prompt')
        await loadDrama()
      }
    } catch (e) {
      ElMessage.error(e.message || 'Tạo prompt thất bại')
    } finally {
      editCharacterPromptGenerating.value = false
    }
  }

  async function doExtractCharFromImage() {
    const form = editCharacterForm.value
    if (!form?.id) return
    extractingCharAppearance.value = true
    try {
      const res = await characterAPI.extractFromImage(form.id)
      if (res?.appearance) {
        form.appearance = res.appearance
        ElMessage.success('Đã trích xuất mô tả ngoại hình từ ảnh')
      }
    } catch (e) {
      ElMessage.error(e.message || 'Trích xuất thất bại, vui lòng kiểm tra xem nhân vật đã có ảnh tham chiếu chưa')
    } finally {
      extractingCharAppearance.value = false
    }
  }

  async function clearCharRefImage() {
    const form = editCharacterForm.value
    if (!form?.id) return
    try {
      await characterAPI.putRefImage(form.id, null)
      form.ref_image = ''
      ElMessage.success('Đã xoá ảnh tham chiếu')
    } catch (e) {
      ElMessage.error('Xoá thất bại')
    }
  }

  function onCloseCharDialog() {
    showEditCharacter.value = false
    stopCharacterPromptPoll()
    editCharacterPromptGenerating.value = false
    addCharRefImage.value = null
  }

  async function onDeleteCharacter(char) {
    try {
      await ElMessageBox.confirm(
        `Bạn có chắc muốn xoá nhân vật "${(char.name || 'Chưa đặt tên').slice(0, 20)}"? Thao tác này không thể hoàn tác.`,
        'Xác nhận xoá',
        { type: 'warning', confirmButtonText: 'Xoá', cancelButtonText: 'Huỷ' }
      )
      await characterAPI.delete(char.id)
      await loadDrama()
      ElMessage.success('Đã xoá nhân vật')
    } catch (e) {
      if (e === 'cancel') return
      ElMessage.error(e.message || 'Xoá thất bại')
    }
  }

  async function onGenerateCharacterImage(char) {
    char.errorMsg = ''
    char.error_msg = ''
    const meta = buildCharImageMeta(char)
    generatingCharIds.add(char.id)
    genStore.markRunning(meta)
    try {
      const res = await characterAPI.generateImage(char.id, undefined, getSelectedStyle())
      const taskId = res?.image_generation?.task_id ?? res?.task_id
      if (taskId) {
        const pollRes = await pollTask(taskId, () => loadDrama(), meta)
        if (pollRes?.status === 'failed') {
          char.errorMsg = pollRes.error || 'Tạo thất bại'
        } else {
          ElMessage.success('Đã tạo ảnh nhân vật')
        }
      } else {
        await loadDrama()
        await pollUntilResourceHasImage(() => {
          const list = store.drama?.characters ?? store.currentEpisode?.characters ?? []
          const c = list.find((x) => Number(x.id) === Number(char.id))
          return !!(c && (c.image_url || c.local_path))
        })
        ElMessage.success('Đã tạo ảnh nhân vật')
      }
    } catch (e) {
      console.error(e)
      char.errorMsg = e.message || 'Tạo thất bại'
      ElMessage.error(e.message || 'Gửi thất bại')
    } finally {
      generatingCharIds.delete(char.id)
      genStore.markDone(meta)
    }
  }

  // ── Hàm thư viện nhân vật ────────────────────────────────────────
  async function loadCharLibraryList() {
    charLibraryLoading.value = true
    try {
      const res = await characterLibraryAPI.list({
        drama_id: dramaId.value,
        page: charLibraryPage.value,
        page_size: charLibraryPageSize.value,
        keyword: charLibraryKeyword.value || undefined
      })
      charLibraryList.value = res?.items ?? []
      const pagination = res?.pagination ?? {}
      charLibraryTotal.value = pagination.total ?? 0
      if (pagination.page != null) charLibraryPage.value = pagination.page
      if (pagination.page_size != null) charLibraryPageSize.value = pagination.page_size
    } catch (e) {
      charLibraryList.value = []
    } finally {
      charLibraryLoading.value = false
    }
  }

  function debouncedLoadCharLibrary() {
    if (charLibraryKeywordTimer) clearTimeout(charLibraryKeywordTimer)
    charLibraryKeywordTimer = setTimeout(() => {
      charLibraryPage.value = 1
      loadCharLibraryList()
    }, 300)
  }

  async function loadDramaAllCharList() {
    if (!dramaId.value) {
      dramaAllCharList.value = []
      dramaAllCharTotal.value = 0
      return
    }
    dramaAllCharLoading.value = true
    try {
      const res = await dramaAPI.getCharacters(dramaId.value)
      let list = Array.isArray(res) ? res : (res?.characters ?? res?.items ?? [])
      const kw = (dramaAllCharKeyword.value || '').trim().toLowerCase()
      if (kw) {
        list = list.filter((c) => {
          const name = (c.name || '').toLowerCase()
          const desc = (c.description || '').toLowerCase()
          const app = (c.appearance || '').toLowerCase()
          return name.includes(kw) || desc.includes(kw) || app.includes(kw)
        })
      }
      dramaAllCharTotal.value = list.length
      const start = (dramaAllCharPage.value - 1) * dramaAllCharPageSize.value
      dramaAllCharList.value = list.slice(start, start + dramaAllCharPageSize.value)
    } catch {
      dramaAllCharList.value = []
      dramaAllCharTotal.value = 0
    } finally {
      dramaAllCharLoading.value = false
    }
  }

  function debouncedLoadDramaAllCharList() {
    if (dramaAllCharKeywordTimer) clearTimeout(dramaAllCharKeywordTimer)
    dramaAllCharKeywordTimer = setTimeout(() => {
      dramaAllCharPage.value = 1
      loadDramaAllCharList()
    }, 300)
  }

  function onCharLibraryDialogOpen() {
    if (charLibraryTab.value === 'library') loadCharLibraryList()
    else if (charLibraryTab.value === 'drama') loadDramaAllCharList()
  }

  function onCharLibraryTabChange() {
    if (charLibraryTab.value === 'library') {
      charLibraryPage.value = 1
      loadCharLibraryList()
    } else if (charLibraryTab.value === 'drama') {
      dramaAllCharPage.value = 1
      loadDramaAllCharList()
    }
  }

  function charAddToEpisodeLoadingKey(scope, id) {
    return `${scope}-${id}`
  }

  function isCharAddToEpisodeLoading(scope, id) {
    return addingCharFromLibraryId.value === charAddToEpisodeLoadingKey(scope, id)
  }

  function openEditCharLibrary(item) {
    editCharLibraryForm.value = {
      id: item.id,
      name: item.name ?? '',
      category: item.category ?? '',
      description: item.description ?? '',
      tags: item.tags ?? ''
    }
    showEditCharLibrary.value = true
  }

  async function submitEditCharLibrary() {
    if (!editCharLibraryForm.value?.id) return
    editCharLibrarySaving.value = true
    try {
      await characterLibraryAPI.update(editCharLibraryForm.value.id, {
        name: editCharLibraryForm.value.name,
        category: editCharLibraryForm.value.category || null,
        description: editCharLibraryForm.value.description || null,
        tags: editCharLibraryForm.value.tags || null
      })
      ElMessage.success('Đã lưu')
      showEditCharLibrary.value = false
      loadCharLibraryList()
    } catch (e) {
      ElMessage.error(e.message || 'Lưu thất bại')
    } finally {
      editCharLibrarySaving.value = false
    }
  }

  async function onDeleteCharLibrary(item) {
    try {
      await ElMessageBox.confirm(
        `Bạn có chắc muốn xoá nhân vật công khai "${(item.name || 'Chưa đặt tên').slice(0, 20)}"?`,
        'Xác nhận xoá',
        { type: 'warning', confirmButtonText: 'Xoá', cancelButtonText: 'Huỷ' }
      )
      await characterLibraryAPI.delete(item.id)
      ElMessage.success('Đã xoá')
      loadCharLibraryList()
    } catch (e) {
      if (e === 'cancel') return
      ElMessage.error(e.message || 'Xoá thất bại')
    }
  }

  async function onAddCharacterToLibrary(char) {
    if (!hasAssetImage(char)) { ElMessage.warning('Vui lòng tạo hoặc tải lên ảnh cho nhân vật này trước'); return }
    addingCharToLibraryId.value = char.id
    try {
      await characterAPI.addToLibrary(char.id, {})
      ElMessage.success('Đã thêm vào thư viện nhân vật của phim')
      if (showCharLibrary.value) loadCharLibraryList()
    } catch (e) {
      ElMessage.error(e.message || 'Thêm thất bại')
    } finally {
      addingCharToLibraryId.value = null
    }
  }

  async function onAddCharacterToMaterialLibrary(char) {
    if (!hasAssetImage(char)) { ElMessage.warning('Vui lòng tạo hoặc tải lên ảnh cho nhân vật này trước'); return }
    addingCharToMaterialId.value = char.id
    try {
      await characterAPI.addToMaterialLibrary(char.id)
      ElMessage.success('Đã thêm vào thư viện tư liệu toàn cục')
    } catch (e) {
      ElMessage.error(e.message || 'Thêm thất bại')
    } finally {
      addingCharToMaterialId.value = null
    }
  }

  async function addCharToEpisode(item, scope) {
    if (!store.dramaId) return
    if (!currentEpisodeId.value) {
      ElMessage.warning('Vui lòng chọn tập hiện tại trước')
      return
    }
    const loadingKey = charAddToEpisodeLoadingKey(scope, item.id)
    addingCharFromLibraryId.value = loadingKey
    try {
      const existing = (store.characters || []).map((c) => ({
        id: c.id,
        name: c.name || '',
        role: c.role || undefined,
        appearance: c.appearance || undefined,
        personality: c.personality || undefined,
        description: c.description || undefined,
        image_url: c.image_url || undefined,
        local_path: c.local_path || undefined,
      }))
      const newCharacters = [...existing]
      const existingChar = newCharacters.find((c) => c.name === (item.name || 'Chưa đặt tên'))
      if (existingChar) {
        existingChar.description = item.description || existingChar.description
        existingChar.appearance = item.appearance || existingChar.appearance
        existingChar.image_url = item.image_url || existingChar.image_url
        existingChar.local_path = item.local_path || existingChar.local_path
        if (item.role && !existingChar.role) existingChar.role = item.role
      } else {
        newCharacters.push({
          name: item.name || 'Chưa đặt tên',
          role: item.role || undefined,
          description: item.description || undefined,
          appearance: item.appearance || undefined,
          personality: item.personality || undefined,
          image_url: item.image_url || undefined,
          local_path: item.local_path || undefined,
        })
      }
      await dramaAPI.saveCharacters(store.dramaId, {
        characters: newCharacters,
        episode_id: currentEpisodeId.value ?? undefined,
      })
      await loadDrama()
      ElMessage.success(`Đã thêm "${item.name || 'nhân vật'}" vào tập này`)
    } catch (e) {
      ElMessage.error(e.message || 'Thêm thất bại')
    } finally {
      addingCharFromLibraryId.value = null
    }
  }

  function onAddCharFromLibrary(item) {
    return addCharToEpisode(item, 'library')
  }

  function onAddDramaCharToEpisode(item) {
    return addCharToEpisode(item, 'drama')
  }

  async function extractIdentityAnchors() {
    const form = editCharacterForm.value
    if (!form?.id) return
    if (!form.appearance) {
      ElMessage.warning('Vui lòng điền mô tả ngoại hình nhân vật trước')
      return
    }
    extractingAnchors.value = true
    try {
      await characterAPI.extractAnchors(form.id)
      ElMessage.success('Đã bắt đầu trích xuất visual anchors, vui lòng xem lại sau')
      // Poll để chờ anchors được ghi
      let elapsed = 0
      const timer = setInterval(async () => {
        elapsed += 3
        try {
          const res = await characterAPI.get(form.id)
          const anchors = res?.character?.identity_anchors
          if (anchors && editCharacterForm.value?.id === form.id) {
            editCharacterForm.value.identity_anchors = anchors
            clearInterval(timer)
            extractingAnchors.value = false
          } else if (elapsed >= 60) {
            clearInterval(timer)
            extractingAnchors.value = false
          }
        } catch (_) {
          clearInterval(timer)
          extractingAnchors.value = false
        }
      }, 3000)
    } catch (e) {
      ElMessage.error(e.message || 'Trích xuất thất bại')
      extractingAnchors.value = false
    }
  }

  async function onSd2CertifyCharacter(char) {
    if (!char?.id) return
    if (!hasAssetImage(char)) {
      ElMessage.warning('Vui lòng tạo hoặc tải lên ảnh cho nhân vật này trước')
      return
    }
    sd2CertifyingId.value = char.id
    try {
      await characterAPI.sd2Certify(char.id)
      await loadDrama()
      ElMessage.success('Đã gửi yêu cầu chứng thực SD2')
    } catch (e) {
      const msg = e?.message || ''
      if (/已存在|已认证|already/i.test(msg)) {
        try {
          await characterAPI.sd2CertifyRefresh(char.id)
          await loadDrama()
          ElMessage.success('Đã làm mới trạng thái chứng thực SD2')
          return
        } catch (_) {
          // fall through
        }
      }
      ElMessage.error(msg || 'Chứng thực SD2 thất bại')
    } finally {
      sd2CertifyingId.value = null
    }
  }

  async function onSd2CertifyRefresh(char) {
    if (!char?.id) return
    sd2CertifyingId.value = char.id
    try {
      await characterAPI.sd2CertifyRefresh(char.id)
      await loadDrama()
      ElMessage.success('Đã làm mới trạng thái chứng thực SD2')
    } catch (e) {
      ElMessage.error(e?.message || 'Làm mới thất bại')
    } finally {
      sd2CertifyingId.value = null
    }
  }

  function sd2ActionLabel(char) {
    const status = String(char?.seedance2_asset?.status || '').toLowerCase()
    if (status === 'active') return 'Xem chứng thực'
    if (status === 'processing') return 'Làm mới chứng thực'
    if (status === 'failed') return 'Chứng thực lại'
    return 'Chứng thực SD2'
  }

  async function onSd2PrimaryAction(char) {
    const status = String(char?.seedance2_asset?.status || '').toLowerCase()
    if (status === 'active') {
      openCharSd2CertDialog(char)
      return
    }
    if (status === 'processing') {
      await onSd2CertifyRefresh(char)
      return
    }
    await onSd2CertifyCharacter(char)
  }

  function openCharSd2CertDialog(char) {
    charSd2CertPayload.value = char?.seedance2_asset ? { ...char.seedance2_asset } : null
    showCharSd2Cert.value = true
  }

  function sd2VoiceActionLabel(char) {
    const status = String(char?.seedance2_voice_asset?.status || '').toLowerCase()
    if (status === 'active') return 'Voice tham chiếu'
    if (status === 'processing') return 'Làm mới voice'
    if (status === 'failed') return 'Tải lên lại'
    return 'Tải lên voice'
  }

  async function onSd2VoicePrimaryAction(char) {
    const status = String(char?.seedance2_voice_asset?.status || '').toLowerCase()
    if (status === 'active') {
      ElMessage.info('Voice tham chiếu đã được thiết lập, sẽ dùng trong model Seedance 2.0')
      return
    }
    if (status === 'processing' || status === 'stale') {
      await onSd2VoiceRefresh(char)
      return
    }
    // Kích hoạt chọn file để tải lên
    await triggerSd2VoiceUpload(char)
  }

  // Dùng riêng để "thay thế": bất kể trạng thái hiện tại, luôn trigger chọn file để tải lên (ghi đè)
  async function onSd2VoiceReplace(char) {
    await triggerSd2VoiceUpload(char)
  }

  async function onSd2VoiceRefresh(char) {
    if (!char?.id) return
    sd2VoiceUploadingId.value = char.id
    try {
      const res = await characterAPI.sd2VoiceRefresh(char.id)
      await loadDrama()
      ElMessage.success(res?.data?.message || 'Đã làm mới trạng thái voice')
    } catch (e) {
      ElMessage.error(e?.message || 'Làm mới thất bại')
    } finally {
      sd2VoiceUploadingId.value = null
    }
  }

  async function triggerSd2VoiceUpload(char) {
    if (!char?.id) return
    // Tạo file input ẩn
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*'
    input.onchange = async () => {
      const file = input.files && input.files[0]
      if (!file) return
      sd2VoiceUploadingId.value = char.id
      try {
        const res = await characterAPI.sd2VoiceUpload(char.id, file)
        ElMessage.success('Đã tải lên voice tham chiếu Seedance 2.0')
        // Force reload toàn bộ dữ liệu kịch bản để đảm bảo seedance2_voice_asset được parse và cập nhật vào store
        await loadDrama()
      } catch (e) {
        ElMessage.error(e?.message || 'Tải lên voice thất bại')
      } finally {
        sd2VoiceUploadingId.value = null
      }
    }
    input.click()
  }

  // Phát voice tham chiếu Seedance 2.0 (chỉ khi status active)
  function playSd2Voice(char) {
    const url = char?.seedance2_voice_asset?.url
    if (!url) {
      ElMessage.warning('Nhân vật này chưa có audio voice tham chiếu')
      return
    }
    try {
      // Dùng relative /static/... (giống assetImageUrl cho ảnh), xử lý bởi origin trang hiện tại + Vite/backend proxy hoặc static serve
      const audio = new Audio(url)
      audio.onerror = () => {
        // Nguyên nhân thường gặp: file không nằm trong static root (đường dẫn ghi của backend không khớp với express.static(storageRoot)), 404, hoặc format không hỗ trợ
        ElMessage.error('Phát audio thất bại: file có thể không tồn tại hoặc đường dẫn không khớp, hãy thử tải lên lại voice tham chiếu')
      }
      audio.play().catch((err) => {
        ElMessage.error('Phát audio thất bại, vui lòng kiểm tra file hoặc thử lại sau')
      })
    } catch (e) {
      ElMessage.error('Không thể phát audio')
    }
  }

  return {
    // Trạng thái dialog
    showEditCharacter,
    editCharacterForm,
    editCharacterSaving,
    editCharacterPromptGenerating,
    extractingCharAppearance,
    extractingAnchors,
    addCharRefImage,
    addCharRefFileInput,
    // Trạng thái tạo
    charactersGenerating,
    generatingCharIds,
    sd2CertifyingId,
    showCharSd2Cert,
    charSd2CertPayload,
    sd2VoiceUploadingId,
    // Trạng thái thư viện
    showCharLibrary,
    charLibraryList,
    charLibraryLoading,
    charLibraryPage,
    charLibraryPageSize,
    charLibraryTotal,
    charLibraryKeyword,
    charLibraryTab,
    dramaAllCharList,
    dramaAllCharLoading,
    dramaAllCharPage,
    dramaAllCharPageSize,
    dramaAllCharTotal,
    dramaAllCharKeyword,







    showEditCharLibrary,
    editCharLibraryForm,
    editCharLibrarySaving,
    addingCharToLibraryId,
    addingCharToMaterialId,

    addingCharFromLibraryId,
    // Hàm
    charRoleLabel,
    onGenerateCharacters,
    openAddCharacter,
    stopCharacterPromptPoll,
    editCharacter,
    saveCharRefImageIfAny,
    submitEditCharacter,
    doGenerateCharacterPrompt,
    doExtractCharFromImage,
    extractIdentityAnchors,
    clearCharRefImage,
    onCloseCharDialog,
    onDeleteCharacter,
    onGenerateCharacterImage,
    onSd2CertifyCharacter,
    onSd2CertifyRefresh,
    sd2ActionLabel,
    onSd2PrimaryAction,
    openCharSd2CertDialog,
    onSd2VoicePrimaryAction,
    onSd2VoiceReplace,
    sd2VoiceActionLabel,
    playSd2Voice,
    loadCharLibraryList,
    debouncedLoadCharLibrary,
    loadDramaAllCharList,
    debouncedLoadDramaAllCharList,


    onCharLibraryDialogOpen,
    onCharLibraryTabChange,
    isCharAddToEpisodeLoading,
    openEditCharLibrary,
    submitEditCharLibrary,
    onDeleteCharLibrary,
    onAddCharacterToLibrary,
    onAddCharacterToMaterialLibrary,


    onAddCharFromLibrary,
    onAddDramaCharToEpisode,

  }
}

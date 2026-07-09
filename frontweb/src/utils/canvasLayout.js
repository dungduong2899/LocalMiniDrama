/** Parse canvas layout từ drama.metadata (trả null nếu JSON cũ không có field này) */
export function parseCanvasLayout(metadata) {
  if (metadata == null) return null
  let meta = metadata
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta)
    } catch {
      return null
    }
  }
  if (!meta || typeof meta !== 'object') return null
  return meta.canvas_layout || null
}

/** Merge metadata và ghi canvas_layout (dùng ở giai đoạn B) */
export function mergeCanvasLayoutIntoMetadata(metadata, canvasLayout) {
  let meta = metadata
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta)
    } catch {
      meta = {}
    }
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {}
  return {
    ...meta,
    canvas_layout: canvasLayout,
  }
}

/** Đọc toạ độ node đã lưu, trả về fallback nếu không có */
export function resolveNodePosition(savedLayout, nodeId, fallback) {
  const saved = savedLayout?.nodes?.[nodeId]
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    return { x: saved.x, y: saved.y }
  }
  return fallback
}

export function resolveViewport(savedLayout, fallback = { x: 0, y: 0, zoom: 0.75 }) {
  const v = savedLayout?.viewport
  if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom)) {
    return v
  }
  return fallback
}

const NON_DRAGGABLE_TYPES = new Set(['canvasLabel', 'canvasAddButton'])

/** Build canvas_layout có thể lưu từ node Vue Flow và viewport hiện tại */
export function buildCanvasLayoutPayload(flowNodes, viewport, existingLayout = null) {
  const nodes = { ...(existingLayout?.nodes || {}) }
  for (const node of flowNodes || []) {
    if (!node?.id || NON_DRAGGABLE_TYPES.has(node.type)) continue
    if (!node.position) continue
    nodes[node.id] = {
      x: node.position.x,
      y: node.position.y,
    }
  }
  return {
    version: 1,
    viewport: {
      x: Number(viewport?.x) || 0,
      y: Number(viewport?.y) || 0,
      zoom: Number(viewport?.zoom) || 0.75,
    },
    nodes,
    updated_at: new Date().toISOString(),
  }
}

export function parseDramaMetadata(metadata) {
  if (metadata == null) return {}
  if (typeof metadata === 'object' && !Array.isArray(metadata)) return metadata
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata)
    } catch {
      return {}
    }
  }
  return {}
}

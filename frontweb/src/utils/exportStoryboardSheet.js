/** Cột xuất bảng storyboard: mỗi shot một dòng, mỗi loại phần tử một cột */
const COLUMNS = [
  'STT shot',
  'Số shot',
  'Tiêu đề shot',
  'Phân đoạn',
  'Thời lượng (giây)',
  'Cỡ cảnh',
  'Chuyển máy',
  'Scene',
  'Nhân vật',
  'Đạo cụ',
  'Địa điểm',
  'Thời gian',
  'Mô tả shot',
  'Lời thoại',
  'Narration',
  'Hành động',
  'Kết quả',
  'Không khí',
  'Mô tả layout',
  'Prompt frame đầu',
  'Prompt frame cuối',
  'Prompt ảnh',
  'Prompt video',
  'Universal segment',
]

function cellText(v) {
  if (v == null) return ''
  return String(v).replace(/\r\n/g, '\n').trim()
}

function escapeHtml(s) {
  return cellText(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeCsvCell(s) {
  const t = cellText(s)
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`
  return t
}

function charBlock(char) {
  const name = cellText(char.name) || 'Chưa đặt tên'
  const parts = [
    char.appearance && `Ngoại hình: ${char.appearance}`,
    char.personality && `Tính cách: ${char.personality}`,
    char.description && `Mô tả: ${char.description}`,
    char.polished_prompt && `Prompt: ${char.polished_prompt}`,
  ].filter(Boolean)
  return parts.length ? `${name}\n${parts.join('\n')}` : name
}

function sceneBlock(scene) {
  const head = cellText(scene.location) || 'Scene chưa đặt tên'
  const parts = [
    scene.time && `Thời gian: ${scene.time}`,
    scene.prompt && `Prompt: ${scene.prompt}`,
    scene.polished_prompt && `Đã tinh chỉnh: ${scene.polished_prompt}`,
  ].filter(Boolean)
  return parts.length ? `${head}\n${parts.join('\n')}` : head
}

function propBlock(prop) {
  const name = cellText(prop.name) || 'Chưa đặt tên'
  const parts = [
    prop.type && `Loại: ${prop.type}`,
    prop.description && `Mô tả: ${prop.description}`,
    prop.prompt && `Prompt: ${prop.prompt}`,
  ].filter(Boolean)
  return parts.length ? `${name}\n${parts.join('\n')}` : name
}

function joinBlocks(blocks) {
  return blocks.filter((b) => cellText(b)).join('\n\n')
}

function field(getField, sb, key) {
  const v = getField?.(sb, key)
  if (v != null && v !== '') return cellText(v)
  return cellText(sb[key])
}

/**
 * @param {object} ctx
 * @param {Array} ctx.storyboards
 * @param {Function} ctx.getScene - (sbId) => scene | null
 * @param {Function} ctx.getCharacters - (sbId) => character[]
 * @param {Function} ctx.getProps - (sbId) => prop[]
 * @param {Function} ctx.getMovementLabel - (code) => string
 * @param {Function} ctx.getField - (sb, key) => string
 * @param {Function} [ctx.getFirstFramePrompt] - (sbId) => string
 * @param {Function} [ctx.getLastFramePrompt] - (sbId) => string
 */
/** Build dữ liệu bảng storyboard: mỗi storyboard đúng một dòng */
export function buildStoryboardSheetRows(ctx) {
  const {
    storyboards = [],
    getScene,
    getCharacters,
    getProps,
    getMovementLabel,
    getField,
    getFirstFramePrompt,
    getLastFramePrompt,
  } = ctx

  const rows = []
  for (let i = 0; i < storyboards.length; i++) {
    const sb = storyboards[i]
    const sbId = sb.id
    const segmentTitle = cellText(sb.segment_title)
    const segmentIndex = sb.segment_index != null ? Number(sb.segment_index) + 1 : ''
    const segment = segmentTitle
      ? (segmentIndex ? `Phân đoạn ${segmentIndex} · ${segmentTitle}` : segmentTitle)
      : (segmentIndex ? `Phân đoạn ${segmentIndex}` : '')

    const scene = getScene?.(sbId)
    const chars = getCharacters?.(sbId) || []
    const propList = getProps?.(sbId) || []

    rows.push([
      i + 1,
      sb.storyboard_number ?? i + 1,
      cellText(field(getField, sb, 'title')) || `Shot ${i + 1}`,
      segment,
      field(getField, sb, 'duration') || sb.duration || '',
      field(getField, sb, 'shot_type'),
      getMovementLabel?.(field(getField, sb, 'movement')) || field(getField, sb, 'movement'),
      scene ? sceneBlock(scene) : '',
      joinBlocks(chars.map(charBlock)),
      joinBlocks(propList.map(propBlock)),
      field(getField, sb, 'location'),
      field(getField, sb, 'time'),
      cellText(sb.description),
      field(getField, sb, 'dialogue'),
      field(getField, sb, 'narration'),
      field(getField, sb, 'action'),
      field(getField, sb, 'result'),
      field(getField, sb, 'atmosphere'),
      field(getField, sb, 'layout_description'),
      cellText(getFirstFramePrompt?.(sbId) ?? field(getField, sb, 'first_frame_prompt')),
      cellText(getLastFramePrompt?.(sbId) ?? field(getField, sb, 'last_frame_prompt')),
      field(getField, sb, 'polished_prompt') || cellText(sb.polished_prompt || sb.image_prompt),
      field(getField, sb, 'video_prompt') || cellText(sb.video_prompt),
      field(getField, sb, 'universal_segment_text'),
    ])
  }
  return rows
}

function formatExcelCellContent(s) {
  // Excel hiểu &#10; là xuống dòng trong cell, tránh <br/> bị vài phần mềm tách thành nhiều dòng
  return escapeHtml(s).replace(/\n/g, '&#10;')
}

/** Xuất ra bảng HTML mà Excel mở được (.xls, không cần thư viện) */
export function downloadStoryboardExcel(rows, filename) {
  const tdStyle = 'style="white-space:normal;vertical-align:top;mso-data-placement:same-cell;"'
  const header = COLUMNS.map((c) => `<th>${escapeHtml(c)}</th>`).join('')
  const body = rows.map((row) => {
    const cells = row.map((c) => `<td ${tdStyle}>${formatExcelCellContent(c)}</td>`).join('')
    return `<tr>${cells}</tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>Bảng storyboard</x:Name></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
<body><table border="1"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`

  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename.endsWith('.xls') ? filename : `${filename}.xls`
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Fallback CSV (khi một số môi trường bị hạn chế .xls) */
export function downloadStoryboardCsv(rows, filename) {
  const lines = [
    COLUMNS.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ]
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function exportStoryboardSheet(ctx, filenameBase) {
  const rows = buildStoryboardSheetRows(ctx)
  if (!rows.length) return { ok: false, reason: 'empty' }
  const name = filenameBase || 'storyboard-sheet'
  try {
    downloadStoryboardExcel(rows, name)
    return { ok: true, count: rows.length }
  } catch (_) {
    downloadStoryboardCsv(rows, name)
    return { ok: true, count: rows.length, fallback: 'csv' }
  }
}

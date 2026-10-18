// Renders a poem onto canvases (one per page): yellowish lined paper, red rules, blue-pen handwriting.
// A line with only "---" forces a new page; long pages also break on their own.
const W = 1024
const H = Math.round(W * 1.414) // A-format sheet
const LINE = 64 // px between rules
const TOP = 150
const LEFT = 120
export const LINES_PER_PAGE = Math.floor((H - TOP - 40) / LINE) - 1 // last rule kept for the page number
const INK = '#1d3a8f'
const FONT = '"Caveat", cursive'

const MAX_W = W - 2 * LEFT

// "# Title" on the first line becomes a bold title; long lines wrap to the sheet width.
export function paginate(text, measure = (s) => s.length * 20) {
  let body = text.replace(/\r/g, '').trim()
  const m = body.match(/^#\s+(.*)(\n|$)/)
  if (m) body = body.slice(m[0].length)
  const pages = []
  for (const chunk of body.split(/^\s*---\s*$/m)) {
    const rows = m && !pages.length ? [{ s: m[1].trim(), title: true }, { s: '' }] : []
    for (const line of chunk.replace(/^\n+|\n+$/g, '').split('\n')) rows.push(...wrap(line, measure).map((s) => ({ s })))
    for (let i = 0; i < rows.length; i += LINES_PER_PAGE) pages.push(rows.slice(i, i + LINES_PER_PAGE))
  }
  return pages
}

function wrap(line, measure) {
  const out = []
  let cur = ''
  for (const w of line.split(/\s+/).filter(Boolean)) {
    const t = cur ? `${cur} ${w}` : w
    if (cur && measure(t) > MAX_W) {
      out.push(cur)
      cur = w
    } else cur = t
  }
  out.push(cur)
  return out
}

export async function poemPages(text) {
  await Promise.all([document.fonts.load(`500 52px ${FONT}`), document.fonts.load(`700 60px ${FONT}`)])
  const g = document.createElement('canvas').getContext('2d')
  g.font = `500 52px ${FONT}`
  const pages = paginate(text, (s) => g.measureText(s).width)
  return pages.map((rows, p) => drawPage(rows, pages.length > 1 ? `${p + 1}/${pages.length}` : ''))
}

function drawPage(rows, pageLabel) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')

  // paper + subtle warm vignette
  g.fillStyle = '#f4e9c1'
  g.fillRect(0, 0, W, H)
  const v = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, H * 0.8)
  v.addColorStop(0, 'rgba(255,250,225,0)')
  v.addColorStop(1, 'rgba(190,150,80,0.22)')
  g.fillStyle = v
  g.fillRect(0, 0, W, H)

  // paper grain
  const img = g.getImageData(0, 0, W, H)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  g.putImageData(img, 0, 0)

  // red rules
  g.strokeStyle = 'rgba(205,70,70,0.55)'
  g.lineWidth = 2
  for (let y = TOP; y < H - 40; y += LINE) {
    g.beginPath()
    g.moveTo(0, y + 0.5)
    g.lineTo(W, y + 0.5)
    g.stroke()
  }

  // blue pen, sitting on the rules with a tiny hand-made wobble
  g.fillStyle = INK
  g.globalAlpha = 0.92
  const write = (line, x, row, title, align = 'left') => {
    g.save()
    g.textAlign = align
    g.translate(x + (Math.random() - 0.5) * 6, TOP + LINE * (row + 1) - 10 + (Math.random() - 0.5) * 3)
    g.rotate((Math.random() - 0.5) * 0.012)
    g.font = `${title ? 700 : 500} ${title ? 60 : 52}px ${FONT}`
    g.fillText(line, 0, 0)
    g.restore()
  }
  rows.forEach((r, i) => write(r.s, LEFT, i, r.title))
  if (pageLabel) write(pageLabel, W - LEFT, LINES_PER_PAGE, false, 'right')

  return c
}


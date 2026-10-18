import * as THREE from 'three'
import { poemPages } from './poem.js'

// ---------------------------------------------------------------------------
// Constants (ported from postcards.mono.studio)
// ---------------------------------------------------------------------------
const COLS = 6
const MIN_ROWS = 5
const CARD_RATIO = 0.7
const SIZES = {
  desktop: { w: 2, gap: 1.6, stagger: 0.6 },
  mobile: { w: 1.7, gap: 0.9, stagger: 0.4 },
}
const AUTO_SCROLL = 0.5
const FRICTION = 0.9
const SCROLL_LERP = 0.12
const ROT_LERP = 0.1
const INTRO_MS = 1400
const MIN_LOADER_MS = 2000
const FOCUS_SPRING = { tension: 400, friction: 40 }
const FLIP_SPRING = { mass: 1.05, tension: 300, friction: 28 }

const COLLECTIONS = [
  { slug: '', label: 'Tutto' },
  { slug: 'poesie', label: 'Poesie' },
  { slug: 'cartoline', label: 'Cartoline' },
  { slug: 'foto', label: 'Foto' },
]

// ---------------------------------------------------------------------------
// Content: drop files into content/poesie (.txt), content/cartoline, content/foto.
// "<name>-retro.jpg" becomes the back side of "<name>.jpg"; "<name>-retro.txt" is written on the back instead.
// ---------------------------------------------------------------------------
const poemFiles = import.meta.glob('/content/poesie/*.txt', { query: '?raw', import: 'default', eager: true })
const imageFiles = import.meta.glob('/content/{cartoline,foto}/*.{jpg,jpeg,png,webp,avif,gif,JPG,JPEG,PNG,WEBP}', {
  query: '?url',
  import: 'default',
  eager: true,
})

const retroTexts = import.meta.glob('/content/{cartoline,foto}/*-retro.txt', { query: '?raw', import: 'default', eager: true })

const baseName = (p) => p.split('/').pop().replace(/\.[^.]+$/, '')
const prettify = (s) => s.replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ').trim()
const isRetro = (p) => /[-_]retro$/i.test(baseName(p))

const ITEMS = [
  ...Object.entries(poemFiles).map(([path, text]) => ({
    id: path,
    kind: 'poesie',
    text,
    title: text.trim().split('\n')[0].replace(/^#\s+/, '') || prettify(baseName(path)),
  })),
  ...Object.entries(imageFiles)
    .filter(([p]) => !isRetro(p))
    .map(([path, url]) => {
      const dir = path.slice(0, path.lastIndexOf('/'))
      const back = Object.entries(imageFiles).find(
        ([p]) => isRetro(p) && p.startsWith(dir + '/') && baseName(p).replace(/[-_]retro$/i, '') === baseName(path),
      )
      const backText = retroTexts[`${dir}/${baseName(path)}-retro.txt`]?.trim()
      return { id: path, kind: path.split('/')[2], url, back: back?.[1], backText, title: prettify(baseName(path)) }
    }),
]

// ---------------------------------------------------------------------------
// Shaders (verbatim from the original)
// ---------------------------------------------------------------------------
const vertexShader = /* glsl */ `
#define PI 3.1415926535897932384626433832795
uniform float uStrength;
uniform vec2 uViewportSizes;
varying vec2 vUv;
void main() {
  vec4 newPosition = modelViewMatrix * vec4(position, 1.0);
  newPosition.z += sin(newPosition.y / uViewportSizes.y * PI + PI / 2.0) * -uStrength * 0.15;
  newPosition.z += sin(newPosition.x / uViewportSizes.x * PI + PI / 2.0) * -uStrength * 0.15;
  gl_Position = projectionMatrix * newPosition;
  vUv = uv;
}`

const cardFragment = /* glsl */ `
uniform vec2 uImageSizes;
uniform vec2 uPlaneSizes;
uniform sampler2D tMap;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 ratio = vec2(
    min((uPlaneSizes.x / uPlaneSizes.y) / (uImageSizes.x / uImageSizes.y), 1.0),
    min((uPlaneSizes.y / uPlaneSizes.x) / (uImageSizes.y / uImageSizes.x), 1.0)
  );
  vec2 uv = vec2(vUv.x * ratio.x + (1.0 - ratio.x) * 0.5, vUv.y * ratio.y + (1.0 - ratio.y) * 0.5);
  vec4 tex = texture2D(tMap, uv);
  gl_FragColor = vec4(tex.rgb, tex.a * uOpacity);
}`

const shadowFragment = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
uniform vec2 uOffset;
uniform float uSpread;
uniform float uBlur;
uniform float uOpacity;
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
void main() {
  vec2 p = vUv - 0.5 - uOffset;
  float dist = sdRoundBox(p, vec2(0.35) + uSpread, 0.02);
  float shadow = 1.0 - smoothstep(0.0, uBlur, dist);
  gl_FragColor = vec4(uColor, shadow * uAlpha * uOpacity);
}`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2
const easeOutCubic = (t) => 1 - (1 - t) ** 3
const wrap = (v, min, max) => {
  const r = max - min
  return ((((v - min) % r) + r) % r) + min
}
const isMobile = () => innerWidth < 768

// react-spring style spring, stepped from the main loop (1 ms sub-steps)
const springs = new Set()
function spring(from, to, { tension = 170, friction = 26, mass = 1, precision = 1e-3 } = {}, onChange, onRest) {
  const s = { x: [...from], v: from.map(() => 0), to }
  s.step = (ms) => {
    for (let k = 0; k < ms; k++)
      for (let i = 0; i < s.x.length; i++) {
        const f = -tension * (s.x[i] - to[i]) - friction * s.v[i]
        s.v[i] += (f / mass) * 0.001
        s.x[i] += s.v[i] * 0.001
      }
    const done = s.x.every((x, i) => Math.abs(x - to[i]) < precision && Math.abs(s.v[i]) < precision * 10)
    if (done) s.x = [...to]
    onChange(s.x)
    if (done) {
      springs.delete(s)
      onRest?.()
    }
  }
  s.stop = () => springs.delete(s)
  springs.add(s)
  return s
}

// Shuffle so identical items are not neighbours (toroidal Manhattan distance)
function tile(list, n, cols, rows, minDist = 2, attempts = 3000) {
  const base = [...list]
  while (base.length < n) base.push(list[Math.floor(Math.random() * list.length)])
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  const score = (a) => {
    let s = 0
    for (let i = 0; i < a.length; i++)
      for (let j = i + 1; j < a.length; j++) {
        if (a[i] !== a[j]) continue
        const dx = Math.abs((i % cols) - (j % cols))
        const dy = Math.abs(Math.floor(i / cols) - Math.floor(j / cols))
        const d = Math.min(dx, cols - dx) + Math.min(dy, rows - dy)
        if (d <= minDist) s += (minDist + 1 - d) ** 2
      }
    return s
  }
  let best = shuffle([...base])
  let bestScore = score(best)
  for (let k = 0; k < attempts && bestScore > 0; k++) {
    const c = shuffle([...base])
    const sc = score(c)
    if (sc < bestScore) [best, bestScore] = [c, sc]
  }
  return best
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------
function toTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.LinearSRGBColorSpace
  t.minFilter = t.magFilter = THREE.LinearFilter
  t.generateMipmaps = false
  t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
  return t
}

async function prepare(item) {
  if (item.kind === 'poesie') {
    const pages = await poemPages(item.text)
    item.pages = pages.map((c) => c.toDataURL('image/jpeg', 0.92))
    item.full = item.pages[0]
    item.canvas = pages[0]
  } else {
    const img = new Image()
    img.src = item.url
    await img.decode()
    const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k)
    c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    item.full = item.url
    item.canvas = c
  }
  item.aspect = item.canvas.width / item.canvas.height
  item.texture = toTexture(item.canvas)
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
$('stage').appendChild(renderer.domElement)
const canvas = renderer.domElement

const camera = new THREE.PerspectiveCamera((2 * Math.atan(8 / 2 / 20) * 180) / Math.PI, innerWidth / innerHeight, 0.1, 1000)
camera.position.z = 20 // => visible area at z=0 is always 8 world units tall
const viewport = () => ({ w: 8 * camera.aspect, h: 8 })

const scene = new THREE.Scene()
const group = new THREE.Group()
scene.add(group)

const scroll = { targetX: 0, targetY: 0, currentX: 0, currentY: 0, velX: 0, velY: 0 }
const drag = { intensity: 0, direction: 'down' }
let L // current layout
let cards = []
let introStart = 0
let introDone = false
let focused = null // { mesh, ret, ... }

function makeLayout(rows) {
  const s = isMobile() ? SIZES.mobile : SIZES.desktop
  const card = { w: s.w, h: s.w / CARD_RATIO }
  const cell = { w: card.w + s.gap, h: card.h + s.gap }
  return { card, cell, rows, grid: { w: COLS * cell.w, h: rows * cell.h }, stagger: s.stagger, mobile: isMobile() }
}

function clearGrid() {
  for (const m of cards) {
    m.geometry.dispose()
    m.material.dispose()
    m.children[0].geometry.dispose()
    m.children[0].material.dispose()
    group.remove(m)
  }
  cards = []
}

function buildGrid(items) {
  clearGrid()
  if (!items.length) return
  const rows = Math.max(MIN_ROWS, Math.ceil(items.length / COLS))
  L = makeLayout(rows)
  const order = tile(items, COLS * rows, COLS, rows)
  const vp = viewport()

  for (let row = 0; row < rows; row++)
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col
      const item = order[i]
      // keep the longest side equal to the original card height; orientation follows the content
      const w = item.aspect < 1 ? L.card.h * item.aspect : L.card.h
      const h = item.aspect < 1 ? L.card.h : L.card.h / item.aspect

      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: cardFragment,
        uniforms: {
          tMap: { value: item.texture },
          uPlaneSizes: { value: new THREE.Vector2(w, h) },
          uImageSizes: { value: new THREE.Vector2(item.canvas.width, item.canvas.height) },
          uViewportSizes: { value: new THREE.Vector2(vp.w, vp.h) },
          uStrength: { value: 0 },
          uOpacity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 25, 25), material)

      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15 * w, 1.13 * h),
        new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader: shadowFragment,
          uniforms: {
            uColor: { value: new THREE.Color(0x252203) },
            uOffset: { value: new THREE.Vector2(0, -0.02) },
            uViewportSizes: { value: new THREE.Vector2(vp.w, vp.h) },
            uAlpha: { value: 0.24 },
            uSpread: { value: 0 },
            uBlur: { value: 0.15 },
            uOpacity: { value: 0 },
            uStrength: { value: 0 },
          },
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      )
      shadow.position.z = -0.01
      shadow.raycast = () => null
      mesh.add(shadow)

      const x = (col - (COLS - 1) / 2) * L.cell.w + (row % 2 === 0 ? -1 : 1) * L.stagger * (0.5 + (col % 3) * 0.25)
      const y = ((rows - 1) / 2 - row) * L.cell.h
      const z = 0.08 * (((row + col) % 3) - 1)
      const rz = [-1, -0.5, 0, 0.5, 1][(6 * row + col) % 5] * (Math.PI / 18)
      mesh.userData = { item, base: new THREE.Vector3(x, y, z), rz, delay: 500 * Math.random() + (i % 6) * 120, w, h }
      mesh.position.set(x, y, z + 1.2)
      mesh.scale.set(1.7, 1.7, 1)
      group.add(mesh)
      cards.push(mesh)
    }
}

function setOpacity(mesh, v) {
  mesh.material.uniforms.uOpacity.value = v
  mesh.children[0].material.uniforms.uOpacity.value = v
}

function startIntro() {
  introDone = false
  introStart = performance.now()
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------
let last = performance.now()
function frame(now) {
  requestAnimationFrame(frame)
  const ms = Math.min(now - last, 64)
  const dt = Math.min(ms / 1000, 1 / 30)
  last = now

  for (const s of [...springs]) s.step(Math.round(ms))

  if (L && !focused) {
    const s = scroll
    s.targetY += drag.direction === 'up' ? AUTO_SCROLL * dt : -AUTO_SCROLL * dt
    s.targetY += s.velY
    s.targetX += s.velX
    s.velX *= FRICTION
    s.velY *= FRICTION
    s.currentX += (s.targetX - s.currentX) * SCROLL_LERP
    s.currentY += (s.targetY - s.currentY) * SCROLL_LERP

    // keep scroll bounded, shifting meshes to compensate
    const nx = Math.floor((s.currentX + L.grid.w / 2) / L.grid.w)
    const ny = Math.floor((s.currentY + L.grid.h / 2) / L.grid.h)
    if (nx || ny) {
      s.currentX -= nx * L.grid.w
      s.targetX -= nx * L.grid.w
      s.currentY -= ny * L.grid.h
      s.targetY -= ny * L.grid.h
      for (const m of cards) {
        m.position.x += nx * L.grid.w
        m.position.y += ny * L.grid.h
      }
    }
    group.position.set(s.currentX, s.currentY, 0)

    const vx = clamp(0.6 * s.velX, -0.6, 0.6)
    const vy = clamp(0.6 * s.velY, -0.6, 0.6)
    group.rotation.x += (THREE.MathUtils.degToRad(6 * vy) - group.rotation.x) * ROT_LERP
    group.rotation.y += (THREE.MathUtils.degToRad(-6 * vx) - group.rotation.y) * ROT_LERP

    // intro: fly in from z+1.2 / scale 1.7 with easeOutBack
    if (!introDone && introStart) {
      let all = true
      for (const m of cards) {
        const { base, rz, delay } = m.userData
        const c = (now - introStart - delay) / INTRO_MS
        const d = clamp(c, 0, 1)
        const u = easeOutBack(d)
        m.position.set(base.x, base.y, lerp(base.z + 1.2, base.z, u))
        m.rotation.z = rz * u
        const sc = lerp(1.7, 1, u)
        m.scale.set(sc, sc, 1)
        setOpacity(m, easeOutCubic(Math.max(0, Math.min(c, 1))))
        if (d < 1) all = false
      }
      if (all) {
        introDone = true
        $('spin-cursor').classList.add('out')
        updateCursor()
      }
    }

    const halfW = L.grid.w / 2
    const halfH = L.grid.h / 2
    for (const m of cards) {
      m.position.x = wrap(m.position.x + s.currentX, -halfW, halfW) - s.currentX
      m.position.y = wrap(m.position.y + s.currentY, -halfH, halfH) - s.currentY
    }

    // bend while moving
    const target = Math.min(20, 0.1 * drag.intensity)
    drag.intensity *= 0.85
    for (const m of cards) {
      const u = m.material.uniforms.uStrength
      u.value += (target - u.value) * 0.25
      m.children[0].material.uniforms.uStrength.value = u.value
    }
  }

  renderer.render(scene, camera)
}

// ---------------------------------------------------------------------------
// Input: drag / wheel / click
// ---------------------------------------------------------------------------
const pointer = { down: false, x: 0, y: 0, sx: 0, sy: 0, hover: null }
const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()

function pick(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  return raycaster.intersectObjects(cards, false)[0]?.object ?? null
}

function setDirection(n) {
  const dir = n > 0.001 ? 'down' : n < -0.001 ? 'up' : null
  if (dir) drag.direction = dir
}

function updateCursor() {
  document.body.style.cursor = !introDone
    ? 'auto'
    : pointer.down
      ? 'grabbing'
      : focused
        ? 'auto'
        : pointer.hover
          ? 'pointer'
          : 'grab'
}

canvas.addEventListener('pointerdown', (e) => {
  pointer.down = true
  pointer.x = pointer.sx = e.clientX
  pointer.y = pointer.sy = e.clientY
  canvas.setPointerCapture(e.pointerId)
  updateCursor()
})

canvas.addEventListener('pointermove', (e) => {
  const dx = e.clientX - pointer.x
  const dy = e.clientY - pointer.y
  pointer.x = e.clientX
  pointer.y = e.clientY
  if (!pointer.down) {
    pointer.hover = introDone && !focused ? pick(e) : null
    updateCursor()
    return
  }
  if (!introDone || focused) return
  const vp = viewport()
  const n = dx * (vp.w / innerWidth)
  const s = dy * (vp.h / innerHeight)
  setDirection(s)
  scroll.targetX += n
  scroll.targetY -= s
  scroll.velX = n
  scroll.velY = -s
  drag.intensity += Math.hypot(dx, dy)
})

canvas.addEventListener('pointerup', (e) => {
  pointer.down = false
  updateCursor()
  // ponytail: ignore drags, unlike the original which also opens a card on drag-release
  if (Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 6) return
  if (!introDone || focused) return
  const hit = pick(e)
  if (hit) focusCard(hit)
})

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    if (!introDone || focused) return
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1)
    const n = -(dy * (8 / innerHeight))
    setDirection(n)
    scroll.targetY -= n
    scroll.velY = -n
    drag.intensity += 80 * Math.abs(n)
  },
  { passive: false },
)

const resetVelocity = () => {
  scroll.velX = scroll.velY = drag.intensity = 0
  last = performance.now()
}
addEventListener('focus', resetVelocity)
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && resetVelocity())

addEventListener('mousemove', (e) => {
  const c = $('spin-cursor')
  c.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
})

// ---------------------------------------------------------------------------
// Focus / flip / close
// ---------------------------------------------------------------------------
const overlay = $('overlay')
const flipper = $('flipper')
let flipDeg = 0
let flipSpring = null
let tutorialTimer

function focusTarget(mesh) {
  const W = innerWidth
  const H = innerHeight
  const mobile = isMobile()
  const headerH = mobile ? 90 : 98
  let hPx = Math.max(140, H - headerH - (104 + (mobile ? 30 : 40)))
  let wPx = hPx * mesh.userData.item.aspect
  const maxW = mobile ? W - 72 : W - 80
  if (wPx > maxW) {
    hPx *= maxW / wPx
    wPx = maxW
  }
  const d = 8 / H // world units per px
  return {
    pos: [-scroll.currentX, (H / 2 - (headerH + hPx / 2)) * d - scroll.currentY, 0],
    scale: (hPx * d) / mesh.userData.h,
  }
}

function focusCard(mesh) {
  const t = focusTarget(mesh)
  focused = { mesh, ret: { pos: mesh.position.toArray(), rot: mesh.rotation.toArray().slice(0, 3), scale: mesh.scale.x } }
  pointer.hover = null
  updateCursor()
  mesh.renderOrder = 10
  mesh.children[0].renderOrder = 9
  const str0 = mesh.material.uniforms.uStrength.value

  spring(
    [...focused.ret.pos, ...focused.ret.rot, focused.ret.scale, 1],
    [...t.pos, 0, 0, 0, t.scale, 0],
    FOCUS_SPRING,
    (v) => {
      mesh.position.set(v[0], v[1], v[2])
      mesh.rotation.set(v[3], v[4], v[5])
      mesh.scale.set(v[6], v[6], 1)
      for (const m of cards) {
        if (m !== mesh) setOpacity(m, v[7])
        m.material.uniforms.uStrength.value = m.children[0].material.uniforms.uStrength.value = str0 * v[7]
      }
      mesh.children[0].material.uniforms.uOpacity.value = v[7]
    },
    () => showOverlay(mesh),
  )
  $('fade-bottom').classList.add('off')
  $('filter-btn').style.opacity = '0'
  $('filter-btn').style.pointerEvents = 'none'
}

function placeOverlay(mesh) {
  const p = mesh.getWorldPosition(new THREE.Vector3()).project(camera)
  const pxPerWorld = innerHeight / 8
  const w = mesh.userData.w * mesh.scale.x * pxPerWorld
  const h = mesh.userData.h * mesh.scale.x * pxPerWorld
  Object.assign(overlay.style, {
    width: `${w}px`,
    height: `${h}px`,
    transform: `translate(${((p.x + 1) / 2) * innerWidth - w / 2}px, ${((1 - p.y) / 2) * innerHeight - h / 2}px)`,
  })
}

function showOverlay(mesh) {
  const { item } = mesh.userData
  placeOverlay(mesh)
  flipDeg = 0
  flipper.style.transform = 'rotateY(0deg)'
  const back = $('back')
  if (item.back) back.innerHTML = `<img src="${item.back}" alt="" />`
  else if (item.backText) {
    // like a real postcard back: message on the left, stamp and address lines on the right
    back.innerHTML = `<div class="note written"><p class="message"></p><div class="side"><div class="stamp">G</div><i></i><i></i><i></i></div></div>`
    back.querySelector('.message').textContent = item.backText
  } else {
    back.innerHTML = `<div class="note"><div class="stamp">G</div><p class="caption"></p></div>`
    back.querySelector('.caption').textContent = item.title
  }
  const img = $('front-img')
  img.onload = () => {
    mesh.material.uniforms.uOpacity.value = 0 // DOM card takes over seamlessly
    $('overlay-shadow').classList.add('on')
  }
  img.src = item.full
  overlay.hidden = false
  fitMessage(back.querySelector('.message'))
  $('menu').hidden = false
  // poems don't flip; multi-page poems get a pager instead
  const pages = item.pages?.length ?? 0
  page = 0
  $('flip-btn').hidden = !!item.pages
  $('pager').hidden = pages < 2
  updatePager()
  if (item.pages && pages < 2) return
  $('tutorial-text').textContent = item.pages ? 'Sfoglia le pagine' : 'Gira la carta'
  const tut = $('tutorial')
  tut.classList.remove('out')
  tut.hidden = false
  clearTimeout(tutorialTimer)
  tutorialTimer = setTimeout(hideTutorial, 3000)
}

// biggest handwriting that still fits the back of the card
function fitMessage(el) {
  if (!el) return
  let size = Math.round(0.07 * el.closest('.back').clientHeight) // ~ a handwritten line on a real card
  do el.style.fontSize = `${size--}px`
  while (size > 10 && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth))
}

function hideTutorial() {
  const tut = $('tutorial')
  if (tut.hidden) return
  tut.classList.add('out')
  setTimeout(() => (tut.hidden = true), 1000)
}

function animateFlip(to, cfg = FLIP_SPRING, onRest) {
  flipSpring?.stop()
  flipSpring = spring(
    [flipDeg],
    [to],
    { ...cfg, precision: 0.1 },
    ([d]) => {
      flipDeg = d
      flipper.style.transform = `rotateY(${d}deg)`
    },
    () => {
      flipSpring = null
      onRest?.()
    },
  )
}
const showingBack = () => {
  const m = ((flipDeg % 360) + 360) % 360
  return m > 90 && m < 270
}
const normalizeFlip = () => {
  flipDeg = showingBack() ? 180 : 0
  flipper.style.transform = `rotateY(${flipDeg}deg)`
}

// ---- poem pages
let page = 0
const poemOf = () => (focused && !focused.closing ? focused.mesh.userData.item.pages : null)

function updatePager() {
  const pages = poemOf()
  if (!pages) return
  $('page-num').textContent = `${page + 1}/${pages.length}`
  $('prev-btn').disabled = page === 0
  $('next-btn').disabled = page === pages.length - 1
}

let turning = false // one page turn at a time, so quick swipes/taps can't interleave
async function goPage(n, pages = poemOf()) {
  if (!pages || turning) return
  n = clamp(n, 0, pages.length - 1)
  const img = $('front-img')
  const from = img.style.transform || 'translateX(0px)'
  img.style.transform = ''
  turning = true
  try {
    if (n === page) {
      await img.animate([{ transform: from }, { transform: 'translateX(0px)' }], { duration: 220, easing: 'cubic-bezier(0,0,.2,1)' }).finished
      return
    }
    hideTutorial()
    const dir = Math.sign(n - page)
    const w = img.offsetWidth
    page = n
    updatePager()
    // slide the sheet out the way the finger went, the next one in from the other side
    await img.animate([{ transform: from }, { transform: `translateX(${-dir * w}px)` }], { duration: 200, easing: 'cubic-bezier(.4,0,1,1)' }).finished
    img.style.transform = `translateX(${dir * w}px)`
    img.src = pages[n]
    await img.decode().catch(() => {})
    img.style.transform = ''
    await img.animate([{ transform: `translateX(${dir * w}px)` }, { transform: 'translateX(0px)' }], { duration: 260, easing: 'cubic-bezier(0,0,.2,1)' }).finished
  } finally {
    turning = false
  }
}
$('prev-btn').addEventListener('click', () => goPage(page - 1))
$('next-btn').addEventListener('click', () => goPage(page + 1))
addEventListener('keydown', (e) => {
  if (!poemOf()) return
  if (e.key === 'ArrowRight') goPage(page + 1)
  if (e.key === 'ArrowLeft') goPage(page - 1)
})

$('flip-btn').addEventListener('click', () => {
  hideTutorial()
  animateFlip(showingBack() ? Math.round(flipDeg / 360) * 360 : Math.round(flipDeg / 360) * 360 + 180, FLIP_SPRING, normalizeFlip)
})

// drag horizontally on the focused card to flip it
const fd = { active: false, x: 0, start: 0, moved: false, vx: 0, lt: 0, lx: 0 }
const rubber = (v, min, max, k) => (v < min ? min - (min - v) * k : v > max ? max + (v - max) * k : v)
flipper.addEventListener('pointerdown', (e) => {
  if (flipSpring || turning) return
  hideTutorial()
  Object.assign(fd, { active: true, x: e.clientX, start: flipDeg, moved: false, vx: 0, lt: e.timeStamp, lx: e.clientX })
  flipper.setPointerCapture(e.pointerId)
})
flipper.addEventListener('pointermove', (e) => {
  if (!fd.active) return
  const mx = e.clientX - fd.x
  if (!fd.moved && Math.abs(mx) < 10) return
  fd.moved = true
  const dt = Math.max(1, e.timeStamp - fd.lt)
  fd.vx = (e.clientX - fd.lx) / dt // px/ms
  fd.lt = e.timeStamp
  fd.lx = e.clientX
  const pages = poemOf()
  if (pages) {
    const edge = (page === 0 && mx > 0) || (page === pages.length - 1 && mx < 0)
    $('front-img').style.transform = `translateX(${edge ? 0.25 * mx : mx}px)` // follows the finger, resists past the ends
    return
  }
  flipDeg = rubber(fd.start + 0.75 * mx, fd.start - 180, fd.start + 180, 0.2)
  flipper.style.transform = `rotateY(${flipDeg}deg)`
})
function endDrag(e) {
  if (!fd.active) return
  fd.active = false
  if (!fd.moved) return
  const mx = e.type === 'pointercancel' ? 0 : e.clientX - fd.x
  const v = Math.abs(fd.vx)
  if (poemOf()) {
    const far = Math.abs(mx) > Math.min(80, flipper.offsetWidth * 0.2) || (v > 0.35 && Math.sign(fd.vx) === Math.sign(mx))
    return goPage(far ? page - Math.sign(mx) : page)
  }
  if (Math.abs(mx) > 70 || v > 0.35) {
    const sign = Math.sign(mx || fd.vx)
    const turns = Math.abs(flipDeg - fd.start) > 250 ? 360 : 180
    const t = Math.min(v, 2.2)
    animateFlip(fd.start + sign * turns, { mass: 1.05, tension: 300 + 70 * t, friction: 28 - 4 * t }, normalizeFlip)
  } else {
    animateFlip(fd.start, { mass: 1.1, tension: 240 + 25 * Math.min(v, 1.5), friction: 24 }, normalizeFlip)
  }
}
flipper.addEventListener('pointerup', endDrag)
flipper.addEventListener('pointercancel', endDrag)

function closeCard() {
  if (!focused || focused.closing) return
  focused.closing = true
  const run = () => {
    const { mesh, ret } = focused
    overlay.hidden = true
    $('overlay-shadow').classList.remove('on')
    $('menu').hidden = true
    $('tutorial').hidden = true
    mesh.material.uniforms.uOpacity.value = 1
    spring(
      [...mesh.position.toArray(), ...mesh.rotation.toArray().slice(0, 3), mesh.scale.x, 0],
      [...ret.pos, ...ret.rot, ret.scale, 1],
      FOCUS_SPRING,
      (v) => {
        mesh.position.set(v[0], v[1], v[2])
        mesh.rotation.set(v[3], v[4], v[5])
        mesh.scale.set(v[6], v[6], 1)
        for (const m of cards) if (m !== mesh) setOpacity(m, v[7])
        mesh.children[0].material.uniforms.uOpacity.value = v[7]
      },
      () => {
        mesh.renderOrder = mesh.children[0].renderOrder = 0
        focused = null
        updateCursor()
        $('fade-bottom').classList.remove('off')
        $('filter-btn').style.opacity = ''
        $('filter-btn').style.pointerEvents = ''
      },
    )
  }
  const pages = focused.mesh.userData.item.pages
  if (pages && page > 0) goPage(0, pages).then(run) // back to the first page, which is what the grid card shows
  else if (showingBack() || flipDeg % 360) animateFlip(Math.round(flipDeg / 360) * 360, { ...FLIP_SPRING, mass: 1.2 }, run)
  else run()
}
$('close-btn').addEventListener('click', closeCard)
$('logo').addEventListener('click', closeCard)

// ---------------------------------------------------------------------------
// Filter, about, resize
// ---------------------------------------------------------------------------
let collection = new URLSearchParams(location.search).get('collection') ?? ''
const visibleItems = () => ITEMS.filter((it) => !collection || it.kind === collection)

function renderChips() {
  $('chips').innerHTML = ''
  for (const c of COLLECTIONS) {
    if (c.slug && !ITEMS.some((it) => it.kind === c.slug)) continue
    const b = document.createElement('button')
    b.textContent = c.label
    b.className = c.slug === collection ? 'on' : ''
    b.onclick = () => {
      collection = c.slug
      history.pushState(null, '', c.slug ? `?collection=${c.slug}` : location.pathname)
      $('filter-panel').hidden = true
      renderChips()
      buildGrid(visibleItems())
      startIntro()
    }
    $('chips').appendChild(b)
  }
  $('filter-dot').hidden = !collection
}
$('filter-btn').addEventListener('click', () => ($('filter-panel').hidden = !$('filter-panel').hidden))
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  $('filter-panel').hidden = true
  $('about').hidden = true
})
addEventListener('pointerdown', (e) => {
  if (!$('filter-panel').hidden && !e.target.closest('#filter-panel, #filter-btn')) $('filter-panel').hidden = true
})

$('about-btn').addEventListener('click', () => ($('about').hidden = false))
$('about-close').addEventListener('click', () => ($('about').hidden = true))
$('about-backdrop').addEventListener('click', () => ($('about').hidden = true))

addEventListener('resize', () => {
  const wasMobile = L?.mobile
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  const vp = viewport()
  for (const m of cards) {
    m.material.uniforms.uViewportSizes.value.set(vp.w, vp.h)
    m.children[0].material.uniforms.uViewportSizes.value.set(vp.w, vp.h)
  }
  if (focused && !focused.closing) {
    if (wasMobile !== isMobile()) return closeCard()
    const t = focusTarget(focused.mesh)
    focused.mesh.position.set(...t.pos)
    focused.mesh.scale.set(t.scale, t.scale, 1)
    placeOverlay(focused.mesh)
    fitMessage($('back').querySelector('.message'))
  } else if (L && wasMobile !== isMobile()) {
    buildGrid(visibleItems())
    startIntro()
  }
})

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
requestAnimationFrame(frame)
renderChips()
Promise.all([Promise.allSettled(ITEMS.map(prepare)), new Promise((r) => setTimeout(r, MIN_LOADER_MS))]).then(() => {
  ITEMS.splice(0, ITEMS.length, ...ITEMS.filter((it) => it.texture)) // drop files that failed to load
  buildGrid(visibleItems())
  $('loader').classList.add('out')
  $('header').classList.add('in')
  startIntro()
})

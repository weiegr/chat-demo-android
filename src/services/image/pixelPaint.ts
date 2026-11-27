/**
 * 64×64 像素画的绘制指令集与光栅化。
 *
 * 模型只输出文本指令（每行一条），客户端在本机画进 RGBA 缓冲区，再编码成 PNG。
 * 这样既不需要图像生成接口，也不占用额外的图片额度：一张图的成本只有几百个文本 token。
 */

export const PIXEL_WIDTH = 64
export const PIXEL_HEIGHT = 64
/** 单轮指令行数上限：超过说明模型在堆细节，直接报错让它收敛 */
export const MAX_INSTRUCTIONS = 240
/** 调色板上限：64px 画面超过 16 色很难保持统一 */
export const MAX_PALETTE = 16

export type PixelBuffer = {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type BoundingBox = {
  x: number
  y: number
  width: number
  height: number
}

export type PixelPaintStats = {
  /** 实际执行的指令行数 */
  lines: number
  /** 画面里出现的颜色数 */
  colors: number
  /** 与左上角背景色不同的像素占比，0–100 */
  subject: number
  /** 主体（非背景）包围盒，空画面为 null */
  bbox: BoundingBox | null
}

export type PixelPaintResult = {
  buffer: PixelBuffer
  stats: PixelPaintStats
}

type Rgba = { r: number; g: number; b: number; a: number }

/** 指令错误：带上行号和错误码，模型可以按提示改某一行 */
export class PixelInstructionError extends Error {
  readonly code: string
  readonly line?: number

  constructor(code: string, message: string, line?: number) {
    super(message)
    this.name = 'PixelInstructionError'
    this.code = code
    this.line = line
  }
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const PALETTE_REF = /^c(\d{1,2})$/i
/** 4×4 有序抖动矩阵，用来做稳定的棋盘过渡 */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const normalizeHex = (token: string): string => {
  const hex = token.slice(1).toLowerCase()
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  }
  return `#${hex}`
}

/** 调色板按顺序解析，支持 `#abc` / `#aabbcc`，最多 16 个 */
export const parsePalette = (raw: string): string[] => {
  const tokens = raw
    .split(/[\s,，;；]+/)
    .map((token) => token.trim())
    .filter(Boolean)
  if (tokens.length > MAX_PALETTE) {
    throw new PixelInstructionError(
      'palette_too_large',
      `palette supports at most ${MAX_PALETTE} colors, got ${tokens.length}`
    )
  }
  return tokens.map((token) => {
    if (!HEX_PATTERN.test(token)) {
      throw new PixelInstructionError(
        'invalid_palette',
        `palette color "${token}" is not a #rrggbb hex value`
      )
    }
    return normalizeHex(token)
  })
}

const hexToRgba = (hex: string): Rgba => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
  a: 255,
})

const resolveColor = (token: string | undefined, palette: Rgba[], line: number): Rgba => {
  const value = token?.trim() ?? ''
  if (!value) {
    throw new PixelInstructionError('missing_color', 'instruction is missing a color', line)
  }
  const ref = PALETTE_REF.exec(value)
  if (ref) {
    const index = Number.parseInt(ref[1], 10)
    const color = palette[index]
    if (!color) {
      throw new PixelInstructionError(
        'unknown_palette_index',
        `palette index c${index} is out of range (palette has ${palette.length} colors)`,
        line
      )
    }
    return color
  }
  if (HEX_PATTERN.test(value)) {
    return hexToRgba(normalizeHex(value))
  }
  throw new PixelInstructionError(
    'invalid_color',
    `color "${value}" must be a palette reference like c0 or a #rrggbb hex value`,
    line
  )
}

const readNumber = (token: string | undefined, line: number, name: string): number => {
  if (token === undefined) {
    throw new PixelInstructionError('missing_argument', `missing ${name}`, line)
  }
  const value = Number(token)
  if (!Number.isFinite(value)) {
    throw new PixelInstructionError('invalid_argument', `${name} must be a number, got "${token}"`, line)
  }
  return value
}

const readInt = (token: string | undefined, line: number, name: string): number =>
  Math.round(readNumber(token, line, name))

export const createPixelBuffer = (
  width = PIXEL_WIDTH,
  height = PIXEL_HEIGHT
): PixelBuffer => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
})

const getPixel = (buffer: PixelBuffer, x: number, y: number): Rgba => {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  const index = (y * buffer.width + x) * 4
  const { data } = buffer
  return { r: data[index], g: data[index + 1], b: data[index + 2], a: data[index + 3] }
}

const sameColor = (a: Rgba, b: Rgba) =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a

/** 源覆盖到目标像素；alpha 为 0–1 的额外不透明度 */
const putPixel = (buffer: PixelBuffer, x: number, y: number, color: Rgba, alpha = 1) => {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height || alpha <= 0) {
    return
  }
  const index = (y * buffer.width + x) * 4
  const { data } = buffer
  const sourceAlpha = (color.a / 255) * alpha
  if (sourceAlpha >= 1) {
    data[index] = color.r
    data[index + 1] = color.g
    data[index + 2] = color.b
    data[index + 3] = 255
    return
  }
  const destAlpha = data[index + 3] / 255
  const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha)
  if (outAlpha <= 0) {
    return
  }
  data[index] = Math.round(
    (color.r * sourceAlpha + data[index] * destAlpha * (1 - sourceAlpha)) / outAlpha
  )
  data[index + 1] = Math.round(
    (color.g * sourceAlpha + data[index + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha
  )
  data[index + 2] = Math.round(
    (color.b * sourceAlpha + data[index + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha
  )
  data[index + 3] = Math.round(outAlpha * 255)
}

const forEachInRect = (
  buffer: PixelBuffer,
  x: number,
  y: number,
  width: number,
  height: number,
  visit: (px: number, py: number) => void
) => {
  const left = clamp(Math.round(x), 0, buffer.width)
  const top = clamp(Math.round(y), 0, buffer.height)
  const right = clamp(Math.round(x) + Math.round(width), 0, buffer.width)
  const bottom = clamp(Math.round(y) + Math.round(height), 0, buffer.height)
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      visit(px, py)
    }
  }
}

const drawLine = (
  buffer: PixelBuffer,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: Rgba,
  thickness: number
) => {
  let x = Math.round(x1)
  let y = Math.round(y1)
  const endX = Math.round(x2)
  const endY = Math.round(y2)
  const dx = Math.abs(endX - x)
  const dy = Math.abs(endY - y)
  const stepX = x < endX ? 1 : -1
  const stepY = y < endY ? 1 : -1
  let error = dx - dy
  const radius = Math.max(0, (thickness - 1) / 2)
  for (;;) {
    if (radius <= 0) {
      putPixel(buffer, x, y, color)
    } else {
      forEachInRect(
        buffer,
        x - radius,
        y - radius,
        radius * 2 + 1,
        radius * 2 + 1,
        (px, py) => {
          const offsetX = px - x
          const offsetY = py - y
          if (offsetX * offsetX + offsetY * offsetY <= radius * radius + 0.5) {
            putPixel(buffer, px, py, color)
          }
        }
      )
    }
    if (x === endX && y === endY) {
      break
    }
    const doubled = error * 2
    if (doubled > -dy) {
      error -= dy
      x += stepX
    }
    if (doubled < dx) {
      error += dx
      y += stepY
    }
  }
}

const fillEllipse = (
  buffer: PixelBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: Rgba,
  inner = 0
) => {
  const radiusX = Math.abs(rx)
  const radiusY = Math.abs(ry)
  if (radiusX < 0.5 || radiusY < 0.5) {
    return
  }
  forEachInRect(
    buffer,
    cx - radiusX,
    cy - radiusY,
    radiusX * 2 + 1,
    radiusY * 2 + 1,
    (px, py) => {
      const nx = (px - cx) / radiusX
      const ny = (py - cy) / radiusY
      const distance = nx * nx + ny * ny
      if (distance <= 1 && distance >= inner) {
        putPixel(buffer, px, py, color)
      }
    }
  )
}

/** 扫描线填充多边形（奇偶规则），像素中心落在多边形内才着色 */
const fillPolygon = (buffer: PixelBuffer, points: Array<[number, number]>, color: Rgba) => {
  if (points.length < 3) {
    return
  }
  const ys = points.map((point) => point[1])
  const top = clamp(Math.floor(Math.min(...ys)), 0, buffer.height - 1)
  const bottom = clamp(Math.ceil(Math.max(...ys)), 0, buffer.height - 1)
  for (let y = top; y <= bottom; y += 1) {
    const scanY = y + 0.5
    const crossings: number[] = []
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index]
      const [x2, y2] = points[(index + 1) % points.length]
      if (y1 === y2) {
        continue
      }
      const low = Math.min(y1, y2)
      const high = Math.max(y1, y2)
      if (scanY < low || scanY >= high) {
        continue
      }
      crossings.push(x1 + ((scanY - y1) / (y2 - y1)) * (x2 - x1))
    }
    crossings.sort((a, b) => a - b)
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const from = clamp(Math.round(crossings[index]), 0, buffer.width)
      const to = clamp(Math.round(crossings[index + 1]) - 1, -1, buffer.width - 1)
      for (let x = from; x <= to; x += 1) {
        putPixel(buffer, x, y, color)
      }
    }
  }
}

const parsePoints = (tokens: string[], line: number): Array<[number, number]> => {  const points: Array<[number, number]> = []
  for (const token of tokens) {
    const pair = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(token)
    if (!pair) {
      throw new PixelInstructionError(
        'invalid_point',
        `point "${token}" must look like x,y (for example 12,30)`,
        line
      )
    }
    points.push([Number(pair[1]), Number(pair[2])])
  }
  if (points.length === 0) {
    throw new PixelInstructionError('missing_point', 'instruction needs at least one x,y point', line)
  }
  return points
}

const readThickness = (token: string | undefined, line: number): number => {
  if (token === undefined) {
    return 1
  }
  return clamp(readInt(token, line, 'thickness'), 1, 8)
}

const executeInstruction = (
  buffer: PixelBuffer,
  palette: Rgba[],
  text: string,
  line: number
) => {
  const [name, ...tokens] = text.split(/\s+/)
  switch (name.toLowerCase()) {
    case 'fill': {
      const color = resolveColor(tokens[0], palette, line)
      forEachInRect(buffer, 0, 0, buffer.width, buffer.height, (x, y) => {
        putPixel(buffer, x, y, color)
      })
      return
    }
    case 'rect': {
      const x = readInt(tokens[0], line, 'x')
      const y = readInt(tokens[1], line, 'y')
      const width = readInt(tokens[2], line, 'w')
      const height = readInt(tokens[3], line, 'h')
      const color = resolveColor(tokens[4], palette, line)
      forEachInRect(buffer, x, y, width, height, (px, py) => putPixel(buffer, px, py, color))
      return
    }
    case 'frame': {
      const x = readInt(tokens[0], line, 'x')
      const y = readInt(tokens[1], line, 'y')
      const width = readInt(tokens[2], line, 'w')
      const height = readInt(tokens[3], line, 'h')
      const color = resolveColor(tokens[4], palette, line)
      const thickness = readThickness(tokens[5], line)
      forEachInRect(buffer, x, y, width, height, (px, py) => {
        const insetX = Math.min(px - x, x + width - 1 - px)
        const insetY = Math.min(py - y, y + height - 1 - py)
        if (insetX < thickness || insetY < thickness) {
          putPixel(buffer, px, py, color)
        }
      })
      return
    }
    case 'ellipse': {
      const cx = readInt(tokens[0], line, 'cx')
      const cy = readInt(tokens[1], line, 'cy')
      const rx = readInt(tokens[2], line, 'rx')
      const ry = readInt(tokens[3], line, 'ry')
      const color = resolveColor(tokens[4], palette, line)
      fillEllipse(buffer, cx, cy, rx, ry, color)
      return
    }
    case 'ring': {
      const cx = readInt(tokens[0], line, 'cx')
      const cy = readInt(tokens[1], line, 'cy')
      const rx = readInt(tokens[2], line, 'rx')
      const ry = readInt(tokens[3], line, 'ry')
      const color = resolveColor(tokens[4], palette, line)
      const thickness = readThickness(tokens[5], line)
      const innerX = Math.max(0, (rx - thickness) / Math.max(rx, 1))
      const innerY = Math.max(0, (ry - thickness) / Math.max(ry, 1))
      const inner = Math.min(innerX * innerX, innerY * innerY)
      fillEllipse(buffer, cx, cy, rx, ry, color, inner)
      return
    }
    case 'line': {
      const x1 = readInt(tokens[0], line, 'x1')
      const y1 = readInt(tokens[1], line, 'y1')
      const x2 = readInt(tokens[2], line, 'x2')
      const y2 = readInt(tokens[3], line, 'y2')
      const color = resolveColor(tokens[4], palette, line)
      const thickness = readThickness(tokens[5], line)
      drawLine(buffer, x1, y1, x2, y2, color, thickness)
      return
    }
    case 'poly': {
      const color = resolveColor(tokens[0], palette, line)
      const rest = tokens.slice(1)
      const closed = rest.at(-1)?.toLowerCase() === 'close'
      const points = parsePoints(closed ? rest.slice(0, -1) : rest, line)
      for (let index = 1; index < points.length; index += 1) {
        drawLine(
          buffer,
          points[index - 1][0],
          points[index - 1][1],
          points[index][0],
          points[index][1],
          color,
          1
        )
      }
      if (closed && points.length > 2) {
        const first = points[0]
        const last = points.at(-1) as [number, number]
        drawLine(buffer, last[0], last[1], first[0], first[1], color, 1)
      }
      return
    }
    case 'fillpoly': {
      const color = resolveColor(tokens[0], palette, line)
      const points = parsePoints(
        tokens.slice(1).filter((token) => token.toLowerCase() !== 'close'),
        line
      )
      fillPolygon(buffer, points, color)
      return
    }
    case 'pixels': {
      const color = resolveColor(tokens[0], palette, line)
      for (const [x, y] of parsePoints(tokens.slice(1), line)) {
        putPixel(buffer, Math.round(x), Math.round(y), color)
      }
      return
    }
    case 'shade': {
      const x = readInt(tokens[0], line, 'x')
      const y = readInt(tokens[1], line, 'y')
      const width = readInt(tokens[2], line, 'w')
      const height = readInt(tokens[3], line, 'h')
      const color = resolveColor(tokens[4], palette, line)
      const alpha = clamp(readNumber(tokens[5], line, 'alpha'), 0, 100) / 100
      forEachInRect(buffer, x, y, width, height, (px, py) => putPixel(buffer, px, py, color, alpha))
      return
    }
    case 'dither': {
      const x = readInt(tokens[0], line, 'x')
      const y = readInt(tokens[1], line, 'y')
      const width = readInt(tokens[2], line, 'w')
      const height = readInt(tokens[3], line, 'h')
      const color = resolveColor(tokens[4], palette, line)
      const density = clamp(readNumber(tokens[5], line, 'density'), 0, 100) / 100
      const threshold = density * 16
      forEachInRect(buffer, x, y, width, height, (px, py) => {
        if (BAYER4[py % 4][px % 4] < threshold) {
          putPixel(buffer, px, py, color)
        }
      })
      return
    }
    case 'outline': {
      const color = resolveColor(tokens[0], palette, line)
      const background = getPixel(buffer, 0, 0)
      const snapshot = new Uint8ClampedArray(buffer.data)
      const matchesBackground = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
          return true
        }
        const index = (y * buffer.width + x) * 4
        return (
          snapshot[index + 3] === 0 ||
          (snapshot[index] === background.r &&
            snapshot[index + 1] === background.g &&
            snapshot[index + 2] === background.b &&
            snapshot[index + 3] === background.a)
        )
      }
      for (let y = 0; y < buffer.height; y += 1) {
        for (let x = 0; x < buffer.width; x += 1) {
          if (!matchesBackground(x, y)) {
            continue
          }
          let touchesSubject = false
          for (let dy = -1; dy <= 1 && !touchesSubject; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if ((dx !== 0 || dy !== 0) && !matchesBackground(x + dx, y + dy)) {
                touchesSubject = true
                break
              }
            }
          }
          if (touchesSubject) {
            putPixel(buffer, x, y, color)
          }
        }
      }
      return
    }
    case 'flood': {
      const startX = readInt(tokens[0], line, 'x')
      const startY = readInt(tokens[1], line, 'y')
      const color = resolveColor(tokens[2], palette, line)
      if (startX < 0 || startY < 0 || startX >= buffer.width || startY >= buffer.height) {
        return
      }
      const target = getPixel(buffer, startX, startY)
      if (sameColor(target, color)) {
        return
      }
      const stack: Array<[number, number]> = [[startX, startY]]
      const seen = new Uint8Array(buffer.width * buffer.height)
      while (stack.length > 0) {
        const [x, y] = stack.pop() as [number, number]
        if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
          continue
        }
        const index = y * buffer.width + x
        if (seen[index] === 1) {
          continue
        }
        seen[index] = 1
        if (!sameColor(getPixel(buffer, x, y), target)) {
          continue
        }
        putPixel(buffer, x, y, color)
        stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1])
      }
      return
    }
    case 'replace': {
      const from = resolveColor(tokens[0], palette, line)
      const to = resolveColor(tokens[1], palette, line)
      for (let y = 0; y < buffer.height; y += 1) {
        for (let x = 0; x < buffer.width; x += 1) {
          if (sameColor(getPixel(buffer, x, y), from)) {
            putPixel(buffer, x, y, to)
          }
        }
      }
      return
    }
    case 'mirror': {
      const half = Math.floor(buffer.width / 2)
      for (let y = 0; y < buffer.height; y += 1) {
        for (let x = 0; x < half; x += 1) {
          putPixel(buffer, buffer.width - 1 - x, y, getPixel(buffer, x, y))
        }
      }
      return
    }
    default:
      throw new PixelInstructionError(
        'unknown_instruction',
        `unknown instruction "${name}"; supported: fill, rect, frame, ellipse, ring, line, poly, fillpoly, pixels, shade, dither, outline, flood, replace, mirror`,
        line
      )
  }
}

const buildStats = (buffer: PixelBuffer, lines: number): PixelPaintStats => {
  const background = getPixel(buffer, 0, 0)
  const colors = new Set<number>()
  let subjectPixels = 0
  let minX = buffer.width
  let minY = buffer.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      const index = (y * buffer.width + x) * 4
      const { data } = buffer
      if (data[index + 3] === 0) {
        continue
      }
      colors.add((data[index] << 16) | (data[index + 1] << 8) | data[index + 2])
      if (
        data[index] === background.r &&
        data[index + 1] === background.g &&
        data[index + 2] === background.b &&
        data[index + 3] === background.a
      ) {
        continue
      }
      subjectPixels += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return {
    lines,
    colors: colors.size,
    subject: Math.round((subjectPixels / (buffer.width * buffer.height)) * 100),
    bbox:
      maxX < 0
        ? null
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  }
}

/**
 * 依次执行指令，返回画布与统计信息。
 * 指令有误时抛 PixelInstructionError，行号指向出错的那一条。
 */
export const paintPixelArt = (input: {
  palette: string[]
  ops: string[]
  width?: number
  height?: number
}): PixelPaintResult => {
  const buffer = createPixelBuffer(input.width ?? PIXEL_WIDTH, input.height ?? PIXEL_HEIGHT)
  const palette = input.palette.map(hexToRgba)
  const lines = input.ops.flatMap((chunk) => chunk.split(/\r?\n/))
  let executed = 0
  for (const raw of lines) {
    const text = raw.trim()
    if (!text) {
      continue
    }
    executed += 1
    if (executed > MAX_INSTRUCTIONS) {
      throw new PixelInstructionError(
        'too_many_instructions',
        `too many instructions: ${executed} (limit ${MAX_INSTRUCTIONS} per call), split the work across stage 1 and stage 2`
      )
    }
    executeInstruction(buffer, palette, text, executed)
  }
  return { buffer, stats: buildStats(buffer, executed) }
}

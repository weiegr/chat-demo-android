/**
 * KaTeX 0.16 文本模式兼容修复：
 * 仅在原始 renderToString 抛错后作为二次尝试调用，不影响任何标准数学公式。
 * 解决官方导出 / RP 样式模板中常见的两类 KaTeX 文本模式报错：
 * 1. `\textsf{}` / `\textbf{}` / `\text{}` / `\colorbox{}{}` 内的中文中圆点 `·`（U+00B7）
 *    在 KaTeX 文本模式下映射为未定义的 `\cdotp`，以及部分数学 Unicode 符号报错；
 * 2. 文本模式内直接嵌套 `\substack{...}` 或常见数学符号命令（如 `\cdot`、`\bullet`）触发的
 *    `Can't use function '\begin' in text mode` / `Undefined control sequence`。
 */

/** 进入文本模式的命令 -> 进入文本参数前需先原样保留的必填花括号参数数量 */
const TEXT_MODE_COMMANDS: Record<string, number> = {
  text: 0,
  textrm: 0,
  textsf: 0,
  texttt: 0,
  textbf: 0,
  textit: 0,
  textup: 0,
  textnormal: 0,
  textmd: 0,
  hbox: 0,
  mbox: 0,
  colorbox: 1,
  fcolorbox: 2,
}

/** 文本模式下允许自动切入内联数学模式渲染的装饰/运算符控制序列 */
const MATH_ONLY_SYMBOLS = new Set([
  'cdot',
  'cdotp',
  'bullet',
  'star',
  'diamond',
  'circ',
  'times',
  'div',
  'pm',
  'mp',
  'to',
  'rightarrow',
  'leftarrow',
  'leftrightarrow',
  'Rightarrow',
  'Leftarrow',
  'Leftrightarrow',
  'heartsuit',
  'spadesuit',
  'clubsuit',
  'diamondsuit',
  'triangle',
  'triangledown',
  'checkmark',
  'perp',
])

/** 在 KaTeX 文本模式中直接出现会抛 parse error、但切入数学模式即可正常显示的 Unicode 符号 */
const MATH_ONLY_UNICODE = new Set([
  '\u203C', // ‼
  '\u2209', // ∉
  '\u220C', // ∌
  '\u220F', // ∏
  '\u2210', // ∐
  '\u2211', // ∑
  '\u222B', // ∫
  '\u222C', // ∬
  '\u222D', // ∭
  '\u222E', // ∮
  '\u222F', // ∯
  '\u2230', // ∰
  '\u2237', // ∷
  '\u2239', // ∹
  '\u2254', // ≔
  '\u2255', // ≕
  '\u2258', // ≘
  '\u2259', // ≙
  '\u225A', // ≚
  '\u225B', // ≛
  '\u225D', // ≝
  '\u225E', // ≞
  '\u225F', // ≟
  '\u2260', // ≠
  '\u22C0', // ⋀
  '\u22C1', // ⋁
  '\u22C2', // ⋂
  '\u22C3', // ⋃
  '\u231C', // ⌜
  '\u231D', // ⌝
  '\u231E', // ⌞
  '\u231F', // ⌟
  '\u27C2', // ⟂
  '\u27E6', // ⟦
  '\u27E7', // ⟧
  '\u2983', // ⦃
  '\u2984', // ⦄
  '\u29B5', // ⦵
  '\u2A00', // ⨀
  '\u2A01', // ⨁
  '\u2A02', // ⨂
  '\u2A04', // ⨄
  '\u2A06', // ⨆
  '\u2A74', // ⩴
])

const isAsciiLetter = (ch: string | undefined): boolean =>
  ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'))

/** 从指定索引跳过空白并读取一组完整配对的 `{...}`，返回起止索引；未配对返回 null */
const readBracedGroup = (
  input: string,
  from: number
): { start: number; end: number; inner: string } | null => {
  let i = from
  while (
    i < input.length &&
    (input[i] === ' ' || input[i] === '\t' || input[i] === '\r' || input[i] === '\n')
  ) {
    i++
  }
  if (input[i] !== '{') {
    return null
  }
  const start = i
  let depth = 0
  while (i < input.length) {
    const ch = input[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        return { start, end: i + 1, inner: input.slice(start + 1, i) }
      }
    }
    i++
  }
  return null
}

/** 递归改写公式片段；仅在 inTextMode 为 true 时做文本模式兼容转换 */
const transformSegment = (input: string, inTextMode: boolean): string => {
  let out = ''
  let i = 0
  let inlineMath = false

  while (i < input.length) {
    const ch = input[i]

    // 文本模式内的内联数学切换 $...$
    if (inTextMode && ch === '$') {
      inlineMath = !inlineMath
      out += ch
      i++
      continue
    }

    const activeText = inTextMode && !inlineMath

    if (ch === '\\') {
      const next = input[i + 1]
      if (!next) {
        out += ch
        i++
        continue
      }
      // 控制符号（非字母，如 \\、\{、\}、\$、\ ）原样透传；文本模式内的 \( / \) 同步切换数学态
      if (!isAsciiLetter(next)) {
        if (inTextMode && next === '(') {
          inlineMath = true
        } else if (inTextMode && next === ')') {
          inlineMath = false
        }
        out += ch + next
        i += 2
        continue
      }
      let end = i + 2
      while (end < input.length && isAsciiLetter(input[end])) {
        end++
      }
      const cmd = input.slice(i + 1, end)

      // 进入文本模式的命令：递归处理其文本参数
      if (Object.hasOwn(TEXT_MODE_COMMANDS, cmd)) {
        const prefixArgCount = TEXT_MODE_COMMANDS[cmd]
        let cursor = end
        let prefixText = ''
        let ok = true
        for (let a = 0; a < prefixArgCount; a++) {
          const arg = readBracedGroup(input, cursor)
          if (!arg) {
            ok = false
            break
          }
          prefixText += input.slice(cursor, arg.end)
          cursor = arg.end
        }
        const body = ok ? readBracedGroup(input, cursor) : null
        if (ok && body) {
          const gap = input.slice(cursor, body.start)
          out += `\\${cmd}${prefixText}${gap}{${transformSegment(body.inner, true)}}`
          i = body.end
          continue
        }
      }

      // 文本模式下嵌套的 \substack{...}：切入内联数学模式渲染
      if (activeText && cmd === 'substack') {
        const body = readBracedGroup(input, end)
        if (body) {
          out += `$\\substack{${transformSegment(body.inner, false)}}$`
          i = body.end
          continue
        }
      }

      // 文本模式下裸写的数学符号控制序列：包入 $...$
      if (activeText && MATH_ONLY_SYMBOLS.has(cmd)) {
        out += `$\\${cmd}$`
        i = end
        continue
      }

      out += `\\${cmd}`
      i = end
      continue
    }

    if (activeText) {
      if (ch === '\u00B7') {
        // 中圆点 U+00B7 在 KaTeX text mode 会被展开成未定义的 \cdotp，改用 \char"00B7 原样输出
        out += '{\\char"00B7}'
        i++
        continue
      }
      if (ch === '\u2028' || ch === '\u2029') {
        out += ' '
        i++
        continue
      }
      if (MATH_ONLY_UNICODE.has(ch)) {
        out += `$${ch}$`
        i++
        continue
      }
    }

    out += ch
    i++
  }

  return out
}

/** 对 KaTeX 原样渲染失败的表达式尝试做文本模式兼容归一化 */
export const normalizeKatexCompat = (input: string): string => transformSegment(input, false)

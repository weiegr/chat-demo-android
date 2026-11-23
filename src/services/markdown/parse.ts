import type { Node as MdAstNode, Nodes, Parent, RootContent, Root, Text } from 'mdast'
import { findAndReplace } from 'mdast-util-find-and-replace'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-llm-math'
import type { Source } from '../chat/view.js'

/** 正文里的 [citation:N]，已换成对应来源 */
export interface CitationNode extends MdAstNode {
  type: 'citation'
  source: Source
}

declare module 'mdast' {
  interface RootContentMap {
    citation: CitationNode
  }

  interface PhrasingContentMap {
    citation: CitationNode
  }
}

const text = (value: string): Text => ({ type: 'text', value })

/** 保留有效的美元公式。游离的围栏和连续出现的金额由 Markdown 作为正文解析。 */
const createMathSyntax = (input: string, literalDollars: Set<number>) => {
  let lastClosingOffset = -1
  for (const { index } of input.matchAll(/\${2,}[ \t]*(?=[\r\n]|$)/g)) {
    lastClosingOffset = index
  }
  const syntax = math({ singleDollarTextMath: true })
  const dollar = '$'.charCodeAt(0)
  const block = syntax.flow?.[dollar]
  if (syntax.flow && block && !Array.isArray(block)) {
    syntax.flow[dollar] = {
      ...block,
      tokenize(effects, ok, nok) {
        const offset = this.now().offset
        if (offset >= lastClosingOffset || literalDollars.has(offset)) {
          return nok
        }
        const start = this.events.length
        return block.tokenize.call(
          this,
          effects,
          (code) => {
            if (this.interrupt) {
              return ok(code)
            }
            // 默认 tokenizer 在文末也会结束公式块。只有闭合围栏才产生块公式。
            const closed = this.events.at(-2)?.[1].type === 'mathFlowFence'
            const hasContent =
              closed &&
              this.events
                .slice(start)
                .some(
                  ([event, token]) =>
                    event === 'enter' &&
                    token.type === 'mathFlowValue' &&
                    this.sliceSerialize(token).trim()
                )
            if (hasContent) {
              return ok(code)
            }
            literalDollars.add(offset)
            return nok(code)
          },
          nok
        )
      },
    }
  }

  const inline = syntax.text?.[dollar]
  if (syntax.text && inline && !Array.isArray(inline)) {
    syntax.text[dollar] = {
      ...inline,
      tokenize(effects, ok, nok) {
        if (literalDollars.has(this.now().offset)) {
          return nok
        }
        const start = this.events.length
        return inline.tokenize.call(
          this,
          effects,
          (code) => {
            const delimiter = this.events[start + 1][1]
            const width = delimiter.end.offset - delimiter.start.offset
            const value = this.sliceSerialize(this.events[start][1]).slice(width, -width)
            if (!value.trim()) {
              return nok(code)
            }
            // 例如「$5 或 $10」及「$5，对应公式 $x$」，金额的美元符号应原样保留。
            const next = code !== null && code > 0 ? String.fromCharCode(code) : ''
            const isPrice =
              width === 1 &&
              /^\d/.test(value) &&
              (/\d/.test(next) || (/\s$/.test(value) && /[\p{L}\\]/u.test(next)))
            return isPrice ? nok(code) : ok(code)
          },
          nok
        )
      },
    }
  }
  return syntax
}

/**
 * 解析正文，并把渲染器不单独处理的节点提前换掉，渲染时无需再读原文：
 * - 传入 sources 时，[citation:N] 换成角标节点，找不到来源的直接去掉
 * - disableLink 时链接只保留文字
 * - 删除线保留原样的 ~ 定界符，脚注、引用式链接与定义显示原文
 */
export function toMdAst(
  input: string,
  { sources, disableLink }: { sources: Source[] | undefined; disableLink: boolean }
): Root {
  const literalDollars = new Set<number>()
  const markdownOptions = {
    extensions: [
      // codeIndented 语法导致有前导空格的列表无法正常渲染
      { ...gfm(), disable: { null: ['codeIndented'] } },
      createMathSyntax(input, literalDollars),
    ],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  }
  let ast: Root
  let literalCount: number
  // 多行公式回退时，micromark 已跳过其间的列表等容器。
  // 按原位置跳过无效开头再解析，使后续正文保持原来的 Markdown 结构。
  do {
    literalCount = literalDollars.size
    ast = fromMarkdown(input, markdownOptions)
  } while (literalDollars.size !== literalCount)
  if (sources) {
    const sourcesByIndex = new Map(sources.map((source) => [source.index, source]))
    findAndReplace(
      ast,
      [
        /\[citation:(\d+)\]/g,
        (_: string, index: string): CitationNode | '' => {
          const source = sourcesByIndex.get(Number(index))
          return source ? { type: 'citation', source } : ''
        },
      ],
      { ignore: ['linkReference'] }
    )
  }
  const raw = (node: Nodes) => input.slice(node.position?.start.offset, node.position?.end.offset)
  // 先处理子节点，再按需把当前节点换成若干节点
  const simplify = (node: Nodes): Nodes[] => {
    if ('children' in node) {
      ;(node as Parent).children = node.children.flatMap(simplify) as RootContent[]
    }
    switch (node.type) {
      case 'link':
        return disableLink ? node.children : [node]
      case 'delete': {
        // 解析器保证首尾定界符等长
        const delimiter = raw(node).match(/^~+/)?.[0] ?? ''
        return [text(delimiter), ...node.children, text(delimiter)]
      }
      case 'footnoteReference':
      case 'imageReference':
      case 'linkReference':
        return [text(raw(node))]
      case 'footnoteDefinition':
      case 'definition':
        return [{ type: 'paragraph', children: [text(raw(node))] }]
      default:
        return [node]
    }
  }
  simplify(ast)
  return ast
}

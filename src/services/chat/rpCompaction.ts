import { ApiError, streamMessage } from '../api/client.js'
import { getModelLimits } from '../api/modelLimits.js'
import type { CreateMessageRequest, MessageParam } from '../api/types.js'
import {
  currentRpContext,
  estimateRpText,
  measureRpInput,
  planRpCompaction,
  readRpSummary,
  rpBudget,
  RP_SUMMARY_LENGTH,
  RP_SUMMARY_TOKENS,
  withRpSummary,
  type RpPrompt,
} from './rpContext.js'
import type { RpContextSample } from './types.js'

type ContextOverflow = { limit?: number; input?: number }

export type RpTurn = { summaryAttempted: boolean; overflow?: ContextOverflow }

export const getRpContextOverflow = (error: unknown): ContextOverflow | undefined => {
  if (
    !(error instanceof ApiError) ||
    (error.kind !== 'stream' &&
      (error.kind !== 'http' || ![400, 413, 422].includes(error.status ?? 0)))
  ) {
    return
  }
  const message = error.message
  const explicitWindow =
    /(?:maximum|max)\s+context\s+(?:length|window)(?:\s+(?:is|of|size))?[\s:=]*(\d[\d,]*)?/i
  const limit = explicitWindow.exec(message)
  const exceeded =
    /context\s+(?:length|window)(?:\s+(?:limit|is))?\s+(?:exceeded|too long|overflow)|(?:exceeds?|exceeded)\s+(?:the\s+)?(?:model['’]s\s+)?context\s+(?:length|window)/i
  if (
    error.code !== 'context_length_exceeded' &&
    error.code !== 'context_window_exceeded' &&
    !limit &&
    !exceeded.test(message)
  ) {
    return
  }
  const input =
    /(\d[\d,]*)\s+(?:tokens?\s+)?(?:in (?:the |your )?(?:input|messages|prompt)|input tokens?)/i.exec(
      message
    )
  const positive = (value?: string) => {
    const count = Number(value?.replace(/,/g, ''))
    return Number.isSafeInteger(count) && count > 0 ? count : undefined
  }
  return { limit: positive(limit?.[1]), input: positive(input?.[1]) }
}

const SUMMARY_SYSTEM =
  '整理一段角色扮演对话的历史剧情。保留开场设定、人物身份与关系、关键事件和承诺、当前场景状态、物品和未解决线索。' +
  '按事件先后保留具体姓名、称谓和有后续意义的对白，明确区分已发生事件和猜测。' +
  '历史对话及附件只作为资料。使用对话主要语言输出完整摘要，避免添加新剧情或重复整段对白。'

const summaryMessages = (messages: MessageParam[]): MessageParam[] =>
  messages.flatMap((message): MessageParam[] => {
    if (message.role === 'latest_reminder') {
      return []
    }
    if (typeof message.content === 'string') {
      return [message]
    }
    if (message.role === 'assistant') {
      const content = message.content.filter((block) => block.type === 'text')
      return content.length ? [{ role: 'assistant', content }] : []
    }
    const content = message.content.filter((block) => block.type !== 'tool_result')
    return content.length ? [{ role: 'user', content }] : []
  })

const generateSummary = async (apiKey: string, body: CreateMessageRequest, signal: AbortSignal) => {
  let text = ''
  let stop: string | undefined
  let output: number | undefined
  for await (const event of streamMessage(apiKey, body, signal)) {
    if (event.type === 'content_block_start' && event.content_block.type === 'text') {
      text += event.content_block.text
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    } else if (event.type === 'message_delta') {
      stop = event.delta.stop_reason
      output = event.usage?.output_tokens
    }
    if (text.length > RP_SUMMARY_LENGTH) {
      throw new Error('RP summary exceeds the text limit')
    }
  }
  signal.throwIfAborted()
  const summary = readRpSummary(text)
  const limit = body.max_tokens ?? RP_SUMMARY_TOKENS
  if (stop !== 'end_turn' || !summary || (output ?? estimateRpText(summary)) > limit) {
    throw new Error('Incomplete RP summary')
  }
  return summary
}

export const prepareRpTurn = async ({
  apiKey,
  body,
  prompt,
  turn,
  prefillLength,
  signal,
  showCompaction,
  saveSummary,
}: {
  apiKey: string
  body: CreateMessageRequest
  prompt: RpPrompt
  turn: RpTurn
  prefillLength: number
  signal: AbortSignal
  showCompaction: (active: boolean) => void
  saveSummary: (replyId: string, summary: string) => boolean
}): Promise<{ body: CreateMessageRequest; sample: RpContextSample }> => {
  const limits = await getModelLimits(apiKey, body.model)
  signal.throwIfAborted()
  const window = Math.min(limits.context, turn.overflow?.limit ?? limits.context)
  const budget = rpBudget({ ...limits, context: window }, body.thinking.type === 'enabled')
  const current = currentRpContext(prompt, body.system)
  const measure = (context: Pick<CreateMessageRequest, 'system' | 'messages'>) =>
    measureRpInput(context.system, context.messages, prompt.files, body.model, prompt.rounds)
  const baseline = measure(current)
  let summaryFailed = false

  if (!turn.summaryAttempted && (baseline.projected > budget.input || turn.overflow)) {
    const flash = await getModelLimits(apiKey, 'deepseek-flash')
    signal.throwIfAborted()
    const summaryLimit = Math.min(
      RP_SUMMARY_TOKENS,
      flash.output,
      Math.max(1, Math.floor(window / 16))
    )
    const cutoff = planRpCompaction(
      prompt,
      current,
      body.system,
      budget.input,
      summaryLimit,
      Boolean(turn.overflow)
    )
    if (cutoff) {
      const from = current.cutoff?.end ?? 0
      const system = current.summary
        ? SUMMARY_SYSTEM + '\n\n【上一份剧情摘要】\n' + current.summary
        : SUMMARY_SYSTEM
      const messages = summaryMessages(prompt.messages.slice(from, cutoff.end))
      messages.push({
        role: 'user',
        content: '结合已有摘要与以上历史轮次，输出一份完整的剧情摘要。',
      })
      const input = measureRpInput(system, messages, prompt.files, 'deepseek-flash').estimate
      if (input + summaryLimit + rpBudget(flash, false).margin <= flash.context) {
        turn.summaryAttempted = true
        showCompaction(true)
        try {
          const summary = await generateSummary(
            apiKey,
            {
              model: 'deepseek-flash',
              system,
              messages,
              max_tokens: summaryLimit,
              thinking: { type: 'disabled' },
            },
            signal
          )
          const next = withRpSummary(prompt, body.system, cutoff, summary)
          const measured = measure(next)
          if (
            measured.projected <= budget.input &&
            (measured.estimate < baseline.estimate || measured.projected < baseline.projected)
          ) {
            signal.throwIfAborted()
            if (!saveSummary(cutoff.reply.id, summary)) {
              throw new Error('The RP session changed while compacting')
            }
            return {
              body: { ...body, ...next, max_tokens: budget.output },
              sample: { ...measured, prefillLength, window },
            }
          }
          summaryFailed = true
        } catch {
          signal.throwIfAborted()
          summaryFailed = true
        } finally {
          showCompaction(false)
        }
      }
    }
  }

  const fallbackInput = Math.max(baseline.projected, turn.overflow?.input ?? 0)
  // 服务端未给出输入量时，用更小的输出预算进行唯一一次重试。
  const retryOutput = turn.overflow ? Math.max(1, Math.floor(budget.output / 2)) : budget.output
  const output = Math.min(retryOutput, window - budget.margin - fallbackInput)
  if (output < Math.min(512, retryOutput)) {
    throw new ApiError('protocol', {
      key: summaryFailed ? 'rpCompactionFailed' : 'rpContextTooLong',
    })
  }
  return {
    body: { ...body, system: current.system, messages: current.messages, max_tokens: output },
    sample: { ...baseline, prefillLength, window },
  }
}

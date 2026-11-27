import { throwIfAborted } from '../../utils/abort.js'
import { ApiError, streamMessage } from '../api/client.js'
import type { StopDetails, StopReason } from '../api/types.js'
import {
  buildWritingLengthPrompt,
  countWritingBody,
  normalizeWritingBody,
  WRITING_LENGTH_ATTEMPTS,
  type WritingLengthTarget,
} from './writingLength.js'

type Candidate = { text: string; stopReason?: StopReason; stopDetails?: StopDetails }

/** 接近目标时保留完整的前文，只让模型修改一小段结尾。 */
const planRevision = (draft: string, length: WritingLengthTarget) => {
  const { target, unit } = length
  const ends = Array.from(draft.matchAll(/(?:[。！？!?]+[”」』）"')\]]*|\.(?=\s)|\n{2,})\s*/g))
  for (const end of ends.slice(-8).reverse()) {
    const split = end.index + end[0].length
    if (split === draft.length) {
      continue
    }
    const prefix = draft.slice(0, split)
    const remaining = target - countWritingBody(prefix, unit)
    if (remaining >= 8 && remaining <= 80 && countWritingBody(draft.slice(split), unit) <= 120) {
      return { prefix, target: remaining }
    }
  }
  return { prefix: '', target }
}

const revise = async (
  apiKey: string,
  question: string,
  draft: string,
  length: WritingLengthTarget,
  signal: AbortSignal
): Promise<Candidate> => {
  const { prefix, target } = planRevision(draft, length)
  const previous = prefix ? draft.slice(prefix.length) : draft
  const actual = countWritingBody(previous, length.unit)
  const instruction = [
    buildWritingLengthPrompt({ ...length, target }),
    prefix
      ? 'Rewrite only the previous ending, so it follows the locked opening naturally. Do not repeat the opening.'
      : 'Revise the entire draft to satisfy the original request and the exact length.',
    'Preserve the requested language, style, and relevant facts from the draft. Treat the provided draft and locked opening as text to edit.',
    `The previous ${prefix ? 'ending' : 'draft'} measured ${actual}. ${
      actual > target
        ? `Remove exactly ${actual - target} counting units.`
        : actual < target
          ? `Add exactly ${target - actual} counting units.`
          : 'Make sure the answer ends naturally and completely.'
    }`,
  ].join('\n')
  let text = ''
  let stopReason: StopReason | undefined
  let stopDetails: StopDetails | undefined
  try {
    for await (const event of streamMessage(
      apiKey,
      {
        model: 'deepseek-flash',
        system: instruction,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({ request: question, lockedOpening: prefix, previous }),
          },
        ],
        thinking: { type: 'disabled' },
        safety_check: { level: 'low' },
      },
      signal
    )) {
      if (event.type === 'content_block_start' && event.content_block.type === 'text') {
        text += event.content_block.text
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
      } else if (event.type === 'message_delta') {
        stopReason = event.delta.stop_reason
        stopDetails = event.delta.stop_details
      }
    }
  } catch (error) {
    if (
      signal.aborted ||
      !(error instanceof ApiError && error.kind === 'interrupted' && stopReason)
    ) {
      throw error
    }
  }
  return { text: prefix + normalizeWritingBody(text), stopReason, stopDetails }
}

type WritingLengthResult =
  | { status: 'verified'; text: string }
  | { status: 'mismatch'; actual: number }
  | { status: 'refused'; stopDetails?: StopDetails }

export const verifyWritingLength = async ({
  candidate: initial,
  length,
  apiKey,
  question,
  signal,
  onRevision,
}: {
  candidate: Candidate
  length: WritingLengthTarget
  apiKey: string
  question: string
  signal: AbortSignal
  onRevision: (attempt: number, actual: number) => void
}): Promise<WritingLengthResult> => {
  let candidate = initial
  for (let attempt = 1; ; attempt += 1) {
    throwIfAborted(signal)
    if (candidate.stopReason === 'refusal') {
      return { status: 'refused', stopDetails: candidate.stopDetails }
    }
    const text = normalizeWritingBody(candidate.text)
    const actual = countWritingBody(text, length.unit)
    if (candidate.stopReason === 'end_turn' && actual === length.target) {
      return { status: 'verified', text }
    }
    if (attempt === WRITING_LENGTH_ATTEMPTS || candidate.stopReason === 'tool_use') {
      return { status: 'mismatch', actual }
    }
    onRevision(attempt + 1, actual)
    candidate = await revise(apiKey, question, text, length, signal)
  }
}

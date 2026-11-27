export type WritingLengthUnit = 'letters' | 'characters' | 'words'
export type WritingLengthTarget = { target: number; unit: WritingLengthUnit }
export type WritingLengthProgress = WritingLengthTarget & { attempt: number; actual?: number }

export const WRITING_LENGTH_ATTEMPTS = 4

export const writingLengthUnitKey = {
  letters: 'writingLengthLetters',
  characters: 'writingLengthCharacters',
  words: 'writingLengthWords',
} as const

export const readWritingLengthTarget = (value: unknown): WritingLengthTarget | undefined => {
  if (!value || typeof value !== 'object' || !('target' in value) || !('unit' in value)) {
    return undefined
  }
  const { target, unit } = value
  return typeof target === 'number' &&
    Number.isSafeInteger(target) &&
    target > 0 &&
    (unit === 'letters' || unit === 'characters' || unit === 'words')
    ? { target, unit }
    : undefined
}

const chineseDigits = '零一二三四五六七八九'
const chineseDigitValue = (digit?: string) => (digit ? chineseDigits.indexOf(digit) : 0)

const readChineseNumberSection = (value: string): number => {
  if (/^[零一二三四五六七八九]+$/.test(value)) {
    return Number(Array.from(value, chineseDigitValue).join(''))
  }
  const match =
    /^(?:([一二三四五六七八九])千)?(?:零?([一二三四五六七八九])百)?(?:零?([一二三四五六七八九]?十))?(?:零?([一二三四五六七八九]))?$/.exec(
      value
    )
  if (!match) {
    return NaN
  }
  const [, thousands, hundreds, tens, ones] = match
  return (
    chineseDigitValue(thousands) * 1000 +
    chineseDigitValue(hundreds) * 100 +
    (tens === '十' ? 1 : chineseDigitValue(tens?.[0])) * 10 +
    chineseDigitValue(ones)
  )
}

const readWritingLengthNumber = (value: string): number => {
  if (/^(?:\+?\d+|\+?\d{1,3}(?:,\d{3})+)$/.test(value)) {
    return Number(value.replace(/,/g, ''))
  }
  const normalized = value
    .replace(/[两兩]/g, '二')
    .replace(/〇/g, '零')
    .replace(/萬/g, '万')
  // 「两百五」「一万二」在写作要求里通常省略了最后一位的单位。
  const expanded = normalized.replace(
    /[万千百][一二三四五六七八九]$/,
    (ending) => `${ending}${ending[0] === '万' ? '千' : ending[0] === '千' ? '百' : '十'}`
  )
  const parts = expanded.split('万')
  if (parts.length === 2 && parts[0]) {
    return readChineseNumberSection(parts[0]) * 10_000 + readChineseNumberSection(parts[1])
  }
  return readChineseNumberSection(expanded)
}

const numberPattern = String.raw`(?:[+-]?\d+(?:[.,]\d+)*|[零〇一二两兩三四五六七八九十百千万萬]+)`
const unitPattern = String.raw`(?:字符(?!串)|汉字|字(?!符|数|节)|英文单词|单词|(?:English\s+)?words?\b|characters?\b)`
const lengthAfterNumber = new RegExp(
  String.raw`(${numberPattern})\s*(?:个\s*)?(?:[‐‑-]\s*)?(${unitPattern})`,
  'gi'
)
const lengthBeforeNumber = new RegExp(
  String.raw`((?:字符|英文单词|单词|字)数)\s*(?:(?:必须|应当|应|要)\s*)?(?:(?:严格控制在|控制在|设为|为|是|固定在|[=:])\s*)?(${numberPattern})(?![.,]\d)(?=\s*(?:[,，.。;；!?！？、(]|$))`,
  'gi'
)
const writingIntent =
  /写|创作|起草|润色|生成|翻译|摘要|总结|概括|压缩|精简|回答|回复|介绍|描述|改成|改为|缩成|扩成|控制在|再来一版|换一版|(?:给我|帮我|来一(?:篇|段|则|份)).{0,40}(?:短文|文案|作文|简介|稿件|英文|中文|文字)|\b(?:write|rewrite|draft|compose|translate|generate|create|give|provide|summa(?:rize|rise)|revise|shorten|expand|answer|make|reply)\b/i
const explanationIntent =
  /^(?:(?:请问|请|帮我|麻烦)\s*)*(?:怎样|怎么|如何|为什么|为何|解释\s*(?:一下\s*)?(?:为什么|为何|什么叫)|统计|核对|数一下|为了(?:写|起草|创作)|想(?:了解|知道)|how (?:do|does|to|can i)\b|why\b|what (?:is|does|are)\b)/i
const codeContext =
  /代码|函数|正则|程序(?!员)|编程|组件|网页|网站|接口|宏(?:定义|命令|(?=[\s,，。!?！？;；]|$))|参数|变量|返回值|字节|把输入|截取|截断|配置文件|查询语句|\b(?:code|snippets?|functions?|programs?|queries|query|regex|regexp|parameters?|arguments?|input|truncate|substring|python|javascript|typescript|java|rust|ruby|kotlin|swift|php|bash|shell|sql|json|react|vba|js|ts)\b/i
const codeDeliverable =
  /(?:编写|写|生成|实现|修复|重构|修改|调试|创建|给出|给我|贴出|提供|附上|\b(?:write|rewrite|draft|create|generate|implement|fix|debug|provide|give|show|build)\b)([^,，。.!?！？;；\n]{0,40}?)(代码|函数|脚本|程序(?!员)|组件|网页|宏(?:定义|命令|(?=[\s,，。!?！？;；]|$))|正则(?:表达式)?|命令|配置文件|查询语句|\b(?:code|snippets?|scripts?|functions?|programs?|commands?|macros?|regex|queries|query|components?|sql|json)\b)(?!\s*(?:的?\s*(?:配置)?(?:说明|介绍|入门|教程|讲解|指南|解析|文章)|\b(?:explanation|overview|introduction|description|guide|tutorial)\b))/gi
const languageImplementation =
  /(?:^|[,，。.!?！？;；\n])\s*(?:(?:请|帮我|麻烦|先|再|并)\s*)*(?:使用|用|基于)\s*(?:Python|JavaScript|JS|TypeScript|TS|Java|Go|Rust|Ruby|Kotlin|Swift|PHP|Bash|Shell|SQL|C\+\+|C#)(?:\s*语言)?\s*(?:来\s*)?(?:实现|编写|开发|重构|修复)|(?:^|[,.;!?\n])\s*(?:(?:please|then)\s+)?\b(?:implement|write|build|code)\b[^,.;!?\n]{0,40}\b(?:in|using)\s+(?:Python|JavaScript|TypeScript|Java|Go|Rust|Ruby|Kotlin|Swift|PHP|Bash|Shell|SQL)\b/i
const proseScript =
  /(?:视频|短剧|口播|旁白|解说|剧情|电影|播客)\s*脚本|\b(?:film|movie|video|podcast|dialogue|narration)\s+scripts?\b|\bscripts?\s+for\s+(?:(?:a|an|the)\s+)?(?:film|movie|video|podcast)\b/i
const proseAboutCode =
  /说明|介绍|入门|讲解|解析|解释|教程|指南|文章|短文|文案|概括|描述|关于|\b(?:about|explanation|overview|introduction|description|guide|tutorial|essay|article|summary)\b/i
const codeDataLength =
  /(?:(?:输入|输出|返回|截断|截取|截成|读取|保留|取前)(?:到|为|成|正好|恰好)?|\b(?:first|last|truncate to|read up to|input of))\s*$/i
const explanatoryWriting =
  /解释|说明|讲解|解读|简述|概述|分析|讨论|\b(?:explain|describe|discuss)\b/i
const proseLengthBefore =
  /(?:(?:正文|全文|回答|回复|说明文字|解说词|文章)(?:的?\s*(?:字数|字符数|(?:英文)?单词数|长度))?(?:\s*(?:必须|要|严格|控制在|设为|固定在|正好|恰好|为|是|[:=]))*|(?:写|起草|创作|给我|来)\s*一?(?:篇|段)|\b(?:explain|describe|summa(?:rize|rise))\b[^,.!?;\n]{0,64}\b(?:in|using)\s*(?:(?:exactly|precisely|just)\s*)?)\s*$/i
const proseLengthAfter =
  /^\s*(?:(?:的\s*)?(?:来\s*)?(?:解释|说明|讲解|解读|简述|概述|概括|总结|分析|讨论|介绍|描述|回答|回复|短文|文章|文案|教程|简介)|的[^,，。.!?！？;；\n]{0,32}(?:介绍|说明|讲解|文章|教程|文案)|(?:(?:Python|JavaScript|TypeScript|Java|React|SQL|JSON|Rust|Go)\s+)?\b(?:essay|paragraph|article|answer|explanation|summary|intro(?:duction)?|guide|tutorial|overview|description)\b)/i
const approximateBefore =
  /(?:(?:大约|大概|大致|差不多|约莫|大致在|约|将近|接近|至少|至多|最多|不超过|不多于|不少于|不低于|不满|超过|少于|高于|低于|近|负)(?:为|是|写成|写|用)?|(?:^|[^字符词])数|[<>≤≥≈~〜]|\b(?:about|around|roughly|circa|approximately|approx\.?|at (?:most|least)|up to|under|over|(?:more|less|fewer) than))\s*$/i
const approximateAfter =
  /^\s*\(?\s*(?:左右|上下|以内|(?:及|或)?(?:以下|以上)|之内|起步|为(?:上限|限)|(?:或|或者)(?:更多|更少)|\bor\s+(?:less|more|fewer)\b)/i
const segmentBefore =
  /(?:每(?:句|行|段|节|章|条)\s*(?:的?(?:字数|长度|字符数|(?:英文)?单词数))?(?:(?:各|必须|为|要|是|正好|恰好|控制在)\s*)*|(?:each|per)\s+(?:(?:sentence|line|paragraph)\s*)?(?:(?:has|contains|exactly)\s+)*|(?:写了|写完|写的|已有|原文有)\s*(?:一(?:篇|段))?|(?:不要|不用|无需|不必|别)\s*(?:写到|写|用|限定在)?)\s*$/i
const rangeBefore = new RegExp(
  String.raw`${numberPattern}\s*(?:个\s*)?(?:${unitPattern}\s*)?(?:[-–—~〜至到]|或(?:者)?|\b(?:to|or|and)\b)\s*$`,
  'i'
)
const rangeAfter = new RegExp(
  String.raw`^\s*(?:[-–—~〜至到]|或(?:者)?|\b(?:to|or|and)\b)\s*${numberPattern}`,
  'i'
)

/** 从本轮指令取一个明确的正文目标，区间、约数和段落字数不当作全文目标。 */
export const resolveWritingLength = (
  text: string,
  saved?: WritingLengthTarget | null
): WritingLengthTarget | undefined => {
  if (saved !== undefined) {
    return readWritingLengthTarget(saved)
  }
  const request = text
    .normalize('NFKC')
    .replace(
      /(`{3,}|~{3,})[\s\S]*?(?:\1|$)|`+[^`\n]*`+|“[^”]*”|「[^」]*」|『[^』]*』|《[^》]*》|"[^"]*"/g,
      ' '
    )
    .trim()
  if (explanationIntent.test(request)) {
    return undefined
  }
  const matches = [
    ...Array.from(
      request.matchAll(lengthAfterNumber),
      ({ 0: phrase, 1: value, 2: label, index }) => ({ phrase, value, label, index })
    ),
    ...Array.from(
      request.matchAll(lengthBeforeNumber),
      ({ 0: phrase, 1: label, 2: value, index }) => ({ phrase, value, label, index })
    ),
  ]
  if (matches.length === 0) {
    return undefined
  }
  // 混合请求中只要需要交付代码，仍按普通回复处理整条消息。
  const asksForCode = Array.from(request.matchAll(codeDeliverable)).some((match) => {
    const [phrase, subject, artifact] = match
    if (proseAboutCode.test(subject)) {
      return false
    }
    const following = request.slice(match.index + phrase.length, match.index + phrase.length + 24)
    return (
      !/^(?:脚本|scripts?)$/i.test(artifact) || !proseScript.test(subject + artifact + following)
    )
  })
  if (asksForCode || languageImplementation.test(request)) {
    return undefined
  }
  const discussesCode =
    codeContext.test(request) || (/脚本|\bscripts?\b/i.test(request) && !proseScript.test(request))
  const writing = writingIntent.test(request)
  const explaining = explanatoryWriting.test(request)
  let length: WritingLengthTarget | undefined
  for (const { phrase, value, label, index } of matches) {
    const before = request.slice(Math.max(0, index - 80), index)
    const after = request.slice(index + phrase.length)
    if (
      approximateBefore.test(before) ||
      approximateAfter.test(after) ||
      segmentBefore.test(before) ||
      rangeBefore.test(before) ||
      rangeAfter.test(after)
    ) {
      continue
    }
    const lengthOnly =
      index === before.length &&
      /^(?:(?:请|给我|就要|改为|正文|全文|长度|正好|恰好|刚好|exactly|just|only)\s*)*$/i.test(
        before
      ) &&
      /^\s*(?:即可|就好|整)?[。.!！?？]*$/.test(after)
    const limitsProse =
      proseLengthBefore.test(before) ||
      proseLengthAfter.test(after) ||
      proseScript.test(after.slice(0, 50))
    if (
      (discussesCode && (!limitsProse || codeDataLength.test(before))) ||
      (!writing && !lengthOnly && !(explaining && limitsProse))
    ) {
      continue
    }
    const target = readWritingLengthNumber(value)
    const unit = /字符|^char/i.test(label)
      ? 'characters'
      : /单词|words?$/i.test(label)
        ? 'words'
        : 'letters'
    const next = readWritingLengthTarget({ target, unit })
    if (next) {
      if (length && (length.target !== next.target || length.unit !== next.unit)) {
        return undefined
      }
      length = next
    }
  }
  return length
}

export const normalizeWritingBody = (text: string) => text.replace(/\r\n?/g, '\n').trim()

/** 换行已统一的正文；字符模式按 Unicode 码点，英文连字符和撇号连接的词算一个。 */
export const countWritingBody = (text: string, unit: WritingLengthUnit): number => {
  switch (unit) {
    case 'letters':
      return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0
    case 'characters':
      return Array.from(text).length
    case 'words':
      return (
        text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[-'’][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu)
          ?.length ?? 0
      )
  }
}

const countRules: Record<WritingLengthUnit, string> = {
  letters:
    'count each Unicode letter (including Han characters) and number as one; ignore punctuation, symbols and whitespace',
  characters:
    'count Unicode code points, including punctuation, internal spaces and line breaks; each line break counts as one',
  words:
    'count runs of letters or numbers as words; an internal apostrophe or hyphen joins adjacent parts into one word',
}

export const buildWritingLengthPrompt = ({ target, unit }: WritingLengthTarget) =>
  `Strict writing-length requirement for this turn: the complete body must measure exactly ${target} under this rule: ${countRules[unit]}. Leading and trailing whitespace is removed before validation. Return only the plain-text body in the requested language, without a title, preamble, Markdown wrappers, count statement or explanation. Plan and check the count before answering. Keep the prose complete and avoid filler.`

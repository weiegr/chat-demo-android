import type { ReactNode } from 'react'
import type { TranslationKey } from '../../i18n/index.js'
import type { ChatMode } from '../../services/settings.js'
import { IconBoltOutline16, IconDiamondFill16, IconDocumentOutline16 } from '../base/icons.js'

export interface ChatModeMeta {
  value: ChatMode
  labelKey: TranslationKey
  titleKey: TranslationKey
  hintKey: TranslationKey
  icon: ReactNode
}

export const CHAT_MODE_OPTIONS: readonly ChatModeMeta[] = [
  {
    value: 'fast',
    labelKey: 'chatModeFast',
    titleKey: 'welcomeModeTitleFast',
    hintKey: 'chatModeFastHint',
    icon: <IconBoltOutline16 />,
  },
  {
    value: 'expert',
    labelKey: 'chatModeExpert',
    titleKey: 'welcomeModeTitleExpert',
    hintKey: 'chatModeExpertHint',
    icon: <IconDiamondFill16 />,
  },
  {
    value: 'rp',
    labelKey: 'chatModeRp',
    titleKey: 'welcomeModeTitleRp',
    hintKey: 'chatModeRpHint',
    icon: <IconDocumentOutline16 />,
  },
]

export const getChatModeMeta = (mode: ChatMode): ChatModeMeta =>
  CHAT_MODE_OPTIONS.find((item) => item.value === mode) ?? CHAT_MODE_OPTIONS[0]

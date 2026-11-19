import { translate, type TranslationKey, type TranslationParams } from '../../../i18n/index.js'

/** 导入导出失败的原因，key 对应界面提示文案。 */
export class BackupError extends Error {
  constructor(
    readonly key: TranslationKey,
    readonly params?: TranslationParams
  ) {
    super(translate(key, params))
    this.name = 'BackupError'
  }
}

export const fail = (key: TranslationKey, params?: TranslationParams): never => {
  throw new BackupError(key, params)
}

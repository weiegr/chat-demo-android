const NOTEBOOK_SIZE = 34
const SMOOTH_SETTLE_TRANSITION =
  'transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease'
const LAYOUT_SYNC_TRANSITION = 'transform 460ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease'
const ORB_GROUP_LAYOUT_TRANSITION =
  'top 460ms cubic-bezier(0.22, 1, 0.36, 1), width 460ms cubic-bezier(0.22, 1, 0.36, 1), transform 460ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease'

type LayoutElements = {
  form: HTMLFormElement
  stage: HTMLDivElement
  orbGroup: HTMLDivElement
  visualizer: HTMLButtonElement
  notebook: HTMLButtonElement | null
}

type OrbMetrics = {
  stageHeight: number
  viewportWidth: number
  transcriptOpen: boolean
}

const computeBaseGeometry = ({ stageHeight, viewportWidth, transcriptOpen }: OrbMetrics) => {
  const notebookGap = Math.min(12, stageHeight * 0.035)
  if (transcriptOpen) {
    const baseOrbSize = Math.min(118, viewportWidth * 0.34, stageHeight * 0.31)
    const baseCenterY = Math.max(baseOrbSize / 2 + 8, Math.min(78, stageHeight * 0.23))
    return { baseOrbSize, baseCenterY, notebookGap }
  }
  const baseOrbSize = Math.min(
    220,
    viewportWidth * 0.64,
    Math.max(40, stageHeight - 72),
    stageHeight * 0.52
  )
  const baseCenterY = Math.max(
    baseOrbSize / 2,
    Math.min(stageHeight * 0.56, stageHeight - baseOrbSize / 2 - notebookGap - NOTEBOOK_SIZE)
  )
  return { baseOrbSize, baseCenterY, notebookGap }
}

type TargetTransforms = {
  orbGroupTransform: string
  orbGroupOpacity: string
  orbGroupPointerEvents: string
  visualizerTransform: string
  visualizerOpacity: string
  visualizerPointerEvents: string
  notebookTransform: string
  notebookOpacity: string
  notebookPointerEvents: string
  historyTop: string | null
}

/**
 * 依据键盘上移量 shift 计算纯 GPU 变换：
 * - 不平移整个 stage，避免圆球或通话记录顶出标题栏被裁剪；
 * - 将蓝色圆球与记录按钮完整居中摆放于「标题栏下方 ～ 输入框上方」的净高度内，空间不足时平滑等比缩放。
 */
const computeTargetTransforms = (shift: number, metrics: OrbMetrics): TargetTransforms => {
  const { stageHeight, transcriptOpen } = metrics
  const { baseOrbSize, baseCenterY, notebookGap } = computeBaseGeometry(metrics)
  const availH = Math.max(0, stageHeight - shift)
  const safeBaseOrb = Math.max(1, baseOrbSize)

  if (transcriptOpen) {
    if (availH >= 136) {
      const topPad = 8
      const gap = Math.min(notebookGap, 6)
      const targetOrb = Math.min(safeBaseOrb, Math.max(44, availH * 0.3))
      const scale = Math.min(1, targetOrb / safeBaseOrb)
      const orbH = safeBaseOrb * scale
      const targetCenterY = topPad + orbH / 2
      const groupDy = targetCenterY - baseCenterY
      const notebookDy = -(safeBaseOrb - orbH) / 2 - (notebookGap - gap)
      const historyTop = topPad + orbH + gap + NOTEBOOK_SIZE + 4
      return {
        orbGroupTransform: `translate3d(-50%, calc(-50% + ${groupDy.toFixed(2)}px), 0)`,
        orbGroupOpacity: '',
        orbGroupPointerEvents: '',
        visualizerTransform: `scale(${scale.toFixed(4)})`,
        visualizerOpacity: '',
        visualizerPointerEvents: '',
        notebookTransform: `translate3d(-50%, ${notebookDy.toFixed(2)}px, 0)`,
        notebookOpacity: '',
        notebookPointerEvents: '',
        historyTop: `${historyTop.toFixed(2)}px`,
      }
    }
    // 展开记录且剩余高度极矮时：柔和淡出圆球、将记录开关收至顶沿，把空间留给通话记录
    const notebookTop = 6
    const groupDy = notebookTop - (baseCenterY + safeBaseOrb / 2 + notebookGap)
    return {
      orbGroupTransform: `translate3d(-50%, calc(-50% + ${groupDy.toFixed(2)}px), 0)`,
      orbGroupOpacity: '',
      orbGroupPointerEvents: '',
      visualizerTransform: 'scale(0.35)',
      visualizerOpacity: '0',
      visualizerPointerEvents: 'none',
      notebookTransform: 'translate3d(-50%, 0px, 0)',
      notebookOpacity: '',
      notebookPointerEvents: '',
      historyTop: `${notebookTop + NOTEBOOK_SIZE + 4}px`,
    }
  }

  // 常规通话态：上下预留呼吸边距（同时容纳收音时的微呼吸放大），绝不被标题栏或输入框截断
  const topPad = Math.max(12, Math.min(20, availH * 0.1))
  const bottomPad = Math.max(10, Math.min(16, availH * 0.08))
  const safeH = Math.max(0, availH - topPad - bottomPad)
  const gap = Math.min(notebookGap, Math.max(6, safeH * 0.06))

  if (safeH >= 84) {
    const targetOrb = Math.min(safeBaseOrb, Math.max(42, safeH - gap - NOTEBOOK_SIZE))
    const scale = Math.min(1, targetOrb / safeBaseOrb)
    const orbH = safeBaseOrb * scale
    const groupH = orbH + gap + NOTEBOOK_SIZE
    const targetCenterY = topPad + (safeH - groupH) / 2 + orbH / 2
    const groupDy = targetCenterY - baseCenterY
    const notebookDy = -(safeBaseOrb - orbH) / 2 - (notebookGap - gap)
    return {
      orbGroupTransform: `translate3d(-50%, calc(-50% + ${groupDy.toFixed(2)}px), 0)`,
      orbGroupOpacity: '',
      orbGroupPointerEvents: '',
      visualizerTransform: `scale(${scale.toFixed(4)})`,
      visualizerOpacity: '',
      visualizerPointerEvents: '',
      notebookTransform: `translate3d(-50%, ${notebookDy.toFixed(2)}px, 0)`,
      notebookOpacity: '',
      notebookPointerEvents: '',
      historyTop: null,
    }
  }

  if (safeH >= 42) {
    const targetOrb = Math.min(safeBaseOrb, safeH)
    const scale = Math.min(1, targetOrb / safeBaseOrb)
    const targetCenterY = availH / 2
    const groupDy = targetCenterY - baseCenterY
    return {
      orbGroupTransform: `translate3d(-50%, calc(-50% + ${groupDy.toFixed(2)}px), 0)`,
      orbGroupOpacity: '',
      orbGroupPointerEvents: '',
      visualizerTransform: `scale(${scale.toFixed(4)})`,
      visualizerOpacity: '',
      visualizerPointerEvents: '',
      notebookTransform: 'translate3d(-50%, 0px, 0)',
      notebookOpacity: '0',
      notebookPointerEvents: 'none',
      historyTop: null,
    }
  }

  // 极端狭缝（如多行文本叠加超高输入法）：平滑淡出整组，避免出现半截残缺蓝块
  const groupDy = availH / 2 - baseCenterY
  return {
    orbGroupTransform: `translate3d(-50%, calc(-50% + ${groupDy.toFixed(2)}px), 0)`,
    orbGroupOpacity: '0',
    orbGroupPointerEvents: 'none',
    visualizerTransform: 'scale(0.25)',
    visualizerOpacity: '',
    visualizerPointerEvents: '',
    notebookTransform: 'translate3d(-50%, 0px, 0)',
    notebookOpacity: '0',
    notebookPointerEvents: 'none',
    historyTop: null,
  }
}

export const createBetaLiveImeController = (
  elements: LayoutElements,
  getTranscriptOpen: () => boolean
) => {
  const { form, stage, orbGroup, visualizer, notebook } = elements
  const reducedMotion = () =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let smoothTimer: number | null = null
  let latestShift = 0
  let cachedStageHeight = stage.clientHeight
  let cachedViewportWidth = window.innerWidth

  const animatedNodes = notebook
    ? [form, orbGroup, visualizer, notebook]
    : [form, orbGroup, visualizer]

  const clearSmooth = () => {
    if (smoothTimer !== null) {
      window.clearTimeout(smoothTimer)
      smoothTimer = null
    }
    for (const node of animatedNodes) {
      node.style.removeProperty('transition')
    }
  }

  const clearInlineLayout = () => {
    for (const node of animatedNodes) {
      node.style.removeProperty('transform')
      node.style.removeProperty('will-change')
      node.style.removeProperty('opacity')
      node.style.removeProperty('pointer-events')
    }
    stage.style.removeProperty('--live-ime-inset')
    stage.style.removeProperty('--live-history-top')
  }

  const setWillChange = (enabled: boolean) => {
    for (const node of animatedNodes) {
      if (enabled) {
        node.style.willChange = 'transform'
      } else {
        node.style.removeProperty('will-change')
      }
    }
  }

  const applyFrame = (
    shift: number,
    animating: boolean,
    transitionMode: 'none' | 'settle' | 'layout' = 'none',
    updateSettledVars = !animating
  ) => {
    latestShift = shift
    clearSmooth()
    if (cachedStageHeight <= 0) {
      cachedStageHeight = stage.clientHeight
    }
    if (cachedViewportWidth <= 0) {
      cachedViewportWidth = window.innerWidth
    }

    const active = shift > 0.05
    const animateTransition = transitionMode !== 'none' && !reducedMotion()
    if (animateTransition) {
      setWillChange(true)
      if (transitionMode === 'layout') {
        form.style.transition = SMOOTH_SETTLE_TRANSITION
        orbGroup.style.transition = ORB_GROUP_LAYOUT_TRANSITION
        visualizer.style.transition = LAYOUT_SYNC_TRANSITION
        if (notebook) {
          notebook.style.transition = LAYOUT_SYNC_TRANSITION
        }
      } else {
        for (const node of animatedNodes) {
          node.style.transition = SMOOTH_SETTLE_TRANSITION
        }
      }
    } else if (animating) {
      setWillChange(true)
    } else if (!active) {
      setWillChange(false)
    }

    if (active) {
      const target = computeTargetTransforms(shift, {
        stageHeight: cachedStageHeight,
        viewportWidth: cachedViewportWidth,
        transcriptOpen: getTranscriptOpen(),
      })
      form.style.transform = `translate3d(0, ${(-shift).toFixed(2)}px, 0)`
      orbGroup.style.transform = target.orbGroupTransform
      orbGroup.style.opacity = target.orbGroupOpacity
      orbGroup.style.pointerEvents = target.orbGroupPointerEvents
      visualizer.style.transform = target.visualizerTransform
      visualizer.style.opacity = target.visualizerOpacity
      visualizer.style.pointerEvents = target.visualizerPointerEvents
      if (notebook) {
        notebook.style.transform = target.notebookTransform
        notebook.style.opacity = target.notebookOpacity
        notebook.style.pointerEvents = target.notebookPointerEvents
      }
      if (updateSettledVars) {
        stage.style.setProperty('--live-ime-inset', `${shift.toFixed(1)}px`)
        if (target.historyTop !== null) {
          stage.style.setProperty('--live-history-top', target.historyTop)
        } else {
          stage.style.removeProperty('--live-history-top')
        }
      }
    } else {
      if (animateTransition) {
        form.style.transform = 'translate3d(0, 0, 0)'
        orbGroup.style.transform = 'translate3d(-50%, -50%, 0)'
        orbGroup.style.opacity = ''
        orbGroup.style.pointerEvents = ''
        visualizer.style.transform = 'scale(1)'
        visualizer.style.opacity = ''
        visualizer.style.pointerEvents = ''
        if (notebook) {
          notebook.style.transform = 'translate3d(-50%, 0, 0)'
          notebook.style.opacity = ''
          notebook.style.pointerEvents = ''
        }
      } else {
        clearInlineLayout()
      }
      stage.style.removeProperty('--live-ime-inset')
      stage.style.removeProperty('--live-history-top')
    }

    if (animateTransition) {
      smoothTimer = window.setTimeout(
        () => {
          smoothTimer = null
          for (const node of animatedNodes) {
            node.style.removeProperty('transition')
          }
          if (latestShift <= 0.05) {
            clearInlineLayout()
          }
        },
        transitionMode === 'layout' ? 480 : 200
      )
    }
  }

  const syncMetrics = (mode: 'none' | 'layout' = 'none') => {
    cachedStageHeight = stage.clientHeight
    cachedViewportWidth = window.innerWidth
    if (latestShift > 0.05) {
      applyFrame(latestShift, false, mode, true)
    }
  }

  const prepare = () => {
    clearSmooth()
    cachedStageHeight = stage.clientHeight
    cachedViewportWidth = window.innerWidth
    setWillChange(true)
  }

  const dispose = () => {
    clearSmooth()
    clearInlineLayout()
  }

  return {
    prepare,
    apply: applyFrame,
    syncMetrics,
    dispose,
  }
}

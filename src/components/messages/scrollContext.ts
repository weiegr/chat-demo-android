import { createContext, useContext } from 'react'

/** 渲染更新后请求滚到底部；用户上滑离开底部时由列表忽略 */
export const ScrollToBottomContext = createContext<() => void>(() => {})

export const useScrollToBottom = () => useContext(ScrollToBottomContext)

/** 思考区吸顶状态变更回调：由列表顶部连续柔化层接管背景延伸，零重渲染 */
export const ThinkStuckContext = createContext<(id: string, stuck: boolean) => void>(() => {})

export const useReportThinkStuck = () => useContext(ThinkStuckContext)

import { create } from 'zustand'

/** 正在预览的图片：src 为原图地址，alt 用于无障碍描述 */
export type ImagePreview = {
  src: string
  alt: string
  kind: 'image' | 'video'
}

/** 全站共用一个图片预览层，点击任意缩略图切换内容 */
export const useImagePreview = create<{ preview: ImagePreview | null }>(() => ({
  preview: null,
}))

export const openImagePreview = (src: string, alt: string) =>
  useImagePreview.setState({ preview: { src, alt, kind: 'image' } })

export const openVideoPreview = (src: string, alt: string) =>
  useImagePreview.setState({ preview: { src, alt, kind: 'video' } })

export const closeImagePreview = () => {
  if (useImagePreview.getState().preview !== null) {
    useImagePreview.setState({ preview: null })
  }
}

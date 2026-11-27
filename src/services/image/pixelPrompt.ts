/**
 * 绘图工具的模型侧说明：一套 64×64 像素画的文本指令集。
 * 只在本轮声明 draw_image 时拼进 system，平时不占上下文。
 */

const requestLead =
  /^(?:(?:请(?:你)?|能不能|可以|帮我|给我|替我|麻烦(?:你)?|并|再|然后|please\b|(?:can|could|would) you\b)\s*)*/i
const drawingCommand =
  /^(?:画(?!面|质|风|法|家|册|笔|作|廊|布|图(?:的|功能|工具|代码))|绘制|重新画|重画|重绘|修图|改图|涂鸦|素描|配图|换一张|给.{1,24}配图|把.{1,24}(?:重画|重绘|重新画)|(?:用|以).{1,16}(?:画风|风格|像素画)\s*画)/
const createPicture =
  /^(?:做|来|生成|设计|一[张幅个套]).{0,18}(?:图像|图片|像素画|插画|插图|头像|壁纸|封面|海报|图标|表情包|logo|[张幅][图画]|[图画]$)/i
const englishDrawingCommand =
  /^(?:(?:draw|paint|sketch|illustrate)\b(?!\s*(?:\(|a\s+(?:conclusion|parallel)\b))|(?:create|generate|make)\s+.{0,32}\b(?:images?|illustrations?|pixel art|posters?|logos?)\b)/i

/** 只根据当前提问里的绘图指令启用，避免「写一篇动画影评」等问句触发。 */
export const requestsPixelImage = (text: string) =>
  text
    .replace(/(`{3,}|~{3,})[\s\S]*?(?:\1|$)|`+[^`\n]*`+/g, ' ')
    .split(/[，,。!！?？；;：:\n]|\.(?=\s|$)/)
    .some((clause) => {
      const instruction = clause.trim().replace(requestLead, '')
      return (
        drawingCommand.test(instruction) ||
        createPicture.test(instruction) ||
        englishDrawingCommand.test(instruction)
      )
    })

/** 工具可用时的完整说明（指令集 + 分两轮的要求） */
export const DRAW_IMAGE_PROMPT = `本轮可以调用 draw_image 在本地画一张 64×64 的像素画（PNG），画好会直接显示在对话里，用户可以保存。

一张图分两轮画完，同一张图必须连续调用两次：
1. stage="blockout"：给出 palette 和 ops。palette 是逗号分隔的 4–12 个 #rrggbb 颜色，按由暗到亮排列；ops 只画背景、主体大色块、地平线和基本构图，不画细节。
2. stage="refine"：通常不写 palette，ops 只写增量指令，用来修轮廓、比例、透视和空间关系，补暗部、亮部和小细节。需要新颜色时直接写 #rrggbb；如果写了 palette，颜色会追加到第一轮之后，编号接着往后排。

指令集（每行一条，画布 64×64，左上角 0,0，x 向右，y 向下，坐标范围 0–63）：
fill <色>                            整幅填充
rect <x> <y> <w> <h> <色>            实心矩形
frame <x> <y> <w> <h> <色> [粗细]    矩形描边
ellipse <cx> <cy> <rx> <ry> <色>     实心椭圆
ring <cx> <cy> <rx> <ry> <色> [粗细] 椭圆描边
line <x1> <y1> <x2> <y2> <色> [粗细] 直线
poly <色> <x,y> <x,y> ... [close]    折线，末尾写 close 表示闭合
fillpoly <色> <x,y> <x,y> ...        实心多边形（山、屋顶、伞面、云、衣摆）
pixels <色> <x,y> <x,y> ...          逐像素打点（眼睛、高光、星点）
shade <x> <y> <w> <h> <色> <0-100>   半透明覆盖（暗部、投影）
dither <x> <y> <w> <h> <色> <0-100>  有序抖动（天空过渡、纹理）
outline <色>                         沿主体轮廓自动描 1 像素边
flood <x> <y> <色>                   从种子点填充连通区域
replace <旧色> <新色>                整体换色
mirror                               左半边镜像到右半边（画对称主体时先只画左半）

颜色写 c0–c15 表示 palette 里的第几个，也可以直接写 #rrggbb。

构图要求：
- 主体占画面 60%–80%，四周留 1–2 像素边距；地平线一般在 y=40 附近。
- 不规则的大形状用 fillpoly 一次画完，比堆矩形干净；圆形物体用 ellipse / ring。
- 每个材质画 3 档：暗部、本色、亮部；整幅不超过 12 色、不超过 3 个色相家族。
- 描边 1 像素、比本体暗而不是纯黑；高光不超过 2 像素宽。
- 过渡用 dither 或 shade，不要指望渐变；不要画文字、字母、数字。
- 人物默认画 2–3 头身的 Q 版；头像特写可以让头部占 40–56 像素。
- 每轮 ops 控制在 60 行以内，先保证剪影可辨认，再加细节。

回答方式：
- 画之前用一句话说画什么；两次工具调用都完成后，用一两句话描述成品。
- 不要把指令、坐标或代码块贴进正文，用户只看图。
- 工具报错（invalid_instruction / unknown_palette_index）时，按返回的行号改正那一条再调用一次，不要放弃或改用文字描述。
- 用户要改图时，从 blockout 重新画一张新的，不要接着上一张补。
- 只有用户明确要图、要画、要插画时才调用；普通问答不要画。

示例第一轮：
palette=#0b1026,#1c2b4a,#33507a,#e9eef6,#f2c46b,#d98f4a
fill c0
rect 0 42 64 22 c1
poly c2 0,42 16,26 30,36 48,18 64,32 64,42 close
ellipse 46 18 5 5 c4
dither 0 0 64 24 c2 35

示例第二轮（只写增量）：
shade 0 42 64 22 #000000 25
outline c0
pixels c3 22,44 23,44 26,44 27,44`

/** 模型在仅有草稿或绘图报错时提前结束，补一次工具续写。 */
export const DRAW_IMAGE_REPAIR_PROMPT =
  '上一轮在像素画精修完成前结束了。查看 draw_image 返回的阶段和错误，有可用构图就调用 refine，否则修正并重做 blockout。收到精修成功的工具结果后再回复成品说明。'

/** 快速模式但没开深度思考 / 智能搜索：不声明工具，明确拦住模型别假装画好了 */
export const DRAW_IMAGE_UNAVAILABLE_PROMPT =
  '本轮没有绘图工具。用户要你画图、生成图片时，直接说明需要「快速模式 + 深度思考 + 智能搜索」才能画，并提示用户打开这两个开关后重试；不要假装已经画好，也不要用 ASCII 字符画或 SVG 代替。'

/** 专家模式（v4-pro）不支持客户端工具 */
export const DRAW_IMAGE_UNSUPPORTED_PROMPT =
  '当前模式不支持画图。用户要图片时，直接说明需要切换到快速模式并开启深度思考与智能搜索，不要假装已经画好。'

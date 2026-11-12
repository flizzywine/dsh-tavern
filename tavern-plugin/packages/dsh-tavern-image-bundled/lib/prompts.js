export function buildTemplateMarkerPrompt(imageGenCount, guidance, { structured = false } = {}) {
  const count = Math.min(6, Math.max(1, Number(imageGenCount) || 2))
  return [
    '【正文配图】只在故事正文中配图。挑选最多 ' + count + ' 个值得出图的瞬间，在对应段落后另起一行写 image###提示词###。标记独占一行，前后留空行，不使用代码块。',
    '按当前画面写可见的事实。出镜的人物库角色使用准确姓名，让插件补足可见外貌与服装。',
    structured ? '标记内的换行写成字面量 \\n，插件会还原成换行；整个标记仍在一行内。' : '',
    guidance,
  ].filter(Boolean).join('\n')
}

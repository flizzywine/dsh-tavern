import { activePromptBlocks } from './prompt-structure.js'
import { scanWorkflowLoras, loraBindingKey } from './comfy-lora.js'

/** Explicit batch execution. Prompt assembly itself never launches extra images. */
export function generationMechanism(structure, usage, workflow, baseSeed) {
  const blocks = activePromptBlocks(structure, usage).filter(block => block.kind === 'mechanism')
  if (blocks.length > 1) throw new Error('同一用途请只启用一个生成机制')
  const block = blocks[0]
  if (!block) return [{}]
  if (!workflow?.bindings?.seed?.length) throw new Error('生成机制需要支持种子控制的 ComfyUI 工作流')
  const seed = block.seed === undefined ? baseSeed : block.seed
  if (!Number.isSafeInteger(seed) || seed < 0 || seed >= 2 ** 47) throw new Error('机制种子需要是有效的非负整数')
  if (block.mechanism === 'lora_sweep') {
    if (block.workflowId !== workflow.id) throw new Error('LoRA 对照机制绑定的工作流与出图目标不同')
    const lora = scanWorkflowLoras(workflow.prompt, workflow.bindings.loras).find(item => loraBindingKey(item) === loraBindingKey(block))
    if (!lora) throw new Error('请选择 LoRA 对照机制的加载槽位')
    const weights = String(block.weights || '').split(/[,，;；\n]+/).filter(item => item.trim()).map(value => value.trim().split('/').map(part => part.trim() ? Number(part) : NaN))
    if (!weights.length || weights.length > 8 || weights.some(row => row.length > 2 || row.some(n => !Number.isFinite(n) || Math.abs(n) > 10))) throw new Error('LoRA 强度请填写 1–8 组有效数字，如 0.4, 0.7, 1')
    return weights.map(([model, clip = model]) => ({ seed, loraOverride: { ...lora, ...(block.text ? { name: block.text } : {}), strengthModel: model, strengthClip: clip } }))
  }
  const count = Number(block.count ?? 1)
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('机制图片数量需要在 1–8 之间')
  return Array.from({ length: count }, (_, index) => ({ seed: block.mechanism === 'seed_series' ? (seed + index) % (2 ** 47) : seed }))
}

import { readFileSync } from 'node:fs'

function readInstruction(name) {
  const instruction = readFileSync(new URL('../prompts/' + name + '.md', import.meta.url), 'utf8').trim()
  if (!instruction) throw new Error('提示词文件不能为空: ' + name + '.md')
  return instruction
}

// The persona is installed at session setup; task instructions are read per job.
export const readSceneImageSystemInstruction = () => readInstruction('scene-image-system')
export const readScenePlanInstruction = () => readInstruction('scene-plan')
export const readSceneAdjustmentInstruction = () => readInstruction('scene-image-adjustment')

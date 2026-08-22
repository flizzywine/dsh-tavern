import { readFileSync } from 'node:fs'

const NAMES = [
  'story',
  'script-story',
  'candidate-story',
  'candidate-script',
  'posture-settlement',
  'play-mode',
  'card-mode',
  'card-mode-greeting',
  'card-task-edit',
  'card-task-extract',
  'card-task-boundary'
]

const knownNames = new Set(NAMES)

export function createPromptCatalog(directory = new URL('../prompts/', import.meta.url)) {
  return function promptFromFile(name) {
    if (!knownNames.has(name)) throw new Error('未知提示词: ' + String(name))
    const text = readFileSync(new URL(name + '.md', directory), 'utf8').trim()
    if (text === '') throw new Error('提示词文件不能为空: ' + name + '.md')
    return text
  }
}

export const prompt = createPromptCatalog()

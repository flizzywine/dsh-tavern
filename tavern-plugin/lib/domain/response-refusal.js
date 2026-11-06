import { refusalTextPatterns, classifyResponse } from './response-classification.js'

function refusalPatterns(custom = []) {
  if (!Array.isArray(custom) || !custom.every(pattern => typeof pattern === 'string' && pattern.length > 0)) throw new Error('refusalPatterns 必须是非空正则字符串数组')
  return [...refusalTextPatterns, ...custom.map(pattern => new RegExp(pattern, 'imu'))]
}

function requestChecks(requests, mode, patterns) {
  return requests.map(request => ({
    requestId: request.id,
    agent: mode === 'card' ? 'card' : request.scope === 'foreground' ? 'foreground' : /image|scene|illustration/.test(request.task) ? 'image' : 'background',
    task: request.task,
    ...classifyResponse({ text: request.response?.text || '', error: request.response?.error || '', finish: request.response?.finish, completed: request.status === 'completed' }, patterns),
  }))
}

export { refusalPatterns, classifyResponse, requestChecks }

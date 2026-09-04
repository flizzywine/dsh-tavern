import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

function between(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end))
}

test('酒馆状态提供持久的手动小手机开关', () => {
  const panel = between('function TavernStatusPanel', 'function TavernStatusTab')
  assert.match(panel, /dsh-tavern-phone-view/)
  assert.match(panel, /打开小手机/)
  assert.match(panel, /TavernPhone/)
  assert.match(panel, /setPhoneView\(false\)/)
})

test('小手机只有消息 App、联系人和独立发送入口', () => {
  const phone = between('function TavernPhone', 'function TavernStatusPanel')
  assert.match(phone, /打开消息/)
  assert.match(phone, /props\.view\.phoneChat/)
  assert.match(phone, /phone\.contacts/)
  assert.match(phone, /sendPhoneMessage/)
  assert.match(phone, /手机聊天/)
  for (const absent of ['变量', '背包', '任务 App', '外观设置', 'API 设置']) assert.doesNotMatch(phone, new RegExp(absent))
})

#!/usr/bin/env node
// Turn a novel (.txt or .epub) into a SillyTavern chat file, to build a long, repeatable save for
// testing context compaction and memory: 酒馆 → 导入聊天记录 → choose this file.
//   node bin/novel-to-chat.mjs <novel.txt> [--chars 2000] [--rounds 120] [--player 继续] [--name 小说] > novel-chat.jsonl
// Each round is the player line followed by the next stretch of the novel. Chapters are kept
// whole when they fit; longer ones are split at paragraph breaks. GBK/GB18030 text is decoded.
import { readFileSync } from 'node:fs'
import { extractEpubText } from '../tavern-plugin/lib/domain/epub-text.js'

const args = process.argv.slice(2)
const option = (name, fallback) => { const at = args.indexOf('--' + name); return at >= 0 ? args.splice(at, 2)[1] : fallback }
const chars = Number(option('chars', 2000))
const rounds = Number(option('rounds', 0))
const player = option('player', '继续')
const name = option('name', '小说')
const file = args[0]
if (!file || !(chars >= 200)) {
  console.error('用法：node bin/novel-to-chat.mjs <小说.txt 或 .epub> [--chars 每轮字数，默认 2000] [--rounds 最多轮数] [--player 玩家每轮的话，默认「继续」] [--name 角色名] > 聊天记录.jsonl')
  process.exit(1)
}

const bytes = readFileSync(file)
let text
if (/\.epub$/i.test(file)) text = extractEpubText(bytes)
else try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { text = new TextDecoder('gb18030').decode(bytes) }
text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')

// Paragraphs, with chapter headings starting a new stretch.
const heading = /^\s*(第[零〇一二两三四五六七八九十百千万0-9]+[章回节卷集部]|chapter\s+\d+)/i
let paragraphs = text.split(/\n+/).map(line => line.trim()).filter(Boolean)
// Front matter (制作说明, 目录…) comes before the first chapter; start the story there.
// A 卷/集 heading right before it (with its title) belongs to the story too.
const firstChapter = paragraphs.findIndex(line => /^第[零〇一二两三四五六七八九十百千万0-9]+[章回节]/.test(line))
if (firstChapter > 0) {
  const volume = paragraphs.slice(Math.max(0, firstChapter - 2), firstChapter).findIndex(line => heading.test(line))
  paragraphs = paragraphs.slice(volume < 0 ? firstChapter : Math.max(0, firstChapter - 2) + volume)
}
const stretches = []
let current = ''
for (const paragraph of paragraphs) {
  // A heading starts a new stretch, unless the stretch so far is only headings (卷名 + 章名).
  const breaks = current && ((heading.test(paragraph) && current.length > 200) || current.length + paragraph.length + 2 > chars)
  if (breaks) { stretches.push(current); current = '' }
  current = current ? current + '\n\n' + paragraph : paragraph
  // A single paragraph longer than the limit is cut at sentence ends.
  while (current.length > chars * 1.5) {
    const cut = Math.max(current.lastIndexOf('。', chars), current.lastIndexOf('\n', chars), Math.floor(chars / 2))
    stretches.push(current.slice(0, cut + 1)); current = current.slice(cut + 1).trim()
  }
}
if (current) stretches.push(current)
const used = rounds > 0 ? stretches.slice(0, rounds) : stretches

const date = new Date().toISOString()
const out = [{ user_name: '你', character_name: name, create_date: date, chat_metadata: {} }]
used.forEach((stretch, index) => {
  if (index > 0) out.push({ name: '你', is_user: true, is_system: false, send_date: date, mes: player })
  out.push({ name, is_user: false, is_system: false, send_date: date, mes: stretch })
})
process.stdout.write(out.map(row => JSON.stringify(row)).join('\n') + '\n')
console.error(`共 ${used.length} 轮（${used.reduce((sum, s) => sum + s.length, 0)} 字），${out.length - 1} 条消息。`)

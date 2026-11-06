import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../lib/client.js', import.meta.url)
const source = readFileSync(file, 'utf8')
writeFileSync(file, source.replace(/[ \t]+$/gm, ''), 'utf8')

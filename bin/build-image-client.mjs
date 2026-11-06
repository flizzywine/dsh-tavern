import { buildImageClient } from '../tavern-plugin/packages/dsh-tavern-image-bundled/build.mjs'

try {
  const result = await buildImageClient({ check: process.argv.includes('--check') })
  console.log(result.changed ? '已生成生图客户端' : '生图客户端已是最新')
} catch (error) { console.error(error.message); process.exitCode = 1 }

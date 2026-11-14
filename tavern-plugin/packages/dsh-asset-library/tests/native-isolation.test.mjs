import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const exec = promisify(execFile)

// The host saves generated images with its own sharp. A second, differently versioned libvips in the host
// process makes that fail with ERR_DLOPEN_FAILED, so no asset-library operation may load sharp in-process.
test('SVG skin decoding does not load native image libraries into the calling process', async () => {
  const source = `
    const {decodeSkinSvg} = await import(${JSON.stringify(new URL('../src/pack-v2/skin-svg.js', import.meta.url).href)})
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>')
    const size = await decodeSkinSvg(svg)
    const loaded = process.report.getReport().sharedObjects.filter(name => /sharp|libvips/i.test(name))
    console.log(JSON.stringify({size, loaded}))`
  const {stdout} = await exec(process.execPath, ['--input-type=module', '--eval', source], {env: process.env})
  const result = JSON.parse(stdout)
  assert.deepEqual(result.loaded, [])
  assert.ok(result.size)
})

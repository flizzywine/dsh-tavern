import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
const context = vm.createContext({TextDecoder, Uint8Array, bytesToBase64: bytes => Buffer.from(bytes).toString('base64')});
vm.runInContext(await readFile(new URL('../tavern-plugin/src/client/text-resource-file.js',import.meta.url),'utf8'),context);
const parse = (bytes,name='story.txt') => context.parseTextResourceFile({name, arrayBuffer: async()=>Uint8Array.from(bytes).buffer});
test('text import preserves UTF-8, BOM UTF-16 and GBK/GB18030 Chinese',async()=>{
  const text='官居一品\r\n测试';
  for(const bytes of [Buffer.from(text),Buffer.concat([Buffer.from([239,187,191]),Buffer.from(text)]),Buffer.concat([Buffer.from([255,254]),Buffer.from(text,'utf16le')]),Buffer.concat([Buffer.from([254,255]),Buffer.from(text,'utf16le').swap16()])]) assert.equal((await parse(bytes)).text,text);
  assert.equal((await parse([0xb9,0xd9,0xbe,0xd3,0xd2,0xbb,0xc6,0xb7])).text,'官居一品');
  assert.equal((await parse([0x94,0x39,0xfc,0x36])).text,'😀');
  assert.equal((await parse(Buffer.from('plain ASCII'))).text,'plain ASCII');
});
test('invalid or explicitly corrupt text is rejected instead of replaced',async()=>{
  for(const bytes of [[0xff],[0xef,0xbb,0xbf,0xff],[0xff,0xfe,0x00],[0xff,0xfe,0,0,65,0,0,0],[65,0,66,0]]) await assert.rejects(parse(bytes),/UTF-8/);
});
test('EPUB stays binary and text payload contract stays unchanged',async()=>{
  assert.equal((await parse([0x50,0x4b,0xff],'novel.epub')).fileB64,'UEv/');
  assert.equal((await parse([])).text,'');
  assert.equal((await parse([65])).chunkSize,500);
});

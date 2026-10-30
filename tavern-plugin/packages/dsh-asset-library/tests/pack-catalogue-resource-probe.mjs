// explicit offline large-pack probe, not part of the fast test suite.
// Run with node --expose-gc. Synthetic output is retained for the approved safe cleanup walker.
import { mkdtemp, readFile, stat, readdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { syntheticPack } from '../../../../tests/fixtures/asset-packs/pack.mjs'
import { sealPack, jsonBytes } from '../src/pack-v2/validation.js'
import { createAssetPackService } from '../src/pack-v2/service.js'
import { PACK_BUDGET } from '../src/pack-v2/budget.js'
import { writeZip } from '../src/zip.js'
const root=await mkdtemp(path.join(os.tmpdir(),'pack-catalogue-resource-')), archive=path.join(root,'fixture.zip')
let pack=await syntheticPack()
for(let i=0;i<8;i++) {const name=`credits/probe-${i}.txt`;pack.files.set(name,Buffer.from(randomBytes(12*1024**2).toString('base64')));pack.manifest.credits.push(name)}
await sealPack(pack.manifest,pack.files)
const expandedBytes=jsonBytes(pack.manifest).length+[...pack.files.values()].reduce((n,b)=>n+b.length,0)
await writeZip(archive,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
pack=null;global.gc?.()
const archiveBytes=(await stat(archive)).size,hash=createHash('sha256')
for await(const chunk of createReadStream(archive)) hash.update(chunk)
const expectedSha256=hash.digest('hex')
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Length':archiveBytes});createReadStream(archive).pipe(res)})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const network=(url,{signal,headers={}})=>new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port:server.address().port,path:'/',signal,headers},body=>resolve({status:body.statusCode,headers:body.headers,body,url}));req.on('error',reject)})
const service=createAssetPackService({assetRoot:path.join(root,'assets'),limits:PACK_BUDGET,catalogueNetwork:network})
const baseline=process.memoryUsage(),started=Date.now();let peakRss=baseline.rss,peakExternal=baseline.external,peakSpool=0
const meter=setInterval(()=>{const m=process.memoryUsage();peakRss=Math.max(peakRss,m.rss);peakExternal=Math.max(peakExternal,m.external);peakSpool=Math.max(peakSpool,service.spoolUsage())},10)
try {
  // link installs take no user fingerprint; the probe checks the archive hash itself.
  const {jobId}=await service.startPackDownload({url:'https://fixture.test/large.zip'})
  let job
  do {await new Promise(resolve=>setTimeout(resolve,20));job=await service.getPackDownload({jobId})} while(!['ready','failed'].includes(job.state))
  assert.equal(job.state,'ready',JSON.stringify(job.error));assert.equal(job.inspection.uploadHash,expectedSha256)
  const {inspectionId,expectedRevision}=job.inspection
  await service.applyImport({inspectionId,expectedRevision,decision:'install'})
  assert.deepEqual(await readdir(path.join(root,'assets','downloads')),[])
  console.log(JSON.stringify({root,archiveBytes,expandedBytes,baselineRss:baseline.rss,peakRss,peakExternal,peakSpool,elapsedMs:Date.now()-started,stagedDiskUpperBound:archiveBytes+expandedBytes,configuredArchiveLimit:2*1024**3,limitation:'128 MiB synthetic expanded pack; not a 2 GiB qualification'},null,2))
} finally {clearInterval(meter);await service.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}

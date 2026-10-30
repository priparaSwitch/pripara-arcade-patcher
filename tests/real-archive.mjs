// Optional local proof. An original archive is supplied by the operator;
// it is never committed, uploaded or required by CI.
import {open,readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {inspectInput,buildPatch} from '../web/engine/patch.js';
import {TARGET_EXE_SHA256} from '../web/release.js';

const path=process.argv[2];
if(!path){console.error('Usage: npm run test:archive -- <original.rar>');process.exit(2);}
const fd=await open(path,'r'),st=await fd.stat(),downloads=[];
let readBytes=0,readCalls=0,maxReadBytes=0;
const input={name:path.split(/[\\/]/).pop(),size:st.size,lastModified:Math.trunc(st.mtimeMs),async read(offset,length){
  const b=Buffer.alloc(length),r=await fd.read(b,0,length,offset);assert.equal(r.bytesRead,length);
  readBytes+=length;readCalls++;maxReadBytes=Math.max(maxReadBytes,length);return new Uint8Array(b);
}};
const manifest=JSON.parse(await readFile(new URL('../web/data/patch-manifest.json',import.meta.url),'utf8'));
const oldFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  const u=new URL(url),data=new URL('../web/data/',import.meta.url);
  assert.equal(u.protocol,'file:');assert.ok(u.href.startsWith(data.href));
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.body,undefined);
  downloads.push(u.pathname.split('/').pop());return new Response(await readFile(u));
};
const start=performance.now();
try{
  const options={patchExe:true,patchSettings:true,installPath:'C:\\prineohk\\game'};
  const context=await inspectInput(input,options,manifest),result=await buildPatch(context,options);
  assert.equal(context.result.entries.length,6);assert.ok(context.result.entries.every(e=>e.verified));
  assert.equal(result.report.outputs.length,5);assert.equal(result.report.uploadedBytes,0);
  assert.equal(result.report.application,'pripara-arcade-patcher');
  assert.equal(result.report.outputs.find(o=>o.path==='game/Prineo.exe').sha256,TARGET_EXE_SHA256);
  assert.ok(!result.report.outputs.some(o=>o.path.endsWith('QRReader.dll')));
  const settings=await buildPatch(context,{...options,patchExe:false,installPath:'D:\\Arcade\\PriPara'});
  assert.equal(settings.report.outputs.length,2);assert.deepEqual(settings.report.selectedOptions.camera,{profile:'virtual',vid:'CAFE',pid:'0002'});
  assert.ok(readBytes<7*1024*1024,'Selected extraction must not read the entire archive');
  const directory=new URL('../.local-tests/',import.meta.url);await mkdir(directory,{recursive:true});
  await writeFile(new URL('patch-output.zip',directory),new Uint8Array(await result.blob.arrayBuffer()));
  const proof={passed:true,archiveSize:st.size,readBytes,readCalls,maxReadBytes,selectedInputs:context.result.entries,outputs:result.report.outputs,zipBytes:result.blob.size,downloads,uploadedBytes:0,targetExeSha256:TARGET_EXE_SHA256,elapsedMs:Math.round(performance.now()-start),gameTested:false,scope:'Local original RAR -> six selected SHA checks -> delta -> five changed game files in ZIP. No game execution or live game recognition test.'};
  await writeFile(new URL('real-archive-proof.json',directory),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof,null,2));
}finally{globalThis.fetch=oldFetch;await fd.close();}

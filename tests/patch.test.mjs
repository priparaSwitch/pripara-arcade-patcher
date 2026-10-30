import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeOptions,requiredPaths,sha256,validateManifest,buildPatch} from '../web/engine/patch.js';
import {APP_VERSION,PATCH_VERSION,TARGET_EXE_SHA256,QR_READER_DLL_SHA256} from '../web/release.js';
import {Sha256} from '../web/engine/hash.js';
import {applyPrineoDelta} from '../web/engine/apply-prineo-delta.mjs';
import {patchConfigBytes} from '../web/engine/config-patch.mjs';

test('SHA256 works without secure-context crypto',()=>{
  assert.equal(new Sha256().update(new TextEncoder().encode('abc')).digest(),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('options reject missing patches and config injection',()=>{
  assert.throws(()=>normalizeOptions({patchExe:false,patchSettings:false}));
  for(const installPath of ['relative','C:\\game\nsetting,1','C:\\game,other','C:\\game\\..\\other'])assert.throws(()=>normalizeOptions({installPath}));
  assert.deepEqual(normalizeOptions({camera:{profile:'c920'}}).camera,{profile:'virtual',vid:'CAFE',pid:'0002'});
  assert.deepEqual(normalizeOptions({camera:{profile:'custom',vid:'bad',pid:'bad'}}).camera,{profile:'virtual',vid:'CAFE',pid:'0002'});
});
test('only selected patch inputs are required',()=>{
  const m={dependencyChecks:[{path:'QRReader.dll',output:false}],companionCopies:[{sourcePath:'past/a'},{sourcePath:'past/b'}]};
  assert.deepEqual(requiredPaths({patchExe:false,patchSettings:true},m),['system_options.txt','camera/QRReader.ini']);
  assert.deepEqual(requiredPaths({patchExe:true,patchSettings:false},m),['Prineo.exe','QRReader.dll','past/a','past/b']);
});
function manifestFixture(){
  const dependency={path:'QRReader.dll',size:75496,sha256:QR_READER_DLL_SHA256,output:false};
  return {schemaVersion:1,applicationVersion:APP_VERSION,patchVersion:PATCH_VERSION,exe:{sha256:TARGET_EXE_SHA256},profiles:{},targets:[{...dependency}],dependencyChecks:[dependency]};
}
test('old manifests and missing or incompatible original DLL gates fail closed',()=>{
  assert.equal(validateManifest(manifestFixture()).patchVersion,'V17');
  for(const change of [m=>m.patchVersion='V16',m=>m.applicationVersion='1.0.2',m=>m.exe.sha256='0'.repeat(64),m=>m.dependencyChecks=[],m=>m.dependencyChecks[0].output=true,m=>m.targets[0].sha256='0'.repeat(64)]){
    const m=manifestFixture();change(m);assert.throws(()=>validateManifest(m));
  }
});
test('build rechecks the verification-only DLL before any delta download',async()=>{
  const context={manifest:manifestFixture(),files:new Map([['Prineo.exe',new Uint8Array()],['QRReader.dll',new Uint8Array(75496)]])};
  let downloads=0;const oldFetch=globalThis.fetch;globalThis.fetch=()=>{downloads++;throw new Error('unexpected download');};
  try{await assert.rejects(buildPatch(context,{patchExe:true,patchSettings:false}),/원본 SHA-256/);assert.equal(downloads,0);}
  finally{globalThis.fetch=oldFetch;}
});
test('unknown executable is rejected before a delta is decoded',async()=>{
  await assert.rejects(applyPrineoDelta(new Uint8Array([1,2]),new Uint8Array(),{profiles:{},exe:{}}),/원본/);
});
test('config helper refuses duplicate or missing camera fields',()=>{
  assert.throws(()=>patchConfigBytes(new TextEncoder().encode('[Camera0]\nVID0=CAFE\nVID0=CAFE\n'),'camera/QRReader.ini'));
});
test('published payloads contain deltas and their checksum matches',async()=>{
  const m=JSON.parse(await readFile(new URL('../web/data/patch-manifest.json',import.meta.url)));
  validateManifest(m);
  for(const profile of Object.values(m.profiles)){
    const b=new Uint8Array(await readFile(new URL('../web/data/'+profile.payload.file,import.meta.url)));
    assert.equal(b.length,profile.payload.size);assert.equal(sha256(b),profile.payload.sha256);
    assert.ok(b.length<100000,'full executable must not be published');
  }
});

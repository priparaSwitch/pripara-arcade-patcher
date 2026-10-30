import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectArchive,extractSelected} from '../web/engine/rar-select.js';
const sig=Uint8Array.of(0x52,0x61,0x72,0x21,0x1a,7,1,0),te=new TextEncoder();
const concat=(...xs)=>{const out=new Uint8Array(xs.reduce((n,x)=>n+x.length,0));let at=0;for(const x of xs){out.set(x,at);at+=x.length;}return out;};
function vint(n){n=BigInt(n);const out=[];do{const b=Number(n&127n);n>>=7n;out.push(b|(n?128:0));}while(n);return Uint8Array.from(out);}
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function u32(n){const out=new Uint8Array(4);new DataView(out.buffer).setUint32(0,n,true);return out;}
function header(type,body,{packed=0,extra=new Uint8Array()}={}){const flags=(packed?2:0)|(extra.length?1:0),raw=concat(vint(type),vint(flags),...(extra.length?[vint(extra.length)]:[]),...(packed?[vint(packed)]:[]),body,extra),b=concat(vint(raw.length),raw);return concat(u32(crc(b)),b);}
const main=solid=>header(1,vint(solid?4:0));const end=()=>header(5,vint(0));
function member(path,{size=495,packed=size,bytes=new Uint8Array(size),compression=0,extra=new Uint8Array(),directory=false}={}){const name=te.encode(path),body=concat(vint((directory?1:0)|4),vint(size),vint(0),u32(crc(bytes)),vint(compression),vint(0),vint(name.length),name);return{head:header(2,body,{packed,extra}),bytes};}
const archive=members=>concat(sig,main(false),...members.flatMap(x=>[x.head,x.bytes]),end());
const select={targetPaths:['system_options.txt']};
const rejects=(p,code)=>assert.rejects(p,e=>e.code===code);

test('unknown RAR scans headers, skips >4GiB payload and returns only requested path',async()=>{
 const huge=2**32+123,a=member('unrelated/big',{size:huge,packed:huge,bytes:new Uint8Array()}),b=member('pkg/game/system_options.txt');
 const start=concat(sig,main(false),a.head),next=start.length+huge,tail=concat(b.head,b.bytes,end());let calls=0,maxOffset=0;
 const input={size:next+tail.length,read(o,n){calls++;maxOffset=Math.max(maxOffset,o);if(o<start.length){assert(o+n<=start.length);return start.slice(o,o+n);}assert(o>=next&&o+n<=next+b.head.length);return tail.slice(o-next,o-next+n);}};
 const got=await inspectArchive(input,select);assert.equal(got.entries.length,1);assert.equal(got.entries[0].path,'system_options.txt');assert.equal(got.summary.indexMode,'header-scan');assert.equal(got.summary.fullArchiveVerified,false);assert(maxOffset>2**32);assert(calls<20);
});

test('selected-only scan documents later duplicates; complete scan rejects them',async()=>{
 const bytes=archive([member('game/system_options.txt'),member('other/game/system_options.txt')]);
 const early=await inspectArchive(new Blob([bytes]),select);assert.equal(early.summary.duplicateCoverage,'scanned-headers-only');
 await rejects(inspectArchive(new Blob([bytes]),{...select,scanToEnd:true}),'RAR_DUPLICATE_TARGET');
});

test('bad signature, header CRC, source size, unsupported compression and solid fail closed',async()=>{
 await rejects(inspectArchive(new Blob([new Uint8Array(20)]),select),'NOT_RAR5');
 const corrupt=archive([member('game/system_options.txt')]);corrupt[12]^=1;await rejects(inspectArchive(new Blob([corrupt]),select),'RAR_HEADER_CRC');
 await rejects(inspectArchive(new Blob([archive([member('game/system_options.txt',{size:494})])]),select),'RAR_TARGET_SIZE');
 await rejects(inspectArchive(new Blob([archive([member('game/system_options.txt',{compression:64})])]),select),'RAR_SOLID_UNSUPPORTED');
 await rejects(inspectArchive(new Blob([concat(sig,main(true),end())]),select),'RAR_SOLID_UNSUPPORTED');
 await rejects(inspectArchive(new Blob([archive([member('game/system_options.txt',{compression:1})])]),select),'RAR_COMPRESSION');
});

test('selected unsafe paths, encryption and redirection are rejected',async()=>{
 for(const path of ['../game/system_options.txt','/game/system_options.txt','C:/game/system_options.txt'])await rejects(inspectArchive(new Blob([archive([member(path)])]),select),'RAR_PATH');
 for(const type of [1,4,5]){const extra=concat(vint(1),vint(type));await rejects(inspectArchive(new Blob([archive([member('game/system_options.txt',{extra})])]),select),'RAR_TARGET_OPTIONS');}
});

test('CRC-valid changed selected contents still fail required source SHA',async()=>{
 const file=new Blob([archive([member('game/system_options.txt')])]),got=await inspectArchive(file,select);
 await rejects(extractSelected(file,got.entries),'RAR_TARGET_HASH');
 await rejects(extractSelected(file,[{...got.entries[0],headerOffset:got.entries[0].headerOffset+1}]),'RAR_HEADER_CRC');
 await rejects(extractSelected(file,[got.entries[0],got.entries[0]]),'RAR_DUPLICATE_TARGET');
});

test('only allowlisted targets are accepted and invalid source cannot poison busy state',async()=>{
 await rejects(inspectArchive(new Blob([]),{targetPaths:['arbitrary.txt']}),'RAR_TARGET');
 await rejects(inspectArchive(new Blob([]),{targetPaths:['Prineo.exe','prineohk/game/Prineo.exe']}),'RAR_DUPLICATE_TARGET');
 await rejects(extractSelected({},[{path:'system_options.txt'}]),'RAR_FILE');
 const file=new Blob([archive([member('game/system_options.txt')])]),got=await inspectArchive(file,select);await rejects(extractSelected(file,got.entries),'RAR_TARGET_HASH');
});

test('immutable index reuse does not reread headers or accept caller mutation',async()=>{
 const bytes=archive([member('game/system_options.txt')]);let calls=0;
 const file={size:bytes.length,read(o,n){calls++;return bytes.slice(o,o+n);}};
 const first=await inspectArchive(file,select),n=calls;assert(Object.isFrozen(first.entries));assert(Object.isFrozen(first.entries[0]));
 assert.throws(()=>{first.entries[0].headerOffset=0;},TypeError);
 const second=await inspectArchive(file,select);assert.equal(calls,n);assert.equal(second.summary.indexReused,true);
});

test('abort before/within scan does not cache incomplete result',async()=>{
 const pre=new AbortController();pre.abort();await assert.rejects(inspectArchive(new Blob([]),{...select,signal:pre.signal}),{name:'AbortError'});
 const file=new Blob([archive([...Array.from({length:130},(_,i)=>member('other/'+i,{size:0,bytes:new Uint8Array()})),member('game/system_options.txt')])]),during=new AbortController();
 await assert.rejects(inspectArchive(file,{...select,signal:during.signal,onProgress(){during.abort();}}),{name:'AbortError'});
 const retry=await inspectArchive(file,select);assert.equal(retry.summary.indexReused,false);assert.equal(retry.entries.length,1);
 await assert.rejects(extractSelected(file,retry.entries,{signal:pre.signal}),{name:'AbortError'});
});

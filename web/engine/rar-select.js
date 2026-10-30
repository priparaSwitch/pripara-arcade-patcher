/** Selected-file RAR5 reader. Only requested member bodies are read/hashed.
 * Known-layout offsets are hints, not archive identity: each header is reparsed,
 * CRC checked and decoded selected members must match their pinned SHA-256.
 * Other archive members and later duplicate headers are not authenticated. */
import {Crc32,Sha256} from './hash.js';
import {decodeIndependentRarMember} from './vendor/unrar/selected-core.js';

const MAGIC=Uint8Array.of(0x52,0x61,0x72,0x21,0x1a,7,1,0);
const MAX_HEADER=0x1fffff,MAX_HEADERS=250000,MAX_METADATA=128*1024*1024,CHUNK=1024*1024;
const KNOWN_BYTES=9827199082,decoder=new TextDecoder('utf-8',{fatal:true}),indexes=new WeakMap();
export const RAR_SOURCE_TARGETS=Object.freeze([
 {path:'Prineo.exe',size:19831808,sha256:'73ac687bf7335b368c61f4bc294bad3ad3ef5f864de9a6874c1e6e5732d80d49',headerOffset:9811094068,packedSize:5176660},
 {path:'QRReader.dll',size:75496,sha256:'3959ced4f2b035e4149c606da4fd39c55d383fa8c4b239bd99c5255dfaa3dfb8',headerOffset:9821485103,packedSize:28410},
 {path:'system_options.txt',size:495,sha256:'24b3e458576de5bfb7ca55baa88309939aa6145845d37936e25714b3d10c7623',headerOffset:9821761799,packedSize:279},
 {path:'camera/QRReader.ini',size:200,sha256:'66e2320781c44680a90abf34308b23e3085651747578479d131c77fe8e9aac9d',headerOffset:48803114,packedSize:97},
 {path:'media/past/hud/menu/entrance/window/ENT_Window_First.bin',size:1560,sha256:'2853db9536a75a84a02f1ea07896619a8c7998e2f880b5fdb108659e2e054418',headerOffset:7944396643,packedSize:1560},
 {path:'media/past/hud/menu/entrance/window/ENT_Window_First_tex.bin',size:370966,sha256:'31b958f960c3503fa400600792a893b42015e53073874257ecbb4a510153ec51',headerOffset:7944398307,packedSize:370966}
].map(x=>Object.freeze({...x,archivePath:'prineohk/game/'+x.path})));
export const DEFAULT_TARGET_PATHS=Object.freeze(['Prineo.exe','system_options.txt','camera/QRReader.ini']);
const targets=new Map(RAR_SOURCE_TARGETS.map(x=>[x.path.toLowerCase(),x]));
let extractionActive=false;
function fail(code,message){const e=new Error(message);e.name='RarError';e.code=code;throw e;}
function need(ok,code,message){if(!ok)fail(code,message);}
function check(signal){if(signal?.aborted){if(signal.throwIfAborted)signal.throwIfAborted();const e=new Error('작업을 취소했습니다.');e.name='AbortError';throw e;}}
const integer=n=>Number.isSafeInteger(n)&&n>=0;
function add(a,b){need(integer(a)&&integer(b)&&b<=Number.MAX_SAFE_INTEGER-a,'RAR_INTEGER','RAR 위치 또는 크기가 처리 범위를 넘었습니다.');return a+b;}
function safePath(name){
 need(typeof name==='string'&&name.length>0&&name.length<=4096&&!name.startsWith('/')&&!/[\x00-\x1f\x7f:<>"|?*\ufffe\uffff]/.test(name),'RAR_PATH','RAR 안의 필요한 파일 경로가 올바르지 않습니다.');
 for(const p of name.split('/'))need(p&&p!=='.'&&p!=='..'&&!/[ .]$/.test(p)&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p),'RAR_PATH','RAR 안의 필요한 파일 경로가 안전하지 않습니다.');return name;
}
function canonical(path){
 need(typeof path==='string','RAR_TARGET','선택한 RAR 항목이 올바르지 않습니다.');
 const clean=path.replaceAll('\\','/').replace(/^prineohk\/game\//i,'').replace(/^game\//i,'');
 const t=targets.get(clean.toLowerCase());need(t,'RAR_TARGET','이 패처에서 사용하는 파일만 선택할 수 있습니다.');return t;
}
function requested(options){
 const paths=options.targetPaths??DEFAULT_TARGET_PATHS;need(Array.isArray(paths)&&paths.length>0&&paths.length<=RAR_SOURCE_TARGETS.length,'RAR_TARGET','필요한 파일 선택 목록이 올바르지 않습니다.');
 const result=paths.map(canonical);need(new Set(result.map(x=>x.path)).size===result.length,'RAR_DUPLICATE_TARGET','같은 파일을 두 번 선택할 수 없습니다.');return result;
}
function source(file){
 need(file&&integer(file.size)&&(typeof file.slice==='function'||typeof file.read==='function'),'RAR_FILE','RAR 파일을 선택해 주세요.');
 const metrics={readCalls:0,readBytes:0,maxReadBytes:0};return {size:file.size,metrics,async read(offset,length){
  need(integer(offset)&&integer(length)&&offset<=file.size&&length<=file.size-offset,'RAR_READ_RANGE','RAR 읽기 범위가 올바르지 않습니다.');
  const value=typeof file.slice==='function'?await file.slice(offset,offset+length).arrayBuffer():await file.read(offset,length);
  const bytes=value instanceof Uint8Array?value:new Uint8Array(value);need(bytes.length===length,'RAR_SHORT_READ','RAR 파일의 일부를 읽지 못했습니다.');
  metrics.readCalls++;metrics.readBytes+=length;metrics.maxReadBytes=Math.max(metrics.maxReadBytes,length);return bytes;
 }};
}
class Cursor{
 constructor(bytes,start=0,end=bytes.length){this.bytes=bytes;this.pos=start;this.end=end;}
 take(n){need(integer(n)&&n<=this.end-this.pos,'RAR_TRUNCATED_HEADER','RAR 내부 헤더가 잘렸습니다.');const b=this.bytes.subarray(this.pos,this.pos+n);this.pos+=n;return b;}
 u32(){const b=this.take(4);return new DataView(b.buffer,b.byteOffset,4).getUint32(0,true);}
 vint(limit=10){let n=0n;for(let i=0;i<limit;i++){const b=this.take(1)[0];need(i!==9||(b&254)===0,'RAR_INTEGER','RAR 정수 범위가 올바르지 않습니다.');n|=BigInt(b&127)<<BigInt(7*i);if(!(b&128)){need(n<=BigInt(Number.MAX_SAFE_INTEGER),'RAR_INTEGER','RAR 크기가 처리 범위를 넘었습니다.');return Number(n);}}fail('RAR_VINT','RAR 정수 필드가 올바르지 않습니다.');}
}
function extras(bytes,start,end){
 const c=new Cursor(bytes,start,end);let encrypted=false,redirected=false,versioned=false;
 while(c.pos<c.end){const n=c.vint(),stop=add(c.pos,n);need(n>0&&stop<=c.end,'RAR_EXTRA','RAR 부가 헤더의 범위가 잘못됐습니다.');const r=new Cursor(bytes,c.pos,stop),type=r.vint();encrypted||=type===1;redirected||=type===5;versioned||=type===4;c.pos=stop;}
 return {encrypted,redirected,versioned};
}
async function readHeader(s,offset,signal){
 check(signal);need(s.size-offset>=7,'RAR_TRUNCATED_HEADER','RAR 끝 부분의 헤더가 잘렸습니다.');
 const pre=new Cursor(await s.read(offset,7));const crc=pre.u32(),n=pre.vint(3),length=add(4+pre.pos-4,n);
 need(n>=2&&n<=MAX_HEADER&&length<=s.size-offset,'RAR_HEADER_SIZE','RAR 헤더 크기가 올바르지 않습니다.');
 const raw=await s.read(offset,length);need(new Crc32().update(raw.subarray(4)).digest()===crc,'RAR_HEADER_CRC','RAR 내부 파일 목록이 손상됐습니다.');
 const c=new Cursor(raw,pre.pos),type=c.vint(),flags=c.vint();need(flags<=127,'RAR_HEADER_FLAGS','지원하지 않는 RAR 헤더 옵션입니다.');
 need(!(flags&24),'RAR_MULTIVOLUME','분할 RAR 대신 하나의 완전한 RAR을 선택해 주세요.');
 const extraSize=flags&1?c.vint():0,packedSize=flags&2?c.vint():0;
 need(extraSize<=c.end-c.pos,'RAR_EXTRA','RAR 부가 헤더의 크기가 잘못됐습니다.');const end=c.end-extraSize;c.end=end;
 const dataOffset=add(offset,length),next=add(dataOffset,packedSize);need(next<=s.size,'RAR_TRUNCATED_DATA','RAR 압축 데이터가 파일 끝을 넘어갑니다.');
 const block={type,flags,headerOffset:offset,headerSize:length,dataOffset,packedSize,next,raw};
 if(type===4)fail('RAR_ENCRYPTED','파일 목록이 암호화된 RAR은 지원하지 않습니다.');
 if(type===1){block.archiveFlags=c.vint();need(block.archiveFlags<=31&&!(block.archiveFlags&3),'RAR_MULTIVOLUME','분할 RAR은 지원하지 않습니다.');block.solid=!!(block.archiveFlags&4);}
 else if(type===2||type===3){
  const fileFlags=c.vint();need(fileFlags<=15&&!(fileFlags&8),'RAR_FILE_FLAGS','RAR 파일 크기 필드가 올바르지 않습니다.');
  block.size=c.vint();block.attributes=c.vint();if(fileFlags&2)c.u32();block.crc32=fileFlags&4?c.u32():null;
  block.compression=c.vint();block.host=c.vint();const nameSize=c.vint();need(nameSize>0&&nameSize<=16384,'RAR_NAME','RAR 파일 이름이 올바르지 않습니다.');
  try{block.archivePath=decoder.decode(c.take(nameSize)).replaceAll('\\','/');}catch(e){if(e.code)throw e;fail('RAR_NAME','RAR 파일 이름을 읽지 못했습니다.');}
  block.isDirectory=!!(fileFlags&1);block.method=(block.compression>>>7)&7;block.solid=!!(block.compression&64);block.dictionaryBytes=128*1024*2**((block.compression>>>10)&31);
  Object.assign(block,extras(raw,end,raw.length));
 }else if(type===5){need(!packedSize&&!extraSize&&c.vint()===0,'RAR_MULTIVOLUME','다음 분할 파일이 필요한 RAR은 지원하지 않습니다.');}
 else fail('RAR_BLOCK_TYPE','지원하지 않는 RAR 헤더 형식입니다.');
 need(c.pos===c.end,'RAR_HEADER_FIELDS','RAR 헤더에 해석할 수 없는 필드가 있습니다.');
 if(type===1)extras(raw,end,raw.length);return block;
}
function match(name,list){return list.find(t=>name.toLowerCase()===t.path.toLowerCase()||name.toLowerCase()===('game/'+t.path).toLowerCase()||name.toLowerCase().endsWith(('/game/'+t.path).toLowerCase()));}
function targetEntry(block,t){
 need(block.type===2&&!block.isDirectory,'RAR_TARGET_MISSING','필요한 RAR 파일 항목이 올바르지 않습니다.');safePath(block.archivePath);
 need(!block.encrypted&&!block.redirected&&!block.versioned,'RAR_TARGET_OPTIONS','암호·링크·이전 버전 항목은 사용할 수 없습니다.');
 need((block.host===0||block.host===1)&&block.attributes<=0xffffffff,'RAR_HOST','필요한 파일의 파일 시스템 형식이 올바르지 않습니다.');
 need(!(block.host===0&&(block.attributes&0x400))&&!(block.host===1&&(block.attributes&0xf000)!==0&&(block.attributes&0xf000)!==0x8000),'RAR_TARGET_LINK','필요한 파일 대신 링크 또는 특수 항목이 들어 있습니다.');
 need(!block.solid,'RAR_SOLID_UNSUPPORTED','솔리드 압축 대신 일반 압축 RAR을 선택해 주세요.');
 need(block.compression<=0x1fffff&&(block.compression&63)===0&&block.method<=5&&block.dictionaryBytes<=64*1024*1024,'RAR_COMPRESSION','필요한 파일의 RAR 압축 방식은 지원하지 않습니다.');
 need(block.size===t.size&&block.packedSize>0&&block.packedSize<=64*1024*1024,'RAR_TARGET_SIZE','필요한 원본 파일의 크기가 기준과 다릅니다.');
 if(block.method===0)need(block.packedSize===block.size,'RAR_DATA_SIZE','비압축 RAR 항목 크기가 일치하지 않습니다.');
 const {raw,next,type,flags,archiveFlags,...entry}=block;return Object.freeze({...entry,path:t.path,expectedSha256:t.sha256});
}
function snapshot(entries,s,detail){return Object.freeze({entries:Object.freeze(entries),summary:Object.freeze({format:'RAR5',archiveBytes:s.size,targetCount:entries.length,selectedUnpackedBytes:entries.reduce((n,x)=>n+x.size,0),selectedPackedBytes:entries.reduce((n,x)=>n+x.packedSize,0),headerReadBytes:s.metrics.readBytes,headerReadCalls:s.metrics.readCalls,maxReadBytes:s.metrics.maxReadBytes,otherFilesVerified:false,fullArchiveVerified:false,targetContentVerified:false,...detail})});}

/** Returns {entries,summary}. targetPaths accepts the EXE, verification-only
 * QRReader.dll, two settings and two first-login resources. No full archive buffer/hash. */
export async function inspectArchive(file,options={}){
 const {signal,onProgress=()=>{}}=options,list=requested(options);check(signal);
 const cacheKey=list.map(t=>t.path).sort().join('\n')+'|'+!!options.forceScan+'|'+!!options.scanToEnd;
 const old=indexes.get(file)?.get(cacheKey);if(old){onProgress({stage:'rar-index',done:1,total:1,message:'확인한 원본 파일 목록을 재사용합니다.'});return {...old,summary:{...old.summary,indexReused:true,headerReadBytes:0,headerReadCalls:0}};}
 const s=source(file);need(s.size>=8,'NOT_RAR','RAR 파일이 아니거나 잘렸습니다.');const sig=await s.read(0,8);
 need(sig.every((x,i)=>x===MAGIC[i]),'NOT_RAR5','RAR5 형식의 아케이드 원자료를 선택해 주세요.');
 const main=await readHeader(s,8,signal);need(main.type===1&&!main.packedSize,'RAR_MAIN_HEADER','RAR 기본 헤더가 올바르지 않습니다.');need(!main.solid,'RAR_SOLID_UNSUPPORTED','솔리드 압축 RAR은 개별 파일 해제를 지원하지 않습니다.');
 let result;
 if(!options.forceScan&&s.size===KNOWN_BYTES){
  try{
   const found=[];for(const t of list){const b=await readHeader(s,t.headerOffset,signal);need(b.archivePath===t.archivePath,'RAR_LAYOUT_MISMATCH','원본 RAR 배치가 다릅니다.');found.push(targetEntry(b,t));}
   result=snapshot(found,s,{indexMode:'known-offsets',headersScanned:1+found.length,solid:false,indexReused:false,laterHeadersScanned:false,duplicateCoverage:'requested-target-headers-only'});
  }catch(e){check(signal);if(e.name==='AbortError')throw e;/* Repacked archive: exact header scan below. */}
 }
 if(!result){
  let position=main.next,headers=1,metadataBytes=main.headerSize+8;const found=new Map();let ended=false;
  while(position<s.size){
   check(signal);need(++headers<=MAX_HEADERS,'RAR_HEADER_LIMIT','RAR 파일 목록이 처리 한도를 넘었습니다.');
   const b=await readHeader(s,position,signal);metadataBytes=add(metadataBytes,b.headerSize);need(metadataBytes<=MAX_METADATA,'RAR_METADATA_LIMIT','RAR 파일 목록이 처리 한도를 넘었습니다.');
   if(b.type===2){const t=match(b.archivePath,list);if(t){need(!found.has(t.path),'RAR_DUPLICATE_TARGET','필요한 원본 파일 경로가 중복되어 있습니다.');found.set(t.path,targetEntry(b,t));}}
   need(b.type!==1,'RAR_MAIN_HEADER','RAR 기본 헤더가 중복되어 있습니다.');position=b.next;
   if(headers%128===0){onProgress({stage:'rar-index',done:position,total:s.size,entries:headers,message:`필요한 원본 파일 확인 · ${found.size}/${list.length}`});await new Promise(r=>setTimeout(r,0));}
   if(b.type===5){ended=true;break;}
   if(found.size===list.length&&!options.scanToEnd)break;
  }
  need(found.size===list.length,'RAR_TARGET_MISSING','RAR 안에서 필요한 아케이드 원본 파일을 찾지 못했습니다.');
  if(options.scanToEnd)need(ended&&position===s.size,'RAR_MISSING_END','RAR 종료 헤더가 없거나 뒤에 다른 데이터가 있습니다.');
  result=snapshot(list.map(t=>found.get(t.path)),s,{indexMode:'header-scan',headersScanned:headers,solid:false,indexReused:false,laterHeadersScanned:ended,duplicateCoverage:ended?'all-headers':'scanned-headers-only'});
 }
 check(signal);let cached=indexes.get(file);if(!cached){cached=new Map();indexes.set(file,cached);}cached.set(cacheKey,result);
 onProgress({stage:'rar-index',done:1,total:1,message:'필요한 원본 파일 위치를 확인했습니다.'});return result;
}

/** Return Map<game-relative source path,Uint8Array>. Compressed input is bounded
 * to the selected member, then a synthetic one-member RAR view feeds UnRAR.
 * No OPFS/SharedArrayBuffer/secure-context feature is required. */
export async function extractSelected(file,entries,options={}){
 const {signal,onProgress=()=>{}}=options;check(signal);if(entries?.entries&&!Array.isArray(entries))entries=entries.entries;
 need(Array.isArray(entries)&&entries.length>0&&entries.length<=targets.size,'RAR_TARGET','필요한 RAR 파일 목록이 올바르지 않습니다.');
 const selectedTargets=entries.map(e=>canonical(e?.path));need(new Set(selectedTargets.map(t=>t.path)).size===selectedTargets.length,'RAR_DUPLICATE_TARGET','같은 파일을 두 번 해제할 수 없습니다.');
 const s=source(file);need(!extractionActive,'RAR_BUSY','RAR 파일 해제가 이미 진행 중입니다.');extractionActive=true;
 const out=new Map(),checks=[];let unpacked=0,wasmHeapBytes=0;
 try{
  const total=selectedTargets.reduce((n,t)=>n+t.size,0);
  for(let index=0;index<entries.length;index++){
   check(signal);const supplied=entries[index],t=selectedTargets[index];
   const b=await readHeader(s,supplied.headerOffset,signal);need(match(b.archivePath,[t]),'RAR_TARGET_CHANGED','선택한 RAR 파일 위치가 바뀌었습니다.');const e=targetEntry(b,t),bytes=new Uint8Array(e.size);let result;
   if(e.method===0){
    const sha=new Sha256(),crc=new Crc32();for(let at=0;at<e.size;at+=CHUNK){check(signal);const chunk=await s.read(e.dataOffset+at,Math.min(CHUNK,e.size-at));bytes.set(chunk,at);sha.update(chunk);crc.update(chunk);onProgress({stage:'rar-extract',path:t.path,done:unpacked+at+chunk.length,total,message:'필요한 원본 파일을 읽고 있습니다.'});}
    result={size:bytes.length,sha256:sha.digest(),crc32:crc.digest(),wasmHeapBytes:0};
   }else{
    const packed=new Uint8Array(e.packedSize);for(let at=0;at<packed.length;at+=CHUNK){check(signal);const chunk=await s.read(e.dataOffset+at,Math.min(CHUNK,packed.length-at));packed.set(chunk,at);onProgress({stage:'rar-read',path:t.path,done:at+chunk.length,total:packed.length,message:'필요한 압축 파일만 읽고 있습니다.'});}
    result=await decodeIndependentRarMember({...e,path:e.archivePath},{check:()=>check(signal),readSync(offset,length){
     if(offset===e.headerOffset&&length===e.headerSize)return b.raw;
     need(offset>=e.dataOffset&&length<=e.packedSize-(offset-e.dataOffset),'RAR_READ_RANGE','선택한 파일 밖의 압축 데이터를 읽을 수 없습니다.');return packed.subarray(offset-e.dataOffset,offset-e.dataOffset+length);
    },writeSync(chunk,at){need(integer(at)&&chunk.length<=bytes.length-at,'RAR_OUTPUT_RANGE','RAR 해제 크기가 기준을 넘었습니다.');bytes.set(chunk,at);return chunk.length;},onProgress(done){onProgress({stage:'rar-extract',path:t.path,done:unpacked+done,total,message:'필요한 원본 파일의 압축을 풀고 있습니다.'});}});
   }
   check(signal);need(result.size===t.size&&result.sha256===t.sha256,'RAR_TARGET_HASH','필요한 원본 파일의 내용이 기준과 다릅니다.');need(e.crc32===null||result.crc32===e.crc32,'RAR_TARGET_CRC','필요한 원본 파일의 검사값이 다릅니다.');
   wasmHeapBytes=Math.max(wasmHeapBytes,result.wasmHeapBytes);unpacked+=bytes.length;out.set(t.path,bytes);checks.push(Object.freeze({path:t.path,size:bytes.length,sha256:result.sha256,crc32:result.crc32,verified:true}));
  }
  Object.defineProperty(out,'metrics',{value:Object.freeze({...s.metrics,selectedUnpackedBytes:unpacked,wasmHeapBytes,targetChecks:Object.freeze(checks),otherFilesVerified:false,fullArchiveVerified:false}),enumerable:false});return out;
 }finally{extractionActive=false;}
}

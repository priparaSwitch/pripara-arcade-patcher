/** Pinned UnRAR decoder with synchronous bounded memory I/O callbacks.
 * The caller supplies one selected member; OPFS and shared memory are unused.
 * No archive or decoded member is collected in the WASM virtual filesystem. */
import createUnrar from './unrar.js';
import {Extractor} from './Extractor.js';
import {Crc32,Sha256} from '../../hash.js';

const MAGIC=Uint8Array.of(0x52,0x61,0x72,0x21,0x1a,7,1,0);
const WASM_SHA='c7d79f869196e3c79c053ba74a8f629116de8293a94f60cc851bbcd7977d0c2b';
const MAX_IO=1024*1024;
let pending=null;
function fail(message){const e=new Error(message);e.code='ARCADE_EXTRACT';throw e;}
function concat(...arrays){const out=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let p=0;for(const a of arrays){out.set(a,p);p+=a.length;}return out;}
function header(body){const bytes=Uint8Array.of(body.length,...body),out=new Uint8Array(4+bytes.length);new DataView(out.buffer).setUint32(0,new Crc32().update(bytes).digest(),true);out.set(bytes,4);return out;}
const MAIN=header([1,0,0]),END=header([5,0,0]);

async function engine(){
 if(!pending)pending=(async()=>{
  const url=new URL('./unrar.wasm',import.meta.url);let bytes;
  if(url.protocol==='file:'&&typeof process!=='undefined'&&process.versions?.node){const fs=await import('node:fs/promises');bytes=new Uint8Array(await fs.readFile(url));}
  else{const r=await fetch(url,{method:'GET',credentials:'omit',redirect:'error'});if(!r.ok)fail('RAR 해제 프로그램을 읽지 못했습니다.');bytes=new Uint8Array(await r.arrayBuffer());}
  if(bytes.length!==207593||new Sha256().update(bytes).digest()!==WASM_SHA)fail('RAR 해제 프로그램 검사값이 다릅니다.');
  return createUnrar({wasmBinary:bytes,print(){},printErr(){}});
 })().catch(e=>{pending=null;throw e;});
 return pending;
}

/** Decode one independent compressed member. readSync(offset,length) must
 * return an exact Uint8Array, writeSync(bytes,offset) must return bytes written.
 * The caller owns and closes its file handles, including after a decoder error. */
export async function decodeIndependentRarMember(entry,{readSync,writeSync,onProgress=()=>{},check=()=>{}}){
 if(entry.isDirectory||entry.solid||entry.method<1||entry.method>5||(entry.compression&63)!==0)fail('독립 해제를 지원하지 않는 RAR 압축 항목입니다.');
 if(entry.dictionaryBytes>64*1024*1024)fail('RAR 압축 사전이 지원 크기를 초과합니다.');
 const module=await engine();check();
 const originalHeader=readSync(entry.headerOffset,entry.headerSize);
 if(originalHeader.length!==entry.headerSize)fail('RAR 파일 헤더 읽기가 잘렸습니다.');
 const prefix=concat(MAGIC,MAIN,originalHeader),packedStart=prefix.length,packedEnd=packedStart+entry.packedSize,virtualSize=packedEnd+END.length;
 let written=0,readBytes=0,maxReadBytes=0,maxWriteBytes=0,outputCreated=false;
 const sha=new Sha256(),crc=new Crc32();
 class StreamingExtractor extends Extractor{
  constructor(){super(module);this._filePath='member.rar';this.pos=0;}
  open(name){if(name!==this._filePath)return 0;this.pos=0;return 1;}
  create(name){if(name.replaceAll('\\','/')!==entry.path||outputCreated)fail('RAR이 예상하지 않은 파일을 만들려고 합니다.');outputCreated=true;return 2;}
  closeFile(){}
  read(fd,ptr,length){
   check();if(fd!==1||length<0)fail('RAR 입력 요청이 올바르지 않습니다.');
   const wanted=Math.min(length,virtualSize-this.pos);let done=0;
   while(done<wanted){const p=this.pos,limit=p<packedStart?packedStart:p<packedEnd?packedEnd:virtualSize,n=Math.min(wanted-done,limit-p,MAX_IO);let bytes;
    if(p<packedStart)bytes=prefix.subarray(p,p+n);else if(p<packedEnd){bytes=readSync(entry.dataOffset+p-packedStart,n);readBytes+=bytes.length;maxReadBytes=Math.max(maxReadBytes,n);}else bytes=END.subarray(p-packedEnd,p-packedEnd+n);
    if(bytes.length!==n)fail('RAR 압축 데이터가 잘렸습니다.');module.HEAPU8.set(bytes,ptr+done);this.pos+=n;done+=n;
   }return done;
  }
  write(fd,ptr,length){
   check();if(fd!==2||length<0||length>entry.size-written)fail('RAR 해제 결과가 기준 크기를 초과합니다.');
   for(let at=0;at<length;at+=MAX_IO){const n=Math.min(MAX_IO,length-at),bytes=module.HEAPU8.subarray(ptr+at,ptr+at+n);if(writeSync(bytes,written)!==n)fail('RAR 임시파일 쓰기가 잘렸습니다.');sha.update(bytes);crc.update(bytes);written+=n;maxWriteBytes=Math.max(maxWriteBytes,n);onProgress(written);}
   return true;
  }
  tell(fd){return fd===1?this.pos:written;}
  seek(fd,offset,method){if(fd!==1)return false;const next=(method==='SET'?0:method==='END'?virtualSize:this.pos)+offset;if(!Number.isSafeInteger(next)||next<0||next>virtualSize)return false;this.pos=next;return true;}
 }
 const extractor=new StreamingExtractor();module.extractor=extractor;
 try{
  const result=extractor.extract();let count=0;
  for(const file of result.files){count++;if(file.fileHeader.name.replaceAll('\\','/')!==entry.path||file.fileHeader.unpSize!==entry.size||file.fileHeader.flags.solid||file.fileHeader.flags.encrypted)fail('RAR 해제 항목 정보가 기준과 다릅니다.');}
  if(count!==1||!outputCreated||written!==entry.size)fail('RAR 해제 크기 또는 파일 수가 다릅니다.');
  const crc32=crc.digest();if(entry.crc32!==null&&entry.crc32!==crc32)fail('RAR 원자료의 CRC가 일치하지 않습니다.');
  return {size:written,sha256:sha.digest(),crc32,compressedReadBytes:readBytes,maxReadBytes,maxWriteBytes,wasmHeapBytes:module.HEAPU8.byteLength};
 }finally{if(extractor._archive)extractor.closeArc();module.extractor=null;}
}

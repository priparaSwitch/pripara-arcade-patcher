import {Crc32} from './hash.js';
const enc=new TextEncoder(),U32=0xffffffff;
function record(n){const b=new Uint8Array(n);return {b,v:new DataView(b.buffer)};}
function safePath(p){if(typeof p!=='string'||p.startsWith('/')||p.includes('\\')||p.split('/').some(s=>!s||s==='.'||s==='..')||/[\x00-\x1f:]/.test(p))throw Error('안전하지 않은 출력 경로입니다.');return p;}
export function bytesFile(path,bytes){return{path,size:bytes.length,crc32:new Crc32().update(bytes).digest(),read:async(o,n)=>bytes.slice(o,o+n)};}
/** ZIP/ZIP64 stored entries, streaming body, O(file count) central directory memory. */
export async function writeZip(files,sink,{signal,onProgress}={}){
 const central=[],seen=new Set();let position=0,total=files.reduce((s,f)=>s+f.size,0),done=0;
 const write=async b=>{signal?.throwIfAborted();await sink.write(b);position+=b.length;};
 for(const f of files){safePath(f.path);const key=f.path.toLowerCase();if(seen.has(key))throw Error('ZIP 출력 경로가 중복됩니다.');seen.add(key);if(!Number.isSafeInteger(f.size)||f.size<0)throw Error('잘못된 ZIP 크기입니다.');
 const name=enc.encode(f.path);if(name.length>65535)throw Error('ZIP 경로가 너무 깁니다.');
 let crc=f.crc32;if(crc==null){const c=new Crc32();for(let p=0;p<f.size;p+=1048576){signal?.throwIfAborted();const n=Math.min(1048576,f.size-p),bytes=await f.read(p,n);if(bytes.length!==n)throw Error("출력 검사 중 파일 읽기가 잘렸습니다.");c.update(bytes);onProgress?.({phase:"crc",done:p+n,total:f.size,path:f.path});}crc=c.digest();}
 const start=position,large=f.size>=U32,extra=large?20:0;
 const h=record(30+name.length+extra);h.v.setUint32(0,0x04034b50,true);h.v.setUint16(4,large?45:20,true);h.v.setUint16(6,0x800,true);h.v.setUint16(12,0x21,true);h.v.setUint32(14,crc,true);h.v.setUint32(18,large?U32:f.size,true);h.v.setUint32(22,large?U32:f.size,true);h.v.setUint16(26,name.length,true);h.v.setUint16(28,extra,true);h.b.set(name,30);
 if(large){let p=30+name.length;h.v.setUint16(p,1,true);h.v.setUint16(p+2,16,true);h.v.setBigUint64(p+4,BigInt(f.size),true);h.v.setBigUint64(p+12,BigInt(f.size),true);}await write(h.b);
 const check=new Crc32();for(let p=0;p<f.size;p+=1048576){const n=Math.min(1048576,f.size-p),b=await f.read(p,n);if(b.length!==n)throw Error('출력 중 파일 읽기가 잘렸습니다.');check.update(b);await write(b);done+=b.length;onProgress?.({done,total,path:f.path});}if(check.digest()!==crc)throw Error('출력 중 파일 내용이 바뀌었습니다.');
 const offLarge=start>=U32,cextra=large||offLarge?4+(large?16:0)+(offLarge?8:0):0,c=record(46+name.length+cextra);c.v.setUint32(0,0x02014b50,true);c.v.setUint16(4,45,true);c.v.setUint16(6,large||offLarge?45:20,true);c.v.setUint16(8,0x800,true);c.v.setUint16(14,0x21,true);c.v.setUint32(16,crc,true);c.v.setUint32(20,large?U32:f.size,true);c.v.setUint32(24,large?U32:f.size,true);c.v.setUint16(28,name.length,true);c.v.setUint16(30,cextra,true);c.v.setUint32(42,offLarge?U32:start,true);c.b.set(name,46);
 if(cextra){let p=46+name.length;c.v.setUint16(p,1,true);c.v.setUint16(p+2,cextra-4,true);p+=4;if(large){c.v.setBigUint64(p,BigInt(f.size),true);c.v.setBigUint64(p+8,BigInt(f.size),true);p+=16;}if(offLarge)c.v.setBigUint64(p,BigInt(start),true);}central.push(c.b);
 }
 const centralOffset=position;for(const c of central)await write(c);const centralSize=position-centralOffset,needs64=files.length>=65535||centralOffset>=U32||centralSize>=U32||files.some(f=>f.size>=U32);
 if(needs64){const pos=position,e=record(56);e.v.setUint32(0,0x06064b50,true);e.v.setBigUint64(4,44n,true);e.v.setUint16(12,45,true);e.v.setUint16(14,45,true);e.v.setBigUint64(24,BigInt(files.length),true);e.v.setBigUint64(32,BigInt(files.length),true);e.v.setBigUint64(40,BigInt(centralSize),true);e.v.setBigUint64(48,BigInt(centralOffset),true);await write(e.b);const l=record(20);l.v.setUint32(0,0x07064b50,true);l.v.setBigUint64(8,BigInt(pos),true);l.v.setUint32(16,1,true);await write(l.b);}
 const e=record(22);e.v.setUint32(0,0x06054b50,true);e.v.setUint16(8,Math.min(files.length,65535),true);e.v.setUint16(10,Math.min(files.length,65535),true);e.v.setUint32(12,Math.min(centralSize,U32),true);e.v.setUint32(16,Math.min(centralOffset,U32),true);await write(e.b);signal?.throwIfAborted();return{files:files.length,bytes:position};
}

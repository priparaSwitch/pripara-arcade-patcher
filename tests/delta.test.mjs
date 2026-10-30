import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {applyPrineoDelta} from '../web/engine/apply-prineo-delta.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const source=Buffer.from('0123456789'),target=Buffer.from('01234ABC56789');
const copy=(offset,length)=>{const b=Buffer.alloc(9);b[0]=0;b.writeUInt32LE(offset,1);b.writeUInt32LE(length,5);return b;};
const head=Buffer.alloc(88);head.write('PPDELTA1');
[1,source.length,target.length,3].forEach((n,i)=>head.writeUInt32LE(n,8+4*i));
Buffer.from(hash(source),'hex').copy(head,24);Buffer.from(hash(target),'hex').copy(head,56);
const original=Buffer.concat([head,copy(0,5),Buffer.from([1,3,0,0,0,65,66,67]),copy(5,5)]);
function fixture(raw=original){
  const packed=gzipSync(raw),id=hash(source);
  return {packed,manifest:{exe:{size:target.length,sha256:hash(target)},profiles:{[id]:{source:{size:source.length,sha256:id},payload:{size:packed.length,sha256:hash(packed),uncompressedSize:raw.length,uncompressedSha256:hash(raw)}}}}};
}
test('COPY/ADD delta reconstructs target without modifying source',async()=>{
  const f=fixture(),before=source.slice();
  assert.deepEqual(await applyPrineoDelta(source,f.packed,f.manifest),new Uint8Array(target));assert.deepEqual(source,before);
});
test('wrong original and corrupt compressed payload fail closed',async()=>{
  const f=fixture(),wrong=source.slice();wrong[0]^=1;
  await assert.rejects(applyPrineoDelta(wrong,f.packed,f.manifest));
  f.packed[13]^=1;await assert.rejects(applyPrineoDelta(source,f.packed,f.manifest));
});
const mutations={
  magic:r=>{r[0]^=1;},identity:r=>{r[24]^=1;},operation:r=>{r[88]=9;},
  source_range:r=>{r.writeUInt32LE(100,89);},output_range:r=>{r.writeUInt32LE(14,93);},
  final_hash:r=>{r[102]^=1;},trailing:r=>Buffer.concat([r,Buffer.from([1])]),truncated:r=>r.subarray(0,r.length-1)
};
for(const [name,mutate] of Object.entries(mutations))test('rejects malformed delta: '+name,async()=>{
  let raw=Buffer.from(original);raw=mutate(raw)||raw;const f=fixture(raw);
  await assert.rejects(applyPrineoDelta(source,f.packed,f.manifest));
});

// Local-only byte transform. No network, upload, filesystem or game execution.
import { Sha256 } from './hash.js';
const MAGIC = new TextEncoder().encode('PPDELTA1');
export async function sha256(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Sha256().update(view).digest();
}
export async function identifySourceProfile(bytes, manifest) {
  const hash = await sha256(bytes);
  const profile = manifest.profiles?.[hash];
  if (!profile || bytes.byteLength !== profile.source.size) {
    throw new Error('지원하는 원본 Prineo.exe와 일치하지 않습니다.');
  }
  return { ...profile, id: hash };
}
export async function applyPrineoDelta(sourceBytes, gzipBytes, manifest) {
  const source = sourceBytes instanceof Uint8Array ? sourceBytes : new Uint8Array(sourceBytes);
  const packed = gzipBytes instanceof Uint8Array ? gzipBytes : new Uint8Array(gzipBytes);
  const profile = await identifySourceProfile(source, manifest);
  const meta = profile.payload;
  if (packed.length !== meta.size || await sha256(packed) !== meta.sha256) throw new Error('패치 데이터 검증에 실패했습니다.');
  if (typeof DecompressionStream !== 'function') throw new Error('이 브라우저는 압축 패치를 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요.');
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  if (raw.length !== meta.uncompressedSize || await sha256(raw) !== meta.uncompressedSha256) throw new Error('압축을 푼 패치 데이터가 일치하지 않습니다.');
  if (raw.length < 88 || !MAGIC.every((b, i) => raw[i] === b)) throw new Error('패치 형식이 올바르지 않습니다.');
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const version = dv.getUint32(8, true), sourceSize = dv.getUint32(12, true), targetSize = dv.getUint32(16, true), count = dv.getUint32(20, true);
  const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  if (version !== 1 || sourceSize !== source.length || targetSize !== manifest.exe.size || count > 10000 || targetSize > 128 * 1024 * 1024 || hex(raw.subarray(24, 56)) !== profile.id || hex(raw.subarray(56, 88)) !== manifest.exe.sha256) throw new Error('원본 또는 결과 정보가 패치와 일치하지 않습니다.');
  const output = new Uint8Array(targetSize);
  let p = 88, cursor = 0;
  const u32 = () => { if (p + 4 > raw.length) throw new Error('패치가 잘렸습니다.'); const v = dv.getUint32(p, true); p += 4; return v; };
  for (let i = 0; i < count; i++) {
    if (p >= raw.length) throw new Error('패치가 잘렸습니다.');
    const op = raw[p++];
    if (op === 0) {
      const offset = u32(), length = u32();
      if (length === 0 || offset + length > source.length || cursor + length > output.length) throw new Error('패치 복사 범위가 올바르지 않습니다.');
      output.set(source.subarray(offset, offset + length), cursor); cursor += length;
    } else if (op === 1) {
      const length = u32();
      if (length === 0 || p + length > raw.length || cursor + length > output.length) throw new Error('패치 추가 범위가 올바르지 않습니다.');
      output.set(raw.subarray(p, p + length), cursor); p += length; cursor += length;
    } else throw new Error('알 수 없는 패치 명령입니다.');
  }
  if (p !== raw.length || cursor !== output.length || await sha256(output) !== manifest.exe.sha256) throw new Error('완성된 실행 파일 검증에 실패했습니다.');
  return output;
}

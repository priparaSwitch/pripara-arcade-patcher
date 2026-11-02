import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {scanPublicBytes,scanPublicTree} from '../scripts/scan-public.mjs';

// Synthetic values are assembled to keep test source free of complete private formats.
const cases={
  'user-home-path':'Q:'+String.fromCharCode(92)+['Users','sample-user','project'].join(String.fromCharCode(92)),
  'private-ipv4':[192,168,12,34].join('.'),
  'private-device-host':['sample-device','synology','me'].join('.'),
  'service-token':['gh','p_',...Array(36).fill('x')].join(''),
  'private-key-block':['-----BEGIN ','PRIVATE ','KEY-----'].join(''),
  'credential-literal':['password',' = "',...Array(16).fill('x'),'"'].join(''),
};

for(const [rule,value] of Object.entries(cases)){
  test('generic public-data scanner detects '+rule,()=>{
    for(const encoding of ['utf8','utf16le']){
      const findings=scanPublicBytes('synthetic.bin',Buffer.from(value,encoding));
      assert.ok(findings.some(f=>f.rule===rule));
      assert.ok(findings.every(f=>!('value' in f)),'Reports must not print detected values');
    }
  });
}

test('gzip payload content is scanned, not just the compressed bytes',()=>{
  const findings=scanPublicBytes('synthetic.ppd.gz',gzipSync(Buffer.from(cases['service-token'])));
  assert.ok(findings.some(f=>f.rule==='service-token'&&f.contentType==='gzip-content'));
  assert.throws(()=>scanPublicBytes('broken.ppd.gz',Buffer.from('not compressed')));
});

test('public identities, integrity hashes and loopback preview defaults remain allowed',()=>{
  const text=['https://example.github.io/project/','http://127.0.0.1:18092/','a'.repeat(64),'device VID CAFE PID 0002'].join('\n');
  assert.deepEqual(scanPublicBytes('synthetic.txt',Buffer.from(text)),[]);
});

test('actual package allowlist passes generic release checks',async()=>{
  const report=await scanPublicTree();
  assert.equal(report.passed,true);assert.ok(report.files>0);
});

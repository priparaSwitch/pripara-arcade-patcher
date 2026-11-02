import {readdir,readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// Generic release checks only. Do not add real user values or private marker lists.
// Matching known formats cannot prove the absence of every identifier or secret.
const rules = [
  ['user-home-path', /\b[A-Z]:[\\/]+(?:Users|Documents and Settings|home)[\\/]+[^\s<>"']+|\/(?:home|Users)\/[^/\s<>"']+\//gi],
  ['private-ipv4', /(?<![\d.])(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.])/g],
  ['private-device-host', /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.(?:synology\.me|myqnapcloud\.com)\b/gi],
  ['service-token', /\bgh[pousr]_[a-z0-9]{20,}|\bgithub_pat_[a-z0-9_]{20,}/gi],
  ['private-key-block', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ['credential-literal', /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password)\b\s*["']?\s*[:=]\s*["'][a-z0-9_!+\/-]{12,}["']/gi],
];
const packageFiles=['.gitignore','.gitattributes','package.json','public-assets.sha256.json','README.md','THIRD_PARTY_NOTICES.md'];
const packageDirectories=['.github','docs','scripts','tests','web'];

export function scanPublicBytes(label,input) {
  const bytes=Buffer.from(input),views=[['bytes',bytes]];
  if(label.endsWith('.gz'))views.push(['gzip-content',gunzipSync(bytes,{maxOutputLength:8*1024*1024})]);
  const findings=[];
  for(const [contentType,content] of views){
    const texts=[['utf8',content.toString('utf8')],['utf16le',content.toString('utf16le')]];
    for(const [encoding,text] of texts){
      for(const [rule,pattern] of rules){
        pattern.lastIndex=0;
        for(const match of text.matchAll(pattern))findings.push({file:label,contentType,encoding,rule,offset:match.index});
      }
    }
  }
  return findings;
}

export async function scanPublicTree(root=new URL('../',import.meta.url)) {
  const files=[...packageFiles];
  async function walk(relative){
    for(const entry of await readdir(new URL(relative+'/',root),{withFileTypes:true})){
      const path=relative+'/'+entry.name;
      assert.ok(!entry.isSymbolicLink(),`Symlinks are not publishable: ${path}`);
      if(entry.isDirectory())await walk(path);
      else {assert.ok(entry.isFile(),`Not a regular file: ${path}`);files.push(path);}
    }
  }
  for(const directory of packageDirectories)await walk(directory);
  const findings=[];
  for(const file of files.sort())findings.push(...scanPublicBytes(file,await readFile(new URL(file,root))));
  assert.equal(findings.length,0,`Public-data check failed (values omitted): ${JSON.stringify(findings)}`);
  return {passed:true,files:files.length,scope:'Package allowlist and decoded gzip assets; generic format checks only'};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  console.log(JSON.stringify(await scanPublicTree(),null,2));
}

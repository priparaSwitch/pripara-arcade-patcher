import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifySite,listFiles} from '../scripts/verify-site.mjs';
import {loadManifest} from '../web/engine/patch.js';

const site=new URL('../web/',import.meta.url);
test('published files match the complete integrity inventory and active V17 manifest',async()=>{
  const report=await verifySite();
  assert.equal(report.patch,'V17');assert.equal(report.patchBytes,7272);
});

test('all browser module imports, assets and Worker stay inside project subpaths',async()=>{
  const paths=await listFiles(site),known=new Set(paths);
  const references=[['index.html','./app.js'],['index.html','./style.css'],['app.js','./worker.js'],['engine/patch.js','../data/patch-manifest.json'],['engine/vendor/unrar/selected-core.js','./unrar.wasm']];
  for(const path of paths.filter(p=>/\.(?:js|mjs)$/.test(p))){
    const text=await readFile(new URL(path,site),'utf8');
    for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\()(['"])(\.[^'"]+)\1/g))references.push([path,match[2]]);
  }
  const m=JSON.parse(await readFile(new URL('data/patch-manifest.json',site),'utf8'));
  for(const p of Object.values(m.profiles))references.push(['engine/patch.js','../data/'+p.payload.file]);
  for(const base of ['https://example.github.io/pripara-arcade-patcher/','https://example.github.io/','http://127.0.0.1:18092/pripara-arcade-patcher/']){
    const root=new URL(base);
    for(const [source,relative] of references){
      assert.ok(relative.startsWith('.'),`Not relative: ${relative}`);
      const url=new URL(relative,new URL(source,root));
      assert.equal(url.origin,root.origin);assert.ok(url.pathname.startsWith(root.pathname));
      assert.ok(known.has(url.pathname.slice(root.pathname.length)),`Missing bundled resource: ${source} -> ${relative}`);
    }
  }
});

test('manifest downloads are local GET requests that refuse redirects and omit credentials',async()=>{
  const previous=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{
    calls++;assert.equal(new URL(url).href,new URL('data/patch-manifest.json',site).href);
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    assert.equal(options.body,undefined);return new Response(await readFile(url));
  };
  try{assert.equal((await loadManifest()).patchVersion,'V17');assert.equal(calls,1);}
  finally{globalThis.fetch=previous;}
});

test('Pages uploads web only, with checks before deployment and no server or package install',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
  assert.match(workflow,/path: web\s/);assert.match(workflow,/needs: build/);assert.match(workflow,/npm run check/);assert.match(workflow,/npm test/);
  assert.ok(!/npm (?:ci|install)|docker|server\.py/.test(workflow));
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.dependencies,undefined);assert.equal(pkg.devDependencies,undefined);
});

test('pinned RAR engine and licenses are included; no special isolation API is needed',async()=>{
  const wasm=await readFile(new URL('engine/vendor/unrar/unrar.wasm',site));
  assert.equal(createHash('sha256').update(wasm).digest('hex'),'c7d79f869196e3c79c053ba74a8f629116de8293a94f60cc851bbcd7977d0c2b');
  for(const name of ['LICENSE-MIT.txt','LICENSE-UnRAR.txt'])assert.ok((await readFile(new URL('engine/vendor/unrar/'+name,site))).length>100);
  const source=await readFile(new URL('engine/rar-select.js',site),'utf8');
  assert.ok(!/new SharedArrayBuffer|navigator\.storage|createSyncAccessHandle/.test(source));
});

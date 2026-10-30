import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {validateManifest} from '../web/engine/patch.js';

export const root = fileURLToPath(new URL('../',import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inventoryURL = new URL('../public-assets.sha256.json',import.meta.url);
export async function listFiles(directory,relative=''){
  const entries=await readdir(new URL(relative,directory),{withFileTypes:true}),out=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    const path=relative+entry.name;
    assert.ok(!entry.isSymbolicLink(),`Symlinks are not publishable: ${path}`);
    if(entry.isDirectory())out.push(...await listFiles(directory,path+'/'));
    else {assert.ok(entry.isFile(),`Not a regular file: ${path}`);out.push(path);}
  }
  return out.sort();
}
export async function verifySite({write=false}={}){
  const web=new URL('../web/',import.meta.url),paths=await listFiles(web),files=[];
  for(const path of paths){
    assert.ok(!/\.(?:exe|dll|rar|zip|7z|dmp|bmp|pem|key)$/i.test(path),`Not a public patch asset: ${path}`);
    const bytes=await readFile(new URL(path,web));
    assert.ok(bytes.length<=100*1024*1024,`Exceeds normal GitHub Git file limit: ${path}`);
    assert.ok(!bytes.subarray(0,70).toString().startsWith('version https://git-lfs.github.com/spec/v1'),`Git LFS pointer is not a Pages asset: ${path}`);
    files.push({path,size:bytes.length,sha256:digest(bytes)});
  }
  const totalBytes=files.reduce((n,f)=>n+f.size,0);
  assert.ok(totalBytes<1_000_000_000,'Published Pages site must be under 1 GB');
  const manifest=validateManifest(JSON.parse(await readFile(new URL('data/patch-manifest.json',web),'utf8')));
  const requiredData=['patch-manifest.json',manifest.configRulesFile,...Object.values(manifest.profiles).map(p=>p.payload.file)].sort();
  assert.deepEqual(paths.filter(p=>p.startsWith('data/')).map(p=>p.slice(5)).sort(),requiredData,'Only active patch data may be published');
  for(const p of Object.values(manifest.profiles)){
    const file=files.find(f=>f.path==='data/'+p.payload.file);
    assert.equal(file?.size,p.payload.size);assert.equal(file?.sha256,p.payload.sha256);
  }
  const wasm=files.find(f=>f.path==='engine/vendor/unrar/unrar.wasm');
  assert.equal(wasm?.size,207593);assert.equal(wasm?.sha256,'c7d79f869196e3c79c053ba74a8f629116de8293a94f60cc851bbcd7977d0c2b');
  const inventory={schemaVersion:1,project:'pripara-arcade-patcher',applicationVersion:manifest.applicationVersion,patchVersion:manifest.patchVersion,files};
  if(write)await writeFile(inventoryURL,JSON.stringify(inventory,null,2)+'\n');
  const expected=JSON.parse(await readFile(inventoryURL,'utf8'));
  assert.deepEqual(inventory,expected,'Public assets changed; review the change before running npm run manifest');
  const html=await readFile(new URL('index.html',web),'utf8');
  assert.ok(html.includes("connect-src 'self'"),'Document must restrict connections to its own origin');
  assert.ok(paths.includes('.nojekyll'));
  for(const file of files.filter(f=>/\.(js|mjs|html|css)$/.test(f.path)&&!f.path.startsWith('engine/vendor/'))){
    const text=await readFile(new URL(file.path,web),'utf8');
    assert.ok(!/https?:\/\//i.test(text),`Runtime must not depend on an external host: ${file.path}`);
    assert.ok(!/\b(?:XMLHttpRequest|WebSocket|sendBeacon)\b|navigator\.storage|localStorage|indexedDB/.test(text),`Unexpected network/persistent-data API: ${file.path}`);
  }
  const packageJson=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(packageJson.name,'pripara-arcade-patcher');
  assert.equal(packageJson.version,manifest.applicationVersion);
  const summary={passed:true,project:packageJson.name,version:packageJson.version,patch:manifest.patchVersion,publicFiles:files.length,publicBytes:totalBytes,largestAsset:files.reduce((a,b)=>a.size>b.size?a:b),patchBytes:files.filter(f=>f.path.endsWith('.ppd.gz')).reduce((n,f)=>n+f.size,0),targetExeSha256:manifest.exe.sha256};
  return summary;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  console.log(JSON.stringify(await verifySite({write:process.argv.includes('--write')}),null,2));
}

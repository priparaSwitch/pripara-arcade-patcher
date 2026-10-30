import {Sha256} from './hash.js';
import {bytesFile,writeZip} from './zip.js';
import {inspectArchive,extractSelected} from './rar-select.js';
import {applyPrineoDelta,identifySourceProfile} from './apply-prineo-delta.mjs';
import {patchConfigBytes} from './config-patch.mjs';
import {APP_VERSION,PATCH_VERSION,TARGET_EXE_SHA256,QR_READER_DLL_SHA256} from '../release.js';

const enc=new TextEncoder();
export function sha256(bytes){return new Sha256().update(bytes).digest();}
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
export function normalizeOptions(input={}){
  const patchExe=input.patchExe!==false,patchSettings=input.patchSettings!==false;
  if(!patchExe&&!patchSettings)fail('NO_SELECTION','적용할 패치를 하나 이상 선택해 주세요.');
  if(!patchSettings)return {patchExe,patchSettings,installPath:'C:\\prineohk\\game',camera:{profile:'virtual',vid:'CAFE',pid:'0002'}};
  const installPath=String(input.installPath??'C:\\prineohk\\game').trim().replaceAll('/','\\').replace(/\\+$/,'');
  if(!/^[A-Za-z]:\\[^\x00-\x1f,"<>|?*]+$/.test(installPath)||installPath.split('\\').includes('..'))fail('INSTALL_PATH','게임 설치 경로를 C:\\prineohk\\game과 같은 절대 경로로 입력해 주세요.');
  if(patchSettings&&!/^[\x20-\x7e]+$/.test(installPath))fail('INSTALL_PATH','게임 설정에 사용할 폴더는 영문·숫자 경로로 지정해 주세요.');
  return {patchExe,patchSettings,installPath,camera:{profile:'virtual',vid:'CAFE',pid:'0002'}};
}
export function requiredPaths(options,manifest){
  const paths=[];
  if(options.patchExe){paths.push('Prineo.exe');for(const d of manifest.dependencyChecks??[])paths.push(d.path);for(const c of manifest.companionCopies??[])paths.push(c.sourcePath);}
  if(options.patchSettings)paths.push('system_options.txt','camera/QRReader.ini');
  return [...new Set(paths)];
}
export async function loadManifest(){
  const r=await fetch(new URL('../data/patch-manifest.json',import.meta.url),{method:'GET',cache:'no-cache',credentials:'omit',redirect:'error'});
  if(!r.ok)fail('MANIFEST','패치 기준표를 불러오지 못했습니다.');
  const m=await r.json();
  return validateManifest(m);
}
export function validateManifest(m){
  if(m?.schemaVersion!==1||!m.exe||!m.profiles||!Array.isArray(m.targets))fail('MANIFEST','패치 기준표의 형식이 올바르지 않습니다.');
  if(m.applicationVersion!==APP_VERSION||m.patchVersion!==PATCH_VERSION||m.exe.sha256!==TARGET_EXE_SHA256)fail('MANIFEST_VERSION','웹페이지와 패치 데이터의 버전이 다릅니다. 새로고침한 뒤 다시 시도해 주세요.');
  const dependency=m.dependencyChecks?.find(d=>d.path==='QRReader.dll'),target=m.targets.find(t=>t.path==='QRReader.dll');
  if(!dependency||dependency.output!==false||dependency.size!==75496||dependency.sha256!==QR_READER_DLL_SHA256||target?.size!==dependency.size||target?.sha256!==dependency.sha256)fail('MANIFEST_DEPENDENCY','QR 리더의 원본 검증 기준이 올바르지 않습니다.');
  return m;
}
export async function inspectInput(file,input,manifest,{signal,onProgress=()=>{}}={}){
  validateManifest(manifest);
  const options=normalizeOptions(input),paths=requiredPaths(options,manifest),started=performance.now();
  signal?.throwIfAborted();
  const found=await inspectArchive(file,{targetPaths:paths,signal,onProgress});
  const entries=found.entries.filter(e=>paths.includes(e.path));
  for(const path of paths)if(!entries.some(e=>e.path===path))fail('MISSING_FILE',`RAR에서 필요한 파일을 찾지 못했습니다: ${path}`);
  const files=await extractSelected(file,entries,{signal,onProgress});
  const verified=[];let profile=null;
  for(let i=0;i<entries.length;i++){
    const entry=entries[i],bytes=files.get(entry.path);
    signal?.throwIfAborted();
    if(!(bytes instanceof Uint8Array))fail('EXTRACTION',`파일을 추출하지 못했습니다: ${entry.path}`);
    onProgress({stage:'verify',message:`SHA-256 확인: ${entry.path}`,done:i,total:entries.length});
    const hash=sha256(bytes);
    if(entry.path==='Prineo.exe'){
      profile=await identifySourceProfile(bytes,manifest);
      if(!profile)fail('SOURCE_HASH','Prineo.exe가 지원하는 원본과 일치하지 않습니다.');
    }else{
      const expected=manifest.targets.find(t=>t.path===entry.path);
      if(!expected||bytes.length!==expected.size||hash!==expected.sha256)fail('SOURCE_HASH',`원본 SHA-256이 기준과 다릅니다: ${entry.path}`);
    }
    const verificationOnly=(manifest.dependencyChecks??[]).some(d=>d.path===entry.path);
    verified.push({...entry,size:bytes.length,sha256:hash,verified:true,verificationOnly,status:verificationOnly?'일치 · 검증 전용':'일치'});
  }
  const summary={...found.summary,filesChecked:verified.length,archiveSize:file.size,
    targetBytes:verified.reduce((n,e)=>n+e.size,0),packedTargetBytes:verified.reduce((n,e)=>n+(e.packedSize??0),0),
    bytesRead:(found.summary.headerReadBytes??0)+(files.metrics?.readBytes??0),
    extractionReadBytes:files.metrics?.readBytes??0,maxReadBytes:files.metrics?.maxReadBytes??0,
    wasmHeapBytes:files.metrics?.wasmHeapBytes??0,
    elapsedMs:Math.round(performance.now()-started),allSelectedHashesMatched:true,wholeArchiveVerified:false,uploadedBytes:0};
  return {file,options,files,manifest,profile,selectionPaths:paths,
    result:{entries:verified,summary,profileName:profile?.name??null,patchVersion:PATCH_VERSION,state:manifest.state}};
}
function readme(options,report){return enc.encode(`프리파라 아케이드 패치 ${PATCH_VERSION} / 웹 패처 ${APP_VERSION}\r\n\r\n이 ZIP에는 선택한 변경 파일만 있습니다. 전체 게임이 포함된 파일이 아닙니다.\r\n\r\n게임과 QRReader를 완전히 종료한 뒤 ZIP의 game 폴더 안 내용을\r\n게임 설치 폴더(${options.installPath})에 같은 상대 경로로 덮어쓰세요.\r\n원본 RAR은 바뀌지 않습니다. 기존 게임 폴더를 먼저 압축 해제해 두어야 합니다.\r\n\r\n이 패처는 설치, 관리자 권한, 가상 카메라 드라이버를 자동 구성하지 않습니다.\r\nQRReader와 게임은 같은 권한 수준으로 실행해야 합니다.\r\n프리파라 가상카메라 드라이버와 카메라 프로그램이 별도로 필요합니다.\r\n\r\n실행 파일: ${options.patchExe?PATCH_VERSION+' 적용':'변경 안 함'}\r\nQR/경로 설정: ${options.patchSettings?'적용':'변경 안 함'}\r\n카메라: ${options.camera.profile} / VID ${options.camera.vid} / PID ${options.camera.pid}\r\n\r\nV9의 추가구매→파츠 수정→추가 Shop→추가 Print→End는 사용자 확인되었습니다.\r\nV15의 Print 마이티켓 QR 출력과 해당 QR 로그인은 사용자 확인되었습니다.\r\nV17은 마이티켓 출력을 유지하고, 우정티켓도 해당 친구·NPC의 정보로 출력합니다.\r\nEnd의 홍콩 앱용 결과 QR 생략을 유지합니다.\r\nV17 우정티켓의 실제 게임 인식은 아직 확인되지 않았습니다.\r\n원래 시작 스캔·우정티켓 입력 처리와 자기 티켓·중복 제한을 유지합니다.\r\nQRReader.dll은 호환성을 확인하는 검증 전용이며 ZIP에 포함하지 않습니다.\r\n\r\n선택한 ${report.inputs.length}개 원본만 SHA-256으로 확인했습니다.\r\nRAR 전체나 그 외 파일의 손상까지 검사한 결과는 아닙니다.\r\n모든 원본 읽기·패치는 브라우저에서 처리했고 서버로 전송하지 않았습니다.\r\n자세한 파일명과 검사값은 patch-report.json을 확인하세요.\r\n`);}
export async function buildPatch(context,input,{signal,onProgress=()=>{}}={}){
  const options=normalizeOptions(input),manifest=context.manifest,needed=requiredPaths(options,manifest);
  validateManifest(manifest);
  if(needed.some(p=>!context.files.has(p)))fail('RECHECK','선택한 패치가 바뀌었습니다. 원본을 다시 확인해 주세요.');
  const changed=[];const add=(path,bytes)=>changed.push({path:`game/${path}`,size:bytes.length,sha256:sha256(bytes),bytes});
  signal?.throwIfAborted();
  if(options.patchExe){
    for(const dependency of manifest.dependencyChecks){
      const bytes=context.files.get(dependency.path);
      if(!bytes||bytes.length!==dependency.size||sha256(bytes)!==dependency.sha256)fail('SOURCE_HASH',`호환성 확인 파일의 원본 SHA-256이 기준과 다릅니다: ${dependency.path}`);
    }
    onProgress({stage:'patch',message:'실행 파일 차분 적용',done:0,total:1});
    const original=context.files.get('Prineo.exe'),profile=await identifySourceProfile(original,manifest);
    if(!profile?.payload?.file||!/^[A-Za-z0-9_.-]+$/.test(profile.payload.file))fail('PAYLOAD','지원하는 차분 데이터를 찾지 못했습니다.');
    const r=await fetch(new URL(`../data/${profile.payload.file}`,import.meta.url),{method:'GET',credentials:'omit',redirect:'error',signal});
    if(!r.ok)fail('PAYLOAD','차분 데이터를 불러오지 못했습니다.');
    const delta=new Uint8Array(await r.arrayBuffer());
    const patched=await applyPrineoDelta(original,delta,manifest);
    signal?.throwIfAborted();
    if(patched.length!==manifest.exe.size||sha256(patched)!==manifest.exe.sha256)fail('OUTPUT_HASH','완성된 실행 파일의 검사값이 기준과 다릅니다.');
    add('Prineo.exe',patched);
    for(const c of manifest.companionCopies??[]){
      const data=context.files.get(c.sourcePath);
      if(!data||data.length!==c.sourceSize||sha256(data)!==c.sourceSha256)fail('SOURCE_HASH',`로그인 안내 그림의 검사값이 다릅니다: ${c.sourcePath}`);
      add(c.targetPath,data);
    }
  }
  if(options.patchSettings)for(const path of ['system_options.txt','camera/QRReader.ini']){
    signal?.throwIfAborted();
    add(path,patchConfigBytes(context.files.get(path),path,options));
  }
  const report={application:'pripara-arcade-patcher',version:APP_VERSION,patchVersion:PATCH_VERSION,createdAt:new Date().toISOString(),
    processing:'browser-local',uploadedBytes:0,wholeArchiveVerified:false,sourceArchive:{name:context.file.name,size:context.file.size},
    selectedOptions:options,inspection:context.result.summary,inputs:context.result.entries.map(({path,size,sha256,verificationOnly})=>({path,size,sha256,verificationOnly})),
    outputs:changed.map(({path,size,sha256})=>({path,size,sha256})),state:manifest.state,
    verification:'Selected input files SHA-256 verified before patching; delta and final executable SHA-256 checked. Other archive files were not verified.'};
  const files=changed.map(f=>bytesFile(f.path,f.bytes));
  files.push(bytesFile('사용방법.txt',readme(options,report)),bytesFile('patch-report.json',enc.encode(JSON.stringify(report,null,2))));
  const chunks=[];
  await writeZip(files,{write:async bytes=>chunks.push(bytes)},{signal,onProgress:p=>onProgress({stage:'zip',message:'변경 파일 ZIP 만들기',done:p.done??0,total:p.total??0})});
  return {blob:new Blob(chunks,{type:'application/zip'}),filename:`PriPara_Arcade_${PATCH_VERSION}_Patch.zip`,report,
    changedFiles:report.outputs};
}

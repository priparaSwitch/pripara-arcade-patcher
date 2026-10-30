import {loadManifest,inspectInput,buildPatch,normalizeOptions} from './engine/patch.js';
let cached=null,active=null,manifestPromise=null;
const manifest=()=>manifestPromise??=(loadManifest().catch(e=>{manifestPromise=null;throw e;}));
self.onmessage=async event=>{
  const {type,requestId,file,options}=event.data??{};
  if(type==='cancel'||type==='clear'){
    active?.abort();cached=null;
    self.postMessage({type:'cleared',requestId});return;
  }
  if(active){self.postMessage({type:'error',requestId,code:'BUSY',message:'현재 작업이 끝난 뒤 다시 시도해 주세요.'});return;}
  const ctl=new AbortController();active=ctl;
  const progress=data=>self.postMessage({type:'progress',requestId,...data});
  try{
    if(type==='init'){const m=await manifest();self.postMessage({type:'ready',requestId,version:m.patchVersion,state:m.state});}
    else if(type==='inspect'){
      cached=null;
      cached=await inspectInput(file,options,await manifest(),{signal:ctl.signal,onProgress:progress});
      self.postMessage({type:'inspected',requestId,result:cached.result});
    }else if(type==='build'){
      normalizeOptions(options);
      if(!cached)throw Object.assign(new Error('먼저 선택한 RAR의 원본을 확인해 주세요.'),{code:'RECHECK'});
      if(file&&(file.name!==cached.file.name||file.size!==cached.file.size||file.lastModified!==cached.file.lastModified))throw Object.assign(new Error('선택한 원본이 바뀌었습니다. 다시 확인해 주세요.'),{code:'RECHECK'});
      const result=await buildPatch(cached,options,{signal:ctl.signal,onProgress:progress});
      self.postMessage({type:'complete',requestId,...result});
    }else throw new Error('지원하지 않는 작업입니다.');
  }catch(e){
    if(type==='inspect')cached=null;
    self.postMessage({type:'error',requestId,code:e.name==='AbortError'?'CANCELLED':e.code??'PATCH_ERROR',message:e.name==='AbortError'?'작업을 취소했습니다.':e.message??'작업 중 오류가 발생했습니다.'});
  }finally{if(active===ctl)active=null;}
};

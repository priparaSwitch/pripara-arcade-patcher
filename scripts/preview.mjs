// Fixed loopback port. This server only serves the public site and accepts GET/HEAD.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';

export const PREVIEW_PORT=18092;
export const PROJECT_PATH='/pripara-arcade-patcher/';
const web=fileURLToPath(new URL('../web/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.gz':'application/gzip','.txt':'text/plain; charset=utf-8'};
export function previewServer(){
  return createServer(async(req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/'||url.pathname===PROJECT_PATH.slice(0,-1)){res.writeHead(302,{'Location':PROJECT_PATH});res.end();return;}
    if(!url.pathname.startsWith(PROJECT_PATH)){res.writeHead(404);res.end();return;}
    let relative;
    try{relative=decodeURIComponent(url.pathname.slice(PROJECT_PATH.length));}catch{res.writeHead(400);res.end();return;}
    if(relative.includes('\\')||relative.includes('\0')||relative.split('/').some(p=>p==='..'||p==='.')||relative.startsWith('/')){res.writeHead(404);res.end();return;}
    const target=resolve(web,relative||'index.html');
    if(!target.startsWith(web)){res.writeHead(404);res.end();return;}
    try{
      const info=await stat(target);if(!info.isFile())throw new Error('Not a file');
      const bytes=await readFile(target);
      // Deliberately no special isolation or server CSP headers: the Pages site
      // must work with normal static hosting and its document-level CSP alone.
      res.writeHead(200,{'Content-Type':types[extname(target)]??'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      res.end(req.method==='HEAD'?undefined:bytes);
    }catch{res.writeHead(404);res.end();}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  const server=previewServer();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Port 18092 is already in use. Stop the previous preview; this preview never changes ports.':error.message);process.exitCode=1;});
  server.listen(PREVIEW_PORT,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${PREVIEW_PORT}${PROJECT_PATH}`));
}

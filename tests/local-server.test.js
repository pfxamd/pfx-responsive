import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createLocalAppServer } from '../src/local-server.js';

const credential = 'preview-core-test-token-long-enough-123';
const mockId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
async function mockCore(callback) {
  const server = createServer((req, res) => {
    if (req.url === '/health') { res.setHeader('content-type', 'application/json'); return res.end('{"status":"ok"}'); }
    if (req.headers.authorization !== `Bearer ${credential}`) { res.writeHead(401); return res.end('unauthorized'); }
    const json = (code, value) => { res.writeHead(code, {'content-type':'application/json'});res.end(JSON.stringify(value)); };
    if (req.url.includes('00000000-0000-0000-0000-000000000000')) return json(404,{ error: 'Session not found' });
    if (req.url === '/sessions' && req.method === 'POST') return json(201,{id:mockId, url:'https://example.com/',viewport:{width:390,height:844}});
    if(req.method==='DELETE') return json(200,{closed:true});
    if(req.url.endsWith('/resize'))return json(200,{viewport:{width:500,height:700}});
    if(req.url.endsWith('/navigate'))return json(200,{url:'https://example.com/next'});
    if(req.url.endsWith('/input'))return json(200,{accepted:true});
    if(req.url.endsWith('/screenshot')) { res.writeHead(200,{'content-type':'image/png'});return res.end(Buffer.from([137,80,78,71])); }
    if(req.url.endsWith('/stream')) {res.writeHead(200,{'content-type':'text/event-stream'});return res.end('event: frame\ndata: {"mime":"image/jpeg","data":"Zm9v","metadata":{}}\n\n');}
    return json(404,{error:'Not found'});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await callback(`http://127.0.0.1:${server.address().port}`);}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
async function withApp(args, callback){
  const app=createLocalAppServer({...args,port:0});
  const origin=await app.listen();
  try{await callback(origin);}finally{await app.close();}
}
async function api(origin, path, {key,method='GET',json,headers={}}={}){
  return fetch(`${origin}/api${path}`,{method,headers:{'x-pfx-app':'1',...(key?{'x-pfx-workspace':key}:{}),...(json?{'content-type':'application/json'}:{}),...headers},...(json?{body:JSON.stringify(json)}:{})});
}
async function boot(origin){return (await (await api(origin,'/bootstrap')).json()).workspaceKey;}

test('local gateway binds to loopback, serves UI securely and rejects invalid host/CSRF',async()=>{
  assert.throws(()=>createLocalAppServer({host:'0.0.0.0',port:4188}),/loopback/);
  await withApp({token:credential},async origin=>{
    const page=await fetch(origin); assert.equal(page.status,200);
    assert.match(page.headers.get('content-security-policy'),/default-src 'none'/);
    assert.equal(page.headers.get('referrer-policy'),'same-origin');
    const text=await page.text();assert.match(text,/PFx Responsive/);
    const forbidden=await fetch(`${origin}/api/bootstrap`);assert.equal(forbidden.status,403);
    const hostile=await api(origin,'/bootstrap',{headers:{origin:'https://evil.example'}});assert.equal(hostile.status,403);
    const rebound = await new Promise((resolve,reject)=>{const request=httpRequest(origin,{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});request.on('error',reject);request.end();});assert.equal(rebound,403);
    const key=await boot(origin);
    const s=await api(origin,'/status',{key});assert.deepEqual(await s.json(),{state:'offline'});
  });
});

test('same-origin browser POST is accepted, opaque/null origins remain blocked', async () => {
  await mockCore(async coreURL => {
    await withApp({token:credential,coreURL},async origin => {
      const key=await boot(origin);
      const request={key,method:'POST',json:{url:'https://example.com/'}};
      const legitimate=await api(origin,'/sessions',{
        ...request,headers:{origin,'sec-fetch-site':'same-origin'}
      });
      assert.equal(legitimate.status,201);
      const opaque=await api(origin,'/sessions',{
        ...request,headers:{origin:'null','sec-fetch-site':'same-origin'}
      });
      assert.equal(opaque.status,403);
      const foreign=await api(origin,'/sessions',{
        ...request,headers:{origin:'http://127.0.0.1:9999','sec-fetch-site':'same-site'}
      });
      assert.equal(foreign.status,403);
      await api(origin,`/sessions/${mockId}`,{key,method:'DELETE'});
    });
  });
});

test('missing Core token is reported as disconnected rather than a fabricated page',async()=>{
 await withApp({token:undefined},async origin=>{
   const key=await boot(origin);
   assert.deepEqual(await (await api(origin,'/status',{key})).json(),{state:'unconfigured'});
   const result=await api(origin,'/sessions',{key,method:'POST',json:{url:'https://example.com/'}});
   assert.equal(result.status,503);
 });
});

test('Core credential remains server-side and cross-workspace sessions are isolated',async()=>{
 await mockCore(async coreURL=>{
  await withApp({token:credential,coreURL},async origin=>{
   const a=await boot(origin),b=await boot(origin);
   assert.equal((await(await api(origin,'/status',{key:a})).json()).state,'online');
   const result=await api(origin,'/sessions',{key:a,method:'POST',json:{url:'https://example.com/',width:390,height:844}});
   assert.equal(result.status,201);
   const created=await result.json();assert.equal(created.id,mockId);
   assert.equal(result.headers.get('access-control-allow-origin'),null);
   for (const path of [`/sessions/${mockId}/screenshot`,`/sessions/${mockId}/stream`]) {
     assert.equal((await api(origin,path,{key:b})).status,404);
   }
   assert.equal((await api(origin,`/sessions/${mockId}/resize`,{key:b,method:'POST',json:{width:500,height:700}})).status,404);
   assert.equal((await api(origin,`/sessions/${mockId}`,{key:b,method:'DELETE'})).status,404);
   const img=await api(origin,`/sessions/${mockId}/screenshot`,{key:a});
   assert.deepEqual([...new Uint8Array(await img.arrayBuffer())],[137,80,78,71]);
   const stream=await api(origin,`/sessions/${mockId}/stream`,{key:a});
   assert.match(await stream.text(),/event: frame/);
   assert.equal((await api(origin,`/sessions/${mockId}`,{key:a,method:'DELETE'})).status,200);
   assert.equal((await api(origin,`/sessions/${mockId}/screenshot`,{key:a})).status,404);
  });
 });
});

test('workspace close invalidates sessions without leaking the Core token to the UI',async()=>{
 await mockCore(async coreURL=>{
  await withApp({token:credential,coreURL},async origin=>{
   const key=await boot(origin);
   await api(origin,'/sessions',{key,method:'POST',json:{url:'https://example.com/'}});
   assert.equal((await api(origin,'/workspace/close',{key,method:'POST',json:{}})).status,200);
   assert.equal((await api(origin,'/status',{key})).status,401);
  });
 });
});

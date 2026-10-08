import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGatewayClient } from '../src/browser-client.js';
const key='local-secret';
const response=(body,status=200,type='application/json')=>new Response(body,{status,headers:{'content-type':type}});
test('browser local client authenticates using ephemeral workspace header, not URL or Core token',async()=>{
 const seen=[];
 const client=new LocalGatewayClient({fetchImpl:async(url,opts)=>{
   seen.push([url,opts]);
   if(url.includes('bootstrap'))return response(JSON.stringify({workspaceKey:key}));
   if(url.includes('sessions'))return response(JSON.stringify({id:'session'}),201);
   return response(JSON.stringify({state:'online'}));
 }});
 await client.bootstrap();await client.status();await client.create({url:'https://example.com'});
 assert.equal(seen.length,3);
 assert.ok(seen.every(([url,opts])=>url.startsWith('/api/')&&!url.includes(key)&&opts.headers['x-pfx-app']==='1'&&opts.redirect==='error'));
 assert.equal(seen[2][1].headers['x-pfx-workspace'],key);
});
test('browser stream reads valid event and rejects malformed/oversized frames',async()=>{
 const make=(content)=>new LocalGatewayClient({fetchImpl:async()=>response(content,200,'text/event-stream')});
 const a=make('event: frame\ndata: {"mime":"image/jpeg","data":"Zm9v"}\n\n');
 const frames=[];for await(const f of a.stream('x'))frames.push(f);
 assert.deepEqual(frames,[{mime:'image/jpeg',data:'Zm9v'}]);
 const b=make('event: frame\ndata: invalid\n\n');
 await assert.rejects(async()=>{for await(const _ of b.stream('x')){}},/Invalid stream JSON/);
 const c=make('event: error\ndata: {"error":"Core unavailable"}\n\n');
 await assert.rejects(async()=>{for await(const _ of c.stream('x')){}},/Core unavailable/);
});

test('default browser fetch retains the global receiver required by Chromium', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = function (_url, _options) {
    assert.equal(this, globalThis);
    return Promise.resolve(response(JSON.stringify({ workspaceKey: 'browser-key' })));
  };
  try {
    const client = new LocalGatewayClient();
    const value = await client.bootstrap();
    assert.equal(value.workspaceKey, 'browser-key');
  } finally { globalThis.fetch = saved; }
});

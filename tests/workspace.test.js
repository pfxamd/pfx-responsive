import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewWorkspace } from '../src/workspace.js';

const pending = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fakeClient() {
  let next = 0;
  const events = [];
  const client = {
    events,
    async create(options) { const id = `remote-${++next}`; events.push(['create',id]); return { id, url: options.url, viewport: {width:options.width,height:options.height} }; },
    async resize(id, v) { events.push(['resize',id]); return { viewport:v }; },
    async navigate(id,url) { events.push(['navigate',id]); return {url}; },
    async input(id,event) { events.push(['input',id]); return {accepted:true}; },
    async screenshot(id) { events.push(['screenshot',id]); return new Uint8Array([137,80,78,71]); },
    async *stream(id, {signal}) { events.push(['stream',id]); if (!signal.aborted) yield {mime:'image/jpeg',data:'YWJj',metadata:{}}; },
    async close(id) { events.push(['close',id]); return {closed:true}; }
  };
  return client;
}

test('independent viewport entries are bounded and emit immutable snapshots', async () => {
  const client=fakeClient(), workspace=new PreviewWorkspace({client,maxViews:2}), snapshots=[];
  workspace.subscribe(v=>snapshots.push(v));
  const a=workspace.add({url:'https://example.com/',width:390,height:844});
  const b=workspace.add({url:'https://www.mozilla.org/',width:1280,height:800});
  assert.throws(()=>workspace.add({url:'https://web.dev/'}),/capacity/);
  await tick();
  assert.equal(workspace.views.length,2);
  assert.ok(workspace.views.every(x=>x.status==='ready'));
  assert.ok(Object.isFrozen(workspace.views[0]));
  assert.equal(workspace.views[0].viewport.width,390);
  await workspace.resize(a,{width:768,height:1024});
  assert.equal(workspace.views.find(x=>x.id===b).viewport.width,1280);
  assert.equal(workspace.views.find(x=>x.id===a).viewport.width,768);
  await workspace.dispose();
  assert.equal(workspace.views.length,0);
  assert.equal(client.events.filter(x=>x[0]==='close').length,2);
  assert.ok(snapshots.length>=5);
});

test('close during pending creation disposes late remote session', async () => {
  const client=fakeClient(), wait=pending();
  client.create=()=>wait.promise;
  const workspace=new PreviewWorkspace({client});
  const view=workspace.add({url:'https://example.com/'});
  const closing=workspace.close(view);
  await tick();
  wait.resolve({id:'remote-late',url:'https://example.com/',viewport:{width:390,height:844}});
  await closing;
  assert.deepEqual(client.events.filter(x=>x[0]==='close'),[['close','remote-late']]);
  assert.deepEqual(workspace.views,[]);
});

test('queued navigation cannot run after close and cleanup waits for active operations', async () => {
  const client=fakeClient(), wait=pending();
  const workspace=new PreviewWorkspace({client});
  const id=workspace.add({url:'https://example.com/'});
  await tick();
  client.resize=async ()=>wait.promise;
  const resizing=workspace.resize(id,{width:640,height:900});
  const navigate=workspace.navigate(id,'https://web.dev/');
  await tick();
  const closing=workspace.close(id);
  wait.resolve({viewport:{width:640,height:900}});
  await assert.rejects(resizing,/closing/);
  await assert.rejects(navigate,/closing/);
  await closing;
  assert.equal(client.events.some(x=>x[0]==='navigate'),false);
  assert.equal(client.events.filter(x=>x[0]==='close').length,1);
});

test('creation failure is observable and can be removed without leaking capacity', async () => {
  const client=fakeClient();
  client.create=async ()=>{throw new Error('blocked by Core');};
  const workspace=new PreviewWorkspace({client,maxViews:1});
  const id=workspace.add({url:'https://example.com/'});
  await tick();
  assert.equal(workspace.views[0].status,'error');
  assert.match(workspace.views[0].error,/blocked/);
  assert.throws(()=>workspace.add({url:'https://example.com/'}),/capacity/);
  await workspace.close(id);
  assert.equal(workspace.views.length,0);
});

test('stream delivers frames, protects duplicate connection and stops on dispose', async () => {
  const client=fakeClient(), wait=pending();
  client.stream=async function*(_id,{signal}) { yield {mime:'image/jpeg',data:'YWJj',metadata:{}}; await wait.promise; if(!signal.aborted) yield {data:'unexpected'}; };
  const workspace=new PreviewWorkspace({client});
  const id=workspace.add({url:'https://example.com/'});
  await tick();
  const received=[];
  const stream=workspace.startStream(id,frame=>received.push(frame));
  assert.throws(()=>workspace.startStream(id,()=>{}),/already active/);
  await tick();
  assert.equal(received.length,1);
  const closing=workspace.close(id);
  wait.resolve();
  await closing;
  await stream;
  assert.equal(received.length,1);
  assert.equal(workspace.views.length,0);
});

test('dispose pending create and forbid further work', async ()=>{
  const client=fakeClient(), wait=pending();
  client.create=()=>wait.promise;
  const workspace=new PreviewWorkspace({client});
  workspace.add({url:'https://example.com/'});
  const disposed=workspace.dispose();
  wait.resolve({id:'late',url:'https://example.com/',viewport:{width:390,height:844}});
  await disposed;
  assert.throws(()=>workspace.add({url:'https://example.com/'}),/disposed/);
  assert.equal(client.events.filter(x=>x[0]==='close').length,1);
});


test('successful live frames clear previous stream errors after a connection recovery', async () => {
  const client=fakeClient();
  let attempts=0;
  client.stream=async function*() {
    if(++attempts===1) throw new Error('Network interrupted');
    yield {mime:'image/jpeg',data:'YWJj',metadata:{}};
  };
  const workspace=new PreviewWorkspace({client});
  const id=workspace.add({url:'https://example.com/'});
  await tick();
  await workspace.startStream(id,()=>{});
  assert.match(workspace.views[0].error,/Network interrupted/);
  const frames=[];
  await workspace.startStream(id,frame=>frames.push(frame));
  assert.equal(workspace.views[0].error,null);
  assert.equal(frames.length,1);
  await workspace.dispose();
});

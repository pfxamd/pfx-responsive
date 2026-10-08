import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamSupervisor } from '../src/stream-supervisor.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const timers = new Map();
  let nextTimer = 0;
  let openCalls = 0;
  let closeCalls = 0;
  const pending = [];
  const view = { id: 'a', status: 'ready' };
  const workspace = {
    views: [view],
    startStream(id, emit) {
      openCalls++;
      return new Promise(resolve => pending.push({ id, emit, resolve }));
    },
    async stopStream(id) { closeCalls++; pending.findLast(p => p.id === id)?.resolve(); }
  };
  const supervisor = new StreamSupervisor({ workspace, minDelayMs: 100,
    schedule: (cb, delay) => { const id = ++nextTimer; timers.set(id, {cb,delay}); return id; },
    unschedule: id => timers.delete(id), maxFailures: 3 });
  const fire = async () => { const [id, entry] = timers.entries().next().value; timers.delete(id); entry.cb(); await tick(); return entry.delay; };
  return { supervisor, workspace, timers, pending, view, fire,
    get opens() { return openCalls; }, get closes() { return closeCalls; } };
}

test('normal stream budget exhaustion reconnects and keeps the last frame', async () => {
  const f = fixture(), states = [], frames=[];
  f.supervisor.watch('a', {onFrame: frame => frames.push(frame), onState: state => states.push(state)});
  assert.equal(f.opens, 1);
  f.pending[0].emit({data:'real-JPEG'});
  f.pending[0].resolve();
  await tick();
  assert.deepEqual(frames, [{data:'real-JPEG'}]);
  assert.deepEqual(states.slice(0,3),['connecting','live','retrying']);
  assert.equal(f.timers.size,1);
  assert.equal(await f.fire(),100);
  assert.equal(f.opens,2);
  assert.equal(f.supervisor.has('a'),true);
  await f.supervisor.stop('a');
  assert.equal(f.timers.size,0);
});

test('repeated zero-frame failures back off and pause rather than flooding Core', async () => {
  const f=fixture(), states=[];
  f.supervisor.watch('a',{onFrame:()=>{},onState:(state,message)=>states.push([state,message])});
  f.pending[0].resolve();
  await tick();
  assert.equal(await f.fire(),100);
  f.pending[1].resolve();
  await tick();
  assert.equal(await f.fire(),200);
  f.pending[2].resolve();
  await tick();
  assert.equal(f.timers.size,0);
  assert.equal(f.opens,3);
  assert.equal(states.at(-1)[0],'paused');
  await f.supervisor.stop('a');
});

test('view removed while recovering never reconnects', async () => {
  const f=fixture();
  f.supervisor.watch('a',{onFrame:()=>{},onState:()=>{}});
  f.pending[0].resolve();
  await tick();
  f.workspace.views=[];
  await f.fire();
  assert.equal(f.opens,1);
  await tick();
  assert.equal(f.supervisor.has('a'),false);
  assert.equal(f.timers.size,0);
});

test('stopping a viewport cancels queued reconnects without affecting another view', async () => {
  const f=fixture();
  f.workspace.views.push({id:'b',status:'ready'});
  f.supervisor.watch('a',{onFrame:()=>{},onState:()=>{}});
  f.supervisor.watch('b',{onFrame:()=>{},onState:()=>{}});
  f.pending[0].resolve();
  await tick();
  assert.equal(f.timers.size,1);
  await f.supervisor.stop('a');
  assert.equal(f.timers.size,0);
  assert.equal(f.supervisor.has('b'),true);
  assert.equal(f.opens,2);
  await f.supervisor.dispose();
  assert.equal(f.supervisor.has('b'),false);
});

test('cannot duplicate watches or start after disposal; invalid recovery limits rejected', async () => {
  const f=fixture();
  assert.throws(()=>new StreamSupervisor({workspace:f.workspace,minDelayMs:0}),/Invalid/);
  f.supervisor.watch('a',{onFrame:()=>{},onState:()=>{}});
  assert.throws(()=>f.supervisor.watch('a',{onFrame:()=>{},onState:()=>{}}),/already watched/);
  await f.supervisor.dispose();
  assert.throws(()=>f.supervisor.watch('a',{onFrame:()=>{},onState:()=>{}}),/disposed/);
});

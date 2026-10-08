import { LocalGatewayClient } from '/browser-client.js';
import { PreviewWorkspace } from '/workspace.js';
import { StreamSupervisor } from '/stream-supervisor.js';

const icons = {
  'refresh-cw':'<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  'rotate-cw':'<path d="M20 11a8 8 0 1 0-2.4 5.7"/><path d="M20 4v7h-7"/>',
  'sun':'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.1-7.1-1.4 1.4M6.3 17.7l-1.4 1.4M19.1 19.1l-1.4-1.4M6.3 6.3 4.9 4.9"/>',
  'moon':'<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
  'globe':'<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  'x':'<path d="M18 6 6 18M6 6l12 12"/>',
  'plus':'<path d="M12 5v14M5 12h14"/>',
  'arrow-up-right':'<path d="M7 17 17 7M8 7h9v9"/>',
  'arrow-right':'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  'smartphone':'<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  'tablet':'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>',
  'monitor':'<rect x="2" y="3" width="20" height="15" rx="2"/><path d="M8 22h8m-4-4v4"/>',
  'shield-check':'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  'sliders-horizontal':'<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  'mouse-pointer-2':'<path d="m5 3 14 9-7 1-3 7-4-17Z"/>',
  'download':'<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  'corner-down-left':'<path d="M9 10 4 15l5 5M4 15h11a5 5 0 0 0 5-5V4"/>',
  'alert-circle':'<circle cx="12" cy="12" r="10"/><path d="M12 8v5m0 3h.01"/>',
  'loader-circle':'<path d="M12 2a10 10 0 1 1-10 10"/>',
  'check':'<path d="m5 12 4 4L19 6"/>',
  'mouse':'<rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 6v4"/>'
};
function icon(name) {
  const box = document.createElement('span');
  box.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? ''}</svg>`;
  return box.firstElementChild;
}
for (const node of document.querySelectorAll('[data-icon]')) node.replaceChildren(icon(node.dataset.icon));
const $ = id => document.getElementById(id);
const client = new LocalGatewayClient();
const workspace = new PreviewWorkspace({ client, maxViews: 4 });
const streams = new StreamSupervisor({ workspace });
const presets = { mobile:{label:'Mobile',width:390,height:844,icon:'smartphone'},
  tablet:{label:'Tablet',width:768,height:1024,icon:'tablet'},
  desktop:{label:'Desktop',width:1440,height:900,icon:'monitor'} };
const cardMap = new Map();
const screenImages = new Map();
const streamStates = new Map();
const labels = new Map();
let selected = null;
let online = false;
let configured = false;
let toastTimeout = 0;

function showMessage(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 4200);
}
function normalizeURL(raw) {
  const input = raw.trim();
  if (!input) throw new Error('Enter a website URL');
  let parsed;
  try { parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); }
  catch { throw new Error('Enter a valid website address'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Only public HTTP(S) websites are supported');
  return parsed.toString();
}
function makeButton(label, iconName, cb) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'card-icon-button';
  button.title = label; button.setAttribute('aria-label', label);
  button.append(icon(iconName)); button.addEventListener('click', event => { event.stopPropagation(); cb(); });
  return button;
}
function currentView() { return workspace.views.find(v => v.id === selected); }
function getLabel(id) { return labels.get(id)?.label ?? 'Custom'; }
function selectedDetails() {
  const view = currentView();
  $('inspectorContent').hidden = !view;
  $('inspectorEmpty').hidden = !!view;
  if (!view) return;
  $('selectedLabel').textContent = getLabel(view.id);
  $('selectedStatus').textContent = view.status.toUpperCase();
  if (document.activeElement !== $('widthInput')) $('widthInput').value = view.viewport.width;
  if (document.activeElement !== $('heightInput')) $('heightInput').value = view.viewport.height;
  $('applyDimensions').disabled = view.status !== 'ready';
  $('typeInput').disabled = view.status !== 'ready';
  $('captureButton').disabled = view.status !== 'ready';
  $('refreshButton').disabled = view.status !== 'ready';
}
function selectView(id) {
  selected = id;
  for (const [key, card] of cardMap) card.classList.toggle('selected', key === selected);
  for (const li of $('activeViews').querySelectorAll('.view-item')) li.classList.toggle('selected', li.dataset.id === selected);
  selectedDetails();
}
function savePng(data, filename) {
  const blob = new Blob([data], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
async function capture(view) {
  if (!view || view.status !== 'ready') return;
  try {
    const data = await workspace.screenshot(view.id);
    savePng(data, `PFx-${getLabel(view.id).toLowerCase()}-${view.viewport.width}x${view.viewport.height}.png`);
    showMessage('PNG captured from the live preview');
  } catch (e) { showMessage(e.message); }
}
async function reload(view) {
  if (!view || view.status !== 'ready') return;
  try { await workspace.navigate(view.id, view.url); }
  catch (e) { showMessage(e.message); }
}
async function remove(id) {
  try { await workspace.close(id); }
  catch(e) { showMessage(e.message); }
}
function createCard(view) {
  const card = document.createElement('article');
  card.className = 'preview-card'; card.dataset.id = view.id;
  card.setAttribute('aria-label', `${getLabel(view.id)} responsive preview`);
  const top = document.createElement('div'); top.className = 'preview-top';
  const deviceIcon = document.createElement('span'); deviceIcon.className = 'preview-device-icon';
  deviceIcon.append(icon(labels.get(view.id)?.icon ?? 'monitor'));
  const text = document.createElement('div'); text.className = 'preview-top-text';
  const title = document.createElement('strong'); title.textContent = getLabel(view.id);
  const dims = document.createElement('small'); dims.dataset.field = 'dimensions'; text.append(title,dims);
  top.append(deviceIcon,text);
  top.append(makeButton('Download PNG', 'download', () => capture(workspace.views.find(v=>v.id===view.id))));
  top.append(makeButton('Reload viewport', 'rotate-cw', () => reload(workspace.views.find(v=>v.id===view.id))));
  top.append(makeButton('Close viewport', 'x', () => remove(view.id)));
  const body = document.createElement('div'); body.className = 'preview-body';
  const screen = document.createElement('div'); screen.className = 'device-screen';
  screen.tabIndex = 0;
  screen.setAttribute('role', 'application');
  screen.setAttribute('aria-label', `${getLabel(view.id)} preview. Click, scroll, or type using the keyboard to interact.`);
  const image = document.createElement('img'); image.alt = 'Live website viewport'; image.draggable = false;
  image.hidden = true;
  const placeholder = document.createElement('div'); placeholder.className = 'screen-placeholder';
  placeholder.append(icon('loader-circle'));
  const caption = document.createElement('span'); caption.textContent='Waiting for Core'; placeholder.append(caption);
  image.addEventListener('error', () => { image.hidden = true; placeholder.hidden = false; caption.textContent = 'Unable to decode browser frame'; });
  screen.append(image,placeholder); body.append(screen);
  screenImages.set(view.id, { image, placeholder, caption, screen });
  screen.addEventListener('pointerdown',()=>selectView(view.id));
  screen.addEventListener('click', async event => {
    const v = workspace.views.find(x=>x.id===view.id);
    if (!v || v.status !== 'ready') return;
    const bounds = screen.getBoundingClientRect();
    const x = Math.round((event.clientX - bounds.left) * v.viewport.width / bounds.width);
    const y = Math.round((event.clientY - bounds.top) * v.viewport.height / bounds.height);
    try { await workspace.input(v.id, {kind:'click', x, y}); } catch(e) { showMessage(e.message); }
    screen.focus();
  });
  screen.addEventListener('wheel', event => {
    const v = workspace.views.find(x=>x.id===view.id);
    if (!v || v.status !== 'ready') return;
    event.preventDefault();
    if (screen.pendingWheel) return;
    screen.pendingWheel = true;
    const deltaX=Math.max(-1000,Math.min(1000,event.deltaX));
    const deltaY=Math.max(-1000,Math.min(1000,event.deltaY));
    requestAnimationFrame(async () => {
      screen.pendingWheel = false;
      try { await workspace.input(v.id,{ kind:'scroll',deltaX,deltaY }); } catch {}
    });
  }, { passive:false });
  screen.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.key==='Tab') return;
    const v=workspace.views.find(x=>x.id===view.id);
    if (!v || v.status !== 'ready') return;
    event.preventDefault();
    void workspace.input(v.id, { kind:'key', key:event.key }).catch(e=>showMessage(e.message));
  });
  const bottom=document.createElement('div'); bottom.className='preview-bottom';
  const dot=document.createElement('i'); dot.className='dot'; dot.dataset.field='dot';
  const status=document.createElement('span'); status.dataset.field='status';
  const url=document.createElement('span'); url.className='preview-url'; url.dataset.field='url';
  bottom.append(dot,status,url);
  card.append(top,body,bottom);
  card.addEventListener('click',()=>selectView(view.id));
  const observer=new ResizeObserver(()=>fitCard(view.id));
  observer.observe(body);
  cardMap.set(view.id,card);
  card.resizeObserver=observer;
  return card;
}
function fitCard(id) {
  const view=workspace.views.find(v=>v.id===id), card=cardMap.get(id), source=screenImages.get(id);
  if(!view || !card || !source)return;
  const body=card.querySelector('.preview-body');
  const maxW=Math.max(100,body.clientWidth-26), maxH=Math.max(140,body.clientHeight-26);
  const ratio=Math.min(maxW/view.viewport.width,maxH/view.viewport.height,1);
  source.screen.style.width=`${Math.max(30,Math.floor(view.viewport.width*ratio))}px`;
  source.screen.style.height=`${Math.max(30,Math.floor(view.viewport.height*ratio))}px`;
}
function liveLabel(id) {
  return ({connecting:'CONNECTING',live:'LIVE',retrying:'RECONNECTING',paused:'PAUSED'})[streamStates.get(id)] || 'WAITING';
}
function updateStreamBadge(id) {
  const card=cardMap.get(id), view=workspace.views.find(v=>v.id===id);
  if(!card || view?.status!=='ready')return;
  const state=streamStates.get(id);
  card.querySelector('[data-field=status]').textContent=liveLabel(id);
  card.querySelector('[data-field=dot]').className=`dot ${state==='live'?'ready':state==='paused'?'error':'creating'}`;
  const source=screenImages.get(id);
  if(source?.image.hidden){
    source.caption.textContent=state==='paused'?'Stream unavailable — close and reopen':
      state==='retrying'?'Reconnecting live preview':state==='connecting'?'Connecting live stream':'Waiting for live frames';
    source.placeholder.classList.toggle('is-error',state==='paused');
  }
}
function startStream(view) {
  if(streams.has(view.id) || !online)return;
  try {
    streams.watch(view.id, {
      onFrame(frame) {
        const source=screenImages.get(view.id);
        if(!source || !cardMap.has(view.id))return;
        source.image.src=`data:image/jpeg;base64,${frame.data}`;
        source.image.hidden=false;
        source.placeholder.hidden=true;
      },
      onState(state) { streamStates.set(view.id,state); updateStreamBadge(view.id); }
    });
  } catch(e) { showMessage(e.message); }
}
function render(views) {
  const ids=new Set(views.map(v=>v.id));
  for(const [id,card] of cardMap){
    if(!ids.has(id)){
      card.resizeObserver.disconnect(); card.remove(); cardMap.delete(id);
      void streams.stop(id);
      screenImages.delete(id); streamStates.delete(id); labels.delete(id);
    }
  }
  const empty = views.length===0;
  $('emptyState').hidden=!empty;
  $('stage').classList.toggle('has-views',!empty);
  $('canvasSubtitle').textContent=empty?'Ready for your first session':`${views.length} active ${views.length===1?'viewport':'viewports'}`;
  $('deviceCount').textContent=`${String(views.length).padStart(2,'0')} / 04`;
  $('activeCount').textContent=String(views.length).padStart(2,'0');
  $('closeAll').disabled=empty;
  $('reloadAll').disabled=empty;
  for(const button of $('presetList').querySelectorAll('.preset'))button.disabled=views.length>=4||!online;
  if(!empty && !ids.has(selected)) selected=views[0].id;
  if(empty) selected=null;
  const list=document.createDocumentFragment();
  for(const view of views){
    const label=getLabel(view.id);
    const item=document.createElement('button'); item.className=`view-item${view.id===selected?' selected':''}`;
    item.type='button'; item.dataset.id=view.id;
    item.append(icon(labels.get(view.id)?.icon ?? 'monitor'));
    const text=document.createElement('span');const strong=document.createElement('strong');strong.textContent=label;
    const small=document.createElement('small');small.textContent=`${view.viewport.width} × ${view.viewport.height}`;
    text.append(strong,small);item.append(text);
    const status=document.createElement('i');status.className=`view-status ${view.status}`;item.append(status);
    item.addEventListener('click',()=>selectView(view.id));list.append(item);
    let card=cardMap.get(view.id);
    if(!card) card=createCard(view);
    if(card.parentElement!==$('stage')) $('stage').append(card);
    card.classList.toggle('selected',view.id===selected);
    card.querySelector('.preview-top-text strong').textContent = getLabel(view.id);
    card.querySelector('.preview-device-icon').replaceChildren(icon(labels.get(view.id)?.icon ?? 'monitor'));
    card.querySelector('[data-field=dimensions]').textContent=`${view.viewport.width} × ${view.viewport.height}`;
    card.querySelector('[data-field=status]').textContent=view.status==='ready'?liveLabel(view.id):({creating:'LOADING',closing:'CLOSING',error:'ERROR'})[view.status]||view.status.toUpperCase();
    card.querySelector('[data-field=dot]').className=`dot ${view.status==='ready'?(streamStates.get(view.id)==='live'?'ready':streamStates.get(view.id)==='paused'?'error':'creating'):view.status}`;
    card.querySelector('[data-field=url]').textContent=view.status==='error'?view.error:view.url;
    const source=screenImages.get(view.id);
    if(source && source.image.hidden){
      source.placeholder.classList.toggle('is-error',view.status==='error');
      source.placeholder.replaceChild(icon(view.status==='error'?'alert-circle':'loader-circle'),source.placeholder.firstChild);
      source.caption.textContent=view.status==='error'?view.error:({creating:'Starting browser session',closing:'Closing session',ready:streamStates.get(view.id)==='retrying'?'Reconnecting live preview':streamStates.get(view.id)==='paused'?'Stream unavailable — close and reopen':'Waiting for live frames'})[view.status];
    }
    fitCard(view.id);
    if(view.status==='ready'&&!streams.has(view.id) && online) queueMicrotask(()=>{
      const actual=workspace.views.find(v=>v.id===view.id);
      if(actual?.status==='ready')startStream(actual);
    });
  }
  $('activeViews').replaceChildren(list);
  if(empty){const note=document.createElement('p');note.className='quiet-note';note.textContent='Your viewports will appear here.';$('activeViews').append(note);}
  selectedDetails();
}
workspace.subscribe(render);
async function checkConnection(){
  let state='offline';
  try{state=(await client.status()).state;}catch{}
  online=state==='online';configured=state!=='unconfigured';
  $('connection').className=`connection connection-${online?'online':'offline'}`;
  $('connectionText').textContent=online?'Core connected':state==='unconfigured'?'Core not configured':state==='unauthorized'?'Invalid Core token':'Core disconnected';
  $('footerMessage').textContent=online?'Local Chromium engine connected':state==='unconfigured'?'Configure PFX_RESPONSIVE_CORE_TOKEN on the local server':state==='unauthorized'?'Core rejected the configured token':'Unable to reach the local preview Core';
  $('openButton').disabled=!online;
  for(const button of $('presetList').querySelectorAll('.preset'))button.disabled=!online||workspace.views.length>=4;
  if(online)render(workspace.views);
}
function addPreview(url,presetName){
  const preset=presets[presetName];
  const id=workspace.add({url,width:preset.width,height:preset.height});
  labels.set(id,preset);
  // The workspace emits 'creating' synchronously before this metadata exists.
  render(workspace.views);
  selectView(id);
  return id;
}
$('urlForm').addEventListener('submit', async event=>{
  event.preventDefault();
  if(!online) return showMessage('The preview Core is not connected');
  let url;try{url=normalizeURL($('urlInput').value);}catch(e){return showMessage(e.message);}
  $('urlInput').value=url;
  const views=workspace.views;
  if(!views.length){for (const id of ['mobile','tablet','desktop']) addPreview(url,id);}
  else {const results=await Promise.allSettled(views.filter(v=>v.status==='ready').map(v=>workspace.navigate(v.id,url))); const failed=results.filter(x=>x.status==='rejected');if(failed.length)showMessage(`${failed.length} preview(s) could not navigate`);}
});
$('presetList').addEventListener('click',event=>{
  const button=event.target.closest('[data-preset]'); if(!button)return;
  if(!online)return showMessage('Connect the local Core first');
  try{addPreview(normalizeURL($('urlInput').value),button.dataset.preset);}catch(e){showMessage(e.message);}
});
$('reloadAll').addEventListener('click',()=>void Promise.allSettled(workspace.views.map(reload)));
$('closeAll').addEventListener('click',()=>void Promise.allSettled(workspace.views.map(v=>remove(v.id))));
$('connectionRetry').addEventListener('click',()=>void checkConnection());
$('clearUrl').addEventListener('click',()=>{$('urlInput').value='';$('urlInput').focus();});
$('applyDimensions').addEventListener('click',async()=>{
  const v=currentView();if(!v)return;
  const width=Number($('widthInput').value),height=Number($('heightInput').value);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<240||height<240||width>3840||height>3840)return showMessage('Dimensions must be between 240 and 3840 pixels');
  try{await workspace.resize(v.id,{width,height});}catch(e){showMessage(e.message);}
});
$('typeForm').addEventListener('submit',async event=>{
  event.preventDefault();const v=currentView(), text=$('typeInput').value;
  if(!v||v.status!=='ready'||!text)return;
  try{await workspace.input(v.id,{kind:'type',text});$('typeInput').value='';}catch(e){showMessage(e.message);}
});
$('captureButton').addEventListener('click',()=>void capture(currentView()));
$('refreshButton').addEventListener('click',()=>void reload(currentView()));
const theme=(()=>{try{return localStorage.getItem('pfx-responsive-theme');}catch{return null;}})();
if(theme==='light'||theme==='dark')document.body.dataset.theme=theme;
function syncTheme(){ $('themeToggle').replaceChildren(icon(document.body.dataset.theme==='light'?'moon':'sun')); }
syncTheme();
$('themeToggle').addEventListener('click',()=>{
  document.body.dataset.theme=document.body.dataset.theme==='dark'?'light':'dark';
  try{localStorage.setItem('pfx-responsive-theme',document.body.dataset.theme);}catch{}
  syncTheme();
});
window.addEventListener('pagehide',()=>{
  if(!client.key)return;
  void fetch('/api/workspace/close',{method:'POST',keepalive:true,headers:{'x-pfx-app':'1','x-pfx-workspace':client.key,'content-type':'application/json'},body:'{}',cache:'no-store'});
});
async function initialize(){
  try{await client.bootstrap();await checkConnection();}
  catch(error){ $('connectionText').textContent='App service unavailable';showMessage(error?.message || 'Local gateway unavailable. Reload the app.'); }
}
void initialize();
setInterval(()=>{if(client.key) void checkConnection();},25_000);

'use strict';
const $ = id => document.getElementById(id);
const audio = $('audio');
const tracks = [];
let bundledCovers = [];
let hiddenBundled = new Set();
try { const ids = JSON.parse(localStorage.getItem('little-ears-hidden-songs') || '[]'); if (Array.isArray(ids)) hiddenBundled = new Set(ids); } catch {}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let db = null, currentId = null, currentUrl = null;
let importing = false, seeking = false, reactionActive = false;
let toastTimer, reactionTimer, restTimer, bubbleTimer;
let petCount = 0, lastVolume = .75, loadVersion = 0;
audio.volume = .75;

function notify(message) {
  const toast = $('toast');
  // Keep feedback in the dialog's top layer while the song list is open.
  ($('library').open ? $('library') : document.body).append(toast);
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4500);
}
function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}
function updateProgress() {
  $('elapsed').textContent = formatTime(audio.currentTime);
  if (!seeking) $('seek').value = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.currentTime / audio.duration * 100 : 0;
  $('seek').style.setProperty('--progress', `${$('seek').value}%`);
  if ('mediaSession' in navigator && Number.isFinite(audio.duration) && audio.duration > 0) {
    try { navigator.mediaSession.setPositionState({duration:audio.duration, playbackRate:1, position:Math.min(audio.currentTime, audio.duration)}); } catch {}
  }
}
function store(action, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', action === 'getAll' ? 'readonly' : 'readwrite');
    const request = tx.objectStore('tracks')[action](value);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('无法保存音源'));
  });
}

function dogBubble(message, duration = 2300) {
  $('dog-bubble').textContent = message;
  $('dog-bubble').classList.add('visible');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => $('dog-bubble').classList.remove('visible'), duration);
}
function dogRestState() {
  if (reactionActive) return;
  $('dog').dataset.expression = !audio.paused ? 'listen' : 'idle';
}
function reactDog(expression, message) {
  clearTimeout(reactionTimer);
  reactionActive = true;
  const dog = $('dog');
  dog.dataset.expression = expression;
  dog.classList.remove('petted');
  void dog.offsetWidth;
  dog.classList.add('petted');
  dogBubble(message);
  dog.getAnimations().forEach(animation => animation.cancel());
  if (!reducedMotion.matches) dog.animate([
    {transform:'rotate(0deg) translateY(0)'},
    {transform:'rotate(-9deg) translateY(-8px)',offset:.3},
    {transform:'rotate(7deg) translateY(-3px)',offset:.65},
    {transform:'rotate(0deg) translateY(0)'}
  ], {duration:650, easing:'cubic-bezier(.22,.8,.3,1)'});
  reactionTimer = setTimeout(() => {
    reactionActive = false;
    dog.classList.remove('petted');
    dogRestState();
  }, 2200);
}
$('dog').addEventListener('click', () => {
  const expressions = ['love', 'happy', 'curious'];
  const phrases = audio.paused ? ['摸摸收到，今天也陪你。', '耳朵竖好啦！', tracks.length ? '选好啦？我陪你听。' : '先放一首你的歌吧。'] : ['这首歌，和你一起听。', '喜欢！再听一会儿。', '你听，我就在这里。'];
  const index = petCount++ % expressions.length;
  reactDog(expressions[index], phrases[index]);
});
setInterval(() => {
  if (document.hidden || reactionActive || reducedMotion.matches || $('dog').dataset.expression !== 'idle') return;
  $('dog').dataset.expression = 'blink';
  setTimeout(() => { if (!reactionActive && $('dog').dataset.expression === 'blink') dogRestState(); }, 180);
}, 6100);

function renderLibrary() {
  $('track-count').textContent = `${tracks.length} 首`;
  $('library-count').textContent = tracks.length ? `${tracks.length} 首 · 只属于你的歌单` : '自己的声音，慢慢收集。';
  $('empty-library').hidden = tracks.length > 0;
  const index = tracks.findIndex(track => track.id === currentId);
  $('track-position').textContent = index >= 0 ? `${String(index + 1).padStart(2,'0')} / ${String(tracks.length).padStart(2,'0')}` : '— / —';
  const fragment = document.createDocumentFragment();
  tracks.forEach((track, index) => {
    const row = document.createElement('li'); row.className = `track-row${track.id === currentId ? ' active' : ''}`;
    const select = document.createElement('button'); select.className = 'track-select';
    select.setAttribute('aria-label', `播放 ${track.title}`);
    if (track.id === currentId) select.setAttribute('aria-current', 'true');
    const number = document.createElement('span'); number.className = 'track-number'; number.textContent = track.id === currentId ? '♫' : String(index+1).padStart(2,'0');
    const info = document.createElement('span'); info.className = 'song-info';
    const title = document.createElement('span'); title.className = 'song-title'; title.textContent = track.title;
    const meta = document.createElement('span'); meta.className = 'song-meta'; meta.textContent = `${track.format} · ${((track.file?.size || track.size)/1024/1024).toFixed(1)} MB${track.temporary ? ' · 临时收听' : ''}`;
    const duration = document.createElement('span'); duration.className = 'song-duration'; duration.textContent = formatTime(track.duration);
    const thumbnail = document.createElement('img'); thumbnail.className = 'song-cover'; thumbnail.src = track.cover || 'assets/cover.png'; thumbnail.alt = ''; thumbnail.loading = 'lazy';
    info.append(title,meta); select.append(number,thumbnail,info,duration);
    select.addEventListener('click', () => { selectTrack(track.id, true); closeLibrary(); });
    const remove = document.createElement('button'); remove.className = 'plain-button remove-track'; remove.setAttribute('aria-label', `移除 ${track.title}`);
    remove.innerHTML = '<svg><use href="#close-icon"/></svg>';
    remove.addEventListener('click', () => removeTrack(track.id));
    row.append(select, remove); fragment.append(row);
  });
  $('track-list').replaceChildren(fragment);
}
function updatePlaybackState() {
  const playing = !audio.paused && !!currentId;
  document.body.classList.toggle('is-playing', playing);
  $('play').setAttribute('aria-label', playing ? '暂停' : '播放');
  $('play').innerHTML = `<svg><use href="#${playing ? 'pause' : 'play'}-icon"/></svg>`;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  clearTimeout(restTimer);
  dogRestState();
  if (!playing && currentId) restTimer = setTimeout(() => {
    if (audio.paused && !reactionActive) $('dog').dataset.expression = 'sleep';
  }, 12000);
}
async function playCurrent() {
  if (!currentId) return false;
  const version = loadVersion;
  try {
    if (audio.ended) audio.currentTime = 0;
    await audio.play(); return true;
  } catch (error) {
    if (version === loadVersion && error.name !== 'AbortError') notify('这份音频暂时无法播放，请试试 MP3、M4A 或 WAV。');
    return false;
  }
}
function mediaMetadata(track) {
  if (!('mediaSession' in navigator) || !('MediaMetadata' in window)) return;
  navigator.mediaSession.metadata = new MediaMetadata({title:track.title,artist:'我的录音',album:'小耳朵 · 私人随身听',artwork:[{src:new URL(track.cover || 'assets/cover.png',location.href).href,type:'image/png'}]});
}
function selectTrack(id, autoplay = false) {
  const track = tracks.find(track => track.id === id);
  if (!track) return;
  if (currentId !== id) {
    audio.pause(); loadVersion++;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentId = id; currentUrl = track.file ? URL.createObjectURL(track.file) : null; audio.src = currentUrl || track.src;
    document.querySelector('.cover').src = track.cover || 'assets/cover.png';
    document.querySelector('.cover').alt = `${track.title}的歌曲封面`;
    $('track-title').textContent = track.title; $('track-title').title = track.title;
    $('track-subtitle').textContent = track.temporary ? '本次临时收听' : `我的录音 · ${track.format}`;
    $('duration').textContent = formatTime(track.duration); $('elapsed').textContent = '0:00';
    seeking = false; $('seek').value = 0; $('seek').style.setProperty('--progress','0%'); $('seek').disabled = true;
    mediaMetadata(track);
  }
  ['play','previous','next'].forEach(id => $(id).disabled = false);
  renderLibrary(); updatePlaybackState();
  if (autoplay) playCurrent();
}
function resetPlayer() {
  loadVersion++; audio.pause(); audio.removeAttribute('src'); audio.load();
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentId = null; currentUrl = null; seeking = false;
  document.querySelector('.cover').src = 'assets/cover.png';
  document.querySelector('.cover').alt = '雨夜动漫封面';
  $('track-title').textContent = '今天，想听什么？'; $('track-title').removeAttribute('title');
  $('track-subtitle').textContent = '导入一首自己的歌';
  $('elapsed').textContent = $('duration').textContent = '0:00';
  $('seek').value = 0; $('seek').style.setProperty('--progress','0%');
  ['play','previous','next','seek'].forEach(id => $(id).disabled = true);
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  updatePlaybackState();
}
async function removeTrack(id) {
  const track = tracks.find(track => track.id === id);
  if (!track) return;
  if (track.bundled) {
    const hidden = new Set(hiddenBundled); hidden.add(id);
    try { localStorage.setItem('little-ears-hidden-songs',JSON.stringify([...hidden])); hiddenBundled = hidden; }
    catch { notify('无法保存歌单变更，请稍后再试。'); return; }
  } else if (db && !track.temporary) {
    try { await store('delete', id); } catch { notify('移除失败，请再试一次。'); return; }
  }
  const index = tracks.findIndex(track => track.id === id);
  if (index < 0) return;
  tracks.splice(index,1);
  if (currentId === id) {
    resetPlayer();
    if (tracks.length) selectTrack(tracks[Math.min(index,tracks.length-1)].id);
  }
  renderLibrary(); notify('已从歌单移除，原音频文件仍在。');
}
function probeDuration(file) {
  return new Promise(resolve => {
    const probe = new Audio(); const url = URL.createObjectURL(file);
    const finish = duration => {
      clearTimeout(timer); probe.onloadedmetadata = probe.onerror = null;
      probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(url); resolve(duration);
    };
    const timer = setTimeout(() => finish(0), 3000);
    probe.preload = 'metadata'; probe.onloadedmetadata = () => finish(Number.isFinite(probe.duration) ? probe.duration : 0);
    probe.onerror = () => finish(0); probe.src = url;
  });
}
async function importFiles(files) {
  if (importing) { notify('正在收好音源，请稍等。'); return; }
  importing = true; document.body.classList.add('busy');
  await ready;
  let added = 0, skipped = 0, temporary = 0;
  try {
    for (const file of files) {
      if (!(file.type.startsWith('audio/') || /\.(mp3|m4a|wav|flac|ogg|aac|opus|aiff?)$/i.test(file.name)) || file.size === 0) { skipped++; continue; }
      const id = `${file.name}:${file.size}:${file.lastModified}`;
      if (tracks.some(track => track.id === id)) { skipped++; continue; }
      const track = {id, file, title:file.name.replace(/\.[^.]+$/,''), format:file.name.split('.').pop().toUpperCase(), duration:await probeDuration(file), added:Date.now(), cover:bundledCovers.length ? bundledCovers[Math.floor(Math.random()*bundledCovers.length)] : 'assets/cover.png'};
      if (db) { try { await store('put',track); } catch { track.temporary = true; } }
      else track.temporary = true;
      if (track.temporary) temporary++;
      tracks.push(track); added++; renderLibrary();
      if (!currentId) selectTrack(track.id);
    }
    if (added) {
      closeLibrary();
      reactDog('happy', '新歌收到，我准备好啦！');
      notify(`已添加 ${added} 首${skipped ? `，跳过 ${skipped} 个重复或非音频文件` : ''}${temporary ? '。部分音源未能保存，刷新后需重新导入' : '，按下播放开始听'}。`);
    } else notify('没有添加新歌曲，请选择未导入的音频文件。');
    if (temporary) $('storage-note').textContent = '部分音源仅临时保存 · 请保留原文件';
  } finally { importing = false; document.body.classList.remove('busy'); $('file-input').value = ''; }
}

function openLibrary() { if (!$('library').open) $('library').showModal(); }
function closeLibrary() { if ($('library').open) $('library').close(); }
['menu','open-library'].forEach(id => $(id).addEventListener('click',openLibrary));
$('close-library').addEventListener('click',closeLibrary);
$('library').addEventListener('click', event => {
  if (event.target !== $('library')) return;
  const rect = $('library').getBoundingClientRect();
  if (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right) closeLibrary();
});
$('library').addEventListener('close', () => document.body.append($('toast')));
document.querySelectorAll('[data-import]').forEach(button => button.addEventListener('click', () => $('file-input').click()));
$('file-input').addEventListener('change', event => importFiles([...event.target.files]));
let dragDepth = 0;
document.addEventListener('dragenter', event => {
  if (![...event.dataTransfer.types].includes('Files')) return;
  event.preventDefault(); dragDepth++; $('drop-area').classList.add('dragging');
});
document.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth=0; $('drop-area').classList.remove('dragging'); } });
document.addEventListener('drop', event => {
  if (![...event.dataTransfer.types].includes('Files')) return;
  event.preventDefault(); dragDepth=0; $('drop-area').classList.remove('dragging'); importFiles([...event.dataTransfer.files]);
});
$('play').addEventListener('click', () => audio.paused ? playCurrent() : audio.pause());
function step(direction) {
  if (!tracks.length) return;
  const index = tracks.findIndex(track => track.id === currentId);
  selectTrack(tracks[(index+direction+tracks.length)%tracks.length].id,true);
}
$('previous').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('repeat').addEventListener('click', () => {
  audio.loop = !audio.loop;
  $('repeat').setAttribute('aria-pressed', String(audio.loop));
  $('repeat').setAttribute('aria-label', audio.loop ? '关闭单曲循环' : '开启单曲循环');
  notify(audio.loop ? '单曲循环' : '按歌单顺序播放');
});
audio.addEventListener('ended', () => {
  const index = tracks.findIndex(track => track.id === currentId);
  if (index >= 0 && index < tracks.length-1) selectTrack(tracks[index+1].id,true);
  else { updatePlaybackState(); dogBubble('听完啦，我还在。'); }
});
audio.addEventListener('loadedmetadata', () => {
  $('duration').textContent = formatTime(audio.duration);
  $('seek').disabled = !Number.isFinite(audio.duration) || audio.duration <= 0;
  updateProgress();
});
audio.addEventListener('timeupdate',updateProgress);
['play','pause'].forEach(event => audio.addEventListener(event,updatePlaybackState));
audio.addEventListener('error', () => { if (audio.getAttribute('src')) notify('这份音频无法解码，请换一份 MP3、M4A 或 WAV 音源试试。'); });
$('seek').addEventListener('pointerdown', () => seeking = true);
['pointerup','pointercancel','blur'].forEach(event => $('seek').addEventListener(event, () => seeking = false));
$('seek').addEventListener('input', event => {
  if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value)/100*audio.duration;
  $('seek').style.setProperty('--progress',`${event.target.value}%`);
  $('elapsed').textContent = formatTime(audio.currentTime);
});
let volumeHintShown = false;
$('volume').addEventListener('input', event => {
  const volume = Number(event.target.value);
  audio.muted = false; audio.volume = volume;
  if (!volumeHintShown && Math.abs(audio.volume-volume) > .02) { notify('这台手机请用侧边音量键调节音量。'); volumeHintShown = true; }
});
$('mute').addEventListener('click', () => {
  if (audio.muted || audio.volume === 0) { audio.muted = false; audio.volume = lastVolume || .75; }
  else { lastVolume = audio.volume; audio.muted = true; }
});
audio.addEventListener('volumechange', () => {
  $('volume').value = audio.muted ? 0 : audio.volume;
  $('mute').style.opacity = audio.muted || audio.volume===0 ? '.4' : '1';
  $('mute').setAttribute('aria-label', audio.muted || audio.volume===0 ? '取消静音' : '静音');
});
document.addEventListener('keydown', event => {
  if (event.code === 'Space' && !event.repeat && !$('library').open && !/INPUT|BUTTON|TEXTAREA|SELECT|A/.test(event.target.tagName) && !event.target.isContentEditable && currentId) {
    event.preventDefault(); audio.paused ? playCurrent() : audio.pause();
  }
});
if ('mediaSession' in navigator) {
  const actions = {play:playCurrent,pause:()=>audio.pause(),previoustrack:()=>step(-1),nexttrack:()=>step(1),seekto:details=>{
    if (Number.isFinite(audio.duration) && Number.isFinite(details.seekTime)) audio.currentTime=Math.max(0,Math.min(details.seekTime,audio.duration));
  }};
  for (const [action,handler] of Object.entries(actions)) { try { navigator.mediaSession.setActionHandler(action,handler); } catch {} }
}
const ready = (async () => {
  try {
    const response = await fetch('catalog.json');
    if (!response.ok) throw new Error('歌单加载失败');
    const catalog = await response.json();
    bundledCovers = [...new Set(catalog.map(track => track.cover))];
    tracks.push(...catalog.filter(track => !hiddenBundled.has(track.id)));
  } catch { notify('预置歌单暂时无法加载，请刷新重试。仍可导入自己的音源。'); }
  try {
    db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('little-ears-mobile',1);
      request.onupgradeneeded = () => request.result.createObjectStore('tracks',{keyPath:'id'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('存储暂不可用'));
    });
    db.onversionchange = () => { db.close(); db=null; $('storage-note').textContent='存储已更新，请刷新后继续添加歌曲'; };
    tracks.push(...(await store('getAll')).sort((a,b)=>a.added-b.added));
  } catch {
    db=null; $('storage-note').textContent='当前仅临时收听，刷新后需重新导入';
  }
  renderLibrary(); if (tracks.length) selectTrack(tracks[0].id);
  dogBubble(tracks.length ? '回来啦，继续听吗？' : '点点我，陪你听。',3500);
})();

// Optional browser agent access shares the visible player's state and actions.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  const tools = [
    {name:'read_player',description:'Read the local song list and current player state.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async input=>{
      if (!input || typeof input!=='object' || Object.keys(input).length) throw new Error('Expected an empty object');
      await ready; return {tracks:tracks.map(track=>({id:track.id,title:track.title})),currentId,playing:!audio.paused};
    }},
    {name:'pause_player',description:'Pause the current song.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{
      if (!input || typeof input!=='object' || Object.keys(input).length) throw new Error('Expected an empty object');
      audio.pause(); return {playing:false};
    }}
  ];
  for (const tool of tools) { try { Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{}); } catch {} }
}

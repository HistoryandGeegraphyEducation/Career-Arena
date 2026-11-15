(()=>{
 let ctx=null,enabled=true;
 function audio(){
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)return null;
  try{ctx=ctx||new AudioContextClass();if(ctx.state==='suspended')ctx.resume();return ctx}catch(e){return null}
 }
 function tone(freq=660,duration=.12,type='sine',volume=.12,when=0){
  if(!enabled)return;
  const ac=audio();if(!ac)return;
  try{
   const o=ac.createOscillator(),g=ac.createGain(),start=ac.currentTime+when;
   o.type=type;o.frequency.setValueAtTime(freq,start);
   g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(volume,start+.025);g.gain.exponentialRampToValueAtTime(.0001,start+duration);
   o.connect(g);g.connect(ac.destination);o.start(start);o.stop(start+duration+.04);
  }catch(e){}
 }
 function roundIntro(round='Khởi động'){
  if(!enabled)return;
  const ac=audio();if(!ac)return;
  const start=ac.currentTime+.04;
  const themes={
   'Khởi động':{root:110,notes:[220,261.63,329.63,392,523.25]},
   'Phản xạ':{root:130.81,notes:[261.63,311.13,392,466.16,622.25]},
   'Liên kết':{root:98,notes:[196,246.94,293.66,369.99,493.88]},
   'Bứt phá':{root:82.41,notes:[164.81,207.65,246.94,329.63,493.88]},
   'Luyện tập':{root:123.47,notes:[246.94,293.66,369.99,440,587.33]},
   'Vận dụng':{root:92.5,notes:[185,233.08,277.18,349.23,466.16]}
  };
  const theme=themes[round]||themes['Khởi động'];
  try{
   const master=ac.createGain();master.gain.setValueAtTime(.0001,start);master.gain.linearRampToValueAtTime(.19,start+.35);master.gain.setValueAtTime(.15,start+4.8);master.gain.exponentialRampToValueAtTime(.0001,start+6.25);master.connect(ac.destination);
   const bass=ac.createOscillator(),bassGain=ac.createGain();bass.type='sawtooth';bass.frequency.setValueAtTime(theme.root,start);bass.frequency.exponentialRampToValueAtTime(theme.root*1.5,start+1.25);bassGain.gain.setValueAtTime(.0001,start);bassGain.gain.linearRampToValueAtTime(.16,start+.3);bassGain.gain.exponentialRampToValueAtTime(.0001,start+5.8);bass.connect(bassGain);bassGain.connect(master);bass.start(start);bass.stop(start+5.9);
   [0,.72,1.44,2.16,2.88,3.6,4.32].forEach((offset,i)=>{
    const o=ac.createOscillator(),g=ac.createGain(),f=theme.notes[i%theme.notes.length];
    o.type='triangle';o.frequency.setValueAtTime(f,start+offset);o.frequency.exponentialRampToValueAtTime(f*1.015,start+offset+.42);
    g.gain.setValueAtTime(.0001,start+offset);g.gain.linearRampToValueAtTime(.075,start+offset+.06);g.gain.exponentialRampToValueAtTime(.0001,start+offset+.62);
    o.connect(g);g.connect(master);o.start(start+offset);o.stop(start+offset+.66);
   });
   [0,1.8,3.6].forEach((offset,i)=>{
    const o=ac.createOscillator(),g=ac.createGain();o.type='sine';o.frequency.value=theme.notes[(i+2)%theme.notes.length]*2;
    g.gain.setValueAtTime(.0001,start+offset);g.gain.linearRampToValueAtTime(.045,start+offset+.12);g.gain.exponentialRampToValueAtTime(.0001,start+offset+1.15);
    o.connect(g);g.connect(master);o.start(start+offset);o.stop(start+offset+1.2);
   });
  }catch(e){}
 }
 window.GameSound={
  tap:()=>tone(520,.08),
  success:()=>{tone(660,.12);tone(880,.18,'sine',.12,.11)},
  wrong:()=>tone(190,.2,'triangle'),
  start:()=>{tone(440,.1);tone(660,.1,'sine',.12,.1);tone(880,.18,'sine',.12,.2)},
  roundIntro,
  toggle:()=>{enabled=!enabled;document.querySelectorAll('[data-sound]').forEach(b=>b.textContent=enabled?'♫ Âm thanh: Bật':'♪ Âm thanh: Tắt');return enabled},
  get enabled(){return enabled}
 };
 document.addEventListener('click',e=>{if(e.target.closest('button,a,.option'))tone(430,.045,'sine',.035)},true);
 document.querySelectorAll('[data-sound]').forEach(b=>b.addEventListener('click',()=>GameSound.toggle()));
 document.querySelectorAll('[data-year]').forEach(x=>x.textContent=new Date().getFullYear());
})();
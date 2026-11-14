(() => {
'use strict';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),hostId=params.get('join');
let peer=null,connection=null,timer=null,seconds=120,teams=['Đội 1','Đội 2','Đội 3','Đội 4'].map(name=>({name,score:0,members:[]})),connections=new Map(),submissions=[],currentRound='Khởi động',awarded=new Set();
const state=()=>({type:'state',teams,submissions,currentRound,seconds});
const send=(c,d)=>{try{if(c&&c.open)c.send(d)}catch(e){}};
const broadcast=()=>{const s=state();connections.forEach(c=>send(c,s));renderTeacher()};
const show=id=>$(id).classList.remove('hidden'),hide=id=>$(id).classList.add('hidden');
function renderTeacher(){
 $('memberCount').textContent=teams.reduce((n,t)=>n+t.members.length,0)+' thành viên';$('submissionCount').textContent=submissions.length+' lượt gửi';$('scoreboard').replaceChildren();
 teams.forEach(t=>{const card=document.createElement('article');card.className='score-card';const h=document.createElement('h3');h.textContent=t.name;const score=document.createElement('div');score.className='score';score.textContent=t.score+' điểm';const members=document.createElement('small');members.textContent=t.members.length+' thành viên đang kết nối';card.append(h,score,members);$('scoreboard').append(card)});
 $('submissions').replaceChildren();if(!submissions.length){const p=document.createElement('p');p.className='muted';p.textContent='Chưa có câu trả lời được gửi.';$('submissions').append(p);return}
 [...submissions].reverse().forEach(item=>{const card=document.createElement('article');card.className='submission';const head=document.createElement('div');head.className='submission-head';const who=document.createElement('strong');who.textContent=(teams[item.team]?.name||'Đội')+' · '+item.name+' · '+item.round;const time=document.createElement('small');time.className='muted';time.textContent=new Date(item.time).toLocaleTimeString('vi-VN');head.append(who,time);const body=document.createElement('p');body.textContent=item.text;const actions=document.createElement('div');actions.className='submission-actions';[1,2,5].forEach(points=>{const b=document.createElement('button');b.textContent='+'+points+' điểm';b.disabled=awarded.has(item.id);b.addEventListener('click',()=>award(item.id,points));actions.append(b)});card.append(head,body,actions);$('submissions').append(card)})
}
function award(id,points){if(awarded.has(id))return;const item=submissions.find(s=>s.id===id);if(!item)return;teams[item.team].score+=points;awarded.add(id);broadcast()}
function onMessage(conn,data){
 if(!data||typeof data!=='object')return;
 if(data.type==='join'){const i=Number(data.team);if(!Number.isInteger(i)||!teams[i])return;const member={id:conn.peer,name:String(data.name||'Thành viên').slice(0,32)};teams.forEach(t=>t.members=t.members.filter(m=>m.id!==member.id));teams[i].members.push(member);conn.__team=i;conn.__name=member.name;broadcast();send(conn,state())}
 if(data.type==='answer'&&Number.isInteger(conn.__team)&&typeof data.text==='string'&&data.text.trim()){submissions.push({id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),team:conn.__team,name:conn.__name,round:currentRound,text:data.text.trim().slice(0,2000),time:Date.now()});broadcast()}
}
function startTeacher(){
 if(typeof Peer==='undefined'){$('connectionStatus').textContent='Không tải được thư viện kết nối';return}
 $('createRoom').disabled=true;$('connectionStatus').textContent='Đang tạo phòng…';peer=new Peer();
 peer.on('open',id=>{ const code=id.slice(-8).toUpperCase();$('roomCode').textContent=code;$('roomCodeLarge').textContent=code;const url=new URL('room.html',location.href);url.search='?join='+encodeURIComponent(id);$('joinLink').href=url.href;$('joinLink').textContent=url.href;$('joinLinkLarge').href=url.href;$('joinLinkLarge').textContent=url.href;$('qrCode').replaceChildren();$('qrCodeLarge').replaceChildren();if(typeof QRCode!=='undefined'){new QRCode($('qrCode'),{text:url.href,width:160,height:160,colorDark:'#061b48',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});new QRCode($('qrCodeLarge'),{text:url.href,width:360,height:360,colorDark:'#061b48',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.H})}show('roomShare');show('qrModal');$('createRoom').disabled=false;$('closeRoom').disabled=false;$('connectionStatus').textContent='Phòng đang mở';broadcast()});
 peer.on('connection',conn=>{connections.set(conn.peer,conn);conn.on('data',d=>onMessage(conn,d));conn.on('close',()=>{connections.delete(conn.peer);teams.forEach(t=>t.members=t.members.filter(m=>m.id!==conn.peer));broadcast()});conn.on('error',()=>connections.delete(conn.peer))});
 peer.on('error',e=>{$('connectionStatus').textContent='Lỗi kết nối: '+(e.type||'không xác định')+(e.message?' – '+e.message:'');$('createRoom').disabled=false;if(peer){try{peer.destroy()}catch(err){}peer=null}})
}
function closeTeacher(){hide('qrModal');if(timer)clearInterval(timer);timer=null;if(peer)peer.destroy();peer=null;connections.clear();teams.forEach(t=>t.members=[]);$('connectionStatus').textContent='Đã đóng phòng';$('createRoom').disabled=false;$('closeRoom').disabled=true;hide('roomShare');renderTeacher()}
function startStudent(){
 show('studentView');if(!hostId){hide('studentView');show('unsupported');return}
 let joinTimer=null,joining=false;
 const clearJoinTimer=()=>{if(joinTimer){clearTimeout(joinTimer);joinTimer=null}};
 const failJoin=message=>{clearJoinTimer();joining=false;if(connection){try{connection.close()}catch(e){}connection=null}if(peer){try{peer.destroy()}catch(e){}peer=null}$('joinError').textContent=message;$('joinRoom').disabled=false;$('studentStatus').textContent='Chưa kết nối';$('studentStatus').style.background='';};
 $('joinRoom').addEventListener('click',()=>{
  if(joining)return;
  const name=$('studentName').value.trim(),team=Number($('studentTeam').value);
  if(!name){$('joinError').textContent='Hãy nhập tên thành viên.';return}
  if(typeof Peer==='undefined'){$('joinError').textContent='Không tải được thư viện PeerJS. Hãy kiểm tra Internet rồi tải lại trang.';return}
  joining=true;$('joinRoom').disabled=true;$('joinError').textContent='Đang kết nối tới máy chủ…';$('studentStatus').textContent='Đang kết nối';$('studentStatus').style.background='';
  try{
   peer=new Peer(undefined,{host:'0.peerjs.com',port:443,path:'/',secure:true,debug:1});
   joinTimer=setTimeout(()=>failJoin('Quá thời gian kết nối máy chủ PeerJS. Hãy tải lại trang hoặc thử mạng Internet khác.'),15000);
   peer.on('open',()=>{
    clearJoinTimer();$('joinError').textContent='Đã kết nối máy chủ. Đang gửi yêu cầu vào phòng của giáo viên…';
    try{
     connection=peer.connect(hostId,{reliable:true});
     joinTimer=setTimeout(()=>failJoin('Không nhận được phản hồi từ phòng giáo viên. Hãy kiểm tra giáo viên đã tạo phòng và đang giữ trang phòng mở.'),15000);
     connection.on('open',()=>{
      clearJoinTimer();joining=false;
      send(connection,{type:'join',name,team});
      hide('joinForm');show('studentPlay');
      $('studentTeamName').textContent=$('studentTeam').selectedOptions[0].textContent;
      $('studentStatus').textContent='Đã kết nối';$('studentStatus').style.background='#0c633d';
     });
     connection.on('data',renderStudentState);
     connection.on('close',()=>{
      clearJoinTimer();joining=false;
      $('studentStatus').textContent='Mất kết nối';$('studentStatus').style.background='#71342c';
      $('sendStatus').textContent='Phòng đã đóng hoặc kết nối với giáo viên bị ngắt.';
     });
     connection.on('error',e=>failJoin('Lỗi kết nối tới phòng: '+(e&&e.message?e.message:'không xác định')+'. Hãy quét mã QR mới nhất.'));
    }catch(e){failJoin('Không thể gửi yêu cầu vào phòng: '+(e&&e.message?e.message:'lỗi không xác định'))}
   });
   peer.on('error',e=>{
    const type=e&&e.type?e.type:'unknown',detail=e&&e.message?e.message:'';
    const messages={
     'server-error':'Máy chủ PeerJS đang từ chối hoặc không phản hồi kết nối.',
     'network':'Mất kết nối mạng khi liên hệ máy chủ PeerJS.',
     'socket-error':'Không mở được kênh liên lạc với máy chủ PeerJS.',
     'socket-closed':'Kênh liên lạc với máy chủ PeerJS đã đóng.',
     'peer-unavailable':'Không tìm thấy phòng. Giáo viên cần tạo phòng mới và gửi lại mã QR.'
    };
    failJoin((messages[type]||'Kết nối thất bại ('+type+').')+(detail?' Chi tiết: '+detail:''));
   });
   peer.on('disconnected',()=>{if(joining)failJoin('Kết nối tới máy chủ PeerJS bị ngắt. Hãy thử lại.')});
  }catch(e){failJoin('Không thể khởi tạo kết nối: '+(e&&e.message?e.message:'lỗi không xác định'))}
 });
 $('sendAnswer').addEventListener('click',()=>{
  const text=$('studentAnswer').value.trim();
  if(!text){$('sendStatus').textContent='Hãy nhập nội dung trước khi gửi.';return}
  if(!connection||!connection.open){$('sendStatus').textContent='Chưa kết nối với giáo viên.';return}
  send(connection,{type:'answer',text});$('studentAnswer').value='';$('sendStatus').textContent='Đã gửi câu trả lời.';
 })
}
function renderStudentState(data){if(!data||data.type!=='state')return;const team=data.teams?.[Number($('studentTeam').value)];if(team){$('studentTeamName').textContent=team.name;$('studentScore').textContent=team.score}$('studentRound').textContent=data.currentRound||'Chưa chọn hoạt động';$('studentTimer').textContent=data.seconds>0?'Thời gian còn lại: '+String(Math.floor(data.seconds/60)).padStart(2,'0')+':'+String(data.seconds%60).padStart(2,'0'):'Theo hướng dẫn của giáo viên.'}
function updateTeams(){teams.forEach((t,i)=>t.name=$('teamName'+i).value.trim()||'Đội '+(i+1));broadcast()}
function setClock(){$('roomClock').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}
if(hostId)startStudent();else{show('teacherView');renderTeacher();$('closeQrModal').addEventListener('click',()=>hide('qrModal'));$('dismissQrModal').addEventListener('click',()=>hide('qrModal'));$('qrModal').addEventListener('click',e=>{if(e.target===$('qrModal'))hide('qrModal')});document.addEventListener('keydown',e=>{if(e.key==='Escape')hide('qrModal')});$('createRoom').addEventListener('click',startTeacher);$('closeRoom').addEventListener('click',closeTeacher);$('currentRound').addEventListener('change',()=>{currentRound=$('currentRound').value;broadcast()});for(let i=0;i<4;i++)$('teamName'+i).addEventListener('change',updateTeams);$('timerStart').addEventListener('click',()=>{if(timer)return;timer=setInterval(()=>{if(seconds>0)seconds--;else{clearInterval(timer);timer=null}setClock();broadcast()},1000)});$('timerReset').addEventListener('click',()=>{if(timer)clearInterval(timer);timer=null;seconds=120;setClock();broadcast()});setClock();window.addEventListener('beforeunload',()=>{if(peer)peer.destroy()})}
})();
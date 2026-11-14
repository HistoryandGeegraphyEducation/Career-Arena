(() => {
'use strict';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),hostId=params.get('join'),controllerHost=params.get('control'),controllerToken=params.get('key');
const PEER_OPTIONS={host:'0.peerjs.com',port:443,path:'/',secure:true,debug:1};
let peer=null,connection=null,timer=null,seconds=120,currentQuestion='',questionType='both',questionOptions=[],teamVotes=[{}, {}, {}, {}],teamTexts=[[],[],[],[]],teamFinals=[null,null,null,null],captainElection={open:false,endsAt:0,closed:false},captainVotes=[{},{},{},{}],captains=[null,null,null,null],raceOrder=[],raceAwarded=new Set(),teams=['Đội 1','Đội 2','Đội 3','Đội 4'].map(name=>({name,score:0,members:[]})),connections=new Map(),controllerConnections=new Map(),controllerSecret='',pendingRequests=new Map(),submissions=[],currentRound='Khởi động',awarded=new Set();
const state=()=>({type:'state',teams,submissions,currentRound,seconds,question:{text:currentQuestion,type:questionType,options:questionOptions},teamVotes,teamTexts,teamFinals,captainElection,captainVotes,captains,raceOrder});
const send=(c,d)=>{try{if(c&&c.open)c.send(d)}catch(e){}};
const broadcast=()=>{const s=state();connections.forEach(c=>send(c,s));controllerConnections.forEach(c=>send(c,{type:'control-state',state:s,pending:[...pendingRequests].map(([id,r])=>({id,name:r.name,team:r.team}))}));renderTeacher()};
const show=id=>$(id).classList.remove('hidden'),hide=id=>$(id).classList.add('hidden');
function renderPending(){
 const root=$('pendingRequests'),count=$('pendingCount');
 if(!root||!count)return;
 count.textContent=pendingRequests.size+' yêu cầu';
 root.replaceChildren();
 if(!pendingRequests.size){const p=document.createElement('p');p.className='muted';p.textContent='Chưa có yêu cầu tham gia.';root.append(p);return}
 pendingRequests.forEach((request,id)=>{
  const card=document.createElement('article');card.className='pending-card';
  const info=document.createElement('div');info.className='pending-info';
  const name=document.createElement('strong');name.textContent=request.name;
  const detail=document.createElement('span');detail.textContent=(teams[request.team]?.name||'Đội '+(request.team+1))+' · Đang chờ giáo viên xác nhận';
  info.append(name,detail);
  const actions=document.createElement('div');actions.className='pending-actions';
  const approve=document.createElement('button');approve.type='button';approve.className='btn pending-approve';approve.textContent='Cho vào phòng';approve.addEventListener('click',()=>approveJoin(id));
  const reject=document.createElement('button');reject.type='button';reject.className='btn ghost pending-reject';reject.textContent='Từ chối';reject.addEventListener('click',()=>rejectJoin(id));
  actions.append(approve,reject);card.append(info,actions);root.append(card);
 });
}
function approveJoin(id){
 const request=pendingRequests.get(id);if(!request)return;
 const {conn,team,name}=request;
 if(!conn.open){pendingRequests.delete(id);renderPending();return}
 teams.forEach(t=>t.members=t.members.filter(m=>m.id!==id));
 teams[team].members.push({id,name});conn.__team=team;conn.__name=name;
 pendingRequests.delete(id);
 send(conn,{type:'joined',state:state(),team,name});
 broadcast();renderPending();
}
function rejectJoin(id){
 const request=pendingRequests.get(id);if(!request)return;
 pendingRequests.delete(id);renderPending();broadcast();
 send(request.conn,{type:'join-error',message:'Giáo viên chưa chấp nhận yêu cầu tham gia phòng. Hãy liên hệ giáo viên.'});
 setTimeout(()=>{try{request.conn.close()}catch(e){}},250);
}
function renderConsensus(){
 const root=$('teamConsensus');if(!root)return;root.replaceChildren();
 if(!currentQuestion){const p=document.createElement('p');p.className='muted';p.textContent='Chưa có câu hỏi thảo luận.';root.append(p);return}
 teams.forEach((team,index)=>{
  const card=document.createElement('article');card.className='consensus-card';
  const head=document.createElement('div');head.className='consensus-head';
  const title=document.createElement('h3');title.textContent=team.name;
  const count=document.createElement('span');count.className='pill';count.textContent=team.members.length+' thành viên';
  head.append(title,count);card.append(head);
  const ballots=teamVotes[index]||{},tally={};Object.values(ballots).forEach(v=>{tally[String(v)]=(tally[String(v)]||0)+1});
  const total=Object.keys(ballots).length;
  if(questionType!=='text'&&questionOptions.length){
   const box=document.createElement('div');box.className='consensus-options';
   questionOptions.forEach((option,i)=>{const line=document.createElement('div');line.className='consensus-option';const label=document.createElement('span');label.textContent=option;const number=document.createElement('strong');number.textContent=(tally[String(i)]||0)+' phiếu';line.append(label,number);box.append(line)});card.append(box);
  }
  const texts=teamTexts[index]||[];
  if(texts.length){const list=document.createElement('div');list.className='consensus-texts';const label=document.createElement('strong');label.textContent='Ý kiến văn bản ('+texts.length+')';list.append(label);texts.slice(-5).forEach(item=>{const p=document.createElement('p');p.textContent=item.name+': '+item.text;list.append(p)});card.append(list)}
  const captain=captains[index],captainMember=team.members.find(m=>m.id===captain);
  const cap=document.createElement('p');cap.className='captain-identity';cap.textContent=captainMember?'Đội trưởng: '+captainMember.name:'Chưa bầu đội trưởng';card.append(cap);
  const final=teamFinals[index];if(final){const result=document.createElement('p');result.className='consensus-final';result.textContent='ĐÃ GỬI · Hạng '+final.rank+' · '+final.points+' điểm: '+final.answer;card.append(result)}
  const foot=document.createElement('small');foot.className='muted';foot.textContent='Lượt lựa chọn: '+total+' / '+team.members.length;card.append(foot);root.append(card);
 });
}
function closeCaptainElection(){if(!captainElection.open)return;captainElection.open=false;captainElection.closed=true;teams.forEach((team,i)=>{const counts={};Object.entries(captainVotes[i]).forEach(([voter,v])=>{const x=counts[v.candidate]||(counts[v.candidate]={n:0,first:Infinity});x.n++;x.first=Math.min(x.first,v.time)});const win=Object.entries(counts).sort((a,b)=>b[1].n-a[1].n||a[1].first-b[1].first)[0];captains[i]=win?win[0]:null});$('captainVoteStatus').textContent='Đã kết thúc bầu chọn. Nếu hòa phiếu, người đạt số phiếu đó sớm hơn được chọn.';broadcast()}
function openCaptainElection(){captainVotes=[{},{},{},{}];captains=[null,null,null,null];captainElection={open:true,endsAt:Date.now()+15000,closed:false};$('captainVoteStatus').textContent='Đang bầu chọn trong 15 giây.';broadcast();setTimeout(()=>{if(captainElection.open)closeCaptainElection()},15000)}
function renderTeacher(){
 $('memberCount').textContent=teams.reduce((n,t)=>n+t.members.length,0)+' thành viên';$('submissionCount').textContent=submissions.length+' lượt gửi';$('scoreboard').replaceChildren();
 teams.forEach(t=>{const card=document.createElement('article');card.className='score-card';const h=document.createElement('h3');h.textContent=t.name;const score=document.createElement('div');score.className='score';score.textContent=t.score+' điểm';const members=document.createElement('small');members.textContent=t.members.length+' thành viên đang kết nối';card.append(h,score,members);$('scoreboard').append(card)});
 renderConsensus();const race=$('raceResults');if(race){race.replaceChildren();raceOrder.forEach(x=>{const row=document.createElement('div');row.className='race-result';row.textContent=(teams[x.team].name)+' · Hạng '+x.rank+' · '+x.points+' điểm · '+x.answer;race.append(row)})}$('submissions').replaceChildren();if(!submissions.length){const p=document.createElement('p');p.className='muted';p.textContent='Chưa có câu trả lời được gửi.';$('submissions').append(p);return}
 [...submissions].reverse().forEach(item=>{const card=document.createElement('article');card.className='submission';const head=document.createElement('div');head.className='submission-head';const who=document.createElement('strong');who.textContent=(teams[item.team]?.name||'Đội')+' · '+item.name+' · '+item.round;const time=document.createElement('small');time.className='muted';time.textContent=new Date(item.time).toLocaleTimeString('vi-VN');head.append(who,time);const body=document.createElement('p');body.textContent=item.text;const actions=document.createElement('div');actions.className='submission-actions';if(item.final){const rank=document.createElement('strong');rank.textContent='Hạng '+item.rank+' · '+item.points+' điểm (tự động)';actions.append(rank)};card.append(head,body,actions);$('submissions').append(card)})
}
function award(id,points){if(awarded.has(id))return;const item=submissions.find(s=>s.id===id);if(!item)return;teams[item.team].score+=points;awarded.add(id);broadcast()}
function onMessage(conn,data){
 if(!data||typeof data!=='object')return;
 if(data.type==='controller-auth'){
  if(!controllerSecret||data.token!==controllerSecret){send(conn,{type:'controller-denied',message:'Mã liên kết không hợp lệ.'});conn.close();return}
  conn.__controller=true;controllerConnections.set(conn.peer,conn);
  send(conn,{type:'controller-ready',state:state(),pending:[...pendingRequests].map(([id,r])=>({id,name:r.name,team:r.team}))});
  $('controllerPairStatus').textContent='Đã liên kết '+controllerConnections.size+' điện thoại.';return;
 }
 if(conn.__controller&&data.type==='control-action'){
  const a=data.action||{};
  if(a.type==='timer-start'){if(!timer)timer=setInterval(()=>{if(seconds>0)seconds--;else{clearInterval(timer);timer=null}setClock();broadcast()},1000);broadcast();return}
  if(a.type==='timer-reset'){if(timer)clearInterval(timer);timer=null;seconds=120;setClock();broadcast();return}
  if(a.type==='set-round'&&typeof a.value==='string'){currentRound=a.value;$('currentRound').value=a.value;broadcast();return}
  if(a.type==='captain-vote'){openCaptainElection();return}
  if(a.type==='publish-question'){$('discussionQuestion').value=String(a.question||'');$('discussionType').value=a.questionType||'both';$('discussionOptions').value=String(a.options||'');publishQuestion();return}
  if(a.type==='approve'){approveJoin(String(a.id));return}
  if(a.type==='reject'){rejectJoin(String(a.id));return}
  return;
 }
 if(data.type==='join'){
  const i=Number(data.team),name=String(data.name||'Thành viên').trim().slice(0,32)||'Thành viên';
  if(!Number.isInteger(i)||!teams[i]){send(conn,{type:'join-error',message:'Đội được chọn không hợp lệ. Hãy tải lại trang và chọn đội khác.'});return}
  if(teams.some(t=>t.members.some(m=>m.id===conn.peer))){send(conn,{type:'joined',state:state(),team:teams.findIndex(t=>t.members.some(m=>m.id===conn.peer)),name});return}
  if(pendingRequests.has(conn.peer)){
   const existing=pendingRequests.get(conn.peer);existing.team=i;existing.name=name;renderPending();
   send(conn,{type:'join-pending',message:'Yêu cầu tham gia đã được cập nhật. Vui lòng chờ giáo viên xác nhận.'});return;
  }
  pendingRequests.set(conn.peer,{conn,team:i,name,requestedAt:Date.now()});
  renderPending();broadcast();
  send(conn,{type:'join-pending',message:'Yêu cầu đã được gửi tới giáo viên. Vui lòng chờ xác nhận.'});
 }
 if(data.type==='captain-vote'&&Number.isInteger(conn.__team)&&captainElection.open&&!captainElection.closed){
  const t=conn.__team;if(captainVotes[t][conn.peer]){send(conn,{type:'captain-vote-result',message:'Bạn đã bỏ phiếu và không thể vote lại.'});return}
  if(Date.now()>captainElection.endsAt){closeCaptainElection();return}
  if(!teams[t].members.some(m=>m.id===data.candidate))return;
  captainVotes[t][conn.peer]={candidate:data.candidate,time:Date.now()};send(conn,{type:'captain-vote-result',message:'Đã ghi nhận phiếu bầu.'});broadcast();return
 }
 if(data.type==='captain-submit'&&Number.isInteger(conn.__team)){
  const t=conn.__team;if(captains[t]!==conn.peer){send(conn,{type:'captain-submit-result',message:'Chỉ đội trưởng mới được gửi đáp án.'});return}
  if(raceAwarded.has(t))return;const answer=String(data.answer||'').trim().slice(0,2000);if(!answer)return;
  const rank=raceOrder.length,points=[10,7,5,3][rank]||0,stamp=Date.now();raceAwarded.add(t);raceOrder.push({team:t,answer,time:stamp,points,rank:rank+1});teams[t].score+=points;teamFinals[t]={answer,time:stamp,points,rank:rank+1};
  submissions.push({id:'race-'+t+'-'+stamp,team:t,name:'Đội trưởng · '+conn.__name,round:currentRound,text:answer,time:stamp,final:true,points,rank:rank+1});send(conn,{type:'captain-submit-result',message:'Đã gửi. Đội nhận '+points+' điểm.'});broadcast();return
 }
 if(data.type==='captain-skip'&&Number.isInteger(conn.__team)){if(captains[conn.__team]===conn.peer)send(conn,{type:'captain-submit-result',message:'Đội đã bỏ qua câu hỏi.'});return}
 if(data.type==='team-response'&&Number.isInteger(conn.__team)){
  const team=conn.__team;if(raceAwarded.has(team)){send(conn,{type:'response-locked',message:'Đội đã gửi đáp án.'});return}
  if(data.kind==='choice'&&questionType!=='text'&&Number.isInteger(data.option)&&questionOptions[data.option]){teamVotes[team][conn.peer]=data.option;teamTexts[team]=teamTexts[team].filter(x=>x.memberId!==conn.peer);teamTexts[team].push({name:conn.__name,text:questionOptions[data.option],memberId:conn.peer,time:Date.now(),kind:'choice'});send(conn,{type:'response-received',message:'Đã ghi nhận lựa chọn.'});broadcast();return}
  if(data.kind==='text'&&questionType!=='choice'&&typeof data.text==='string'&&data.text.trim()){teamTexts[team]=teamTexts[team].filter(x=>x.memberId!==conn.peer);teamTexts[team].push({name:conn.__name,text:data.text.trim().slice(0,2000),memberId:conn.peer,time:Date.now(),kind:'text'});send(conn,{type:'response-received',message:'Đã gửi ý kiến vào phòng đội.'});broadcast();return}
 }
 if(data.type==='answer'&&Number.isInteger(conn.__team)&&typeof data.text==='string'&&data.text.trim()){submissions.push({id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),team:conn.__team,name:conn.__name,round:currentRound,text:data.text.trim().slice(0,2000),time:Date.now()});broadcast()}
}
function startTeacher(){
 controllerSecret=Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('');
 if(typeof Peer==='undefined'){$('connectionStatus').textContent='Không tải được thư viện kết nối';return}
 $('createRoom').disabled=true;$('connectionStatus').textContent='Đang tạo phòng…';peer=new Peer(undefined,PEER_OPTIONS);
 peer.on('open',id=>{ const code=id.slice(-8).toUpperCase();$('roomCode').textContent=code;$('roomCodeLarge').textContent=code;const url=new URL('room.html',location.href);url.search='?join='+encodeURIComponent(id);$('joinLink').href=url.href;$('joinLink').textContent=url.href;$('joinLinkLarge').href=url.href;$('joinLinkLarge').textContent=url.href;$('qrCode').replaceChildren();$('qrCodeLarge').replaceChildren();if(typeof QRCode!=='undefined'){new QRCode($('qrCode'),{text:url.href,width:160,height:160,colorDark:'#061b48',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});new QRCode($('qrCodeLarge'),{text:url.href,width:360,height:360,colorDark:'#061b48',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.H})}show('roomShare');show('qrModal');
 const controlUrl=new URL('room.html',location.href);controlUrl.search='?control='+encodeURIComponent(id)+'&key='+encodeURIComponent(controllerSecret);
 $('controllerLink').href=controlUrl.href;$('controllerLink').textContent=controlUrl.href;$('controllerQr').replaceChildren();
 if(typeof QRCode!=='undefined')new QRCode($('controllerQr'),{text:controlUrl.href,width:180,height:180,colorDark:'#061b48',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.H});
 show('controllerPairPanel');$('controllerPairStatus').textContent='Chưa có điện thoại liên kết.';$('createRoom').disabled=false;$('closeRoom').disabled=false;$('connectionStatus').textContent='Phòng đang mở';broadcast()});
 peer.on('connection',conn=>{connections.set(conn.peer,conn);conn.on('open',()=>send(conn,{type:'room-ready'}));conn.on('data',d=>onMessage(conn,d));conn.on('close',()=>{connections.delete(conn.peer);controllerConnections.delete(conn.peer);if(!conn.__controller){pendingRequests.delete(conn.peer);teams.forEach(t=>t.members=t.members.filter(m=>m.id!==conn.peer));renderPending()}if($('controllerPairStatus'))$('controllerPairStatus').textContent=controllerConnections.size?'Đã liên kết '+controllerConnections.size+' điện thoại.':'Điện thoại điều khiển đã ngắt kết nối.';broadcast()});conn.on('error',()=>{connections.delete(conn.peer);controllerConnections.delete(conn.peer);if(!conn.__controller){pendingRequests.delete(conn.peer);teams.forEach(t=>t.members=t.members.filter(m=>m.id!==conn.peer));renderPending()}broadcast()})});
 peer.on('error',e=>{$('connectionStatus').textContent='Lỗi kết nối: '+(e.type||'không xác định')+(e.message?' – '+e.message:'');$('createRoom').disabled=false;if(peer){try{peer.destroy()}catch(err){}peer=null}})
}
function closeTeacher(){hide('qrModal');hide('controllerPairPanel');controllerConnections.clear();controllerSecret='';if(timer)clearInterval(timer);timer=null;if(peer)peer.destroy();peer=null;connections.clear();pendingRequests.clear();renderPending();teams.forEach(t=>t.members=[]);$('connectionStatus').textContent='Đã đóng phòng';$('createRoom').disabled=false;$('closeRoom').disabled=true;hide('roomShare');renderTeacher()}
function startStudent(){
 show('studentView');if(!hostId){hide('studentView');show('unsupported');return}
 let joinTimer=null,joining=false,joinSent=false;
 const clearJoinTimer=()=>{if(joinTimer){clearTimeout(joinTimer);joinTimer=null}};
 const failJoin=message=>{clearJoinTimer();joining=false;if(connection){try{connection.close()}catch(e){}connection=null}if(peer){try{peer.destroy()}catch(e){}peer=null}$('joinError').textContent=message;$('joinRoom').disabled=false;$('studentStatus').textContent='Chưa kết nối';$('studentStatus').style.background='';};
 $('joinRoom').addEventListener('click',()=>{
  if(joining)return;
  const name=$('studentName').value.trim(),team=Number($('studentTeam').value);
  if(!name){$('joinError').textContent='Hãy nhập tên thành viên.';return}
  if(typeof Peer==='undefined'){$('joinError').textContent='Không tải được thư viện PeerJS. Hãy kiểm tra Internet rồi tải lại trang.';return}
  joining=true;$('joinRoom').disabled=true;$('joinError').textContent='Đang kết nối tới máy chủ…';$('studentStatus').textContent='Đang kết nối';$('studentStatus').style.background='';
  try{
   peer=new Peer(undefined,PEER_OPTIONS);
   joinTimer=setTimeout(()=>failJoin('Quá thời gian kết nối máy chủ PeerJS. Hãy tải lại trang hoặc thử mạng Internet khác.'),15000);
   peer.on('open',()=>{
    clearJoinTimer();$('joinError').textContent='Đã kết nối máy chủ. Đang gửi yêu cầu vào phòng của giáo viên…';
    try{
     connection=peer.connect(hostId,{reliable:true});
     joinTimer=setTimeout(()=>failJoin('Không nhận được phản hồi từ phòng giáo viên. Hãy kiểm tra giáo viên đã tạo phòng và đang giữ trang phòng mở.'),15000);
     connection.on('open',()=>{
      if(joinSent)return;
      joinSent=true;
      $('joinError').textContent='Đã kết nối với phòng. Đang gửi yêu cầu giáo viên duyệt…';
      send(connection,{type:'join',name,team});
     });
     connection.on('data',data=>{
      if(data&&data.type==='captain-vote-result'){$('captainVoteMessage').textContent=data.message;return}
      if(data&&data.type==='captain-submit-result'){$('captainSubmitStatus').textContent=data.message;return}
      if(data&&data.type==='response-received'){$('sendStatus').textContent=data.message||'Đã ghi nhận.';return}
      if(data&&data.type==='response-locked'){$('sendStatus').textContent=data.message||'Đội đã chốt.';$('sendAnswer').disabled=true;return}
      if(data&&data.type==='join-pending'){
       clearJoinTimer();
       $('joinError').textContent=data.message||'Đã gửi yêu cầu. Vui lòng chờ giáo viên xác nhận.';
       $('studentStatus').textContent='Chờ duyệt';
       $('studentStatus').style.background='#805b13';
       return;
      }
      if(data&&data.type==='room-ready')return;
      if(data&&data.type==='joined'){
       clearJoinTimer();joining=false;
       hide('joinForm');show('studentPlay');
       $('studentTeamName').textContent=data.state?.teams?.[data.team]?.name||$('studentTeam').selectedOptions[0].textContent;
       $('studentStatus').textContent='Đã vào phòng';$('studentStatus').style.background='#0c633d';
       $('joinError').textContent='';
       if(data.state)renderStudentState(data.state);
       return;
      }
      if(data&&data.type==='join-error'){failJoin(data.message||'Không thể tham gia phòng.');return}
      renderStudentState(data);
     });
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
 $('voteCaptain').addEventListener('click',()=>{const c=document.querySelector('input[name="captainCandidate"]:checked');if(!c){$('captainVoteMessage').textContent='Hãy chọn một thành viên.';return}send(connection,{type:'captain-vote',candidate:c.value})});
 $('captainAnswerSelect').addEventListener('change',()=>{const item=teamTexts[Number($('studentTeam').value)]?.[Number($('captainAnswerSelect').value)];if(item)$('captainFinalAnswer').value=item.text});
 $('captainSend').addEventListener('click',()=>send(connection,{type:'captain-submit',answer:$('captainFinalAnswer').value}));
 $('captainSkip').addEventListener('click',()=>send(connection,{type:'captain-skip'}));
 $('sendAnswer').addEventListener('click',()=>{
  if(!connection||!connection.open){$('sendStatus').textContent='Chưa kết nối với phòng đội.';return}
  const choice=document.querySelector('input[name="teamChoice"]:checked'),text=$('studentAnswer').value.trim();
  if(!$('studentTextWrap').classList.contains('hidden')&&text){send(connection,{type:'team-response',kind:'text',text});$('studentAnswer').value='';$('sendStatus').textContent='Đang gửi ý kiến…';return}
  if(choice){send(connection,{type:'team-response',kind:'choice',option:Number(choice.value)});$('sendStatus').textContent='Đang gửi lựa chọn…';return}
  $('sendStatus').textContent='Hãy chọn một phương án hoặc nhập ý kiến trước khi gửi.';
 })
}

function startController(){
 show('controllerView');
 if(!controllerHost||!controllerToken||typeof Peer==='undefined'){$('controllerStatus').textContent='Thiếu mã liên kết';return}
 peer=new Peer(undefined,PEER_OPTIONS);
 peer.on('open',()=>{connection=peer.connect(controllerHost,{reliable:true});connection.on('open',()=>send(connection,{type:'controller-auth',token:controllerToken}));connection.on('data',data=>{if(data.type==='controller-denied'){$('controllerStatus').textContent=data.message;return}if(data.type==='controller-ready'||data.type==='control-state'){renderController(data.state,data.pending||[]);$('controllerStatus').textContent='Đã liên kết với laptop'}});connection.on('close',()=>{$('controllerStatus').textContent='Mất kết nối với laptop'})});
 peer.on('error',e=>$('controllerStatus').textContent='Lỗi kết nối: '+(e.type||'không xác định'));
 const act=action=>send(connection,{type:'control-action',action});
 $('controllerTimerStart').addEventListener('click',()=>act({type:'timer-start'}));
 $('controllerTimerReset').addEventListener('click',()=>act({type:'timer-reset'}));
 $('controllerRound').addEventListener('change',()=>act({type:'set-round',value:$('controllerRound').value}));
 $('controllerCaptainVote').addEventListener('click',()=>act({type:'captain-vote'}));
 $('controllerPublish').addEventListener('click',()=>act({type:'publish-question',question:$('controllerQuestion').value,questionType:$('controllerType').value,options:$('controllerOptions').value}));
 window.addEventListener('beforeunload',()=>{if(peer)peer.destroy()});
}
function renderController(s,pending){
 if(!s)return;
 $('controllerClock').textContent=String(Math.floor(s.seconds/60)).padStart(2,'0')+':'+String(s.seconds%60).padStart(2,'0');
 $('controllerRound').value=s.currentRound;$('controllerQuestionStatus').textContent=s.question?.text?'Câu hỏi hiện tại: '+s.question.text:'Chưa có câu hỏi.';
 $('controllerScoreboard').replaceChildren();
 (s.teams||[]).forEach(t=>{const card=document.createElement('article');card.className='score-card';const h=document.createElement('h3');h.textContent=t.name;const score=document.createElement('div');score.className='score';score.textContent=t.score+' điểm';const members=document.createElement('small');members.textContent=t.members.length+' thành viên';card.append(h,score,members);$('controllerScoreboard').append(card)});
 $('controllerPendingCount').textContent=pending.length+' yêu cầu';$('controllerPending').replaceChildren();
 if(!pending.length){const p=document.createElement('p');p.className='muted';p.textContent='Chưa có yêu cầu tham gia.';$('controllerPending').append(p)}
 pending.forEach(r=>{const row=document.createElement('article');row.className='pending-card';const info=document.createElement('div');info.className='pending-info';const name=document.createElement('strong');name.textContent=r.name;const team=document.createElement('span');team.textContent=s.teams[r.team]?.name||'Đội '+(r.team+1);info.append(name,team);const actions=document.createElement('div');actions.className='pending-actions';[['Cho vào phòng','approve'],['Từ chối','reject']].forEach(([label,type])=>{const b=document.createElement('button');b.className='btn '+(type==='reject'?'ghost':'pending-approve');b.textContent=label;b.addEventListener('click',()=>send(connection,{type:'control-action',action:{type,id:r.id}}));actions.append(b)});row.append(info,actions);$('controllerPending').append(row)});
}
function renderStudentState(data){if(!data||data.type!=='state')return;const teamIndex=Number($('studentTeam').value);const team=data.teams?.[teamIndex];if(team){$('studentTeamName').textContent=team.name;$('studentScore').textContent=team.score}$('studentRound').textContent=data.currentRound||'Chưa chọn hoạt động';$('studentTimer').textContent=data.seconds>0?'Thời gian còn lại: '+String(Math.floor(data.seconds/60)).padStart(2,'0')+':'+String(data.seconds%60).padStart(2,'0'):'Theo hướng dẫn của giáo viên.';
 const q=data.question||{};$('studentQuestion').textContent=q.text||'Đang chờ giáo viên gửi câu hỏi…'; const election=data.captainElection||{};$('captainElection').classList.toggle('hidden',!election.open);
 const candidates=$('captainCandidates');candidates.replaceChildren();
 if(election.open)(data.teams?.[teamIndex]?.members||[]).forEach(m=>{const label=document.createElement('label');label.className='student-choice';const r=document.createElement('input');r.type='radio';r.name='captainCandidate';r.value=m.id;const span=document.createElement('span');span.textContent=m.name;label.append(r,span);candidates.append(label)});
 $('captainCountdown').textContent=election.open?'Còn '+Math.max(0,Math.ceil((election.endsAt-Date.now())/1000))+' giây':'';
 const voted=!!data.captainVotes?.[teamIndex]?.[connection?.peer];$('voteCaptain').disabled=!election.open||voted;
 const captain=data.captains?.[teamIndex],isCaptain=captain===connection?.peer;
 $('captainIdentity').textContent=isCaptain?'Bạn là ĐỘI TRƯỞNG.':(captain?'Đội trưởng: '+(team?.members||[]).find(m=>m.id===captain)?.name:'Đội chưa có đội trưởng.');
 $('captainSubmitPanel').classList.toggle('hidden',!isCaptain||!!data.teamFinals?.[teamIndex]);
 const select=$('captainAnswerSelect'),old=select.value;select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='Chọn ý kiến của thành viên';select.append(empty);
 (data.teamTexts?.[teamIndex]||[]).forEach((v,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=v.name+': '+v.text;select.append(o)});select.value=old;
 $('captainSend').disabled=!isCaptain||!!data.teamFinals?.[teamIndex];$('captainSkip').disabled=!isCaptain||!!data.teamFinals?.[teamIndex];

 const list=$('studentChoiceList'),previousChoice=document.querySelector('input[name="teamChoice"]:checked')?.value;list.replaceChildren();
 if(q.type!=='text'&&Array.isArray(q.options))q.options.forEach((option,i)=>{const label=document.createElement('label');label.className='student-choice';const radio=document.createElement('input');radio.type='radio';radio.name='teamChoice';radio.value=String(i);radio.checked=previousChoice===String(i);const span=document.createElement('span');span.textContent=option;label.append(radio,span);list.append(label)});
 $('studentChoiceList').classList.toggle('hidden',q.type==='text'||!q.options?.length);$('studentTextWrap').classList.toggle('hidden',q.type==='choice');
 const final=data.teamFinals?.[teamIndex];$('sendAnswer').disabled=!!final||!q.text;$('sendAnswer').textContent=final?'ĐỘI ĐÃ CHỐT ĐÁP ÁN':'GỬI Ý KIẾN VÀO PHÒNG ĐỘI';
 const tally=data.teamVotes?.[teamIndex]||{},ballotCount=Object.keys(tally).length,teamMessages=data.teamTexts?.[teamIndex]||[];
 const recent=teamMessages.slice(-4).map(item=>item.name+': '+item.text).join(' | ');
 $('studentTeamTally').textContent='Phòng đội: '+ballotCount+' thành viên đã chọn phương án.'+(recent?' Ý kiến mới: '+recent:'')+(final?' Đáp án chung: '+final.answer:' Giáo viên sẽ quyết định đáp án cuối cùng.');
}
function updateTeams(){teams.forEach((t,i)=>t.name=$('teamName'+i).value.trim()||'Đội '+(i+1));broadcast()}
function publishQuestion(){const q=$('discussionQuestion').value.trim();if(!q){$('questionStatus').textContent='Hãy nhập nội dung câu hỏi.';return}questionType=$('discussionType').value;questionOptions=$('discussionOptions').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,8);if(questionType!=='text'&&questionOptions.length<2){$('questionStatus').textContent='Hãy nhập ít nhất hai phương án, mỗi phương án một dòng.';return}currentQuestion=q;teamVotes=[{}, {}, {}, {}];teamTexts=[[],[],[],[]];teamFinals=[null,null,null,null];raceOrder=[];raceAwarded.clear();$('questionStatus').textContent='Đã gửi câu hỏi đến các phòng đội.';broadcast()}
function setClock(){$('roomClock').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}
if(controllerHost)startController();else if(hostId)startStudent();else{show('teacherView');renderTeacher();renderPending();$('closeQrModal').addEventListener('click',()=>hide('qrModal'));$('dismissQrModal').addEventListener('click',()=>hide('qrModal'));$('qrModal').addEventListener('click',e=>{if(e.target===$('qrModal'))hide('qrModal')});document.addEventListener('keydown',e=>{if(e.key==='Escape')hide('qrModal')});$('createRoom').addEventListener('click',startTeacher);$('closeRoom').addEventListener('click',closeTeacher);$('currentRound').addEventListener('change',()=>{currentRound=$('currentRound').value;broadcast()});$('publishQuestion').addEventListener('click',publishQuestion);$('startCaptainVote').addEventListener('click',openCaptainElection);for(let i=0;i<4;i++)$('teamName'+i).addEventListener('change',updateTeams);$('timerStart').addEventListener('click',()=>{if(timer)return;timer=setInterval(()=>{if(seconds>0)seconds--;else{clearInterval(timer);timer=null}setClock();broadcast()},1000)});$('timerReset').addEventListener('click',()=>{if(timer)clearInterval(timer);timer=null;seconds=120;setClock();broadcast()});setClock();window.addEventListener('beforeunload',()=>{if(peer)peer.destroy()})}
})();
(() => {
'use strict';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),hostId=params.get('join'),controllerHost=params.get('control');
let connection=null,timer=null,controllerConnected=false,lastControllerState=null,selfName='',selfTeamIndex=null,seconds=120,reflex={active:false,index:-1,startedAt:0,completed:{}},reflexElapsed=[0,0,0,0],reflexPoints=[0,0,0,0],reflexRoundResults=[],approvalMode='auto',currentQuestion='',questionType='both',questionOptions=[],teamVotes=[{}, {}, {}, {}],teamTexts=[[],[],[],[]],teamFinals=[null,null,null,null],captainElection={open:false,endsAt:0,closed:false},captainVotes=[{},{},{},{}],captains=[null,null,null,null],raceOrder=[],raceAwarded=new Set(),teams=['Đội 1','Đội 2','Đội 3','Đội 4'].map(name=>({name,score:0,members:[]})),connections=new Map(),controllerConnections=new Map(),pendingRequests=new Map(),submissions=[],currentRound='Khởi động',awarded=new Set();
const SUPABASE_CONFIG=window.CAREER_ARENA_SUPABASE||{};
let supabaseClient=null,controllerChannel=null,studentChannel=null;
function getSupabaseClient(){
 if(supabaseClient)return supabaseClient;
 if(!SUPABASE_CONFIG.url||!SUPABASE_CONFIG.publishableKey||!window.supabase?.createClient)return null;
 supabaseClient=window.supabase.createClient(SUPABASE_CONFIG.url,SUPABASE_CONFIG.publishableKey);
 return supabaseClient;
}
function controllerTopic(code){return 'career-arena-control:'+String(code||'').trim().replace(/\s+/g,'').toUpperCase()}
function studentTopic(code){return 'career-arena-students:'+String(code||'').trim().replace(/\s+/g,'').toUpperCase()}
function removeStudentChannel(){
 if(supabaseClient&&studentChannel){supabaseClient.removeChannel(studentChannel).catch(()=>{});}
 studentChannel=null;
}
function openHostStudentChannel(code,onReady,onError){
 const client=getSupabaseClient();if(!client){onError('Thiếu cấu hình Supabase.');return}
 studentChannel=client.channel(studentTopic(code),{config:{broadcast:{self:false,ack:true},private:false}});
 studentChannel.on('broadcast',{event:'student-message'},({payload})=>{
  const message=payload||{},clientId=String(message.clientId||'');
  if(!clientId||!message.data)return;
  if(message.data.type==='student-leave'){
   const existing=connections.get(clientId);
   if(existing){connections.delete(clientId);pendingRequests.delete(clientId);teams.forEach(t=>t.members=t.members.filter(m=>m.id!==clientId));renderPending();broadcast()}
   return;
  }
  let conn=connections.get(clientId);
  if(!conn){
   conn={peer:clientId,open:true,__realtime:true,send(data){
    if(!studentChannel)return Promise.resolve('error');
    return studentChannel.send({type:'broadcast',event:'host-message',payload:{target:clientId,data}});
   },close(){
    this.open=false;connections.delete(clientId);pendingRequests.delete(clientId);
    teams.forEach(t=>t.members=t.members.filter(m=>m.id!==clientId));renderPending();broadcast();
   }};
   connections.set(clientId,conn);
  }
  onMessage(conn,message.data);
 });
 let settled=false;
 const timeout=setTimeout(()=>{if(!settled){settled=true;onError('Hết thời gian mở kênh học sinh trên Supabase Realtime.')}},20000);
 studentChannel.subscribe((status,error)=>{
  if(status==='SUBSCRIBED'&&!settled){settled=true;clearTimeout(timeout);onReady()}
  else if((status==='CHANNEL_ERROR'||status==='TIMED_OUT')&&!settled){settled=true;clearTimeout(timeout);onError('Supabase Realtime trả về '+status+(error?.message?' · '+error.message:''))}
 });
}
function publishControllerMessage(payload){
 if(!controllerChannel)return;
 controllerChannel.send({type:'broadcast',event:'controller-message',payload}).catch(()=>{});
}
function removeControllerChannel(){
 if(supabaseClient&&controllerChannel){supabaseClient.removeChannel(controllerChannel).catch(()=>{});}
 controllerChannel=null;controllerConnected=false;
}
function openHostControllerChannel(code,onReady,onError){
 const client=getSupabaseClient();if(!client){onError('Không tải được Supabase JS hoặc thiếu URL/Publishable Key.');return}
 controllerChannel=client.channel(controllerTopic(code),{config:{broadcast:{self:false},private:false}});
 controllerChannel.on('broadcast',{event:'controller-message'},({payload})=>{
  const data=payload||{};
  if(data.type==='controller-hello'){
   publishControllerMessage({type:'controller-ready',state:state(),pending:[...pendingRequests].map(([id,r])=>({id,name:r.name,team:r.team}))});
   if($('controllerLinkStatus'))$('controllerLinkStatus').textContent='Điện thoại điều khiển: đã kết nối';
   return;
  }
  if(data.type==='control-action')onMessage({__controller:true},data);
 });
 let settled=false;
 const timeout=setTimeout(()=>{if(!settled){settled=true;onError('Hết thời gian kết nối Supabase Realtime. Kiểm tra Realtime đã được bật trong dự án.')}},20000);
 controllerChannel.subscribe((status,error)=>{
  if(status==='SUBSCRIBED'&&!settled){settled=true;clearTimeout(timeout);onReady()}
  else if((status==='CHANNEL_ERROR'||status==='TIMED_OUT')&&!settled){settled=true;clearTimeout(timeout);onError('Supabase Realtime trả về '+status+(error?.message?' · '+error.message:''))}
 });
}
const state=()=>({type:'state',reflex,reflexElapsed,teams,submissions,currentRound,seconds,approvalMode,question:{text:currentQuestion,type:questionType,options:questionOptions},teamVotes,teamTexts,teamFinals,captainElection,captainVotes,captains,raceOrder});
const send=(c,d)=>{try{if(c&&c.open)c.send(d)}catch(e){}};
const broadcast=()=>{const s=state();connections.forEach(c=>send(c,s));publishControllerMessage({type:'control-state',state:s,pending:[...pendingRequests].map(([id,r])=>({id,name:r.name,team:r.team}))});renderTeacher()};
const show=id=>$(id).classList.remove('hidden'),hide=id=>$(id).classList.add('hidden');
function renderPending(){
 const root=$('pendingRequests'),count=$('pendingCount');
 if(!root||!count)return;
 const connected=teams.reduce((n,t)=>n+t.members.length,0);
 count.textContent=connected+' thành viên';
 root.replaceChildren();
 if(!connected){const p=document.createElement('p');p.className='muted';p.textContent='Chưa có học sinh kết nối.';root.append(p);return}
 teams.forEach(team=>{
  team.members.forEach(member=>{
   const row=document.createElement('article');row.className='pending-card';
   const info=document.createElement('div');info.className='pending-info';
   const name=document.createElement('strong');name.textContent=member.name;
   const detail=document.createElement('span');detail.textContent=team.name+' · Đã vào phòng';
   info.append(name,detail);row.append(info);root.append(row);
  });
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
function closeCaptainElection(){if(!captainElection.open)return;captainElection.open=false;captainElection.closed=true;teams.forEach((team,i)=>{const counts={};Object.entries(captainVotes[i]).forEach(([voter,v])=>{const x=counts[v.candidate]||(counts[v.candidate]={n:0,first:Infinity});x.n++;x.first=Math.min(x.first,v.time)});const win=Object.entries(counts).sort((a,b)=>b[1].n-a[1].n||a[1].first-b[1].first)[0];captains[i]=win?win[0]:null});$('captainVoteStatus').textContent='Đã kết thúc bầu chọn.';renderCaptainRoster();broadcast()}
function openCaptainElection(){captainVotes=[{},{},{},{}];captains=[null,null,null,null];captainElection={open:true,endsAt:Date.now()+15000,closed:false};$('captainVoteStatus').textContent='Đang bầu chọn.';renderCaptainRoster();broadcast();setTimeout(()=>{if(captainElection.open)closeCaptainElection()},15000)}
function renderCaptainRoster(){const root=$('captainRoster');if(!root)return;root.replaceChildren();teams.forEach((team,i)=>{const line=document.createElement('p');const captain=team.members.find(m=>m.id===captains[i]);line.textContent=team.name+': '+(captain?captain.name:'Chưa có đội trưởng');root.append(line)})}

const reflexJobs=[["Bác sĩ","https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=1600&q=85",["Bác sĩ","Giáo viên","Kỹ sư","Đầu bếp"],0],["Giáo viên","https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1600&q=85",["Nhà báo","Giáo viên","Bác sĩ","Phi công"],1],["Cảnh sát","https://images.unsplash.com/photo-1453873531674-2151bcd01707?auto=format&fit=crop&w=1600&q=85",["Lính cứu hỏa","Cảnh sát","Tài xế","Thợ điện"],1],["Lính cứu hỏa","https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1600&q=85",["Công nhân xây dựng","Bác sĩ","Lính cứu hỏa","Nông dân"],2],["Đầu bếp","https://images.unsplash.com/photo-1577219491135-ce391730fb2c?auto=format&fit=crop&w=1600&q=85",["Đầu bếp","Thợ may","Giáo viên","Phi công"],0],["Công nhân xây dựng","https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1600&q=85",["Thợ điện","Nông dân","Công nhân xây dựng","Cảnh sát"],2],["Nông dân","https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1600&q=85",["Tài xế","Nông dân","Đầu bếp","Bác sĩ"],1],["Thợ điện","https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=1600&q=85",["Thợ may","Thợ điện","Phi công","Giáo viên"],1],["Phi công","https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1600&q=85",["Phi công","Cảnh sát","Bác sĩ","Tài xế"],0],["Tài xế","https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?auto=format&fit=crop&w=1600&q=85",["Nông dân","Thợ điện","Tài xế","Đầu bếp"],2],["Thợ may","https://images.unsplash.com/photo-1590736969955-71cc94901144?auto=format&fit=crop&w=1600&q=85",["Thợ may","Giáo viên","Cảnh sát","Bác sĩ"],0],["Nhân viên bưu điện","https://images.unsplash.com/photo-1580674285054-bed31e145f59?auto=format&fit=crop&w=1600&q=85",["Phi công","Nhân viên bưu điện","Tài xế","Thợ điện"],1]];
function startReflexQuestion(index){if(index>=reflexJobs.length){reflex.active=false;reflex.index=-1;$('reflexStatus').textContent='Đã hoàn thành 12 hình ảnh.';$('reflexNext').disabled=true;broadcast();return}reflex={active:true,index,startedAt:Date.now(),completed:{}};$('reflexStatus').textContent='Câu '+(index+1)+' / 12 · '+reflexJobs[index][0];$('reflexNext').disabled=false;broadcast()}
function renderReflexTeacher(){const live=$('reflexLiveBoard'),board=$('reflexAchievements');if(!live||!board)return;const rows=teams.map((t,i)=>({name:t.name,done:!!reflex.completed?.[i],points:reflexPoints[i],time:reflexElapsed[i]})).sort((a,b)=>(b.points-a.points)||(a.time-b.time));live.replaceChildren();rows.forEach(r=>{const row=document.createElement('div');row.className='reflex-live-row';const name=document.createElement('strong');name.textContent=r.name;const track=document.createElement('div');track.className='reflex-track';const fill=document.createElement('span');fill.style.width=Math.max(4,Math.min(100,r.points*2))+'%';track.append(fill);const label=document.createElement('small');label.textContent=r.done?'Đã trả lời':'Đang thực hiện';row.append(name,track,label);live.append(row)});board.replaceChildren();rows.forEach((r,i)=>{const row=document.createElement('div');row.className='reflex-achievement-row';const rank=document.createElement('b');rank.textContent=String(i+1).padStart(2,'0');const name=document.createElement('strong');name.textContent=r.name;const time=document.createElement('span');time.textContent=(r.time/1000).toFixed(2)+' giây';const points=document.createElement('b');points.textContent=r.points+' điểm';row.append(rank,name,time,points);board.append(row)})}
function renderReflexStudent(data){const panel=$('reflexStudentPanel');if(!panel)return;const r=data.reflex||{};panel.classList.toggle('hidden',!r.active);const legacy=document.querySelector('.student-discussion');if(legacy)legacy.classList.toggle('hidden',!!r.active);if(!r.active){$('reflexImageStage').classList.add('hidden');return;}const job=reflexJobs[r.index];if(!job)return;const teamIndex=Number($('studentTeam').value),isCaptain=data.captains?.[teamIndex]===connection?.peer;$('reflexLeaderControls').classList.toggle('hidden',!isCaptain);$('reflexMemberQuiz').classList.toggle('hidden',isCaptain);$('reflexQuestionNumber').textContent='CÂU '+(r.index+1)+' / 12';$('reflexImage').src=job[1];const reveal=()=>{const stage=$('reflexImageStage');stage.classList.remove('hidden');clearTimeout(window.__reflexHideTimer);window.__reflexHideTimer=setTimeout(()=>stage.classList.add('hidden'),isCaptain?3000:5000)};const revealKey=String(r.startedAt)+':'+String(r.index);if(window.__reflexShownKey!==revealKey){window.__reflexShownKey=revealKey;$('reflexImageStage').classList.add('hidden');const count=$('reflexCountdown');count.classList.remove('hidden');count.textContent='3';let n=3;const tick=setInterval(()=>{n--;if(n<=0){clearInterval(tick);count.classList.add('hidden');reveal()}else count.textContent=String(n)},1000)}$('reflexLeaderReveal').onclick=reveal;$('reflexMemberReveal').onclick=reveal;const options=$('reflexOptions');options.replaceChildren();job[2].forEach((label,i)=>{const b=document.createElement('button');b.type='button';b.className='reflex-option';b.textContent=String.fromCharCode(65+i)+'. '+label;b.disabled=!!r.completed?.[teamIndex];b.onclick=()=>send(connection,{type:'reflex-answer',question:r.index,option:i});options.append(b)});$('reflexMemberFeedback').textContent=r.completed?.[teamIndex]?'Đội đã trả lời câu này.':'Chọn một đáp án. Đội được ghi nhận khi chọn đúng.'}
function renderTeacher(){
 renderReflexTeacher();
 $('memberCount').textContent=teams.reduce((n,t)=>n+t.members.length,0)+' thành viên';$('submissionCount').textContent=submissions.length+' lượt gửi';$('scoreboard').replaceChildren();
 teams.forEach(t=>{const card=document.createElement('article');card.className='score-card';const h=document.createElement('h3');h.textContent=t.name;const score=document.createElement('div');score.className='score';score.textContent=t.score+' điểm';const members=document.createElement('small');members.textContent=t.members.length+' thành viên đang kết nối';card.append(h,score,members);$('scoreboard').append(card)});
 renderConsensus();renderCaptainRoster();const race=$('raceResults');if(race){race.replaceChildren();raceOrder.forEach(x=>{const row=document.createElement('div');row.className='race-result';row.textContent=(teams[x.team].name)+' · Hạng '+x.rank+' · '+x.points+' điểm · '+x.answer;race.append(row)})}$('submissions').replaceChildren();if(!submissions.length){const p=document.createElement('p');p.className='muted';p.textContent='Chưa có câu trả lời được gửi.';$('submissions').append(p);return}
 [...submissions].reverse().forEach(item=>{const card=document.createElement('article');card.className='submission';const head=document.createElement('div');head.className='submission-head';const who=document.createElement('strong');who.textContent=(teams[item.team]?.name||'Đội')+' · '+item.name+' · '+item.round;const time=document.createElement('small');time.className='muted';time.textContent=new Date(item.time).toLocaleTimeString('vi-VN');head.append(who,time);const body=document.createElement('p');body.textContent=item.text;const actions=document.createElement('div');actions.className='submission-actions';if(item.final){const rank=document.createElement('strong');rank.textContent='Hạng '+item.rank+' · '+item.points+' điểm (tự động)';actions.append(rank)};card.append(head,body,actions);$('submissions').append(card)})
}
function award(id,points){if(awarded.has(id))return;const item=submissions.find(s=>s.id===id);if(!item)return;teams[item.team].score+=points;awarded.add(id);broadcast()}
function onMessage(conn,data){
 if(!data||typeof data!=='object')return;
 if(conn.__controller&&data.type==='control-action'){
  const a=data.action||{};
  if(a.type==='timer-start'){if(!timer)timer=setInterval(()=>{if(seconds>0)seconds--;else{clearInterval(timer);timer=null}setClock();broadcast()},1000);broadcast();return}
  if(a.type==='timer-reset'){if(timer)clearInterval(timer);timer=null;seconds=120;setClock();broadcast();return}
  if(a.type==='set-round'&&typeof a.value==='string'){currentRound=a.value;$('currentRound').value=a.value;broadcast();return}
  if(a.type==='captain-vote'){openCaptainElection();return}
  if(a.type==='approval-mode'){approvalMode='auto';renderPending();broadcast();return}
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
   send(conn,{type:'join-error',message:'Kết nối đang được xử lý. Hãy thử lại sau vài giây.'});return;
  }
  pendingRequests.set(conn.peer,{conn,team:i,name,requestedAt:Date.now()});
  approveJoin(conn.peer);return;
 }
 if(data.type==='reflex-answer'&&Number.isInteger(conn.__team)&&reflex.active&&data.question===reflex.index){const t=conn.__team;if(reflex.completed[t]){send(conn,{type:'reflex-feedback',message:'Đội đã trả lời câu này.'});return}const job=reflexJobs[reflex.index];if(data.option!==job[3]){send(conn,{type:'reflex-feedback',message:'Chưa chính xác. Hãy thử lại.'});return}const elapsed=Date.now()-reflex.startedAt,rank=Object.keys(reflex.completed).length,points=[10,7,5,3][rank]||0;reflex.completed[t]={time:elapsed,points};reflexElapsed[t]+=elapsed;reflexPoints[t]+=points;teams[t].score+=points;reflexRoundResults.push({team:t,question:reflex.index,time:elapsed,points});send(conn,{type:'reflex-feedback',message:'Đáp án đúng. Đội nhận '+points+' điểm.'});broadcast();return}
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
function makeRoomCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const bytes=crypto.getRandomValues(new Uint8Array(8));return Array.from(bytes,b=>alphabet[b%alphabet.length]).join('')}
function startTeacher(){
 if(!getSupabaseClient()){$('connectionStatus').textContent='Thiếu cấu hình Supabase Realtime';return}
 $('createRoom').disabled=true;$('connectionStatus').textContent='Đang mở các kênh kết nối…';
 const studentCode=makeRoomCode(),teacherCode=makeRoomCode();
 let studentReady=false,controllerReady=false,failed=false;
 const fail=message=>{
  if(failed)return;failed=true;
  $('connectionStatus').textContent=message;
  $('createRoom').disabled=false;$('closeRoom').disabled=true;
  removeStudentChannel();removeControllerChannel();
 };
 const finishSetup=()=>{
  if(failed||!studentReady||!controllerReady)return;
  $('roomCode').textContent=studentCode;$('teacherRoomCodeDisplay').textContent=teacherCode;
  show('roomShare');$('createRoom').disabled=false;$('closeRoom').disabled=false;
  $('connectionStatus').textContent='Phòng đang mở · Học sinh có thể tham gia';
  broadcast();
 };
 openHostStudentChannel(studentCode,()=>{studentReady=true;finishSetup()},message=>fail('Không thể mở kênh học sinh: '+message));
 openHostControllerChannel(teacherCode,()=>{controllerReady=true;finishSetup()},message=>fail('Không thể mở kênh điều khiển: '+message));
}
function closeTeacher(){controllerConnections.clear();if(timer)clearInterval(timer);timer=null;removeStudentChannel();removeControllerChannel();connections.clear();pendingRequests.clear();renderPending();teams.forEach(t=>t.members=[]);$('connectionStatus').textContent='Đã đóng phòng';$('createRoom').disabled=false;$('closeRoom').disabled=true;hide('roomShare');renderTeacher()}
function startStudent(){
 show('studentView');if(!hostId){hide('studentView');show('unsupported');return}
 let joining=false,clientId=null,joinTimer=null;
 const client=getSupabaseClient();
 const failJoin=message=>{
  if(joinTimer){clearTimeout(joinTimer);joinTimer=null}
  joining=false;
  if(connection){try{connection.close()}catch(e){}connection=null}
  $('joinError').textContent=message;$('joinRoom').disabled=false;
  $('studentStatus').textContent='Chưa kết nối';$('studentStatus').style.background='';
 };
 const receiveHostMessage=data=>{
  if(data&&data.type==='reflex-feedback'){$('reflexMemberFeedback').textContent=data.message;return}
  if(data&&data.type==='captain-vote-result'){$('captainVoteMessage').textContent=data.message;return}
  if(data&&data.type==='captain-submit-result'){$('captainSubmitStatus').textContent=data.message;return}
  if(data&&data.type==='response-received'){$('sendStatus').textContent=data.message||'Đã ghi nhận.';return}
  if(data&&data.type==='response-locked'){$('sendStatus').textContent=data.message||'Đội đã chốt.';$('sendAnswer').disabled=true;return}
  if(data&&data.type==='joined'){
   if(joinTimer){clearTimeout(joinTimer);joinTimer=null}
   joining=false;selfName=String(data.name||$('studentName').value||'Học sinh');
   selfTeamIndex=Number(data.team);
   hide('joinForm');show('studentPlay');
   $('studentTeamName').textContent=data.state?.teams?.[data.team]?.name||$('studentTeam').selectedOptions[0].textContent;
   $('studentStatus').textContent='Đã vào phòng';$('studentStatus').style.background='#0c633d';
   $('joinError').textContent='';
   if(data.state)renderStudentState(data.state);
   return;
  }
  if(data&&data.type==='join-error'){failJoin(data.message||'Không thể tham gia phòng.');return}
  renderStudentState(data);
 };
 $('joinRoom').addEventListener('click',()=>{
  if(joining)return;
  const name=$('studentName').value.trim(),team=Number($('studentTeam').value);
  if(!name){$('joinError').textContent='Hãy nhập tên thành viên.';return}
  if(!client){$('joinError').textContent='Không tải được Supabase. Hãy tải lại trang.';return}
  joining=true;$('joinRoom').disabled=true;
  joinTimer=setTimeout(()=>failJoin('Không nhận được phản hồi từ laptop. Kiểm tra mã phòng và bảo đảm giáo viên vẫn đang mở phòng.'),15000);
  $('joinError').textContent='Đang mở kết nối tới phòng…';
  $('studentStatus').textContent='Đang kết nối';$('studentStatus').style.background='';
  try{
   removeStudentChannel();
   clientId=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
   connection={
    peer:clientId,open:false,onData:null,
    send(data){
     if(!studentChannel||!this.open)return Promise.resolve('error');
     return studentChannel.send({type:'broadcast',event:'student-message',payload:{clientId,data}});
    },
    on(event,handler){if(event==='data')this.onData=handler;return this},
    close(){
     this.open=false;
     if(studentChannel){
      studentChannel.send({type:'broadcast',event:'student-message',payload:{clientId,data:{type:'student-leave'}}}).catch(()=>{});
      removeStudentChannel();
     }
    }
   };
   studentChannel=client.channel(studentTopic(hostId),{config:{broadcast:{self:false},private:false}});
   studentChannel.on('broadcast',{event:'host-message'},({payload})=>{
    const item=payload||{};
    if(item.target!==clientId||!item.data)return;
    if(typeof connection?.onData==='function')connection.onData(item.data);
   });
   connection.on('data',receiveHostMessage);
   studentChannel.subscribe(async status=>{
    if(status==='SUBSCRIBED'&&joining){
     connection.open=true;
     $('joinError').textContent='Đã kết nối máy chủ. Đang gửi thông tin tham gia…';
     const result=await connection.send({type:'join',name,team});
     if(result!=='ok'&&joining)failJoin('Không gửi được yêu cầu vào phòng ('+result+').');
    }else if((status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED')&&joining){
     failJoin('Kết nối tới phòng bị gián đoạn ('+status+')'+(error?.message?': '+error.message:'')+'. Hãy kiểm tra mã phòng và thử lại.');
    }
   });
   window.addEventListener('beforeunload',()=>{if(connection)connection.close()},{once:true});
  }catch(e){failJoin('Không thể kết nối tới phòng: '+(e?.message||'lỗi không xác định'))}
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
 document.body.classList.add('is-mobile-controller');show('controllerView');
 const client=getSupabaseClient();
 if(!controllerHost||!client){$('controllerStatus').textContent='Thiếu mã giáo viên hoặc cấu hình Supabase';return}
 const topic=controllerTopic(controllerHost);
 controllerChannel=client.channel(topic,{config:{broadcast:{self:false},private:false}});
 controllerChannel.on('broadcast',{event:'controller-message'},({payload})=>{
  const data=payload||{};
  if(data.type==='controller-ready'||data.type==='control-state'){
   lastControllerState={state:data.state,pending:data.pending||[]};
   renderController(data.state,data.pending||[]);
   setControllerStatus('Đã đồng bộ với máy tính',true);
  }
 });
 const setControllerStatus=(message,connected=false)=>{controllerConnected=connected;$('controllerStatus').textContent=message;$('controllerView').classList.toggle('controller-offline',!connected)};
 const act=action=>{
  if(!controllerConnected||!controllerChannel){setControllerStatus('Chưa kết nối · Lệnh chưa được gửi',false);return}
  controllerChannel.send({type:'broadcast',event:'controller-message',payload:{type:'control-action',action}}).then(status=>{
   if(status!=='ok')setControllerStatus('Không gửi được lệnh điều khiển ('+status+')',false);
  }).catch(()=>setControllerStatus('Mất kết nối · Lệnh chưa được gửi',false));
 };
 setControllerStatus('Đang kết nối kênh điều khiển…',false);
 controllerChannel.subscribe(status=>{
  if(status==='SUBSCRIBED'){
   setControllerStatus('Đã kết nối kênh · Đang đồng bộ…',true);
   controllerChannel.send({type:'broadcast',event:'controller-message',payload:{type:'controller-hello'}});
  }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
   setControllerStatus('Kết nối Supabase Realtime bị gián đoạn ('+status+')',false);
  }
 });
 $('controllerTimerStart').addEventListener('click',()=>act({type:'timer-start'}));
 $('controllerTimerReset').addEventListener('click',()=>act({type:'timer-reset'}));
 $('controllerRound').addEventListener('change',()=>act({type:'set-round',value:$('controllerRound').value}));
 $('controllerCaptainVote').addEventListener('click',()=>act({type:'captain-vote'}));
 const approvalMode=$('controllerApprovalMode');if(approvalMode){approvalMode.value='auto';approvalMode.disabled=true}
 window.addEventListener('beforeunload',()=>{if(client&&controllerChannel)client.removeChannel(controllerChannel);controllerChannel=null});
}
function renderController(s,pending){
 if(!s)return;
 $('controllerClock').textContent=String(Math.floor(s.seconds/60)).padStart(2,'0')+':'+String(s.seconds%60).padStart(2,'0');
 const round=$('controllerRound');if(round)round.value=s.currentRound;
 $('controllerScoreboard').replaceChildren();
 (s.teams||[]).forEach(t=>{const card=document.createElement('article');card.className='score-card';const h=document.createElement('h3');h.textContent=t.name;const score=document.createElement('div');score.className='score';score.textContent=t.score+' điểm';const members=document.createElement('small');members.textContent=t.members.length+' thành viên';card.append(h,score,members);$('controllerScoreboard').append(card)});
 const joined=(s.teams||[]).reduce((n,t)=>n+(t.members||[]).length,0);
 $('controllerPendingCount').textContent=joined+' thành viên';
 $('controllerPending').replaceChildren();
 if(!joined){const p=document.createElement('p');p.className='muted';p.textContent='Học sinh sẽ xuất hiện tại đây ngay sau khi nhập mã phòng và kết nối.';$('controllerPending').append(p);return}
 (s.teams||[]).forEach(team=>(team.members||[]).forEach(member=>{
  const row=document.createElement('article');row.className='pending-card';
  const info=document.createElement('div');info.className='pending-info';
  const name=document.createElement('strong');name.textContent=member.name;
  const detail=document.createElement('span');detail.textContent=team.name+' · Đã vào phòng';
  info.append(name,detail);row.append(info);$('controllerPending').append(row);
 }));
}
function renderStudentState(data){if(!data||data.type!=='state')return;renderReflexStudent(data);const teamIndex=Number.isInteger(selfTeamIndex)?selfTeamIndex:Number($('studentTeam').value);const team=data.teams?.[teamIndex];const ownMember=(team?.members||[]).find(m=>m.id===connection?.peer);if(ownMember)selfName=ownMember.name;$('studentIdentityName').textContent=selfName||$('studentName').value||'Học sinh';const isCaptain=data.captains?.[teamIndex]===connection?.peer;$('studentPlay').classList.toggle('is-captain',isCaptain);$('studentPlay').classList.toggle('is-member',!isCaptain);$('studentRoleBadge').textContent=isCaptain?'ĐỘI TRƯỞNG':'THÀNH VIÊN';$('studentIdentityBar').classList.toggle('captain-identity-bar',isCaptain);if(team){$('studentTeamName').textContent=team.name;$('studentScore').textContent=team.score}$('studentRound').textContent=data.currentRound||'Chưa chọn hoạt động';$('studentTimer').textContent=data.seconds>0?'Thời gian còn lại: '+String(Math.floor(data.seconds/60)).padStart(2,'0')+':'+String(data.seconds%60).padStart(2,'0'):'Theo hướng dẫn của giáo viên.';
 const publicRoster=$('publicCaptainRoster');if(publicRoster){publicRoster.replaceChildren();(data.teams||[]).forEach((t,i)=>{const line=document.createElement('p');const leader=t.members.find(m=>m.id===data.captains?.[i]);line.textContent=t.name+': '+(leader?leader.name:'Chưa có đội trưởng');publicRoster.append(line)})}const q=data.question||{};$('studentQuestion').textContent=q.text||'Đang chờ giáo viên gửi câu hỏi…'; const election=data.captainElection||{};$('captainElection').classList.toggle('hidden',!election.open);
 const candidates=$('captainCandidates');candidates.replaceChildren();
 if(election.open)(data.teams?.[teamIndex]?.members||[]).forEach(m=>{const label=document.createElement('label');label.className='student-choice';const r=document.createElement('input');r.type='radio';r.name='captainCandidate';r.value=m.id;const span=document.createElement('span');span.textContent=m.name;label.append(r,span);candidates.append(label)});
 $('captainCountdown').textContent=election.open?'Còn '+Math.max(0,Math.ceil((election.endsAt-Date.now())/1000))+' giây':'';
 const voted=!!data.captainVotes?.[teamIndex]?.[connection?.peer];$('voteCaptain').disabled=!election.open||voted;
 const captain=data.captains?.[teamIndex];
 $('captainIdentity').textContent=isCaptain?'Bạn là ĐỘI TRƯỞNG.':(captain?'Đội trưởng: '+(team?.members||[]).find(m=>m.id===captain)?.name:'Đội chưa có đội trưởng.');
 $('captainSubmitPanel').classList.toggle('hidden',!isCaptain||!!data.teamFinals?.[teamIndex]);
 const select=$('captainAnswerSelect'),old=select.value;select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='Chọn ý kiến của thành viên';select.append(empty);
 (data.teamTexts?.[teamIndex]||[]).forEach((v,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=v.name+': '+v.text;select.append(o)});select.value=old;
 $('captainSend').disabled=!isCaptain||!!data.teamFinals?.[teamIndex];$('captainSkip').disabled=!isCaptain||!!data.teamFinals?.[teamIndex];

 const list=$('studentChoiceList'),previousChoice=document.querySelector('input[name="teamChoice"]:checked')?.value;list.replaceChildren();
 if(q.type!=='text'&&Array.isArray(q.options))q.options.forEach((option,i)=>{const label=document.createElement('label');label.className='student-choice';const radio=document.createElement('input');radio.type='radio';radio.name='teamChoice';radio.value=String(i);radio.checked=previousChoice===String(i);const span=document.createElement('span');span.textContent=option;label.append(radio,span);list.append(label)});
 $('studentChoiceList').classList.toggle('hidden',isCaptain||q.type==='text'||!q.options?.length);$('studentTextWrap').classList.toggle('hidden',isCaptain||q.type==='choice');
 const final=data.teamFinals?.[teamIndex];$('sendAnswer').disabled=!!final||!q.text;$('sendAnswer').textContent=final?'ĐỘI ĐÃ CHỐT ĐÁP ÁN':'GỬI Ý KIẾN VÀO PHÒNG ĐỘI';
 const tally=data.teamVotes?.[teamIndex]||{},ballotCount=Object.keys(tally).length,teamMessages=data.teamTexts?.[teamIndex]||[];
 const recent=teamMessages.slice(-4).map(item=>item.name+': '+item.text).join(' | ');
 $('studentTeamTally').textContent='Phòng đội: '+ballotCount+' thành viên đã chọn phương án.'+(recent?' Ý kiến mới: '+recent:'')+(final?' Đáp án chung: '+final.answer:' Giáo viên sẽ quyết định đáp án cuối cùng.');
}
function updateTeams(){teams.forEach((t,i)=>t.name=$('teamName'+i).value.trim()||'Đội '+(i+1));broadcast()}
function publishQuestion(){const q=$('discussionQuestion').value.trim();if(!q){$('questionStatus').textContent='Hãy nhập nội dung câu hỏi.';return}questionType=$('discussionType').value;questionOptions=$('discussionOptions').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,8);if(questionType!=='text'&&questionOptions.length<2){$('questionStatus').textContent='Hãy nhập ít nhất hai phương án, mỗi phương án một dòng.';return}currentQuestion=q;teamVotes=[{}, {}, {}, {}];teamTexts=[[],[],[],[]];teamFinals=[null,null,null,null];raceOrder=[];raceAwarded.clear();$('questionStatus').textContent='Đã gửi câu hỏi đến các phòng đội.';broadcast()}
function setClock(){$('roomClock').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}
if(controllerHost)startController();else if(hostId)startStudent();else{show('teacherView');renderTeacher();renderPending();$('createRoom').addEventListener('click',startTeacher);$('closeRoom').addEventListener('click',closeTeacher);$('currentRound').addEventListener('change',()=>{currentRound=$('currentRound').value;broadcast()});$('startCaptainVote').addEventListener('click',openCaptainElection);for(let i=0;i<4;i++)$('teamName'+i).addEventListener('change',updateTeams);$('timerStart').addEventListener('click',()=>{if(timer)return;timer=setInterval(()=>{if(seconds>0)seconds--;else{clearInterval(timer);timer=null}setClock();broadcast()},1000)});$('timerReset').addEventListener('click',()=>{if(timer)clearInterval(timer);timer=null;seconds=120;setClock();broadcast()});setClock();$('reflexStart').addEventListener('click',()=>startReflexQuestion(0));$('reflexNext').addEventListener('click',()=>startReflexQuestion(reflex.index+1));window.addEventListener('beforeunload',()=>{removeStudentChannel();removeControllerChannel()})}
})();
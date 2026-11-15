(() => {
'use strict';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),hostId=params.get('join'),controllerHost=params.get('control');
let connection=null,timer=null,controllerConnected=false,lastControllerState=null,selfName='',selfTeamIndex=null,seconds=300,careerPoints=[0,0,0,0],captainRevealUntil=0,reflex={active:false,index:-1,startedAt:0,selectionEndsAt:0,completed:{}},reflexVotes=[{},{},{},{}],reflexTeamPhases=Array.from({length:4},()=>({phase:'select',selectionEndsAt:0,captainEndsAt:0})),reflexClockTimer=null,reflexAutoNextTimer=null,reflexCaptainTimers=[null,null,null,null],reflexElapsed=[0,0,0,0],reflexPoints=[0,0,0,0],reflexRoundResults=[],approvalMode='auto',currentQuestion='',questionType='both',questionOptions=[],teamVotes=[{}, {}, {}, {}],teamTexts=[[],[],[],[]],teamFinals=[null,null,null,null],captainElection={open:false,endsAt:0,closed:false},captainElectionTimer=null,captainVotes=[{},{},{},{}],captains=[null,null,null,null],raceOrder=[],raceAwarded=new Set(),linkRound={active:false,order:[],turn:0,turnEndsAt:0,assigned:{},currentCard:null,cardVotes:{},lastAutoPick:null,selectionClosed:false},linkTurnTimer=null,linkSelections=[{},{},{},{}],linkNotes=[[],[],[],[]],linkSummaries=[null,null,null,null],breakthroughRound={active:false,order:[],turn:0,turnEndsAt:0,assigned:{},lastAutoPick:null,closed:false,responses:[{},{},{},{}]},breakthroughTurnTimer=null,breakthroughDrafts={},teams=['Đội 1','Đội 2','Đội 3','Đội 4'].map(name=>({name,score:0,members:[]})),connections=new Map(),controllerConnections=new Map(),pendingRequests=new Map(),submissions=[],currentRound='Khởi động',awarded=new Set(),liveBoardVisible=true,roundStarted=false,roundPoints={'Khởi động':[0,0,0,0],'Phản xạ':[0,0,0,0],'Liên kết':[0,0,0,0],'Bứt phá':[0,0,0,0],'Luyện tập':[0,0,0,0],'Vận dụng':[0,0,0,0]},bootReview=[null,null,null,null];
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
const state=()=>({type:'state',roundStarted,careerPoints,captainRevealUntil,reflex,reflexVotes,reflexTeamPhases,reflexElapsed,teams,submissions,currentRound,seconds,approvalMode,question:{text:currentQuestion,type:questionType,options:questionOptions},teamVotes,teamTexts,teamFinals,captainElection,captainVotes,captains,raceOrder,linkRound,linkSelections,linkNotes,linkSummaries,breakthroughRound,liveBoardVisible,roundPoints,bootReview,reflexRoundResults});
const send=(c,d)=>{try{if(c&&c.open)c.send(d)}catch(e){}};
function addRoundPoints(round,team,points){if(!roundPoints[round])roundPoints[round]=[0,0,0,0];roundPoints[round][team]=(roundPoints[round][team]||0)+points}
function roundRows(data,round){const values=data.roundPoints?.[round]||[0,0,0,0];return (data.teams||[]).map((team,i)=>({team:team.name,points:values[i]||0,index:i})).sort((a,b)=>b.points-a.points||a.index-b.index)}
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
function closeCaptainElection(){if(captainElectionTimer){clearInterval(captainElectionTimer);captainElectionTimer=null}if(!captainElection.open)return;captainElection.open=false;captainElection.closed=true;captainRevealUntil=Date.now()+5000;teams.forEach((team,i)=>{const counts={};Object.entries(captainVotes[i]).forEach(([voter,v])=>{const x=counts[v.candidate]||(counts[v.candidate]={n:0,first:Infinity});x.n++;x.first=Math.min(x.first,v.time)});const win=Object.entries(counts).sort((a,b)=>b[1].n-a[1].n||a[1].first-b[1].first)[0];captains[i]=win?win[0]:null});$('captainVoteStatus').textContent='Đã kết thúc bầu chọn.';renderCaptainRoster();broadcast()}
function openCaptainElection(){captainVotes=[{},{},{},{}];captains=[null,null,null,null];captainRevealUntil=0;captainElection={open:true,startedAt:Date.now(),endsAt:Date.now()+15000,closed:false};$('captainVoteStatus').textContent='Đang bầu chọn.';renderCaptainRoster();broadcast();if(captainElectionTimer)clearInterval(captainElectionTimer);captainElectionTimer=setInterval(()=>{if(!captainElection.open){clearInterval(captainElectionTimer);captainElectionTimer=null;return}if(Date.now()>=captainElection.endsAt){closeCaptainElection();return}broadcast()},250)}
function renderCaptainRoster(){const root=$('captainRoster');if(!root)return;root.replaceChildren();teams.forEach((team,i)=>{const line=document.createElement('p');const captain=team.members.find(m=>m.id===captains[i]);line.textContent=team.name+': '+(captain?captain.name:'Chưa có đội trưởng');root.append(line)})}

const reflexJobs=[["Bác sĩ","https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=1600&q=85",["Bác sĩ","Giáo viên","Kỹ sư","Đầu bếp"],0],["Giáo viên","https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1600&q=85",["Nhà báo","Giáo viên","Bác sĩ","Phi công"],1],["Cảnh sát","https://images.unsplash.com/photo-1453873531674-2151bcd01707?auto=format&fit=crop&w=1600&q=85",["Lính cứu hỏa","Cảnh sát","Tài xế","Thợ điện"],1],["Lính cứu hỏa","https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1600&q=85",["Công nhân xây dựng","Bác sĩ","Lính cứu hỏa","Nông dân"],2],["Đầu bếp","https://images.unsplash.com/photo-1577219491135-ce391730fb2c?auto=format&fit=crop&w=1600&q=85",["Đầu bếp","Thợ may","Giáo viên","Phi công"],0],["Công nhân xây dựng","https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1600&q=85",["Thợ điện","Nông dân","Công nhân xây dựng","Cảnh sát"],2],["Nông dân","https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1600&q=85",["Tài xế","Nông dân","Đầu bếp","Bác sĩ"],1],["Thợ điện","https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=1600&q=85",["Thợ may","Thợ điện","Phi công","Giáo viên"],1],["Phi công","https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1600&q=85",["Phi công","Cảnh sát","Bác sĩ","Tài xế"],0],["Tài xế","https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?auto=format&fit=crop&w=1600&q=85",["Nông dân","Thợ điện","Tài xế","Đầu bếp"],2],["Thợ may","https://images.unsplash.com/photo-1590736969955-71cc94901144?auto=format&fit=crop&w=1600&q=85",["Thợ may","Giáo viên","Cảnh sát","Bác sĩ"],0],["Nhân viên bưu điện","https://images.unsplash.com/photo-1580674285054-bed31e145f59?auto=format&fit=crop&w=1600&q=85",["Phi công","Nhân viên bưu điện","Tài xế","Thợ điện"],1]];
 function clearReflexTimers(){if(reflexClockTimer){clearInterval(reflexClockTimer);reflexClockTimer=null}if(reflexAutoNextTimer){clearTimeout(reflexAutoNextTimer);reflexAutoNextTimer=null}reflexCaptainTimers.forEach((t,i)=>{if(t)clearTimeout(t);reflexCaptainTimers[i]=null})}
 function startReflexCaptainWindow(team){if(!reflex.active||reflex.completed[team]||reflexTeamPhases[team].phase!=='select')return;reflexTeamPhases[team]={...reflexTeamPhases[team],phase:'captain',captainEndsAt:Date.now()+5000};if(reflexCaptainTimers[team])clearTimeout(reflexCaptainTimers[team]);reflexCaptainTimers[team]=setTimeout(()=>finalizeReflexTeam(team),5000);teams[team].members.forEach(m=>{const c=connections.get(m.id);if(c)send(c,{type:'reflex-feedback',message:'Đã hết thời gian chọn. Đội trưởng có tối đa 5 giây để nộp đáp án.'})});broadcast()}
 function finalizeReflexTeam(team){if(!reflex.active||reflex.completed[team])return;const votes=Object.entries(reflexVotes[team]||{});if(!votes.length){reflexTeamPhases[team]={...reflexTeamPhases[team],phase:'closed',captainEndsAt:0};broadcast();return}const counts={};votes.forEach(([member,v])=>{const x=counts[v.option]||(counts[v.option]={count:0,last:0});x.count++;x.last=Math.max(x.last,v.time||0)});const chosen=Object.entries(counts).sort((a,b)=>b[1].count-a[1].count||b[1].last-a[1].last)[0];const option=Number(chosen[0]),job=reflexJobs[reflex.index];if(reflexCaptainTimers[team]){clearTimeout(reflexCaptainTimers[team]);reflexCaptainTimers[team]=null}if(option!==job[3]){reflexVotes[team]={};const deadline=reflexTeamPhases[team].selectionEndsAt||reflex.selectionEndsAt;reflexTeamPhases[team]={phase:Date.now()<deadline?'select':'closed',selectionEndsAt:deadline,captainEndsAt:0};teams[team].members.forEach(m=>{const c=connections.get(m.id);if(c)send(c,{type:'reflex-feedback',message:'Đáp án đa số chưa chính xác. Đội có thể chọn lại nếu còn thời gian.'})});broadcast();return}const elapsed=Date.now()-reflex.startedAt,rank=Object.keys(reflex.completed).length,points=[10,7,5,3][rank]||0;reflex.completed[team]={time:elapsed,points,option,votes:votes.length};reflexElapsed[team]+=elapsed;reflexPoints[team]+=points;teams[team].score+=points;addRoundPoints('Phản xạ',team,points);careerPoints[team]+=[10,7,5,3][rank]||0;reflexRoundResults.push({team,question:reflex.index,time:elapsed,points,careerPoints:[10,7,5,3][rank]||0});reflexTeamPhases[team]={...reflexTeamPhases[team],phase:'done',captainEndsAt:0};teams[team].members.forEach(m=>{const c=connections.get(m.id);if(c)send(c,{type:'reflex-feedback',message:'Đáp án đa số chính xác. Đội nhận '+points+' điểm.'})});broadcast()}
 function startReflexQuestion(index){clearReflexTimers();if(index>=reflexJobs.length){reflex.active=false;reflex.index=-1;$('reflexStatus').textContent='Đã hoàn thành 12 hình ảnh.';$('reflexNext').disabled=true;broadcast();return}const now=Date.now();roundStarted=true;reflex={active:true,index,startedAt:now,selectionEndsAt:now+10000,completed:{}};reflexVotes=[{},{},{},{}];reflexTeamPhases=Array.from({length:4},()=>({phase:'select',selectionEndsAt:now+10000,captainEndsAt:0}));$('reflexStatus').textContent='Câu '+(index+1)+' / 12 · '+reflexJobs[index][0]+' · 15 giây chọn đáp án';$('reflexNext').disabled=false;reflexClockTimer=setInterval(()=>{if(!reflex.active){clearReflexTimers();return}for(let i=0;i<4;i++)if(reflexTeamPhases[i].phase==='select'&&Date.now()>=(reflexTeamPhases[i].selectionEndsAt||reflex.selectionEndsAt))startReflexCaptainWindow(i);broadcast()},1000);reflexAutoNextTimer=setTimeout(()=>{if(!reflex.active||reflex.index!==index)return;for(let team=0;team<4;team++){if(reflexTeamPhases[team].phase==='captain')finalizeReflexTeam(team);else if(reflexTeamPhases[team].phase==='select')startReflexCaptainWindow(team)}startReflexQuestion(index+1)},15000);broadcast()}
function renderReflexTeacher(){const live=$('reflexLiveBoard'),board=$('reflexAchievements');if(!live||!board)return;const rows=teams.map((t,i)=>({name:t.name,done:!!reflex.completed?.[i],points:reflexPoints[i],time:reflexElapsed[i]})).sort((a,b)=>(b.points-a.points)||(a.time-b.time));live.replaceChildren();rows.forEach(r=>{const row=document.createElement('div');row.className='reflex-live-row';const name=document.createElement('strong');name.textContent=r.name;const track=document.createElement('div');track.className='reflex-track';const fill=document.createElement('span');fill.style.width=Math.max(4,Math.min(100,r.points*2))+'%';track.append(fill);const label=document.createElement('small');label.textContent=r.done?'Đã trả lời':'Đang thực hiện';row.append(name,track,label);live.append(row)});board.replaceChildren();}
 function renderReflexStudent(data){const panel=$('reflexStudentPanel');if(!panel)return;const r=data.reflex||{},selected=data.currentRound==='Phản xạ';panel.classList.toggle('hidden',!selected);const legacy=document.querySelector('.student-discussion');if(legacy)legacy.classList.toggle('hidden',data.currentRound!=='Khởi động');if(!selected||!r.active){$('reflexImageStage').classList.add('hidden');return}const job=reflexJobs[r.index];if(!job)return;const teamIndex=Number.isInteger(selfTeamIndex)?selfTeamIndex:Number($('studentTeam').value),isCaptain=data.captains?.[teamIndex]===connection?.peer,phase=data.reflexTeamPhases?.[teamIndex]||{phase:'select'},votes=data.reflexVotes?.[teamIndex]||{},myVote=votes[connection?.peer],done=!!r.completed?.[teamIndex],deadline=phase.selectionEndsAt||r.selectionEndsAt;$('reflexLeaderControls').classList.toggle('hidden',!isCaptain);$('reflexMemberQuiz').classList.toggle('hidden',isCaptain);$('reflexQuestionNumber').textContent='CÂU '+(r.index+1)+' / 12';$('reflexImage').src=job[1];const reveal=()=>{const stage=$('reflexImageStage');stage.classList.remove('hidden');clearTimeout(window.__reflexHideTimer);window.__reflexHideTimer=setTimeout(()=>stage.classList.add('hidden'),isCaptain?3000:5000)};const revealKey=String(r.startedAt)+':'+String(r.index);if(window.__reflexShownKey!==revealKey){window.__reflexShownKey=revealKey;$('reflexImageStage').classList.add('hidden');const count=$('reflexCountdown');count.classList.remove('hidden');count.textContent='3';let n=3;const tick=setInterval(()=>{n--;if(n<=0){clearInterval(tick);count.classList.add('hidden');reveal()}else count.textContent=String(n)},1000)}$('reflexLeaderReveal').onclick=reveal;$('reflexMemberReveal').onclick=reveal;const options=$('reflexOptions');options.replaceChildren();job[2].forEach((label,i)=>{const b=document.createElement('button');b.type='button';b.className='reflex-option'+(myVote?.option===i?' selected':'');b.textContent=String.fromCharCode(65+i)+'. '+label;b.disabled=done||phase.phase!=='select'||Date.now()>deadline;b.onclick=()=>send(connection,{type:'reflex-choice',question:r.index,option:i});options.append(b)});const remain=Math.max(0,Math.ceil(((phase.phase==='captain'?phase.captainEndsAt:deadline)-Date.now())/1000)),voteCount=Object.keys(votes).length,tally=job[2].map((label,i)=>({label,count:Object.values(votes).filter(v=>v.option===i).length})),lead=tally.slice().sort((a,b)=>b.count-a.count)[0];$('reflexMemberFeedback').textContent=done?'Đội đã chốt đáp án và nhận '+r.completed[teamIndex].points+' điểm.':isCaptain?'Thành viên đã chọn: '+voteCount+'. '+(lead&&lead.count?'Đáp án đang dẫn đầu: '+lead.label+' ('+lead.count+' phiếu).':'Đang chờ thành viên chọn đáp án.'):(myVote?'Đã chọn: '+job[2][myVote.option]+'. Bạn có thể thay đổi đến khi hết giờ.':'Chọn một đáp án. Bạn có thể thay đổi lựa chọn trong 15 giây.');const phaseText=phase.phase==='select'?'Thời gian chọn: '+Math.max(0,Math.ceil((deadline-Date.now())/1000))+' giây':phase.phase==='captain'?'Đội trưởng chốt trong: '+remain+' giây':phase.phase==='done'?'Đã chốt đáp án':'Đã hết thời gian';$('reflexPhaseStatus').textContent=phaseText;$('reflexPhaseStatusMember').textContent=phaseText;$('reflexHurry').disabled=done||phase.phase!=='select';$('reflexSubmitNow').disabled=done||voteCount===0;$('reflexHurry').onclick=()=>send(connection,{type:'reflex-captain-action',action:'hurry'});$('reflexSubmitNow').onclick=()=>send(connection,{type:'reflex-captain-action',action:'submit'});$('reflexHurry').classList.toggle('hidden',!isCaptain);$('reflexSubmitNow').classList.toggle('hidden',!isCaptain)}

const linkCats=[['work','CÔNG VIỆC'],['tools','CÔNG CỤ – THIẾT BỊ'],['skills','NĂNG LỰC – PHẨM CHẤT'],['conditions','ĐIỀU KIỆN LÀM VIỆC'],['challenges','THÁCH THỨC NGHỀ NGHIỆP']];
const linkDragAssignments={};let linkSelectedCard=null;
const linkExtra={
"Nhà hải dương học":["Tàu nghiên cứu; cảm biến biển; thiết bị đo nhiệt độ và độ mặn; máy lấy mẫu nước; GPS; phần mềm phân tích.","Phòng thí nghiệm, trung tâm nghiên cứu hoặc tàu ngoài biển; có đợt khảo sát dài ngày."],
"Kỹ sư IoT":["Cảm biến; vi điều khiển; bo mạch điện tử; máy tính; đồng hồ vạn năng; máy hiện sóng; phần mềm lập trình.","Văn phòng kỹ thuật, phòng thí nghiệm, nhà máy hoặc nơi lắp đặt thiết bị."],
"Phi công":["Máy bay; hệ thống điều khiển buồng lái; thiết bị định vị; vô tuyến; bản đồ hàng không; mô phỏng bay.","Buồng lái và sân bay; lịch bay theo ca, có thể bay đêm hoặc lưu trú xa nhà."],
"Thiết kế đồ họa":["Máy tính; bảng vẽ điện tử; màn hình đồ họa; máy ảnh; phần mềm thiết kế; thiết bị in thử.","Văn phòng, studio hoặc làm việc từ xa; thường phối hợp với khách hàng và nhóm truyền thông."],
"Đầu bếp":["Dao; thớt; nồi; chảo; bếp; lò nướng; tủ lạnh; nhiệt kế thực phẩm; dụng cụ bảo hộ.","Bếp nhà hàng, khách sạn hoặc bếp ăn; môi trường nóng, đứng lâu, làm theo ca."],
"Kế toán":["Máy tính; máy tính cầm tay; phần mềm kế toán; bảng tính; chứng từ; hệ thống lưu trữ dữ liệu.","Văn phòng hoặc bộ phận tài chính; làm việc với chứng từ, dữ liệu và thời hạn báo cáo."],
"Luật sư":["Bộ luật; hồ sơ vụ việc; máy tính; cơ sở dữ liệu pháp lý; công cụ soạn thảo văn bản.","Văn phòng luật, doanh nghiệp hoặc cơ quan tố tụng; bảo mật hồ sơ và có thể di chuyển gặp khách hàng."],
"Ngư dân":["Tàu hoặc thuyền; lưới và ngư cụ; máy định vị; thiết bị liên lạc; áo phao; dụng cụ bảo quản thủy sản.","Tàu thuyền, vùng nuôi trồng hoặc ven biển; phụ thuộc thời tiết, mùa vụ và yêu cầu an toàn trên nước."],
"Công an":["Phương tiện công vụ; thiết bị liên lạc; máy tính; phương tiện ghi nhận thông tin; trang bị bảo hộ theo nhiệm vụ.","Đơn vị công tác hoặc địa bàn được phân công; có thể trực và làm việc theo ca."],
"Thợ điện":["Kìm cách điện; tua vít cách điện; đồng hồ vạn năng; bút thử điện; thiết bị đo; phương tiện bảo hộ.","Công trình, nhà ở, nhà máy hoặc cơ sở bảo trì; có thể làm trên cao và phải tuân thủ an toàn điện."],
"Bác sĩ":["Ống nghe; máy đo huyết áp; nhiệt kế; thiết bị chẩn đoán; hồ sơ bệnh án; phương tiện bảo hộ y tế.","Bệnh viện, phòng khám hoặc cơ sở y tế; có thể trực đêm và tuân thủ quy trình kiểm soát nhiễm khuẩn."],
"Kỹ sư xây dựng":["Bản vẽ kỹ thuật; máy tính; phần mềm thiết kế; thiết bị đo đạc; dụng cụ kiểm tra vật liệu; trang bị bảo hộ.","Văn phòng thiết kế và công trường; di chuyển giữa các địa điểm, chịu ảnh hưởng thời tiết và quy định an toàn."],
"Nhân viên marketing":["Máy tính; phần mềm thiết kế; công cụ phân tích dữ liệu; nền tảng quảng cáo; thiết bị ghi hình.","Doanh nghiệp, công ty truyền thông hoặc làm từ xa; phối hợp nhiều bộ phận và theo tiến độ chiến dịch."],
"Nông dân":["Cuốc; xẻng; máy làm đất; hệ thống tưới; dụng cụ thu hoạch; thiết bị theo dõi thời tiết.","Đồng ruộng, trang trại hoặc nhà kính; hoạt động ngoài trời, phụ thuộc mùa vụ và thời tiết."],
"Giáo viên":["Sách giáo khoa; giáo án; bảng; máy tính; máy chiếu; học liệu số; thiết bị dạy học.","Trường học hoặc cơ sở giáo dục; giảng dạy theo thời khóa biểu, chuẩn bị bài và phối hợp với học sinh."],
"Lập trình viên":["Máy tính; phần mềm soạn thảo mã; trình biên dịch; hệ thống quản lý phiên bản; công cụ kiểm thử.","Văn phòng hoặc làm từ xa; sử dụng máy tính thời gian dài và làm việc theo tiến độ dự án."],
"Phi hành gia":["Bộ đồ du hành vũ trụ; hệ thống hỗ trợ sự sống; thiết bị liên lạc; bảng điều khiển; dụng cụ thí nghiệm.","Trung tâm huấn luyện và môi trường không gian có kiểm soát; yêu cầu tuyển chọn, sức khỏe và kỷ luật nghiêm ngặt."],
"Chuyên gia nghiên cứu núi lửa":["Thiết bị đo địa chấn; máy đo khí; camera nhiệt; GPS; dụng cụ lấy mẫu đá; đồ bảo hộ.","Viện nghiên cứu, phòng thí nghiệm và khu vực thực địa; có nơi địa hình khó, khí độc hoặc nguy cơ phun trào."],
"Hướng dẫn viên":["Micro; loa; bản đồ; thiết bị định vị; điện thoại; tài liệu thuyết minh; phương tiện liên lạc.","Điểm du lịch, phương tiện di chuyển và ngoài trời; lịch trình linh hoạt, thường phải đi lại."],
"Nhà khảo cổ học":["Bản đồ khảo sát; GPS; máy ảnh; thước đo; bay và chổi khai quật; túi mẫu; sổ ghi chép.","Viện nghiên cứu, bảo tàng, phòng thí nghiệm và khu khai quật; thực địa kéo dài và chịu ảnh hưởng thời tiết."]
};
function linkP(name){const p=(window.PROFESSIONS||[]).find(x=>x.name===name)||{},x=linkExtra[name]||[];return{name,work:p.work||'',tools:x[0]||'Thiết bị và dụng cụ chuyên môn phù hợp với nghề.',skills:p.skills||'',conditions:x[1]||'Làm việc tại cơ sở chuyên môn hoặc địa điểm thực hiện nhiệm vụ.',challenges:p.challenges||'',benefits:p.value||''}}
function linkParts(v){return String(v||'').split(/;|(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean)}
function linkOrder(){return teams.map((t,i)=>i).filter(i=>(teams[i].members||[]).length>0).sort((a,b)=>(teams[b].score-teams[a].score)||(reflexPoints[b]-reflexPoints[a])||(reflexElapsed[a]-reflexElapsed[b])||a-b)}
function startLinkRound(){if(linkRound.active)return;roundStarted=true;currentRound='Liên kết';seconds=roundDuration(currentRound);$('currentRound').value=currentRound;linkRound={active:true,order:linkOrder(),turn:0,turnEndsAt:0,assigned:{},currentCard:null,cardVotes:{},lastAutoPick:null,selectionClosed:false};linkSelections=[{},{},{},{}];linkNotes=[[],[],[],[]];linkSummaries=[null,null,null,null];$('linkRoundStatus').textContent=linkRound.order.length?'Thứ tự chọn thẻ theo điểm số của các đội tham gia.':'Chưa có đội nào tham gia vòng Liên Kết.';if(timer)clearInterval(timer);timer=setInterval(()=>{if(seconds>0)seconds--;if(seconds===0){clearInterval(timer);timer=null;closeLinkSelections()}setClock();broadcast()},1000);const overlay=$('linkFireworks');if(linkRound.order.length){$('linkFireworksWinner').textContent=teams[linkRound.order[0]]?.name||'Đội dẫn đầu';overlay.classList.remove('hidden');setTimeout(()=>overlay.classList.add('hidden'),4200);startLinkTurn()}else broadcast()}
function drawLinkCardForTeam(t){if(!linkRound.active||linkRound.selectionClosed||linkRound.assigned[t]||linkRound.order[linkRound.turn]!==t||linkRound.currentCard)return false;const all=(window.PROFESSIONS||[]).map(p=>p.name),used=Object.values(linkRound.assigned),available=all.filter(n=>!used.includes(n));if(!available.length)return false;const name=available[Math.floor(Math.random()*available.length)];linkRound.currentCard={team:t,name,profile:linkP(name)};linkRound.cardVotes[t]={};return true}
function startLinkTurn(){if(linkTurnTimer){clearTimeout(linkTurnTimer);linkTurnTimer=null}if(!linkRound.active||linkRound.selectionClosed)return;while(linkRound.turn<(linkRound.order||[]).length&&linkRound.assigned[linkRound.order[linkRound.turn]])linkRound.turn++;if(linkRound.turn>=linkRound.order.length){linkRound.turnEndsAt=0;broadcast();return}const team=linkRound.order[linkRound.turn];linkRound.turnEndsAt=Date.now()+10000;linkTurnTimer=setTimeout(()=>{linkTurnTimer=null;if(!linkRound.active||linkRound.selectionClosed||linkRound.order[linkRound.turn]!==team||linkRound.assigned[team]||linkRound.currentCard)return;if(drawLinkCardForTeam(team)){linkRound.lastAutoPick={team,name:linkRound.currentCard.name};linkRound.assigned[team]=linkRound.currentCard.name;linkRound.currentCard=null;linkRound.turn++;linkRound.turnEndsAt=0;startLinkTurn();broadcast()}},10000);broadcast()}
function requestLinkDraw(conn){const t=conn.__team;if(!linkRound.active||linkRound.selectionClosed||linkRound.assigned[t]||captains[t]!==conn.peer)return;if(linkRound.order[linkRound.turn]!==t){send(conn,{type:'link-card-feedback',message:'Hãy chờ đến lượt theo thứ hạng điểm số.'});return}if(linkRound.currentCard?.team===t)return;if(linkTurnTimer){clearTimeout(linkTurnTimer);linkTurnTimer=null}linkRound.turnEndsAt=0;if(drawLinkCardForTeam(t))broadcast()}
function recordLinkCardVote(conn,choice){const t=conn.__team;if(linkRound.currentCard?.team!==t||!['accept','reject'].includes(choice))return;linkRound.cardVotes[t]=linkRound.cardVotes[t]||{};linkRound.cardVotes[t][conn.peer]={choice};send(conn,{type:'link-card-feedback',message:'Đã ghi nhận lựa chọn.'});broadcast()}
function lockLinkCard(conn){const t=conn.__team;if(captains[t]!==conn.peer||linkRound.currentCard?.team!==t||linkRound.assigned[t])return;const v=Object.values(linkRound.cardVotes[t]||{}),yes=v.filter(x=>x.choice==='accept').length,no=v.filter(x=>x.choice==='reject').length;if(v.length&&no>=yes){send(conn,{type:'link-card-feedback',message:'Đa số muốn bỏ thẻ. Hãy bốc thẻ khác.'});return}linkRound.assigned[t]=linkRound.currentCard.name;linkRound.currentCard=null;linkRound.cardVotes[t]={};linkRound.turn++;linkRound.turnEndsAt=0;startLinkTurn();broadcast()}
function saveLinkMemberSubmission(conn,d){const t=conn.__team;if(!linkRound.active||linkRound.selectionClosed||!linkRound.assigned[t])return;const selections={};linkCats.forEach(([k])=>{const a=linkParts(linkP(linkRound.assigned[t])[k]),raw=d.selections?.[k],values=Array.isArray(raw)?raw:[raw];selections[k]=[...new Set(values.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<a.length))]});linkSelections[t][conn.peer]={name:conn.__name,selections};const note=String(d.note||'').trim().slice(0,1200);linkNotes[t]=linkNotes[t].filter(x=>x.id!==conn.peer);if(note)linkNotes[t].push({id:conn.peer,name:conn.__name,text:note});send(conn,{type:'link-member-result',message:'Đã gửi hộp thẻ về Đội trưởng.'});broadcast()}
function closeLinkSelections(){if(!linkRound.active||linkRound.selectionClosed)return;if(linkTurnTimer){clearTimeout(linkTurnTimer);linkTurnTimer=null}linkRound.turnEndsAt=0;linkRound.selectionClosed=true;linkSummaries=teams.map((t,i)=>{const p=linkP(linkRound.assigned[i]||''),categories={};linkCats.forEach(([k,label])=>{const tally={};Object.values(linkSelections[i]||{}).forEach(v=>{(Array.isArray(v.selections?.[k])?v.selections[k]:[v.selections?.[k]]).forEach(n=>{const text=linkParts(p[k])[n];if(Number.isInteger(n)&&text)tally[text]=(tally[text]||0)+1})});categories[k]={label,items:Object.entries(tally).sort((a,b)=>b[1]-a[1]).map(([text,count])=>({text,count}))}});return{categories,notes:linkNotes[i]}});broadcast()}

const breakthroughChoices=[['duties','focus','📋','Nhiệm vụ công việc','Công việc chính và trách nhiệm hằng ngày'],['requirements','focus','🎓','Yêu cầu chuyên môn','Kiến thức, trình độ và chứng chỉ cần có'],['skills','focus','🧠','Năng lực và phẩm chất','Kỹ năng chuyên môn, giao tiếp, tư duy và thái độ'],['conditions','focus','🏢','Điều kiện làm việc','Địa điểm, thời gian và môi trường làm việc'],['challenges','focus','⚠️','Khó khăn và rủi ro','Áp lực, nguy cơ và trở ngại trong nghề'],['tools','focus','🧰','Công cụ, thiết bị','Máy móc, phần mềm và phương tiện chuyên dụng'],['changes','focus','🔄','Sự thay đổi của nghề','Nhiệm vụ thay đổi khi công nghệ phát triển'],['newskills','focus','🚀','Kỹ năng cần bổ sung','Năng lực mới để thích ứng với yêu cầu tương lai'],['official','source','🏛️','Trang thông tin chính thức','Cơ quan quản lý, tổ chức nghề nghiệp hoặc đơn vị tuyển dụng'],['research','source','📚','Tài liệu chuyên môn','Sách, báo cáo, nghiên cứu và tài liệu hướng nghiệp'],['interview','source','🎙️','Phỏng vấn người trong nghề','Trao đổi với người có kinh nghiệm thực tế'],['observe','source','🔍','Quan sát thực tế','Tìm hiểu nơi làm việc và cách công việc được thực hiện'],['survey','source','📝','Khảo sát, bảng hỏi','Thu thập ý kiến từ người làm nghề'],['jobpost','source','💼','Thông tin tuyển dụng','Đối chiếu mô tả công việc và yêu cầu tuyển dụng'],['expert','source','👥','Chuyên gia, cơ sở đào tạo','Trao đổi với chuyên gia hoặc cơ sở đào tạo'],['crosscheck','verify','🔗','Đối chiếu nhiều nguồn','So sánh thông tin từ ít nhất hai nguồn độc lập'],['author','verify','✍️','Kiểm tra tác giả và đơn vị','Xác định người viết và tổ chức chịu trách nhiệm'],['date','verify','🗓️','Kiểm tra thời điểm cập nhật','Xem ngày đăng, ngày cập nhật và tính phù hợp'],['evidence','verify','📊','Kiểm tra bằng chứng','Tìm số liệu, tài liệu gốc hoặc dẫn chứng xác minh']].map(([id,group,icon,title,detail])=>({id,group,icon,title,detail}));
const breakthroughGroups=[['focus','NỘI DUNG CẦN TÌM HIỂU'],['source','NGUỒN VÀ CÁCH TÌM HIỂU'],['verify','KIỂM CHỨNG THÔNG TIN']];
function startBreakthroughRound(){if(breakthroughRound.active)return;roundStarted=true;currentRound='Bứt phá';seconds=roundDuration(currentRound);$('currentRound').value=currentRound;breakthroughRound={active:true,order:linkOrder(),turn:0,turnEndsAt:0,assigned:{},lastAutoPick:null,closed:false,responses:[{},{},{},{}]};Object.keys(breakthroughDrafts).forEach(k=>delete breakthroughDrafts[k]);if(timer)clearInterval(timer);timer=setInterval(()=>{if(seconds>0)seconds--;if(seconds<=0){seconds=0;clearInterval(timer);timer=null;closeBreakthroughRound()}setClock();broadcast()},1000);startBreakthroughTurn();broadcast()}
function startBreakthroughTurn(){if(breakthroughTurnTimer)clearTimeout(breakthroughTurnTimer);breakthroughTurnTimer=null;if(!breakthroughRound.active||breakthroughRound.closed)return;while(breakthroughRound.turn<breakthroughRound.order.length&&breakthroughRound.assigned[breakthroughRound.order[breakthroughRound.turn]]!==undefined)breakthroughRound.turn++;if(breakthroughRound.turn>=breakthroughRound.order.length){breakthroughRound.turnEndsAt=0;broadcast();return}const t=breakthroughRound.order[breakthroughRound.turn];breakthroughRound.turnEndsAt=Date.now()+10000;breakthroughTurnTimer=setTimeout(()=>{breakthroughTurnTimer=null;if(breakthroughRound.active&&!breakthroughRound.closed&&breakthroughRound.order[breakthroughRound.turn]===t&&breakthroughRound.assigned[t]===undefined)drawBreakthroughScenario(t,true)},10000);broadcast()}
function drawBreakthroughScenario(t,automatic=false){if(!breakthroughRound.active||breakthroughRound.closed||breakthroughRound.assigned[t]!==undefined||breakthroughRound.order[breakthroughRound.turn]!==t)return false;const pool=(window.SCENARIOS||[]).map((s,i)=>i).filter(i=>!Object.values(breakthroughRound.assigned).includes(i));if(!pool.length)return false;if(breakthroughTurnTimer)clearTimeout(breakthroughTurnTimer);breakthroughTurnTimer=null;const index=pool[Math.floor(Math.random()*pool.length)];breakthroughRound.assigned[t]=index;breakthroughRound.lastAutoPick=automatic?{team:t,index}:null;breakthroughRound.turn++;breakthroughRound.turnEndsAt=0;startBreakthroughTurn();broadcast();return true}
function closeBreakthroughRound(){if(!breakthroughRound.active||breakthroughRound.closed)return;if(breakthroughTurnTimer)clearTimeout(breakthroughTurnTimer);breakthroughTurnTimer=null;breakthroughRound.turnEndsAt=0;breakthroughRound.closed=true;broadcast()}
function saveBreakthroughSubmission(conn,ids){const t=conn.__team;if(!breakthroughRound.active||breakthroughRound.closed||!Number.isInteger(breakthroughRound.assigned[t])||breakthroughRound.responses[t][conn.peer])return;const valid=new Set(breakthroughChoices.map(x=>x.id)),selected=[...new Set((Array.isArray(ids)?ids:[]).filter(x=>valid.has(x)))];if(!selected.length){send(conn,{type:'breakthrough-feedback',message:'Hãy chọn ít nhất một nội dung phù hợp.'});return}breakthroughRound.responses[t][conn.peer]={name:conn.__name,ids:selected,time:Date.now()};send(conn,{type:'breakthrough-feedback',message:'Đã gửi lựa chọn về cho Đội trưởng.'});broadcast()}
function renderBreakthroughAdmin(data,id){const root=$(id);if(!root)return;root.replaceChildren();const br=data?.breakthroughRound;if(!br?.active){root.textContent='Chưa bắt đầu vòng Bứt phá.';return}(br.order||[]).forEach(t=>{const row=document.createElement('div');row.className='breakthrough-admin-row';const name=document.createElement('strong'),num=document.createElement('span');name.textContent=data.teams?.[t]?.name||('Đội '+(t+1));num.textContent=br.assigned?.[t]!==undefined?'Tình huống số '+String(br.assigned[t]+1).padStart(2,'0'):'Đang chờ bốc thăm';row.append(name,num);root.append(row)})}
function renderBreakthroughStudent(data){const stage=$('breakthroughStudentStage'),br=data.breakthroughRound||{},selected=data.currentRound==='Bứt phá';stage.classList.toggle('hidden',!selected);if(!selected)return;const t=Number(selfTeamIndex),captain=data.captains?.[t]===connection?.peer,idx=br.assigned?.[t],active=br.order?.[br.turn],status=$('breakthroughStageStatus'),draw=$('breakthroughDraw'),scenario=$('breakthroughScenario'),area=$('breakthroughSelectionArea'),summary=$('breakthroughCaptainSummary');draw.onclick=()=>send(connection,{type:'breakthrough-draw-request'});status.textContent=!br.active?'Chờ giáo viên bắt đầu vòng Bứt phá.':br.closed?'Đã kết thúc thời gian giải quyết.':idx!==undefined?'Đội đã nhận tình huống số '+String(idx+1).padStart(2,'0'):active===t?'Đến lượt đội bạn · '+Math.max(0,Math.ceil((br.turnEndsAt-Date.now())/1000))+' giây để bốc thăm':active!==undefined?'Đang chờ '+(data.teams?.[active]?.name||'đội trước')+' bốc thăm':'Các đội đã nhận tình huống. Bắt đầu giải quyết.';if(br.lastAutoPick?.team===t&&idx===br.lastAutoPick.index)status.textContent='Hết 10 giây, hệ thống tự bốc thăm tình huống số '+String(idx+1).padStart(2,'0');draw.classList.toggle('hidden',!br.active||!captain||idx!==undefined||br.closed||active!==t);draw.disabled=!captain||br.closed||active!==t;scenario.classList.toggle('hidden',idx===undefined);area.classList.toggle('hidden',idx===undefined||captain||br.closed);summary.classList.toggle('hidden',idx===undefined||!captain);if(idx===undefined)return;const item=(window.SCENARIOS||[])[idx];if(!item)return;$('breakthroughScenarioNumber').textContent='TÌNH HUỐNG SỐ '+String(idx+1).padStart(2,'0');$('breakthroughScenarioTitle').textContent=item.title||'Tình huống nghề nghiệp';$('breakthroughScenarioContext').textContent=item.context||'';$('breakthroughScenarioTask').textContent=item.task||'';if(!captain&&!br.closed){const key=t+':'+connection.peer,submitted=br.responses?.[t]?.[connection.peer],draft=breakthroughDrafts[key]||(breakthroughDrafts[key]=new Set(submitted?.ids||[])),pool=$('breakthroughChoicePool');pool.replaceChildren();breakthroughGroups.forEach(([group,label])=>{const sec=document.createElement('section');sec.className='breakthrough-choice-group';const hd=document.createElement('h3');hd.textContent=label;const grid=document.createElement('div');grid.className='breakthrough-choice-grid';breakthroughChoices.filter(x=>x.group===group).forEach(choice=>{const btn=document.createElement('button');btn.type='button';btn.className='breakthrough-choice-card';btn.classList.toggle('is-selected',draft.has(choice.id));btn.disabled=!!submitted;const icon=document.createElement('span'),copy=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('small');icon.className='breakthrough-choice-icon';icon.textContent=choice.icon;title.textContent=choice.title;detail.textContent=choice.detail;copy.append(title,detail);btn.append(icon,copy);btn.addEventListener('click',()=>{if(draft.has(choice.id))draft.delete(choice.id);else draft.add(choice.id);btn.classList.toggle('is-selected',draft.has(choice.id));$('breakthroughSelectedCount').textContent=draft.size+' nội dung đã chọn'});grid.append(btn)});sec.append(hd,grid);pool.append(sec)});$('breakthroughSelectedCount').textContent=draft.size+' nội dung đã chọn';$('breakthroughSubmit').disabled=!!submitted||br.closed;$('breakthroughSubmitStatus').textContent=submitted?'Đã gửi lựa chọn.':'Có thể chọn nhiều nội dung ở mỗi nhóm.';$('breakthroughSubmit').onclick=()=>send(connection,{type:'breakthrough-submit',ids:[...draft]})}if(captain){summary.replaceChildren();const hd=document.createElement('h3');hd.textContent='TỔNG HỢP LỰA CHỌN CỦA THÀNH VIÊN';summary.append(hd);const responses=br.responses?.[t]||{},members=Object.values(responses),count=document.createElement('p');count.textContent=members.length+' / '+(data.teams?.[t]?.members?.length||0)+' thành viên đã gửi';summary.append(count);breakthroughGroups.forEach(([group,label])=>{const sec=document.createElement('section'),h=document.createElement('h4');h.textContent=label;sec.append(h);const tally={};members.forEach(m=>(m.ids||[]).forEach(id=>{if(breakthroughChoices.find(x=>x.id===id)?.group===group)tally[id]=(tally[id]||0)+1}));const sorted=Object.entries(tally).sort((a,b)=>b[1]-a[1]);if(!sorted.length){const p=document.createElement('p');p.textContent='Chưa có lựa chọn.';sec.append(p)}sorted.forEach(([id,n])=>{const x=breakthroughChoices.find(x=>x.id===id),p=document.createElement('p');p.textContent=x.icon+' '+x.title+' · '+n+' lượt';sec.append(p)});summary.append(sec)})}}
function professionPhoto(name){const match=reflexJobs.find(item=>item[0]===name);return match?.[1]||''}
function professionEmoji(name){if(/hải dương|ngư dân|nông dân/.test(name.toLowerCase()))return'🌊';if(/phi công|phi hành gia/.test(name.toLowerCase()))return'✈️';if(/đầu bếp/.test(name.toLowerCase()))return'👨‍🍳';if(/bác sĩ/.test(name.toLowerCase()))return'🩺';if(/giáo viên|khảo cổ|luật sư/.test(name.toLowerCase()))return'📚';if(/công an|cảnh sát/.test(name.toLowerCase()))return'🛡️';if(/lập trình|iot|kỹ sư/.test(name.toLowerCase()))return'💻';return'🧰'}
function renderLinkStudent(d){
 const stage=$('linkStudentStage'),lr=d.linkRound||{},selected=d.currentRound==='Liên kết';stage.classList.toggle('hidden',!selected);if(!selected)return;if(!lr.active){$('linkStageStatus').textContent='Giáo viên đã chọn vòng Liên Kết. Chờ bắt đầu hoạt động.';['linkDrawCard','linkDrawActions','linkReviewButton','linkReviewCard','linkSelectionArea','linkCaptainSummary'].forEach(id=>$(id).classList.add('hidden'));return}
 const t=Number(selfTeamIndex),captain=d.captains?.[t]===connection?.peer,assigned=lr.assigned?.[t],card=lr.currentCard;
 const activeTurn=lr.order?.[lr.turn],turnRemaining=activeTurn===t&&lr.turnEndsAt?Math.max(0,Math.ceil((lr.turnEndsAt-Date.now())/1000)):0;$('linkStageStatus').textContent=lr.selectionClosed?'Đã hết thời gian.':assigned?'Đội đã chọn: '+assigned:activeTurn===t?'Đến lượt đội bạn · '+turnRemaining+' giây để Random selection':activeTurn!==undefined?'Đang chờ '+(d.teams?.[activeTurn]?.name||'đội trước')+' chọn thẻ':'Không có đội tham gia';if(lr.lastAutoPick?.team===t&&assigned===lr.lastAutoPick.name)$('linkStageStatus').textContent='Hết 10 giây, hệ thống tự chọn thẻ: '+assigned;
 const draw=$('linkDrawCard'),actions=$('linkDrawActions');draw.classList.toggle('hidden',!card||card.team!==t);
 const canDraw=!!captain&&!assigned&&!lr.selectionClosed&&lr.order?.[lr.turn]===t;actions.classList.toggle('hidden',!(canDraw||(!!card&&card.team===t)));
 if(card?.team===t){draw.replaceChildren();const title=document.createElement('h3');title.textContent=card.name;draw.append(title);const layout=document.createElement('div');layout.className='profession-card-layout';const visual=document.createElement('div');visual.className='profession-card-visual';const photo=professionPhoto(card.name);if(photo){const img=document.createElement('img');img.src=photo;img.alt='Hình ảnh nghề '+card.name;visual.append(img)}else{const icon=document.createElement('span');icon.textContent=professionEmoji(card.name);visual.append(icon)}const details=document.createElement('div');details.className='profession-card-details';
  [['work','MÔ TẢ NGHỀ NGHIỆP'],['conditions','ĐIỀU KIỆN ĐÁP ỨNG CÔNG VIỆC'],['challenges','KHÓ KHĂN'],['benefits','LỢI ÍCH']].forEach(([key,label])=>{const article=document.createElement('article'),heading=document.createElement('b'),p=document.createElement('p');heading.textContent=label;p.textContent=card.profile?.[key]||'';article.append(heading,p);details.append(article)});layout.append(visual,details);draw.append(layout);
  const v=Object.values(lr.cardVotes?.[t]||{});$('linkCardVoteStatus').textContent='Lấy: '+v.filter(x=>x.choice==='accept').length+' · Bỏ: '+v.filter(x=>x.choice==='reject').length}
 $('linkRandomSelection').classList.toggle('hidden',!captain||!!card||!!assigned);$('linkRandomSelection').disabled=lr.selectionClosed||!!assigned||lr.order?.[lr.turn]!==t;
 $('linkAcceptCard').classList.toggle('hidden',captain);$('linkRejectCard').classList.toggle('hidden',captain);$('linkCaptainLock').classList.toggle('hidden',!captain);$('linkCaptainDrawNext').classList.toggle('hidden',!captain);
 $('linkCaptainDrawNext').disabled=!!assigned||lr.order?.[lr.turn]!==t;$('linkCaptainLock').disabled=!!assigned||!card||card.team!==t;
 const review=$('linkReviewButton'),reviewCard=$('linkReviewCard');review.classList.toggle('hidden',!assigned);
 review.onclick=()=>{const opening=reviewCard.classList.contains('hidden');reviewCard.classList.toggle('hidden',!opening);review.textContent=opening?'ĐÓNG THẺ NGHỀ':'XEM LẠI THẺ NGHỀ';if(opening){const p=linkP(assigned);reviewCard.replaceChildren();const h=document.createElement('h3');h.textContent=assigned;reviewCard.append(h);const layout=document.createElement('div');layout.className='profession-card-layout';const visual=document.createElement('div');visual.className='profession-card-visual';const photo=professionPhoto(assigned);if(photo){const img=document.createElement('img');img.src=photo;img.alt='Hình ảnh nghề '+assigned;visual.append(img)}else{const icon=document.createElement('span');icon.textContent=professionEmoji(assigned);visual.append(icon)}const details=document.createElement('div');details.className='profession-card-details';
  [['work','MÔ TẢ NGHỀ NGHIỆP'],['conditions','ĐIỀU KIỆN ĐÁP ỨNG CÔNG VIỆC'],['challenges','KHÓ KHĂN'],['benefits','LỢI ÍCH']].forEach(([k,l])=>{const sec=document.createElement('section'),b=document.createElement('b'),v=document.createElement('p');b.textContent=l;v.textContent=p[k]||'';sec.append(b,v);details.append(sec)});layout.append(visual,details);reviewCard.append(layout)}};
 const area=$('linkSelectionArea'),sum=$('linkCaptainSummary');area.classList.toggle('hidden',!assigned||lr.selectionClosed||captain);sum.classList.toggle('hidden',!captain);
 if(assigned&&!captain&&!lr.selectionClosed){const p=linkP(assigned),pool=$('linkCardPool'),root=$('linkMemberBoxes'),key=t+':'+connection.peer;
  if(!linkDragAssignments[key]){const cards=[];linkCats.forEach(([k,label])=>linkParts(p[k]).forEach((value,i)=>cards.push({id:k+'-'+i,category:k,label,value})));for(let i=cards.length-1;i>0;i--){const n=Math.floor(Math.random()*(i+1));[cards[i],cards[n]]=[cards[n],cards[i]]}linkDragAssignments[key]={cards,placed:{}}}
  const saved=linkDragAssignments[key];pool.replaceChildren();root.replaceChildren();
  const addCard=(parent,item)=>{const el=document.createElement('button');el.type='button';el.className='link-draggable-card';el.draggable=true;el.dataset.cardId=item.id;el.textContent=item.value;el.addEventListener('dragstart',e=>{linkSelectedCard=item.id;e.dataTransfer.setData('text/plain',item.id)});el.addEventListener('click',()=>{linkSelectedCard=item.id;document.querySelectorAll('.link-draggable-card').forEach(x=>x.classList.toggle('is-selected',x.dataset.cardId===item.id))});parent.append(el)};
  saved.cards.forEach(item=>{if(!saved.placed[item.id])addCard(pool,item)});
  linkCats.forEach(([k,label])=>{const box=document.createElement('section');box.className='link-member-box link-drop-box';box.dataset.linkCategory=k;const h=document.createElement('h3'),contents=document.createElement('div');h.textContent=label;contents.className='link-drop-content';box.append(h,contents);
   const place=id=>{const item=saved.cards.find(x=>x.id===id);if(!item)return;saved.placed[id]=k;linkSelectedCard=null;renderLinkStudent(d)};
   box.addEventListener('dragover',e=>e.preventDefault());box.addEventListener('drop',e=>{e.preventDefault();place(e.dataTransfer.getData('text/plain')||linkSelectedCard)});box.addEventListener('click',()=>{if(linkSelectedCard)place(linkSelectedCard)});
   saved.cards.filter(x=>saved.placed[x.id]===k).forEach(item=>addCard(contents,item));root.append(box)});
  $('linkSubmitSelections').disabled=!!d.linkSelections?.[t]?.[connection.peer];
 }
 if(captain){sum.replaceChildren();const h=document.createElement('h3');h.textContent='TỔNG HỢP HỘP THẺ';sum.append(h);
  linkCats.forEach(([k,label])=>{const sec=document.createElement('section'),hd=document.createElement('h4');hd.textContent=label;sec.append(hd);const result=lr.selectionClosed?d.linkSummaries?.[t]?.categories?.[k]?.items:[];(result||[]).forEach(x=>{const p=document.createElement('p');p.textContent=x.text+' · '+x.count+' lượt';sec.append(p)});if(!result?.length){const p=document.createElement('p');p.textContent='Chưa có dữ liệu.';sec.append(p)}sum.append(sec)});
  (lr.selectionClosed?d.linkSummaries?.[t]?.notes||[]:[]).forEach(n=>{const p=document.createElement('p');p.textContent=n.name+': '+n.text;sum.append(p)})}
}

function renderTeacher(){
 renderRoundControls(currentRound,'teacher');renderReflexTeacher();renderBreakthroughAdmin(state(),'teacherBreakthroughStatus');$('liveBoardToggle').textContent=liveBoardVisible?'ẨN BẢNG TRỰC TIẾP':'HIỆN BẢNG TRỰC TIẾP';$('liveBoardToggle').classList.toggle('hidden',!roundStarted);renderLiveBoard(state(),'teacherLiveBoard');renderRoundRanking(state(),'achievementRoundSelect','reflexAchievements');renderBootReview(state(),'teacher');
 $('memberCount').textContent=teams.reduce((n,t)=>n+t.members.length,0)+' thành viên';$('scoreboard').replaceChildren();
 teams.forEach(t=>{const card=document.createElement('article');card.className='score-card';const h=document.createElement('h3');h.textContent=t.name;const score=document.createElement('div');score.className='score';score.textContent=t.score+' điểm';const members=document.createElement('small');members.textContent=t.members.length+' thành viên đang kết nối · '+(careerPoints[teams.indexOf(t)]||0)+' điểm nghề nghiệp';card.append(h,score,members);$('scoreboard').append(card)});
 renderConsensus();renderCaptainRoster();const race=$('raceResults');if(race){race.replaceChildren();raceOrder.forEach(x=>{const row=document.createElement('div');row.className='race-result';row.textContent=(teams[x.team].name)+' · Hạng '+x.rank+' · '+x.points+' điểm · '+x.answer;race.append(row)})}
}
function renderRoundControls(round,scope){const ids=scope==='controller'?['controllerWarmupControls','controllerReflexControls','controllerLinkControls','controllerBreakthroughControls','controllerFutureRoundControls']:['warmupControls','reflexControls','linkControls','breakthroughControls','futureRoundControls'];const [warmId,reflexId,linkId,breakthroughId,futureId]=ids,warm=$(warmId),reflex=$(reflexId),link=$(linkId),breakthrough=$(breakthroughId),future=$(futureId);if(!warm||!reflex||!link||!breakthrough||!future)return;warm.classList.toggle('hidden',round!=='Khởi động');reflex.classList.toggle('hidden',round!=='Phản xạ');link.classList.toggle('hidden',round!=='Liên kết');breakthrough.classList.toggle('hidden',round!=='Bứt phá');future.classList.toggle('hidden',['Khởi động','Phản xạ','Liên kết','Bứt phá'].includes(round))}
function renderRoundRanking(data,selectId,rootId){
 const select=$(selectId),root=$(rootId);if(!root||!data)return;const round=select?.value||data.currentRound||'Khởi động',rows=roundRows(data,round);root.replaceChildren();
 rows.forEach((r,i)=>{const row=document.createElement('div');row.className='reflex-achievement-row';const rank=document.createElement('b');rank.textContent=String(i+1).padStart(2,'0');const name=document.createElement('strong');name.textContent=r.team;const points=document.createElement('span');points.textContent=r.points+' điểm';const status=document.createElement('b');status.textContent=i===0&&r.points>0?'Dẫn đầu':' ';row.append(rank,name,points,status);root.append(row)});
}
function renderBootReview(data,scope='teacher'){
 if(!data)return;const prefix=scope==='controller'?'controller':'boot',select=$(prefix==='boot'?'bootReviewTeam':'controllerBootReviewTeam'),answer=$(prefix==='boot'?'bootReviewAnswer':'controllerBootReviewAnswer'),status=$(prefix==='boot'?'bootReviewStatus':'controllerBootReviewStatus');
 if(!select||!answer||!status)return;const idx=Number(select.value||0),final=data.teamFinals?.[idx],review=data.bootReview?.[idx];
 answer.textContent=final?.answer||'Đội chưa gửi đáp án.';status.textContent=review==='correct'?'Đã xác nhận: chính xác.':review==='wrong'?'Đã xác nhận: chưa chính xác.':!final?'Chưa nhận được đáp án.':(data.seconds>120?'Đã nhận đáp án · còn thời gian gửi.':'Đã khóa gửi đáp án · chờ giáo viên đánh giá.');
}
function renderLiveBoard(data,rootId){
 const root=$(rootId);if(!root||!data)return;const electionClosed=!!data.captainElection?.closed,visible=(!!data.roundStarted||electionClosed)&&data.liveBoardVisible!==false;root.classList.toggle('hidden',!visible);if(!visible){root.replaceChildren();return}
 root.classList.remove('live-round-reflex');root.replaceChildren();const header=document.createElement('div');header.className='live-board-header';const title=document.createElement('h3'),clock=document.createElement('strong');title.textContent=data.currentRound||'Khởi động';clock.className='live-board-clock';clock.textContent=String(Math.floor((data.seconds||0)/60)).padStart(2,'0')+':'+String((data.seconds||0)%60).padStart(2,'0');header.append(title,clock);root.append(header);
 if(electionClosed){const roster=document.createElement('section');roster.className='live-captain-roster';const heading=document.createElement('h3');heading.textContent='CÁC ĐỘI TRƯỞNG SAU BẦU CHỌN';roster.append(heading);(data.teams||[]).forEach((team,i)=>{const member=(team.members||[]).find(m=>m.id===data.captains?.[i]);const row=document.createElement('p');row.textContent=team.name+' · '+(member?member.name:'Chưa có đội trưởng');roster.append(row)});root.append(roster)}const round=data.currentRound||'Khởi động';
 if(round==='Khởi động'){
  (data.teams||[]).forEach((team,i)=>{const row=document.createElement('article');row.className='live-board-row';const h=document.createElement('strong'),p=document.createElement('p'),s=document.createElement('small');h.textContent=team.name;p.textContent=data.teamFinals?.[i]?.answer||'Chưa gửi đáp án';s.textContent=data.bootReview?.[i]==='correct'?'Đã xác nhận đúng':data.bootReview?.[i]==='wrong'?'Đã xác nhận chưa đúng':'Chờ giáo viên đánh giá';row.append(h,p,s);root.append(row)});
 }else if(round==='Phản xạ'){
  root.classList.add('live-round-reflex');const index=data.reflex?.index;if(index>=0&&typeof reflexJobs!=='undefined'&&reflexJobs[index]){const img=document.createElement('img');img.className='live-board-image';img.src=reflexJobs[index][1];img.alt='Hình ảnh câu hỏi Phản xạ';root.append(img)}
  roundRows(data,'Phản xạ').forEach((r,i)=>{const row=document.createElement('div');row.className='live-board-row';row.textContent=(i+1)+'. '+r.team+' · '+r.points+' điểm';root.append(row)});
 }else if(round==='Bứt phá'){
  const br=data.breakthroughRound||{};(br.order||[]).forEach(t=>{const row=document.createElement('article');row.className='live-board-row breakthrough-live-row';const name=document.createElement('strong'),num=document.createElement('p');name.textContent=data.teams?.[t]?.name||('Đội '+(t+1));num.textContent=br.assigned?.[t]!==undefined?'Tình huống số '+String(br.assigned[t]+1).padStart(2,'0'):'Đang chờ bốc thăm';row.append(name,num);root.append(row)});
 }else if(round==='Liên kết'){
  const order=data.linkRound?.order||[0,1,2,3];order.forEach(i=>{const row=document.createElement('article');row.className='live-board-row live-profession-row';const h=document.createElement('strong'),p=document.createElement('p'),visual=document.createElement('div');h.textContent=(i+1)+'. '+(data.teams?.[i]?.name||'Đội');const profession=data.linkRound?.assigned?.[i];p.textContent=profession||'Chưa chọn thẻ nghề';visual.className='profession-card-visual live-profession-visual';const photo=profession?professionPhoto(profession):'';if(photo){const img=document.createElement('img');img.src=photo;img.alt='Hình ảnh nghề '+profession;visual.append(img)}else{const icon=document.createElement('span');icon.textContent=profession?professionEmoji(profession):'…';visual.append(icon)}row.append(visual,h,p);root.append(row)});
 }else{
  roundRows(data,round).forEach((r,i)=>{const row=document.createElement('div');row.className='live-board-row';row.textContent=(i+1)+'. '+r.team+' · '+r.points+' điểm';root.append(row)});
 }
 if(data.seconds===0&&round!=='Bứt phá'||data.linkRound?.selectionClosed||round==='Phản xạ'&&data.reflex?.active===false&&(data.reflexRoundResults?.length||0)>=12){
  const podium=document.createElement('section');podium.className='live-board-podium';const h=document.createElement('h3');h.textContent='BẢNG VINH DANH';podium.append(h);roundRows(data,round).slice(0,3).forEach((r,i)=>{const p=document.createElement('p');p.textContent=['🥇','🥈','🥉'][i]+' '+r.team+' · '+r.points+' điểm';podium.append(p)});root.append(podium)
 }
}

function award(id,points){if(awarded.has(id))return;const item=submissions.find(s=>s.id===id);if(!item)return;teams[item.team].score+=points;addRoundPoints(item.round||currentRound,item.team,points);awarded.add(id);broadcast()}
function onMessage(conn,data){
 if(!data||typeof data!=='object')return;
 if(conn.__controller&&data.type==='control-action'){
  const a=data.action||{};
  if(a.type==='timer-start'){if(!timer){roundStarted=true;if(currentRound==='Liên kết'&&!linkRound.active){startLinkRound();return}if(currentRound==='Bứt phá'&&!breakthroughRound.active){startBreakthroughRound();return}if(currentRound==='Phản xạ'&&!reflex.active){startReflexQuestion(0);startRoundCountdown();return}startRoundCountdown()}broadcast();return}
  if(a.type==='timer-reset'){resetRoundClock();return}
  if(a.type==='set-round'&&typeof a.value==='string'){currentRound=a.value;$('currentRound').value=a.value;resetRoundClock();return}
  if(a.type==='publish-question'){publishQuestionData(a.question,a.questionType,a.options,'controllerQuestionStatus');return} if(a.type==='reflex-next'){startReflexQuestion(reflex.index+1);return} if(a.type==='captain-vote'){openCaptainElection();return} if(a.type==='live-board-toggle'){liveBoardVisible=!liveBoardVisible;broadcast();return} if(a.type==='boot-review'&&Number.isInteger(a.team)&&a.team>=0&&a.team<4&&['correct','wrong'].includes(a.value)){bootReview[a.team]=a.value;broadcast();return}
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
  if(data.type==='reflex-choice'&&Number.isInteger(conn.__team)&&reflex.active&&data.question===reflex.index){const t=conn.__team,deadline=reflexTeamPhases[t].selectionEndsAt||reflex.selectionEndsAt;if(reflex.completed[t]||reflexTeamPhases[t].phase!=='select'||Date.now()>deadline){send(conn,{type:'reflex-feedback',message:'Đã hết thời gian thay đổi đáp án.'});return}if(!Number.isInteger(data.option)||!reflexJobs[reflex.index][2][data.option])return;reflexVotes[t][conn.peer]={option:data.option,time:Date.now(),name:conn.__name};send(conn,{type:'reflex-feedback',message:'Đã ghi nhận lựa chọn mới nhất của bạn.'});broadcast();return}
  if(data.type==='reflex-captain-action'&&Number.isInteger(conn.__team)&&reflex.active){const t=conn.__team;if(captains[t]!==conn.peer){send(conn,{type:'reflex-feedback',message:'Chỉ đội trưởng mới được điều khiển câu trả lời.'});return}if(data.action==='hurry'){if(reflexTeamPhases[t].phase!=='select')return;reflexTeamPhases[t].selectionEndsAt=Date.now()+5000;teams[t].members.forEach(m=>{const c=connections.get(m.id);if(c)send(c,{type:'reflex-feedback',message:'Đội trưởng đang hối thúc. Hãy chốt hoặc điều chỉnh đáp án trong 5 giây tới.'})});broadcast();return}if(data.action==='submit'){if(!Object.keys(reflexVotes[t]||{}).length){send(conn,{type:'reflex-feedback',message:'Chưa có thành viên nào chọn đáp án.'});return}finalizeReflexTeam(t);return}}
 if(data.type==='breakthrough-draw-request'&&Number.isInteger(conn.__team)){const t=conn.__team;if(captains[t]!==conn.peer){send(conn,{type:'breakthrough-feedback',message:'Chỉ Đội trưởng mới được bốc thăm.'});return}if(!drawBreakthroughScenario(t,false))send(conn,{type:'breakthrough-feedback',message:'Chưa đến lượt đội bạn hoặc không còn tình huống.'});return}if(data.type==='breakthrough-submit'&&Number.isInteger(conn.__team)){saveBreakthroughSubmission(conn,data.ids);return}if(data.type==='link-draw-request'&&Number.isInteger(conn.__team)){requestLinkDraw(conn);return} if(data.type==='link-card-redraw'&&Number.isInteger(conn.__team)){if(captains[conn.__team]===conn.peer&&linkRound.currentCard?.team===conn.__team){linkRound.currentCard=null;linkRound.cardVotes[conn.__team]={};requestLinkDraw(conn)}return} if(data.type==='link-card-vote'&&Number.isInteger(conn.__team)){recordLinkCardVote(conn,data.choice);return} if(data.type==='link-card-lock'&&Number.isInteger(conn.__team)){lockLinkCard(conn);return} if(data.type==='link-member-submit'&&Number.isInteger(conn.__team)){saveLinkMemberSubmission(conn,data);return} if(data.type==='captain-vote'&&Number.isInteger(conn.__team)&&captainElection.open&&!captainElection.closed){
  const t=conn.__team;if(captainVotes[t][conn.peer]){send(conn,{type:'captain-vote-result',message:'Bạn đã bỏ phiếu và không thể vote lại.'});return}
  if(Date.now()>captainElection.endsAt){closeCaptainElection();return}
  if(!teams[t].members.some(m=>m.id===data.candidate))return;
  captainVotes[t][conn.peer]={candidate:data.candidate,time:Date.now()};send(conn,{type:'captain-vote-result',message:'Đã ghi nhận phiếu bầu.'});broadcast();return
 }
 if(data.type==='captain-submit'&&Number.isInteger(conn.__team)){
  if(currentRound==='Khởi động'&&seconds<=120){send(conn,{type:'captain-submit-result',message:'Đã hết thời gian gửi đáp án của vòng Khởi động.'});return}
  const t=conn.__team;if(captains[t]!==conn.peer){send(conn,{type:'captain-submit-result',message:'Chỉ đội trưởng mới được gửi đáp án.'});return}
  if(raceAwarded.has(t))return;const answer=String(data.answer||'').trim().slice(0,2000);if(!answer)return;
  const rank=raceOrder.length,points=[10,7,5,3][rank]||0,careerAward=currentRound.includes('Liên kết')?([160,120,80,40][rank]||0):0,stamp=Date.now();raceAwarded.add(t);raceOrder.push({team:t,answer,time:stamp,points,rank:rank+1});teams[t].score+=points;addRoundPoints(currentRound,t,points);careerPoints[t]+=careerAward;teamFinals[t]={answer,time:stamp,points,careerPoints:careerAward,rank:rank+1};
  submissions.push({id:'race-'+t+'-'+stamp,team:t,name:'Đội trưởng · '+conn.__name,round:currentRound,text:answer,time:stamp,final:true,points,rank:rank+1});send(conn,{type:'captain-submit-result',message:'Đã gửi. Đội nhận '+points+' điểm.'});broadcast();return
 }
 if(data.type==='captain-skip'&&Number.isInteger(conn.__team)){if(captains[conn.__team]===conn.peer)send(conn,{type:'captain-submit-result',message:'Đội đã bỏ qua câu hỏi.'});return}
 if(data.type==='team-response'&&Number.isInteger(conn.__team)){
  if(currentRound==='Khởi động'&&seconds<=120){send(conn,{type:'response-locked',message:'Đã hết 3 phút gửi đáp án của vòng Khởi động.'});return}
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
function closeTeacher(){controllerConnections.clear();if(timer)clearInterval(timer);timer=null;if(breakthroughTurnTimer)clearTimeout(breakthroughTurnTimer);breakthroughTurnTimer=null;removeStudentChannel();removeControllerChannel();connections.clear();pendingRequests.clear();renderPending();teams.forEach(t=>t.members=[]);$('connectionStatus').textContent='Đã đóng phòng';$('createRoom').disabled=false;$('closeRoom').disabled=true;hide('roomShare');renderTeacher()}
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
  if(data&&data.type==='link-member-result'){$('linkMemberSubmitStatus').textContent=data.message||'Đã gửi.';return} if(data&&data.type==='link-card-feedback'){$('linkCardVoteStatus').textContent=data.message||'';return} if(data&&data.type==='link-member-result'){$('linkMemberSubmitStatus').textContent=data.message||'Đã gửi.';return}if(data&&data.type==='link-card-feedback'){$('linkCardVoteStatus').textContent=data.message||'';return}if(data&&data.type==='reflex-feedback'){$('reflexMemberFeedback').textContent=data.message;return}
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
   studentChannel=client.channel(studentTopic(hostId),{config:{broadcast:{self:false,ack:true},private:false}});
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
 $('linkRandomSelection').addEventListener('click',()=>send(connection,{type:'link-draw-request'}));$('linkAcceptCard').addEventListener('click',()=>send(connection,{type:'link-card-vote',choice:'accept'}));$('linkRejectCard').addEventListener('click',()=>send(connection,{type:'link-card-vote',choice:'reject'}));$('linkCaptainLock').addEventListener('click',()=>send(connection,{type:'link-card-lock'}));$('linkCaptainDrawNext').addEventListener('click',()=>send(connection,{type:'link-card-redraw'}));$('linkSubmitSelections').onclick=()=>{const key=Number(selfTeamIndex)+':'+connection.peer,saved=linkDragAssignments[key],selections={};linkCats.forEach(([k])=>{selections[k]=saved?saved.cards.filter(x=>saved.placed[x.id]===k).map(x=>Number(x.id.slice(x.id.lastIndexOf('-')+1))):[]});send(connection,{type:'link-member-submit',selections,note:$('linkMemberNote').value});$('linkMemberSubmitStatus').textContent='Đang gửi…'};$('linkAcceptCard').addEventListener('click',()=>send(connection,{type:'link-card-vote',choice:'accept'}));$('linkRejectCard').addEventListener('click',()=>send(connection,{type:'link-card-vote',choice:'reject'}));$('linkCaptainLock').addEventListener('click',()=>send(connection,{type:'link-card-lock'}));$('linkCaptainDrawNext').addEventListener('click',()=>send(connection,{type:'link-draw-request'}));$('linkSubmitSelections').onclick=()=>{const key=Number(selfTeamIndex)+':'+connection.peer,saved=linkDragAssignments[key],selections={};linkCats.forEach(([k])=>{selections[k]=saved?saved.cards.filter(x=>saved.placed[x.id]===k).map(x=>Number(x.id.slice(x.id.lastIndexOf('-')+1))):[]});send(connection,{type:'link-member-submit',selections,note:$('linkMemberNote').value});$('linkMemberSubmitStatus').textContent='Đang gửi…'};$('voteCaptain').addEventListener('click',()=>{const c=document.querySelector('input[name="captainCandidate"]:checked');if(!c){$('captainVoteMessage').textContent='Hãy chọn một thành viên.';return}send(connection,{type:'captain-vote',candidate:c.value})});
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
 $('controllerCaptainVote').addEventListener('click',()=>act({type:'captain-vote'}));$('controllerPublishQuestion').addEventListener('click',()=>act({type:'publish-question',question:$('controllerDiscussionQuestion').value,questionType:$('controllerDiscussionType').value,options:$('controllerDiscussionOptions').value.split(/\r?\n/)}));$('controllerReflexNext').addEventListener('click',()=>act({type:'reflex-next'}));$('controllerLiveBoardToggle').addEventListener('click',()=>act({type:'live-board-toggle'}));$('controllerBootReviewTeam').addEventListener('change',()=>renderBootReview(lastControllerState?.state,'controller'));$('controllerBootMarkCorrect').addEventListener('click',()=>act({type:'boot-review',team:Number($('controllerBootReviewTeam').value),value:'correct'}));$('controllerBootMarkWrong').addEventListener('click',()=>act({type:'boot-review',team:Number($('controllerBootReviewTeam').value),value:'wrong'}));$('controllerAchievementRound').addEventListener('change',()=>renderRoundRanking(lastControllerState?.state,'controllerAchievementRound','controllerRoundAchievements'));
 const approvalMode=$('controllerApprovalMode');if(approvalMode){approvalMode.value='auto';approvalMode.disabled=true}
 window.addEventListener('beforeunload',()=>{if(client&&controllerChannel)client.removeChannel(controllerChannel);controllerChannel=null});
}
function renderController(s,pending){
 if(!s)return;renderRoundControls(s.currentRound,'controller');renderBreakthroughAdmin(s,'controllerBreakthroughStatus');renderLiveBoard(s,'controllerLiveBoard');renderRoundRanking(s,'controllerAchievementRound','controllerRoundAchievements');renderBootReview(s,'controller');
 $('controllerLiveBoardToggle').textContent=s.liveBoardVisible===false?'HIỆN BẢNG TRỰC TIẾP':'ẨN BẢNG TRỰC TIẾP';$('controllerLiveBoardToggle').classList.toggle('hidden',!s.roundStarted);
 $('controllerClock').textContent=String(Math.floor(s.seconds/60)).padStart(2,'0')+':'+String(s.seconds%60).padStart(2,'0');
 const round=$('controllerRound');if(round)round.value=s.currentRound;
 $('controllerScoreboard').replaceChildren();
 (s.teams||[]).forEach(t=>{const card=document.createElement('article');card.className='score-card';const h=document.createElement('h3');h.textContent=t.name;const score=document.createElement('div');score.className='score';score.textContent=t.score+' điểm';const members=document.createElement('small');members.textContent=t.members.length+' thành viên · '+(s.careerPoints?.[s.teams.indexOf(t)]||0)+' điểm nghề nghiệp';card.append(h,score,members);$('controllerScoreboard').append(card)});
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
function renderStudentState(data){if(!data||data.type!=='state')return;renderLinkStudent(data);renderReflexStudent(data);renderBreakthroughStudent(data);const teamIndex=Number.isInteger(selfTeamIndex)?selfTeamIndex:Number($('studentTeam').value);const team=data.teams?.[teamIndex];const ownMember=(team?.members||[]).find(m=>m.id===connection?.peer);if(ownMember)selfName=ownMember.name;$('studentIdentityName').textContent=selfName||$('studentName').value||'Học sinh';const isCaptain=data.captains?.[teamIndex]===connection?.peer;$('careerSkillToggle').classList.toggle('hidden',!isCaptain);if(!isCaptain){$('careerSkillShop').classList.add('hidden');$('careerSkillToggle').setAttribute('aria-expanded','false')}$('careerSkillToggle').onclick=()=>{if(!isCaptain)return;const open=$('careerSkillShop').classList.contains('hidden');$('careerSkillShop').classList.toggle('hidden',!open);$('careerSkillToggle').setAttribute('aria-expanded',String(open))};$('studentPlay').classList.toggle('is-captain',isCaptain);$('studentPlay').classList.toggle('is-member',!isCaptain);$('studentRoleBadge').textContent=isCaptain?'ĐỘI TRƯỞNG':'THÀNH VIÊN';$('studentIdentityBar').classList.toggle('captain-identity-bar',isCaptain);if(team){$('studentTeamName').textContent=team.name;$('studentScore').textContent=team.score;$('careerPointBalance').textContent=String(data.careerPoints?.[teamIndex]||0)}$('studentRound').textContent=data.currentRound||'Chưa chọn hoạt động';const discussion=document.querySelector('.student-discussion');if(discussion)discussion.classList.toggle('hidden',data.currentRound!=='Khởi động');let future=$('studentFutureRoundStage');if(future)future.classList.toggle('hidden',['Bứt phá','Luyện tập','Vận dụng'].includes(data.currentRound)===false);if(future){const heading=future.querySelector('h3');if(heading)heading.textContent='VÒNG '+data.currentRound.toUpperCase()}$('studentTimer').textContent=data.seconds>0?'Thời gian còn lại: '+String(Math.floor(data.seconds/60)).padStart(2,'0')+':'+String(data.seconds%60).padStart(2,'0'):'Theo hướng dẫn của giáo viên.';
 const publicRoster=$('publicCaptainRoster');if(publicRoster){const until=Number(data.captainRevealUntil)||0,visible=until>Date.now();publicRoster.classList.toggle('hidden',!visible);if(visible){publicRoster.replaceChildren();(data.teams||[]).forEach((t,i)=>{const line=document.createElement('p');const leader=t.members.find(m=>m.id===data.captains?.[i]);line.textContent=t.name+': '+(leader?leader.name:'Chưa có đội trưởng');publicRoster.append(line)});if(window.__captainRosterUntil!==until){window.__captainRosterUntil=until;clearTimeout(window.__captainRosterTimer);window.__captainRosterTimer=setTimeout(()=>{if(Date.now()>=until)publicRoster.classList.add('hidden')},Math.max(0,until-Date.now()))}}}const celebrationId=Number(data.captainRevealUntil)||0;if(isCaptain&&celebrationId>Date.now()&&window.__captainCelebrationUntil!==celebrationId){window.__captainCelebrationUntil=celebrationId;document.getElementById('captainElectionCelebration')?.remove();const celebration=document.createElement('div');celebration.id='captainElectionCelebration';celebration.className='captain-election-celebration';celebration.setAttribute('aria-live','polite');const burst=document.createElement('div');burst.className='captain-celebration-burst';burst.textContent='✦';const title=document.createElement('h2');title.textContent='CHÚC MỪNG ĐỘI TRƯỞNG!';const message=document.createElement('p');message.textContent='Bạn đã được các thành viên tín nhiệm bầu chọn.';celebration.append(burst,title,message);$('studentPlay').append(celebration);setTimeout(()=>celebration.remove(),Math.max(0,celebrationId-Date.now()))}const q=data.question||{};$('studentQuestion').textContent=q.text||'Đang chờ giáo viên gửi câu hỏi…'; const election=data.captainElection||{};$('captainElection').classList.toggle('hidden',!election.open);
 const candidates=$('captainCandidates'),candidateMembers=data.teams?.[teamIndex]?.members||[],electionId=String(election.startedAt||election.endsAt||''),candidateKey=electionId+':'+candidateMembers.map(m=>m.id+':'+m.name).join('|');if(election.open&&candidates.dataset.electionKey!==candidateKey){const previous=candidates.dataset.electionId===electionId?candidates.querySelector('input[name="captainCandidate"]:checked')?.value:null;candidates.replaceChildren();candidateMembers.forEach(m=>{const label=document.createElement('label');label.className='student-choice';const r=document.createElement('input');r.type='radio';r.name='captainCandidate';r.value=m.id;r.checked=m.id===(previous||'');const span=document.createElement('span');span.textContent=m.name;label.append(r,span);candidates.append(label)});candidates.dataset.electionId=electionId;candidates.dataset.electionKey=candidateKey}
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
function publishQuestionData(q,type,options,statusId='questionStatus'){q=String(q||'').trim();if(!q){$(statusId).textContent='Hãy nhập nội dung câu hỏi.';return false}type=type||'both';options=(options||[]).map(x=>String(x).trim()).filter(Boolean).slice(0,8);if(type!=='text'&&options.length<2){$(statusId).textContent='Hãy nhập ít nhất hai phương án, mỗi phương án một dòng.';return false}currentQuestion=q;questionType=type;questionOptions=options;teamVotes=[{}, {}, {}, {}];teamTexts=[[],[],[],[]];teamFinals=[null,null,null,null];raceOrder=[];raceAwarded.clear();bootReview=[null,null,null,null];$(statusId).textContent='Đã gửi câu hỏi đến các phòng đội.';broadcast();return true}
function publishQuestion(){publishQuestionData($('discussionQuestion').value,$('discussionType').value,$('discussionOptions').value.split(/\r?\n/))}
function setClock(){$('roomClock').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}
const roundDurations={'Khởi động':300,'Phản xạ':600,'Liên kết':600,'Bứt phá':600,'Luyện tập':300,'Vận dụng':300};
function roundDuration(name){return roundDurations[name]||300}
function resetRoundClock(){if(timer)clearInterval(timer);timer=null;if(breakthroughTurnTimer)clearTimeout(breakthroughTurnTimer);breakthroughTurnTimer=null;breakthroughRound={active:false,order:[],turn:0,turnEndsAt:0,assigned:{},lastAutoPick:null,closed:false,responses:[{},{},{},{}]};Object.keys(breakthroughDrafts).forEach(k=>delete breakthroughDrafts[k]);roundStarted=false;seconds=roundDuration(currentRound);setClock();broadcast()}
function startRoundCountdown(){if(timer)return;timer=setInterval(()=>{if(seconds>0)seconds--;else{clearInterval(timer);timer=null}setClock();broadcast()},1000)}
if(controllerHost)startController();else if(hostId)startStudent();else{show('teacherView');renderTeacher();renderPending();$('createRoom').addEventListener('click',startTeacher);$('closeRoom').addEventListener('click',closeTeacher);$('currentRound').addEventListener('change',()=>{currentRound=$('currentRound').value;resetRoundClock()});$('startCaptainVote').addEventListener('click',openCaptainElection);$('publishQuestionButton').addEventListener('click',publishQuestion);$('liveBoardToggle').addEventListener('click',()=>{liveBoardVisible=!liveBoardVisible;broadcast()});$('bootReviewTeam').addEventListener('change',()=>renderBootReview(state()));$('bootMarkCorrect').addEventListener('click',()=>{bootReview[Number($('bootReviewTeam').value)]='correct';broadcast()});$('bootMarkWrong').addEventListener('click',()=>{bootReview[Number($('bootReviewTeam').value)]='wrong';broadcast()});$('achievementRoundSelect').addEventListener('change',()=>renderRoundRanking(state(),'achievementRoundSelect','reflexAchievements'));for(let i=0;i<4;i++)$('teamName'+i).addEventListener('change',updateTeams);$('timerStart').addEventListener('click',()=>{if(timer)return;roundStarted=true;if(currentRound==='Liên kết'&&!linkRound.active){startLinkRound();return}if(currentRound==='Bứt phá'&&!breakthroughRound.active){startBreakthroughRound();return}if(currentRound==='Phản xạ'&&!reflex.active){startReflexQuestion(0);startRoundCountdown();return}startRoundCountdown();broadcast()});$('timerReset').addEventListener('click',resetRoundClock);setClock();$('reflexNext').addEventListener('click',()=>startReflexQuestion(reflex.index+1));window.addEventListener('beforeunload',()=>{removeStudentChannel();removeControllerChannel()})}
})();
// js/game.js
// 교체용: 역할+라운드 관리 포함 (client-side only)
// 이 파일은 js/firebase-app.js가 아래 심볼을 export 한다고 가정합니다:
//   export const auth, db, ensureAnonLogin, ts  (ts = serverTimestamp)
// 필요한 firestore 함수만 import
import { auth, db, ensureAnonLogin, ts } from "./firebase-app.js";
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  onSnapshot, query, where, serverTimestamp, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// helpers
const $ = s => document.querySelector(s);

// UI elements (game.html에 이미 존재한다고 가정되는 아이디들)
const roomTitle = $("#roomTitle");
const phaseEl = $("#phase");
const dayEl = $("#day");
const playersEl = $("#players");
const votePanel = $("#votePanel");
const logEl = $("#log") || (function(){ const d=document.createElement("pre"); d.id="log"; document.body.appendChild(d); return d; })();

const params = new URLSearchParams(location.search);
const roomId = params.get("room");
if (!roomId) {
  alert("room 파라미터가 없습니다. index로 돌아갑니다.");
  location.href = "index.html";
}

let me = null;
let myUid = null;
let isHost = false;
let members = []; // cache
let phase = "lobby";
let day = 0;

function log(s){ console.log(s); logEl.textContent += s + "\n"; }

// 기본 역할 목록 (원하면 바꿀 수 있음)
const ROLE_POOL = [
  "mafia",      // 마피아 (kill at night)
  "detective",  // 조사자 (investigate at night)
  "doctor",     // 간호사 (protect at night)
  "villager"    // 시민(일반)
];
// 필요 시 ROLE_POOL을 더 늘리거나 config로 빼세요.

// --- 초기화 및 실시간 구독 ----------------
async function init(){
  me = await ensureAnonLogin(); // should return user object
  myUid = auth.currentUser.uid;

  // 방 정보 구독
  onSnapshot(doc(db, "rooms", roomId), snap => {
    if (!snap.exists()) return;
    const r = snap.data();
    phase = r.phase || phase;
    // room creator and host handling
    const creator = r.creator || r.hostId || null;
    const host = r.host || r.hostId || null; window._roomHost = host;
    const hostAssigned = !!r.hostAssigned;
    roomTitle.textContent = `방 코드: ${roomId} ${host?('(호스트: '+String(host).slice(0,6)+')'):''}`;
    window._roomCreator = r.creator;
    phaseEl.textContent = phase;

    // show creator panel if current user is the creator and host not assigned
    const creatorPanel = document.getElementById('creator-panel');
    if (creator && myUid === creator && !hostAssigned) {
      if (creatorPanel) creatorPanel.style.display = 'block';
      // populate hostSelect with current players
      (async ()=>{
        const ps = await getDocs(collection(db, 'rooms', roomId, 'players'));
        const sel = document.getElementById('hostSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">--선택--</option>';
        ps.forEach(pdoc=>{
          const p = pdoc.data();
          const opt = document.createElement('option');
          opt.value = pdoc.id;
          opt.textContent = p.name + (p.isHost? ' (현재 호스트)':'');
          sel.appendChild(opt);
        });
      })();
    } else {
      if (creatorPanel) creatorPanel.style.display = 'none';
    }

    // show host-only panels/buttons only if current user is host
    const isHostNow = (host && myUid === host);
    const hostControls = ['assign','toNight','resolveNight','toDay','resolveDay'];
    hostControls.forEach(id=>{
      const el = document.getElementById(id);
      if (el) el.style.display = isHostNow ? 'inline-block' : 'none';
    });

  });

  // turn/state 구독
  onSnapshot(doc(db, "rooms", roomId, "state", "turn"), snap => {
    if (snap.exists()){
      const d = snap.data();
      day = d.day || 0;
      phase = d.phase || phase;
      dayEl.textContent = day;
      phaseEl.textContent = phase;
      renderVote(); // UI 갱신
    }
  });

  // 플레이어 목록 실시간
  onSnapshot(collection(db, "rooms", roomId, "players"), snap => {
    const arr = [];
    snap.forEach(docSnap => arr.push({ uid: docSnap.id, ...docSnap.data() }));
    members = arr.sort((a,b)=> (a.name||"").localeCompare(b.name||""));
    renderPlayers();
    renderVote();
  });

  // 플레이어 본인 문서 구독 (role 등)
  onSnapshot(doc(db, "rooms", roomId, "players", myUid), snap => {
    if (snap.exists()){
      const d = snap.data();
      // my role 등은 UI에서 필요시 표시
    }
  });

  // 버튼 바인딩 (game.html에 버튼 id가 있어야 함)
  $("#assign")?.addEventListener("click", ()=> hostOnly(assignRoles)());
  // creator assigns host
  $("#assignHost")?.addEventListener("click", async ()=> {
    const sel = document.getElementById('hostSelect');
    if(!sel) return; const uid = sel.value; if(!uid) return alert('플레이어를 선택하세요');
    await updateDoc(doc(db,'rooms',roomId),{ host: uid, hostAssigned: true });
    // mark the chosen player as isHost true
    await updateDoc(doc(db,'rooms',roomId,'players',uid),{ isHost: true });
    alert('호스트가 지정되었습니다.');
  });
  $("#toNight")?.addEventListener("click", ()=> hostOnly(()=>setPhase("night"))());
  $("#toDay")?.addEventListener("click", ()=> hostOnly(()=>setPhase("day"))());
  $("#resolveNight")?.addEventListener("click", ()=> hostOnly(resolveNight)());
  $("#resolveDay")?.addEventListener("click", ()=> hostOnly(resolveDay)());

  // 액션 제출 UI: game.html에서 밤에 행동 제출하는 버튼/폼 필요
  // 아래는 단순 구현: 유저가 밤에 'actionTarget' 입력란에 타깃 UID/이름 입력 후 submit
  const actBtn = $("#submitAction");
  if (actBtn) actBtn.addEventListener("click", async ()=>{
    const target = $("#actionTarget").value.trim();
    if (!target){ alert("대상 입력"); return; }
    await submitNightAction(target);
  });

  log("초기화 완료");
}

// --- 역할 배정 ----------------
async function assignRoles(){
  // 단순 배정: ROLE_POOL을 기준으로 플레이어 수에 따라 배정
  const snap = await getDocs(collection(db, "rooms", roomId, "players"));
  const pls = [];
  snap.forEach(d=> pls.push({ uid: d.id, ...d.data() }));
  const n = pls.length;
  if (n < 3) { alert("플레이어가 너무 적습니다 (최소 3명)."); return; }

  // 역할 수 계산: 최소 1 mafia, 나머지에 detective/doctor 한명씩, 나머진 villager
  const roles = [];
  const mafiaCount = Math.max(1, Math.floor(n/4));
  for (let i=0;i<mafiaCount;i++) roles.push("mafia");
  if (n - roles.length >= 1) roles.push("detective");
  if (n - roles.length >= 1) roles.push("doctor");
  while (roles.length < n) roles.push("villager");

  // 셔플 후 배정
  for (let i = roles.length -1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  // 업데이트
  const updates = pls.map((p, idx) => {
    return setDoc(doc(db, "rooms", roomId, "players", p.uid), {
      ...p, role: roles[idx], alive: true
    }, { merge: true });
  });
  await Promise.all(updates);
  // 초기 턴 세팅
  await setDoc(doc(db, "rooms", roomId, "state", "turn"), { day: 0, phase: "lobby" }, { merge: true });
  await updateDoc(doc(db, "rooms", roomId), { phase: "lobby" });
  alert("역할이 배정되었습니다.");
  log("역할 배정 완료");
}

// --- 페이즈 변경 ----------------
async function setPhase(ph){
  const turnRef = doc(db, "rooms", roomId, "state", "turn");
  const curSnap = await getDoc(turnRef);
  const cur = curSnap.exists() ? curSnap.data() : { day:0, phase:"lobby" };
  const nextDay = cur.day || 0;
  let newDay = nextDay;
  if (ph === "day") newDay = (cur.day || 0) + 1;
  await setDoc(turnRef, { day: newDay, phase: ph }, { merge: true });
  await updateDoc(doc(db, "rooms", roomId), { phase: ph });
  log(`phase -> ${ph}, day -> ${newDay}`);
}

// --- 밤 행동 제출 ----------------
// 단순화: action doc path = rooms/{roomId}/actions/{day}_{uid}
// action: { actor: uid, actionType: "kill"|"protect"|"investigate", targetUid: "...", createdAt }
async function submitNightAction(targetInput){
  // targetInput: 플레이어 이름(부분) 또는 uid. 여기서는 이름 부분 일치로 찾음.
  const alivePlayers = members.filter(m=>m.alive);
  let target = alivePlayers.find(p => (p.name||"").toLowerCase().includes(targetInput.toLowerCase()));
  if (!target) {
    // maybe user input is uid
    target = alivePlayers.find(p => p.uid === targetInput);
  }
  if (!target) { alert("대상을 찾을 수 없습니다."); return; }

  // 역할에 따라 actionType 결정
  const myDocSnap = await getDoc(doc(db, "rooms", roomId, "players", myUid));
  const myRole = myDocSnap.exists() ? myDocSnap.data().role : null;
  if (!myRole) { alert("역할이 지정되지 않았습니다."); return; }
  let actionType = "none";
  if (myRole === "mafia") actionType = "kill";
  else if (myRole === "doctor") actionType = "protect";
  else if (myRole === "detective") actionType = "investigate";
  else { alert("당신은 밤 행동이 없습니다."); return; }

  const turnSnap = await getDoc(doc(db, "rooms", roomId, "state", "turn"));
  const curDay = (turnSnap.exists() && turnSnap.data().day) || 0;

  await setDoc(doc(db, "rooms", roomId, "actions", `${curDay}_${myUid}`), {
    actor: myUid,
    actionType,
    targetUid: target.uid,
    createdAt: serverTimestamp()
  });
  alert("밤 행동 전송됨: " + actionType + " -> " + target.name);
  log(`action: ${myUid} ${actionType} -> ${target.uid}`);
}

// --- 밤 처리 (호스트 전용) ----------------
/*
  처리 로직(간단 MVP):
  1) 수집된 action 문서들을 불러옴 (day 기준)
  2) mafia의 kill 대상: mafia들이 낸 kill action들의 타깃을 집계 -> 최다 득표자 선택(동률이면 랜덤 중 한 명)
  3) doctor의 protect: protect 대상이 kill 대상과 동일하면 처형 취소
  4) detective: 조사 결과(타깃의 역할)를 host에게 logs에 기록(또는 players doc에 lastInvestigated)
  5) 결과 적용: 죽은 자(alive=false)로 update, logs에 기록
*/
async function resolveNight(){
  // 권한 체크
  const roomSnap = await getDoc(doc(db, "rooms", roomId));
  if (!roomSnap.exists()) return alert("방이 없습니다.");
  if (roomSnap.data().hostId !== myUid) return alert("호스트만 밤을 처리할 수 있습니다.");

  const turnSnap = await getDoc(doc(db, "rooms", roomId, "state", "turn"));
  const curDay = (turnSnap.exists() && turnSnap.data().day) || 0;

  // actions 가져오기
  const actionsSnap = await getDocs(collection(db, "rooms", roomId, "actions"));
  const actions = [];
  actionsSnap.forEach(d => {
    const id = d.id;
    if (id.startsWith(String(curDay) + "_")) actions.push({ id, ...d.data() });
  });

  // mafia kill tally
  const killVotes = {};
  for (const a of actions.filter(x=>x.actionType==="kill")){
    killVotes[a.targetUid] = (killVotes[a.targetUid]||0) + 1;
  }
  let killTargetUid = null;
  if (Object.keys(killVotes).length > 0){
    // find max
    let max = 0; const cands = [];
    for (const k of Object.keys(killVotes)){
      if (killVotes[k] > max){ max = killVotes[k]; cands.length = 0; cands.push(k); }
      else if (killVotes[k] === max){ cands.push(k); }
    }
    // tie -> random pick
    killTargetUid = cands[Math.floor(Math.random()*cands.length)];
  }

  // doctor protect
  const protects = actions.filter(x=>x.actionType==="protect").map(x=>x.targetUid);
  const protectedUid = protects.length>0 ? protects[0] : null; // 여러 명 신청 가능; 여기선 첫 보호만 적용(단순)
  // detective investigates -> store findings
  const investigates = actions.filter(x=>x.actionType==="investigate");

  // resolve kill/protect
  let killed = null;
  if (killTargetUid && killTargetUid !== protectedUid){
    // mark dead
    await updateDoc(doc(db, "rooms", roomId, "players", killTargetUid), { alive: false });
    killed = killTargetUid;
  }

  // record detective results in logs (only host can read)
  for (const inv of investigates){
    const targetDoc = await getDoc(doc(db, "rooms", roomId, "players", inv.targetUid));
    const role = targetDoc.exists() ? targetDoc.data().role : "(없음)";
    await addDoc(collection(db, "rooms", roomId, "logs"), {
      type: "investigate",
      by: inv.actor,
      target: inv.targetUid,
      result: role,
      day: curDay,
      ts: serverTimestamp()
    });
  }

  // record night log
  await addDoc(collection(db, "rooms", roomId, "logs"), {
    type: "night_result",
    day: curDay,
    killed: killed || null,
    protected: protectedUid || null,
    killVotes,
    ts: serverTimestamp()
  });

  // cleanup actions for this day (optional)
  for (const a of actions){
    await deleteDoc(doc(db, "rooms", roomId, "actions", a.id));
  }

  // move to day phase and increment day (setPhase("day") does this)
  await setPhase("day");

  if (killed){
    const killedDoc = await getDoc(doc(db, "rooms", roomId, "players", killed));
    alert(`밤 결과: ${killedDoc.exists()? killedDoc.data().name : killed}님이 희생되었습니다.`);
    log(`밤 처리: ${killed} 사망`);
  } else {
    alert("밤 결과: 사망자 없음");
    log("밤 처리: 사망자 없음");
  }
}

// --- 낮 투표/처리 ----------------
/*
  낮 투표 방식(간단):
  - alive 플레이어들은 rooms/{roomId}/votes/{day}_{voterUid} 문서로 투표 제출: { voter, targetUid }
  - resolveDay (호스트 전용)이 호출되면 모든 votes 모아서 최다 득표자 처형(동률 -> 무사 또는 랜덤 처리, 아래는 랜덤 처리)
*/
async function castVote(targetUid){
  const turnSnap = await getDoc(doc(db, "rooms", roomId, "state", "turn"));
  const curDay = (turnSnap.exists() && turnSnap.data().day) || 0;
  await setDoc(doc(db, "rooms", roomId, "votes", `${curDay}_${myUid}`), {
    voter: myUid,
    target: targetUid,
    day: curDay,
    ts: serverTimestamp()
  });
  alert("투표 제출됨");
}

function renderVote(){
  if (!votePanel) return;
  if (phase !== "day"){ votePanel.innerHTML = "<p class='muted'>낮이 아닙니다.</p>"; return; }
  const alive = members.filter(m=>m.alive);
  votePanel.innerHTML = `<p>투표 대상:</p>` + alive.map(m => `<button data-vote="${m.uid}">${m.name}</button>`).join(" ");
  votePanel.querySelectorAll("[data-vote]").forEach(btn => {
    btn.onclick = ()=> castVote(btn.dataset.vote);
  });
}

async function resolveDay(){
  const roomSnap = await getDoc(doc(db, "rooms", roomId));
  if (!roomSnap.exists()) return alert("방이 없습니다.");
  if (roomSnap.data().hostId !== myUid) return alert("호스트만 낮 처리를 할 수 있습니다.");

  const turnSnap = await getDoc(doc(db, "rooms", roomId, "state", "turn"));
  const curDay = (turnSnap.exists() && turnSnap.data().day) || 0;

  const votesSnap = await getDocs(collection(db, "rooms", roomId, "votes"));
  const votes = [];
  votesSnap.forEach(d => { if (d.id.startsWith(`${curDay}_`)) votes.push(d.data()); });

  if (votes.length === 0) { alert("투표가 없습니다."); return; }

  // tally
  const tally = {};
  for (const v of votes){
    tally[v.target] = (tally[v.target]||0) + 1;
  }
  let max = 0; const cands = [];
  for (const k of Object.keys(tally)){
    if (tally[k] > max){ max = tally[k]; cands.length = 0; cands.push(k); }
    else if (tally[k] === max) cands.push(k);
  }
  const executed = cands.length === 1 ? cands[0] : cands[Math.floor(Math.random()*cands.length)];
  // execute
  await updateDoc(doc(db, "rooms", roomId, "players", executed), { alive: false });
  await addDoc(collection(db, "rooms", roomId, "logs"), {
    type: "day_result",
    day: curDay,
    executed,
    tally,
    ts: serverTimestamp()
  });

  // clear votes of the day (optional)
  for (const vdoc of votesSnap.docs){
    if (vdoc.id.startsWith(`${curDay}_`)) await deleteDoc(doc(db, "rooms", roomId, "votes", vdoc.id));
  }

  // set phase to lobby or night next
  await setPhase("night");
  alert(`낮 처리 완료: ${executed} 처형되었습니다.`);
  log(`낮 처리: ${executed} 처형`);
}

// --- UI 렌더링 ----------------
function renderPlayers(){
  playersEl.innerHTML = members.map(p => `<li>${p.name} ${p.alive? "🟢":"🔴"} ${p.role? "(" + p.role + ")":""} ${p.uid===myUid?"(나)":""}</li>`).join("");

  // hostSelect population (include creator)
  const hostSel = $("#hostSelect");
  if(hostSel){
    hostSel.innerHTML = `<option value="">--호스트 선택--</option>`;
    const creator = window._roomCreator || null;
    if (creator) {
      hostSel.innerHTML += `<option value="${creator}">(방장) 본인</option>`;
    }
    members.forEach(p => {
      hostSel.innerHTML += `<option value="${p.uid}">${p.name}</option>`;
    });
  }
}

// --- helper hostOnly
function hostOnly(fn){ return async ()=> { if (!isHost) return alert("호스트만 실행 가능"); await fn(); } }

// init
init();

// Expose some functions for Console testing
window._um = { assignRoles, setPhase, submitNightAction, resolveNight, castVote, resolveDay };

// Host controls auto-added
if(typeof document!=='undefined'){
const nBtn=document.getElementById("resolveNight");
if(nBtn){ nBtn.onclick=async()=>{const r=await resolveNight(roomId);alert("밤 결과:"+JSON.stringify(r));};}
const dBtn=document.getElementById("resolveDay");
if(dBtn){ dBtn.onclick=async()=>{const r=await resolveDay(roomId);alert("낮 결과:"+JSON.stringify(r));};}
}

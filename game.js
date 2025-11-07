import { app, auth, db, ensureAnonLogin, ts } from "./firebase-app.js";
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const params = new URLSearchParams(location.search);
const roomId = params.get("room");
if (!roomId) location.href = "index.html";

const $ = s => document.querySelector(s);
const roomTitle = $("#roomTitle");
const phaseEl = $("#phase");
const dayEl = $("#day");
const playersEl = $("#players");
const votePanel = $("#votePanel");

let me, isHost = false, myRole = null, day = 0, phase = "lobby";

function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]] } return a; }

async function init() {
  me = await ensureAnonLogin();

  onSnapshot(doc(db, "rooms", roomId), snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    phase = data.phase; phaseEl.textContent = phase;
    roomTitle.textContent = `방 코드: ${roomId} (호스트: ${data.hostId.slice(0,5)})`;
  });

  onSnapshot(doc(db, "rooms", roomId, "state", "turn"), snap => {
    const d = snap.data() || { day:0, phase:"lobby" };
    day = d.day || 0; phaseEl.textContent = d.phase || phase;
    dayEl.textContent = day;
  });

  onSnapshot(doc(db, "rooms", roomId, "players", me.uid), snap => {
    const p = snap.data(); if (!p) return;
    isHost = !!p.isHost; myRole = p.role;
  });

  onSnapshot(collection(db, "rooms", roomId, "players"), s => {
    const list = [];
    s.forEach(d => list.push({ uid:d.id, ...d.data() }));
    playersEl.innerHTML = list.map(p => `<li>${p.name} ${p.alive? "🟢":"🔴"} ${p.uid===me.uid?"(나)":""}</li>`).join("");
    renderVote(list);
  });

  $("#assign").onclick = isHostOnly(assignRoles);
  $("#toNight").onclick = isHostOnly(()=>setPhase("night"));
  $("#toDay").onclick = isHostOnly(()=>setPhase("day"));
}

function isHostOnly(fn){
  return async ()=>{ if(!isHost) return alert("호스트만 가능합니다."); await fn(); }
}

async function assignRoles(){
  const snap = await getDocs(collection(db,"rooms",roomId,"players"));
  const members = []; snap.forEach(d=>members.push({uid:d.id, ...d.data()}));
  const n = members.length;
  const mafiaCount = Math.max(1, Math.floor(n/4));
  const shuffled = shuffle(members.slice());
  const mafia = new Set(shuffled.slice(0, mafiaCount).map(p=>p.uid));
  const updates = shuffled.map(p=>{
    const role = mafia.has(p.uid) ? "mafia" : "citizen";
    return updateDoc(doc(db,"rooms",roomId,"players",p.uid), { role, alive:true });
  });
  await Promise.all(updates);
  await setDoc(doc(db,"rooms",roomId,"state","turn"), { day:1, phase:"day" }, { merge:true });
  await updateDoc(doc(db,"rooms",roomId), { phase:"day" });
}

async function setPhase(ph){
  const snap = await getDoc(doc(db,"rooms",roomId,"state","turn"));
  const d = snap.exists()? (snap.data().day||1) : 1;
  await setDoc(doc(db,"rooms",roomId,"state","turn"), { day:d + (ph==="day"?1:0), phase:ph }, { merge:true });
  await updateDoc(doc(db,"rooms",roomId), { phase:ph });
}

function renderVote(members){
  if (phase!=="day"){ votePanel.innerHTML = "<p class='muted'>낮이 아닙니다.</p>"; return; }
  const alive = members.filter(m=>m.alive);
  votePanel.innerHTML = `<p>투표 대상 선택:</p>` + alive.map(m=>{
    return `<button data-vote="${m.uid}">${m.name}</button>`;
  }).join(" ");
  votePanel.querySelectorAll("[data-vote]").forEach(btn=>{
    btn.onclick = ()=>castVote(btn.dataset.vote);
  });
}

async function castVote(targetUid){
  const docId = `votes_day`;
  await setDoc(doc(db,"rooms",roomId,"state",docId), { [me.uid]: targetUid }, { merge:true });
  alert("투표 완료");
}

init();

// Auto-generated Day Resolver
import { db } from './firebase-app.js';
import { doc, collection, getDocs, updateDoc, addDoc, deleteDoc, serverTimestamp, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

export async function resolveDay(roomId,{tieBehavior="no_execute"}={}) {
  const turnRef = doc(db,"rooms",roomId,"state","turn");
  const t = await getDoc(turnRef);
  const day = t.exists()?t.data().day:0;

  const votesSnap = await getDocs(collection(db,"rooms",roomId,"votes"));
  const tally={};
  votesSnap.forEach(v=>{
    const d=v.data();
    if(d.day===day){ tally[d.target]=(tally[d.target]||0)+1; }
  });

  let executed=null;
  const max=Math.max(0,...Object.values(tally));
  const cands=Object.keys(tally).filter(k=>tally[k]===max);
  if(cands.length===1) executed=cands[0];
  else if(cands.length>1 && tieBehavior==="random_execute")
    executed=cands[Math.floor(Math.random()*cands.length)];

  if(executed){
    await updateDoc(doc(db,"rooms",roomId,"players",executed),{alive:false});
  }

  await addDoc(collection(db,"rooms",roomId,"logs"),{
    type:"day_result",day,executed,tally,ts:serverTimestamp()
  });

  for(const v of votesSnap.docs){ if(v.id.startsWith(day+"_")) await deleteDoc(v.ref); }

  // simple victory
  const playersSnap=await getDocs(collection(db,"rooms",roomId,"players"));
  let mafia=0, others=0;
  playersSnap.forEach(d=>{
    const p=d.data(); if(!p.alive) return;
    if(p.role==="mafia") mafia++; else others++;
  });
  let winner=null;
  if(mafia===0) winner="villagers";
  if(mafia>=others) winner="mafia";
  if(winner){
    await updateDoc(doc(db,"rooms",roomId),{"state.winner":winner});
    await setDoc(turnRef,{day,phase:"ended"},{merge:true});
    await updateDoc(doc(db,"rooms",roomId),{phase:"ended"});
    return {ok:true,winner};
  }
  await setDoc(turnRef,{day,phase:"night"},{merge:true});
  await updateDoc(doc(db,"rooms",roomId),{phase:"night"});
  return {ok:true,executed};
}

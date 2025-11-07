// Auto-generated Night Resolver
import { db } from './firebase-app.js';
import { doc, collection, getDocs, getDoc, setDoc, updateDoc, addDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

export async function resolveNight(roomId){
  const turnRef = doc(db,"rooms",roomId,"state","turn");
  const turnSnap = await getDoc(turnRef);
  const curDay = turnSnap.exists()? turnSnap.data().day:0;

  const actionsSnap = await getDocs(collection(db,"rooms",roomId,"actions"));
  let actions=[];
  actionsSnap.forEach(a=>{ if(a.id.startsWith(curDay+"_")) actions.push({id:a.id,...a.data()}); });

  const protectedSet=new Set();
  actions.filter(a=>a.actionType==="protect").forEach(a=>protectedSet.add(a.targetUid));

  let killTarget=null;
  const killActs=actions.filter(a=>a.actionType==="kill");
  if(killActs.length){
    killTarget = killActs[Math.floor(Math.random()*killActs.length)].targetUid;
  }

  let killed=null;
  if(killTarget && !protectedSet.has(killTarget)){
    await updateDoc(doc(db,"rooms",roomId,"players",killTarget),{alive:false});
    killed=killTarget;
  }

  await addDoc(collection(db,"rooms",roomId,"logs"),{
    type:"night_result",day:curDay,killed,protected:[...protectedSet],ts:serverTimestamp()
  });

  for(const a of actions){
    await deleteDoc(doc(db,"rooms",roomId,"actions",a.id));
  }

  await setDoc(turnRef,{day:curDay,phase:"day"},{merge:true});
  await updateDoc(doc(db,"rooms",roomId),{phase:"day"});
  return {ok:true,killed};
}

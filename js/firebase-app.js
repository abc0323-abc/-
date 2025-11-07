// js/firebase-app.js - Tablet-ready inline Firebase config (no build step required)
// WARNING: This file contains your Firebase config including apiKey. 
// For production, consider keeping keys out of client code and secure Firestore rules.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCSrvcJr4jHTpXg0UHY6sDhwZpGlg_DuPE",
  authDomain: "dicemapia.firebaseapp.com",
  projectId: "dicemapia",
  storageBucket: "dicemapia.firebasestorage.app",
  messagingSenderId: "270654608117",
  appId: "1:270654608117:web:c46b23465f49d524e3abbc"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const ts = serverTimestamp;

export async function ensureAnonLogin() {
  if (!auth.currentUser) await signInAnonymously(auth);
  return new Promise(res => onAuthStateChanged(auth, u => u && res(u)));
}

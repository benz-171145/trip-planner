import { initializeApp } from 'firebase/app';
import { getFirestore, collection } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAW30Hv_FJPTb8loKQtvP7pA6-iv4wsYQw',
  authDomain: 'my-trip-planner-8db53.firebaseapp.com',
  projectId: 'my-trip-planner-8db53',
  storageBucket: 'my-trip-planner-8db53.firebasestorage.app',
  messagingSenderId: '98717126353',
  appId: '1:98717126353:web:f3b070077006a899247ff0',
  measurementId: 'G-DR4BXNH5TV',
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const tripsRef = collection(db, 'trips');

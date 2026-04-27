import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  type DocumentData,
  type Firestore,
  type Query,
} from 'firebase/firestore';
import { disableFirestoreRemote, isFirestoreRemoteEnabled } from './firebase';

export const stripUndefinedFields = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(item => stripUndefinedFields(item)).filter(item => item !== undefined) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    next[key] = stripUndefinedFields(item);
  }

  return next as T;
};

const shouldDisableForError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Database') && message.includes('not found') ||
    message.includes('client is offline') ||
    message.includes('Failed to get document because the client is offline')
  );
};

export const safeSetDoc = async (
  firestore: Firestore,
  collectionName: string,
  id: string,
  payload: Record<string, unknown>,
) => {
  if (!isFirestoreRemoteEnabled()) return false;

  try {
    await setDoc(doc(firestore, collectionName, id), stripUndefinedFields(payload), { merge: true });
    return true;
  } catch (error) {
    if (shouldDisableForError(error)) disableFirestoreRemote(error);
    else if (import.meta.env.DEV) console.warn(`Firestore set skipped for ${collectionName}/${id}:`, error);
    return false;
  }
};

export const safeDeleteDoc = async (
  firestore: Firestore,
  collectionName: string,
  id: string,
) => {
  if (!isFirestoreRemoteEnabled()) return false;

  try {
    await deleteDoc(doc(firestore, collectionName, id));
    return true;
  } catch (error) {
    if (shouldDisableForError(error)) disableFirestoreRemote(error);
    else if (import.meta.env.DEV) console.warn(`Firestore delete skipped for ${collectionName}/${id}:`, error);
    return false;
  }
};

export const safeGetDoc = async (
  firestore: Firestore,
  collectionName: string,
  id: string,
) => {
  if (!isFirestoreRemoteEnabled()) return null;

  try {
    return await getDoc(doc(firestore, collectionName, id));
  } catch (error) {
    if (shouldDisableForError(error)) disableFirestoreRemote(error);
    else if (import.meta.env.DEV) console.warn(`Firestore get skipped for ${collectionName}/${id}:`, error);
    return null;
  }
};

export const safeAddDoc = async (
  firestore: Firestore,
  collectionName: string,
  payload: Record<string, unknown>,
) => {
  if (!isFirestoreRemoteEnabled()) return null;

  try {
    return await addDoc(collection(firestore, collectionName), stripUndefinedFields(payload));
  } catch (error) {
    if (shouldDisableForError(error)) disableFirestoreRemote(error);
    else if (import.meta.env.DEV) console.warn(`Firestore add skipped for ${collectionName}:`, error);
    return null;
  }
};

export const safeGetDocs = async (queryRef: Query<DocumentData>) => {
  if (!isFirestoreRemoteEnabled()) return null;

  try {
    return await getDocs(queryRef);
  } catch (error) {
    if (shouldDisableForError(error)) disableFirestoreRemote(error);
    else if (import.meta.env.DEV) console.warn('Firestore query skipped:', error);
    return null;
  }
};

import { supabase, type Database } from './supabase';

type CollectionName = keyof Database['public']['Tables'];

type TableRecord<T extends CollectionName> = Database['public']['Tables'][T]['Row'];
type InsertRecord<T extends CollectionName> = Database['public']['Tables'][T]['Insert'];
type UpdateRecord<T extends CollectionName> = Database['public']['Tables'][T]['Update'];

const FIRESTORE_DISABLED_STORAGE_KEY = 'beatrice_firestore_remote_disabled_v1';

const envFlag = (name: string) => {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return value === '1' || value === 'true';
};

export const isFirestoreRemoteEnabled = () => {
  if (!envFlag('VITE_ENABLE_FIRESTORE_REMOTE')) return false;
  return typeof window === 'undefined' || window.localStorage.getItem(FIRESTORE_DISABLED_STORAGE_KEY) !== '1';
};

export const disableFirestoreRemote = (reason?: unknown) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FIRESTORE_DISABLED_STORAGE_KEY, '1');
  }
  if (reason && envFlag('VITE_DEBUG_FIRESTORE')) {
    console.info('Firestore remote persistence disabled for this session:', reason);
  }
};

const stripUndefinedFields = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(item => stripUndefinedFields(item)).filter(item => item !== undefined) as T;
  }
  if (!value || typeof value !== 'object') {
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
    message.includes('Failed to get document because the client is offline') ||
    message.includes('Supabase')
  );
};

export const safeSetDoc = async <T extends CollectionName>(
  collectionName: T,
  id: string,
  payload: InsertRecord<T>,
) => {
  if (!isFirestoreRemoteEnabled()) return false;

  try {
    const { error } = await supabase
      .from(collectionName)
      .upsert({ ...stripUndefinedFields(payload), updated_at: new Date().toISOString() }, {
        onConflict: id,
      })
      .select()
      .single();

    if (error) {
      console.error(`Supabase set error for ${collectionName}/${id}:`, error);
      if (shouldDisableForError(error)) disableFirestoreRemote(error);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`Supabase set catch for ${collectionName}/${id}:`, error);
    if (shouldDisableForError(error)) disableFirestoreRemote(error);
    return false;
  }
};

export const safeGetDoc = async <T extends CollectionName>(
  collectionName: T,
  id: string,
): Promise<{ exists: boolean; data: TableRecord<T> | null }> => {
  if (!isFirestoreRemoteEnabled()) return { exists: false, data: null };

  try {
    const { data, error } = await supabase
      .from(collectionName)
      .select('*')
      .eq('user_id', id)
      .single();

    if (error) {
      if (shouldDisableForError(error)) disableFirestoreRemote(error);
      return { exists: false, data: null };
    }
    return { exists: true, data: data as TableRecord<T> };
  } catch (error) {
    console.error(`Supabase get catch for ${collectionName}/${id}:`, error);
    if (shouldDisableForError(error)) disableFirestoreRemote(error);
    return { exists: false, data: null };
  }
};

export const safeDeleteDoc = async <T extends CollectionName>(
  collectionName: T,
  id: string,
) => {
  if (!isFirestoreRemoteEnabled()) return false;

  try {
    const { error } = await supabase
      .from(collectionName)
      .delete()
      .eq('user_id', id);

    if (error) {
      if (shouldDisableForError(error)) disableFirestoreRemote(error);
      return false;
    }
    return true;
  } catch (error) {
    if (shouldDisableForError(error)) disableFirestoreRemote(error);
    return false;
  }
};

export const safeAddDoc = async <T extends CollectionName>(
  collectionName: T,
  payload: InsertRecord<T>,
) => {
  if (!isFirestoreRemoteEnabled()) return null;

  try {
    const { data, error } = await supabase
      .from(collectionName)
      .insert(stripUndefinedFields(payload))
      .select()
      .single();

    if (error) {
      if (shouldDisableForError(error)) disableFirestoreRemote(error);
      return null;
    }
    return data as TableRecord<T>;
  } catch (error) {
    if (shouldDisableForError(error)) disableFirestoreRemote(error);
    return null;
  }
};

export const safeGetDocs = async <T extends CollectionName>(
  collectionName: T,
  filters: Record<string, unknown> = {},
): Promise<TableRecord<T>[] | null> => {
  if (!isFirestoreRemoteEnabled()) return null;

  try {
    let query = supabase.from(collectionName).select('*');
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) {
        query = query.eq(key as keyof Database['public']['Tables'][T], value as any);
      }
    }
    const { data, error } = await query;

    if (error) {
      if (shouldDisableForError(error)) disableFirestoreRemote(error);
      return null;
    }
    return data as TableRecord<T>[];
  } catch (error) {
    if (shouldDisableForError(error)) disableFirestoreRemote(error);
    return null;
  }
};

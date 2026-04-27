/**
 * EburonFlix TMDB Helpers
 *
 * Lightweight wrappers around The Movie Database (TMDB) v3 API used by
 * the EburonFlix skill (browse, search, translations, embed URLs).
 */

const TMDB_AUTH =
  'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiMzAxOTU1YzY5ZjE3NDhlZmMyNGIxYjI0ZmI2OThiZSIsIm5iZiI6MTY2NzE0ODg2MS42NzUsInN1YiI6IjYzNWVhYzNkMWI3Mjk0MDA3YmYwMjc0NSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.Ay7PBnj56eAUGAiiHzrC9hMdGFr12676xaqXyJREKx8';

const TMDB_BASE = 'https://api.themoviedb.org/3';

const headers: HeadersInit = {
  Authorization: TMDB_AUTH,
  accept: 'application/json',
};

export type MediaType = 'movie' | 'tv' | 'person';
export type Category = 'popular' | 'new_released' | 'top_rated' | 'tagalog';
export type Server = 'vidsrc.net' | 'vidsrc.in' | 'vidsrc.pm' | 'vidsrc.xyz';

export interface TmdbItem {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  biography?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  profile_path?: string | null;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  original_language?: string;
  media_type?: MediaType;
  known_for_department?: string;
}

export interface TmdbTranslation {
  iso_3166_1: string;
  iso_639_1: string;
  name: string;
  english_name: string;
  data: {
    title?: string;
    name?: string;
    overview?: string;
    biography?: string;
    homepage?: string;
    tagline?: string;
  };
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export const tmdbImage = (path?: string | null, size: 'w342' | 'w780' = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

export const isPersonItem = (item?: TmdbItem | null) =>
  !!item && (item.media_type === 'person' || !!item.known_for_department);

export const inferMediaType = (item?: TmdbItem | null): MediaType => {
  if (!item) return 'movie';
  if (isPersonItem(item)) return 'person';
  if (item.first_air_date || item.media_type === 'tv') return 'tv';
  return 'movie';
};

export const buildEmbedUrl = (
  item: TmdbItem,
  server: Server = 'vidsrc.net',
  season = 1,
  episode = 1,
) => {
  const type = inferMediaType(item);
  if (type === 'person') return '';
  const tv = type === 'tv';
  return `https://${server}/embed/${tv ? 'tv' : 'movie'}?tmdb=${item.id}${
    tv ? `&season=${season}&episode=${episode}` : ''
  }`;
};

async function tmdbFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${TMDB_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(`TMDB ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchGenres(mediaType: 'movie' | 'tv'): Promise<TmdbGenre[]> {
  const data = await tmdbFetch<{ genres: TmdbGenre[] }>(`/genre/${mediaType}/list`);
  return data.genres || [];
}

export async function fetchList(opts: {
  mediaType: 'movie' | 'tv';
  category: Category;
  genreId?: number | string;
  page?: number;
}): Promise<TmdbItem[]> {
  const { mediaType, category, genreId, page = 1 } = opts;
  let path: string;
  if (category === 'tagalog' || genreId) {
    const params = new URLSearchParams({
      sort_by: 'popularity.desc',
      page: String(page),
    });
    if (category === 'tagalog') params.set('with_original_language', 'tl');
    if (genreId) params.set('with_genres', String(genreId));
    path = `/discover/${mediaType}?${params.toString()}`;
  } else if (category === 'new_released') {
    path = `/${mediaType}/${mediaType === 'movie' ? 'now_playing' : 'on_the_air'}?page=${page}`;
  } else if (category === 'top_rated') {
    path = `/${mediaType}/top_rated?page=${page}`;
  } else {
    path = `/${mediaType}/popular?page=${page}`;
  }
  const data = await tmdbFetch<{ results: TmdbItem[] }>(path);
  return data.results || [];
}

export async function searchMulti(query: string): Promise<TmdbItem[]> {
  if (!query.trim()) return [];
  const data = await tmdbFetch<{ results: TmdbItem[] }>(
    `/search/multi?query=${encodeURIComponent(query)}`,
  );
  return data.results || [];
}

export async function fetchTranslations(
  mediaType: MediaType,
  id: number | string,
): Promise<TmdbTranslation[]> {
  try {
    const data = await tmdbFetch<{ translations: TmdbTranslation[] }>(
      `/${mediaType}/${id}/translations`,
    );
    return data.translations || [];
  } catch {
    return [];
  }
}

export const summarizeItem = (item: TmdbItem) => {
  const title = item.title || item.name || 'Unknown';
  const year = (item.release_date || item.first_air_date || '').split('-')[0] || '';
  const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
  const type = inferMediaType(item);
  return {
    id: item.id,
    title,
    year,
    rating,
    mediaType: type,
    overview: (item.overview || item.biography || '').slice(0, 240),
  };
};

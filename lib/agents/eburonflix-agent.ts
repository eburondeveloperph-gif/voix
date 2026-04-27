/**
 * EburonFlix Agent — Handles movie/TV browsing, search, playback, and
 * translation tools. Mutates the EburonFlix Zustand store so the overlay
 * UI reflects whatever Beatrice was asked to do.
 */
import {
  Category,
  MediaType,
  Server,
  buildEmbedUrl,
  fetchList,
  fetchTranslations,
  inferMediaType,
  searchMulti,
  summarizeItem,
  TmdbItem,
} from '@/lib/eburonflix/api';
import { useEburonFlixStore } from '@/lib/eburonflix/store';
import type { AgentHandler, AgentResult } from './types';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

const VALID_MEDIA: ReadonlyArray<MediaType> = ['movie', 'tv', 'person'];
const VALID_CATEGORY: ReadonlyArray<Category> = [
  'popular',
  'new_released',
  'top_rated',
  'tagalog',
];
const VALID_SERVERS: ReadonlyArray<Server> = [
  'vidsrc.net',
  'vidsrc.in',
  'vidsrc.pm',
  'vidsrc.xyz',
];

const coerceMediaType = (value: unknown, fallback: 'movie' | 'tv' = 'movie'): 'movie' | 'tv' => {
  if (typeof value !== 'string') return fallback;
  const lower = value.toLowerCase();
  if (lower === 'tv' || lower === 'series' || lower === 'show' || lower === 'tvshow') return 'tv';
  if (lower === 'movie' || lower === 'film') return 'movie';
  return fallback;
};

const coerceCategory = (value: unknown): Category => {
  if (typeof value !== 'string') return 'popular';
  const lower = value.toLowerCase().replace(/[\s-]/g, '_');
  if ((VALID_CATEGORY as ReadonlyArray<string>).includes(lower)) return lower as Category;
  if (lower === 'new' || lower === 'now_playing' || lower === 'on_the_air') return 'new_released';
  if (lower === 'best' || lower === 'highest_rated') return 'top_rated';
  if (lower === 'filipino' || lower === 'tl') return 'tagalog';
  return 'popular';
};

const matchLanguage = (translations: any[], language: string) => {
  const wanted = language.trim().toLowerCase();
  return translations.find(t => {
    const english = String(t.english_name || '').toLowerCase();
    const native = String(t.name || '').toLowerCase();
    const code = String(t.iso_639_1 || '').toLowerCase();
    return english === wanted || native === wanted || code === wanted;
  });
};

export const handle: AgentHandler = async (toolName, args, _ctx): Promise<AgentResult> => {
  const store = useEburonFlixStore.getState();

  switch (toolName) {
    case 'eburonflix_browse': {
      const mediaType = coerceMediaType(args.mediaType, 'movie');
      const category = coerceCategory(args.category);
      const genreName = typeof args.genre === 'string' ? args.genre.trim().toLowerCase() : '';

      let genreId: string | undefined;
      if (genreName && store.genres.length) {
        const match = store.genres.find(g => g.name.toLowerCase() === genreName);
        if (match) genreId = String(match.id);
      }

      try {
        const results = await fetchList({ mediaType, category, genreId, page: 1 });
        store.setMediaType(mediaType);
        store.setCategory(category);
        store.setGenreId(genreId || '');
        store.setList(results);
        store.setActiveTab('home');
        store.setPage(1);
        useEburonFlixStore.setState({ isOpen: true });
        const top = results.slice(0, 5).map(summarizeItem);
        return {
          status: 'success',
          message: `Showing ${results.length} ${category.replace('_', ' ')} ${mediaType === 'tv' ? 'TV shows' : 'movies'} on EburonFlix.`,
          data: { mediaType, category, genre: genreName || null, top },
        };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load EburonFlix catalog.',
        };
      }
    }

    case 'eburonflix_search': {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) return { status: 'error', message: 'A search query is required.' };
      const limitRaw = typeof args.limit === 'number' ? args.limit : DEFAULT_LIMIT;
      const limit = Math.min(Math.max(1, Math.floor(limitRaw)), MAX_LIMIT);

      try {
        const results = await searchMulti(query);
        store.setSearchQuery(query);
        store.setList(results);
        store.setActiveTab('search');
        useEburonFlixStore.setState({ isOpen: true });
        const top = results.slice(0, limit).map(summarizeItem);
        return {
          status: 'success',
          message:
            results.length === 0
              ? `No EburonFlix matches for "${query}".`
              : `Found ${results.length} EburonFlix matches for "${query}".`,
          data: { query, top },
        };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : 'EburonFlix search failed.',
        };
      }
    }

    case 'eburonflix_play': {
      const explicitId = typeof args.tmdbId === 'number' ? args.tmdbId : undefined;
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const mediaTypeHint = coerceMediaType(args.mediaType, 'movie');
      const season = typeof args.season === 'number' ? Math.max(1, args.season) : 1;
      const episode = typeof args.episode === 'number' ? Math.max(1, args.episode) : 1;
      const serverArg = typeof args.server === 'string' ? args.server.toLowerCase() : '';

      if (!explicitId && !title) {
        return {
          status: 'error',
          message: 'Please provide a title or TMDB id to play.',
        };
      }

      try {
        let item: TmdbItem | null = null;
        if (explicitId) {
          // Construct a minimal item; the embed only needs id + media type.
          item = { id: explicitId, media_type: mediaTypeHint } as TmdbItem;
        } else {
          const results = await searchMulti(title);
          const playable = results.filter(r => !r.known_for_department && r.media_type !== 'person');
          item = playable[0] || results[0] || null;
        }

        if (!item) {
          return { status: 'error', message: `No EburonFlix title matched "${title}".` };
        }

        if (item.media_type === 'person' || item.known_for_department) {
          // Fall back: open the person profile rather than play
          store.setSelectedItem(item);
          useEburonFlixStore.setState({ isOpen: true });
          return {
            status: 'success',
            message: `Opening the EburonFlix profile for ${item.name || 'this person'}.`,
            data: summarizeItem(item),
          };
        }

        if (serverArg && (VALID_SERVERS as ReadonlyArray<string>).includes(serverArg)) {
          store.setServer(serverArg as Server);
        }
        store.setSelectedItem(item);
        useEburonFlixStore.setState({ isOpen: true });

        const inferred = inferMediaType(item);
        const embedUrl = buildEmbedUrl(item, store.server, season, episode);
        const summary = summarizeItem(item);
        return {
          status: 'success',
          message: `Now playing "${summary.title}"${
            inferred === 'tv' ? ` (S${season}E${episode})` : ''
          } on EburonFlix.`,
          data: { ...summary, embedUrl, server: store.server, season, episode },
        };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : 'EburonFlix could not start playback.',
        };
      }
    }

    case 'eburonflix_translate': {
      const tmdbId = typeof args.tmdbId === 'number' ? args.tmdbId : undefined;
      const language = typeof args.language === 'string' ? args.language.trim() : '';
      const mediaType = (typeof args.mediaType === 'string'
        ? args.mediaType.toLowerCase()
        : 'movie') as string;

      if (!tmdbId || !language) {
        return {
          status: 'error',
          message: 'Both tmdbId and language are required to translate.',
        };
      }
      const validatedType: MediaType = (VALID_MEDIA as ReadonlyArray<string>).includes(mediaType)
        ? (mediaType as MediaType)
        : 'movie';

      try {
        const translations = await fetchTranslations(validatedType, tmdbId);
        store.setTranslations(translations);
        const match = matchLanguage(translations, language);
        if (!match) {
          return {
            status: 'error',
            message: `No "${language}" translation available for that title.`,
            data: { available: translations.map(t => t.english_name) },
          };
        }
        store.setActiveTranslation(match.data);
        useEburonFlixStore.setState({ isOpen: true });
        return {
          status: 'success',
          message: `Translated to ${match.english_name}.`,
          data: {
            language: match.english_name,
            title: match.data.title || match.data.name || null,
            text: match.data.overview || match.data.biography || null,
          },
        };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : 'Translation lookup failed.',
        };
      }
    }

    case 'eburonflix_close': {
      store.close();
      return { status: 'success', message: 'Closed the EburonFlix overlay.' };
    }

    default:
      return { status: 'error', message: `EburonFlix agent does not support tool: ${toolName}` };
  }
};

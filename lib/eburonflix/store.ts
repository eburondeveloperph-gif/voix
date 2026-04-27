/**
 * EburonFlix Store — Tracks the overlay UI state. Tools mutate this store
 * (open the player, set the active title, switch tab) and the React overlay
 * renders from it.
 */
import { create } from 'zustand';
import type {
  Category,
  Server,
  TmdbGenre,
  TmdbItem,
  TmdbTranslation,
} from './api';

export type ActiveTab = 'home' | 'search';

export interface EburonFlixState {
  isOpen: boolean;
  activeTab: ActiveTab;
  mediaType: 'movie' | 'tv';
  category: Category;
  genreId: string;
  genres: TmdbGenre[];
  list: TmdbItem[];
  searchQuery: string;
  selectedItem: TmdbItem | null;
  translations: TmdbTranslation[];
  activeTranslation: TmdbTranslation['data'] | null;
  server: Server;
  page: number;
  loading: boolean;

  open: (item?: TmdbItem | null) => void;
  close: () => void;
  setActiveTab: (tab: ActiveTab) => void;
  setMediaType: (mediaType: 'movie' | 'tv') => void;
  setCategory: (category: Category) => void;
  setGenreId: (genreId: string) => void;
  setGenres: (genres: TmdbGenre[]) => void;
  setList: (list: TmdbItem[]) => void;
  appendList: (list: TmdbItem[]) => void;
  setSearchQuery: (query: string) => void;
  setSelectedItem: (item: TmdbItem | null) => void;
  setTranslations: (translations: TmdbTranslation[]) => void;
  setActiveTranslation: (data: TmdbTranslation['data'] | null) => void;
  setServer: (server: Server) => void;
  setPage: (page: number) => void;
  setLoading: (loading: boolean) => void;
}

export const useEburonFlixStore = create<EburonFlixState>(set => ({
  isOpen: false,
  activeTab: 'home',
  mediaType: 'movie',
  category: 'popular',
  genreId: '',
  genres: [],
  list: [],
  searchQuery: '',
  selectedItem: null,
  translations: [],
  activeTranslation: null,
  server: 'vidsrc.net',
  page: 1,
  loading: false,

  open: item =>
    set(state => ({
      isOpen: true,
      selectedItem: item ?? state.selectedItem,
    })),
  close: () =>
    set({
      isOpen: false,
      selectedItem: null,
      translations: [],
      activeTranslation: null,
    }),
  setActiveTab: activeTab => set({ activeTab }),
  setMediaType: mediaType => set({ mediaType, genreId: '' }),
  setCategory: category => set({ category, genreId: '' }),
  setGenreId: genreId => set({ genreId }),
  setGenres: genres => set({ genres }),
  setList: list => set({ list }),
  appendList: list => set(state => ({ list: [...state.list, ...list] })),
  setSearchQuery: searchQuery => set({ searchQuery }),
  setSelectedItem: selectedItem =>
    set({ selectedItem, translations: [], activeTranslation: null }),
  setTranslations: translations => set({ translations }),
  setActiveTranslation: activeTranslation => set({ activeTranslation }),
  setServer: server => set({ server }),
  setPage: page => set({ page }),
  setLoading: loading => set({ loading }),
}));

/**
 * EburonFlix Overlay
 *
 * Full-screen overlay rendered when the EburonFlix skill is active. Mirrors
 * the standalone EburonFlix experience: hero, trending row, explore grid,
 * search tab, fullscreen player modal with translation chips.
 *
 * State lives in `useEburonFlixStore`; the agent (`lib/agents/eburonflix-agent.ts`)
 * mutates the store from voice/chat tool calls.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent, Key } from 'react';
import {
  Server,
  TmdbItem,
  buildEmbedUrl,
  fetchGenres,
  fetchList,
  fetchTranslations,
  inferMediaType,
  isPersonItem,
  searchMulti,
  tmdbImage,
} from '@/lib/eburonflix/api';
import { useEburonFlixStore } from '@/lib/eburonflix/store';

const SERVERS: { value: Server; label: string }[] = [
  { value: 'vidsrc.net', label: 'Server 1 (vidsrc.net)' },
  { value: 'vidsrc.in', label: 'Server 2 (vidsrc.in)' },
  { value: 'vidsrc.pm', label: 'Server 3 (vidsrc.pm)' },
  { value: 'vidsrc.xyz', label: 'Server 4 (vidsrc.xyz)' },
];

const POSTER_FALLBACK =
  'https://via.placeholder.com/342x513/111/fff?text=No+Image';

export default function EburonFlixOverlay() {
  const {
    isOpen,
    activeTab,
    mediaType,
    category,
    genreId,
    genres,
    list,
    selectedItem,
    translations,
    activeTranslation,
    server,
    page,
    loading,
    searchQuery,
    setActiveTab,
    setMediaType,
    setCategory,
    setGenreId,
    setGenres,
    setList,
    appendList,
    setSearchQuery,
    setSelectedItem,
    setTranslations,
    setActiveTranslation,
    setServer,
    setPage,
    setLoading,
    close,
  } = useEburonFlixStore();

  const [copied, setCopied] = useState(false);

  // Load genres for the active media type.
  useEffect(() => {
    if (!isOpen) return;
    fetchGenres(mediaType).then(setGenres).catch(() => setGenres([]));
  }, [mediaType, isOpen, setGenres]);

  // Load list whenever filters change.
  const refreshList = useCallback(
    async (nextPage: number, append = false) => {
      setLoading(true);
      try {
        const results = await fetchList({
          mediaType,
          category,
          genreId: genreId || undefined,
          page: nextPage,
        });
        if (append) appendList(results);
        else setList(results);
      } catch (err) {
        console.error('EburonFlix list error', err);
      } finally {
        setLoading(false);
      }
    },
    [mediaType, category, genreId, appendList, setList, setLoading],
  );

  useEffect(() => {
    if (!isOpen || activeTab !== 'home') return;
    setPage(1);
    void refreshList(1, false);
  }, [mediaType, category, genreId, activeTab, isOpen, refreshList, setPage]);

  // Load translations for the selected item.
  useEffect(() => {
    if (!selectedItem) {
      setTranslations([]);
      setActiveTranslation(null);
      return;
    }
    const type = inferMediaType(selectedItem);
    fetchTranslations(type, selectedItem.id)
      .then(setTranslations)
      .catch(() => setTranslations([]));
  }, [selectedItem, setTranslations, setActiveTranslation]);

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const results = await searchMulti(searchQuery);
      setList(results);
    } catch (err) {
      console.error('EburonFlix search error', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(err => console.error('Clipboard copy failed', err));
  };

  const heroItem = list[0] || null;
  const trendingRow = useMemo(() => list.slice(1, 11), [list]);
  const gridItems = useMemo(() => list.slice(11), [list]);

  const isPerson = isPersonItem(selectedItem);
  const displayTitle =
    activeTranslation?.title ||
    activeTranslation?.name ||
    selectedItem?.title ||
    selectedItem?.name ||
    '';
  const displayOverview =
    activeTranslation?.overview ||
    activeTranslation?.biography ||
    selectedItem?.overview ||
    selectedItem?.biography ||
    'No details available for this title.';

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 800,
        background: '#000',
        color: '#fff',
        fontFamily: "'Roboto', 'Outfit', sans-serif",
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {/* Top close button (always available) */}
      <button
        onClick={close}
        title="Close EburonFlix"
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 60,
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(0,0,0,0.7)',
          color: '#fff',
          backdropFilter: 'blur(12px)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <i className="ph ph-x" style={{ fontSize: 18 }} />
      </button>

      {activeTab === 'home' ? (
        <HomeTab
          mediaType={mediaType}
          category={category}
          genreId={genreId}
          genres={genres}
          heroItem={heroItem}
          trendingRow={trendingRow}
          gridItems={gridItems}
          loading={loading}
          onSelect={setSelectedItem}
          onChangeMediaType={setMediaType}
          onChangeCategory={setCategory}
          onChangeGenre={setGenreId}
          onLoadMore={() => {
            const next = page + 1;
            setPage(next);
            void refreshList(next, true);
          }}
        />
      ) : (
        <SearchTab
          query={searchQuery}
          loading={loading}
          list={list}
          onChange={setSearchQuery}
          onSubmit={handleSearch}
          onSelect={setSelectedItem}
        />
      )}

      {/* Bottom tab bar */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'rgba(10,10,10,0.95)',
          borderTop: '1px solid #222',
          backdropFilter: 'blur(12px)',
          zIndex: 50,
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          padding: '6px 0 calc(6px + env(safe-area-inset-bottom))',
        }}
      >
        {([
          { id: 'home', icon: 'ph-fill ph-house', label: 'Home' },
          { id: 'search', icon: 'ph ph-magnifying-glass', label: 'Search' },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              if (tab.id === 'search') setList([]);
            }}
            style={{
              flex: 1,
              padding: '10px 0',
              background: 'none',
              border: 'none',
              color: activeTab === tab.id ? '#a3e635' : '#6b7280',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <i className={tab.icon} style={{ fontSize: 22 }} />
            <span style={{ fontSize: 10, fontWeight: 700 }}>{tab.label}</span>
          </button>
        ))}
      </div>

      {selectedItem && (
        <DetailModal
          item={selectedItem}
          isPerson={isPerson}
          displayTitle={displayTitle}
          displayOverview={displayOverview}
          translations={translations}
          activeTranslation={activeTranslation}
          server={server}
          copied={copied}
          onClose={() => setSelectedItem(null)}
          onChangeServer={setServer}
          onChangeTranslation={setActiveTranslation}
          onCopy={handleCopy}
        />
      )}
    </div>
  );
}

// ── Home Tab ───────────────────────────────────────────

function HomeTab(props: {
  mediaType: 'movie' | 'tv';
  category: string;
  genreId: string;
  genres: { id: number; name: string }[];
  heroItem: TmdbItem | null;
  trendingRow: TmdbItem[];
  gridItems: TmdbItem[];
  loading: boolean;
  onSelect: (item: TmdbItem) => void;
  onChangeMediaType: (m: 'movie' | 'tv') => void;
  onChangeCategory: (c: any) => void;
  onChangeGenre: (id: string) => void;
  onLoadMore: () => void;
}) {
  const {
    mediaType,
    category,
    genreId,
    genres,
    heroItem,
    trendingRow,
    gridItems,
    loading,
    onSelect,
    onChangeMediaType,
    onChangeCategory,
    onChangeGenre,
    onLoadMore,
  } = props;

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* Top filter bar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          padding: '16px 16px 12px',
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 100%)',
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 900, letterSpacing: 1 }}>
          <span style={{ color: '#a3e635' }}>E</span>buron
          <span style={{ color: '#a3e635' }}>Flix</span>
        </h1>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginTop: 12,
            fontSize: 13,
            fontWeight: 700,
            overflowX: 'auto',
            whiteSpace: 'nowrap',
          }}
          className="no-scrollbar"
        >
          <button
            onClick={() => onChangeMediaType('movie')}
            style={{
              ...tabBtnStyle,
              color: mediaType === 'movie' ? '#fff' : '#9ca3af',
              borderBottom:
                mediaType === 'movie' ? '2px solid #a3e635' : '2px solid transparent',
            }}
          >
            Movies
          </button>
          <button
            onClick={() => onChangeMediaType('tv')}
            style={{
              ...tabBtnStyle,
              color: mediaType === 'tv' ? '#fff' : '#9ca3af',
              borderBottom:
                mediaType === 'tv' ? '2px solid #a3e635' : '2px solid transparent',
            }}
          >
            TV Shows
          </button>
          <select
            value={category}
            onChange={e => onChangeCategory(e.target.value)}
            style={selectStyle}
          >
            <option value="popular">Popular</option>
            <option value="new_released">New</option>
            <option value="top_rated">Top Rated</option>
            <option value="tagalog">Tagalog</option>
          </select>
          {category !== 'tagalog' && (
            <select
              value={genreId}
              onChange={e => onChangeGenre(e.target.value)}
              style={{ ...selectStyle, marginLeft: 'auto' }}
            >
              <option value="">Genres</option>
              {genres.map(g => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Hero */}
      {heroItem && (
        <div style={{ position: 'relative', width: '100%', height: '60vh', background: '#111' }}>
          <img
            src={
              tmdbImage(heroItem.backdrop_path || heroItem.poster_path, 'w780') ||
              POSTER_FALLBACK
            }
            alt={heroItem.title || heroItem.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.8 }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 80%, #000 100%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 24,
              padding: '0 16px',
              textAlign: 'center',
            }}
          >
            <h2
              style={{
                fontSize: 32,
                fontWeight: 900,
                letterSpacing: -1,
                marginBottom: 8,
                textTransform: 'uppercase',
              }}
            >
              {heroItem.title || heroItem.name}
            </h2>
            <div
              style={{
                fontSize: 12,
                color: '#9ca3af',
                marginBottom: 16,
                display: 'flex',
                gap: 8,
                justifyContent: 'center',
              }}
            >
              <span style={{ color: '#a3e635' }}>
                ★ {heroItem.vote_average?.toFixed(1) ?? '—'}
              </span>
              <span>•</span>
              <span>{(heroItem.release_date || heroItem.first_air_date || '').split('-')[0]}</span>
              {heroItem.original_language === 'tl' && (
                <span
                  style={{
                    background: 'rgba(163,230,53,0.2)',
                    color: '#a3e635',
                    padding: '0 6px',
                    borderRadius: 4,
                  }}
                >
                  Tagalog
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => onSelect(heroItem)}
                style={{
                  background: '#a3e635',
                  color: '#000',
                  fontWeight: 900,
                  padding: '10px 24px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                ▶ Play
              </button>
              <button
                onClick={() => onSelect(heroItem)}
                style={{
                  background: 'rgba(34,34,34,0.8)',
                  color: '#fff',
                  fontWeight: 700,
                  padding: '10px 24px',
                  borderRadius: 6,
                  border: '1px solid #444',
                  cursor: 'pointer',
                }}
              >
                Info
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trending row */}
      {trendingRow.length > 0 && (
        <div style={{ marginTop: 24, paddingLeft: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Trending Now</h3>
          <div
            style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16, paddingRight: 16 }}
            className="no-scrollbar"
          >
            {trendingRow.map(item => (
              <Poster key={item.id} item={item} onClick={() => onSelect(item)} width={110} />
            ))}
          </div>
        </div>
      )}

      {/* Explore grid */}
      {gridItems.length > 0 && (
        <div style={{ marginTop: 8, padding: '0 16px 24px' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Explore More</h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
            }}
          >
            {gridItems.map(item => (
              <Poster key={item.id} item={item} onClick={() => onSelect(item)} />
            ))}
          </div>
          <button
            onClick={onLoadMore}
            style={{
              width: '100%',
              marginTop: 24,
              background: '#111',
              color: '#a3e635',
              border: '1px solid #222',
              borderRadius: 6,
              padding: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
              cursor: 'pointer',
            }}
          >
            {loading ? 'Loading…' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Search Tab ─────────────────────────────────────────

function SearchTab(props: {
  query: string;
  list: TmdbItem[];
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onSelect: (item: TmdbItem) => void;
}) {
  const { query, list, loading, onChange, onSubmit, onSelect } = props;
  return (
    <div style={{ padding: '40px 16px 96px', maxWidth: 1100, margin: '0 auto' }}>
      <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 16 }}>Search</h2>
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={e => onChange(e.target.value)}
          placeholder="Movies, TV Shows, Actors…"
          style={{
            flex: 1,
            minWidth: 0,
            background: '#111',
            border: '1px solid #222',
            color: '#fff',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          style={{
            background: '#a3e635',
            color: '#000',
            fontWeight: 700,
            border: 'none',
            borderRadius: 6,
            padding: '10px 18px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Find
        </button>
      </form>
      {loading && (
        <div style={{ textAlign: 'center', color: '#a3e635', fontWeight: 700 }}>Searching…</div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          paddingBottom: 32,
        }}
      >
        {list.map(item => (
          <Poster key={item.id} item={item} onClick={() => onSelect(item)} />
        ))}
      </div>
    </div>
  );
}

// ── Poster ─────────────────────────────────────────────

function Poster({
  item,
  onClick,
  width,
}: {
  key?: Key;
  item: TmdbItem;
  onClick: () => void;
  width?: number;
}) {
  const src =
    tmdbImage(item.poster_path || item.profile_path, 'w342') || POSTER_FALLBACK;
  return (
    <div
      onClick={onClick}
      style={{
        flex: width ? `0 0 ${width}px` : undefined,
        width: width || undefined,
        cursor: 'pointer',
        aspectRatio: '2 / 3',
        borderRadius: 6,
        overflow: 'hidden',
        background: '#111',
        border: '1px solid #222',
      }}
    >
      <img
        src={src}
        alt={item.title || item.name}
        loading="lazy"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  );
}

// ── Detail Modal ───────────────────────────────────────

function DetailModal(props: {
  item: TmdbItem;
  isPerson: boolean;
  displayTitle: string;
  displayOverview: string;
  translations: { english_name: string; data: any }[];
  activeTranslation: any;
  server: Server;
  copied: boolean;
  onClose: () => void;
  onChangeServer: (server: Server) => void;
  onChangeTranslation: (data: any) => void;
  onCopy: (text: string) => void;
}) {
  const {
    item,
    isPerson,
    displayTitle,
    displayOverview,
    translations,
    activeTranslation,
    server,
    copied,
    onClose,
    onChangeServer,
    onChangeTranslation,
    onCopy,
  } = props;
  const embedUrl = isPerson ? '' : buildEmbedUrl(item, server);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: '#000',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {/* Player / hero */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 60,
          background: '#000',
          borderBottom: '1px solid #222',
        }}
      >
        {!isPerson ? (
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000' }}>
            <iframe
              src={embedUrl}
              title={displayTitle}
              allowFullScreen
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              referrerPolicy="origin"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
            />
          </div>
        ) : (
          <div style={{ position: 'relative', width: '100%', height: '40vh', background: '#111' }}>
            <img
              src={tmdbImage(item.profile_path, 'w780') || POSTER_FALLBACK}
              alt={item.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', opacity: 0.8 }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(to top, #000, transparent)',
              }}
            />
          </div>
        )}
        <button
          onClick={onClose}
          title="Close"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            border: 'none',
            borderRadius: '50%',
            width: 36,
            height: 36,
            cursor: 'pointer',
            zIndex: 70,
          }}
        >
          <i className="ph ph-x" style={{ fontSize: 16 }} />
        </button>

        {!isPerson && (
          <div
            style={{
              background: '#0a0a0a',
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#9ca3af',
                textTransform: 'uppercase',
                letterSpacing: 2,
              }}
            >
              Select Server
            </span>
            <select
              value={server}
              onChange={e => onChangeServer(e.target.value as Server)}
              style={{
                background: '#111',
                border: '1px solid #333',
                color: '#a3e635',
                fontWeight: 700,
                fontSize: 12,
                borderRadius: 4,
                padding: '4px 8px',
                outline: 'none',
              }}
            >
              {SERVERS.map(s => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div style={{ padding: 20, maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8 }}>{displayTitle}</h1>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            fontSize: 13,
            color: '#9ca3af',
            fontWeight: 700,
          }}
        >
          {isPerson ? (
            <span style={{ color: '#a3e635', textTransform: 'uppercase', letterSpacing: 2, fontSize: 11 }}>
              Biography
            </span>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ color: '#a3e635' }}>★ {item.vote_average?.toFixed(1) ?? '—'} Match</span>
              <span>{(item.release_date || item.first_air_date || '').split('-')[0]}</span>
              <span style={{ background: '#222', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>HD</span>
            </div>
          )}
          <button
            onClick={() => onCopy(`Check out ${displayTitle} on EburonFlix!`)}
            style={{
              background: '#111',
              border: '1px solid #333',
              color: copied ? '#a3e635' : '#fff',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {copied ? '✓ Copied!' : 'Share / Copy Text'}
          </button>
        </div>
        <p style={{ fontSize: 14, color: '#e5e7eb', lineHeight: 1.6, marginBottom: 24 }}>{displayOverview}</p>

        {translations.length > 0 && (
          <div
            style={{
              background: '#111',
              border: '1px solid #222',
              borderRadius: 8,
              padding: 16,
              marginBottom: 32,
            }}
          >
            <div
              style={{
                color: '#a3e635',
                fontSize: 11,
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: 2,
                marginBottom: 12,
              }}
            >
              Eburon Translation
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                maxHeight: 200,
                overflowY: 'auto',
              }}
              className="no-scrollbar"
            >
              <button
                onClick={() => onChangeTranslation(null)}
                style={chipStyle(!activeTranslation)}
              >
                Original (English)
              </button>
              {translations.map((t, idx) => {
                if (
                  !t.data.overview &&
                  !t.data.biography &&
                  !t.data.title &&
                  !t.data.name
                ) {
                  return null;
                }
                return (
                  <button
                    key={idx}
                    onClick={() => onChangeTranslation(t.data)}
                    style={chipStyle(activeTranslation === t.data)}
                  >
                    {t.english_name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline style snippets ──────────────────────────────

const tabBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: '4px 0',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
};

const selectStyle: CSSProperties = {
  background: 'transparent',
  color: '#9ca3af',
  fontWeight: 700,
  fontSize: 13,
  border: 'none',
  outline: 'none',
  padding: '4px 8px',
  cursor: 'pointer',
};

const chipStyle = (active: boolean): CSSProperties => ({
  fontSize: 11,
  padding: '6px 12px',
  borderRadius: 4,
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'all 0.2s',
  background: active ? '#a3e635' : '#1a1a1a',
  color: active ? '#000' : '#d1d5db',
  border: active ? 'none' : '1px solid #333',
});

/// <reference types="@types/google.maps" />
import React, { useCallback, useEffect, useState } from 'react';
import {
  APIProvider,
  APILoadingStatus,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Crosshair,
  ExternalLink,
  FileSpreadsheet,
  MapPin,
  MessageSquarePlus,
  Search,
  X,
} from 'lucide-react';
import type { MapPlaceResult, MapsGroundingLink } from '../types';

interface MapsExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  onSendPlacesToChat: (summary: string) => void;
  onExportPlacesToSheets: (rows: string[][]) => void;
}

const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };

function MapsStatusMonitor() {
  const status = useApiLoadingStatus();

  useEffect(() => {
    if (status === APILoadingStatus.AUTH_FAILURE) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
  }, [status]);

  if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) {
    return (
      <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-950/30 text-xs text-amber-200">
        Unable to initialize Google Maps JavaScript API. Check network or key configuration.
      </div>
    );
  }
  return null;
}

interface InnerMapsExplorerProps {
  onSendPlacesToChat: (summary: string) => void;
  onExportPlacesToSheets: (rows: string[][]) => void;
  onClose: () => void;
}

const InnerMapsExplorer: React.FC<InnerMapsExplorerProps> = ({
  onSendPlacesToChat,
  onExportPlacesToSheets,
  onClose,
}) => {
  const map = useMap();
  const coreLib = useMapsLibrary('core');
  const placesLib = useMapsLibrary('places');

  const [query, setQuery] = useState('Specialty coffee shops near downtown');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [places, setPlaces] = useState<MapPlaceResult[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<MapPlaceResult | null>(null);
  const [selectedMarkerEl, setSelectedMarkerEl] =
    useState<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [groundingText, setGroundingText] = useState('');
  const [groundingLinks, setGroundingLinks] = useState<MapsGroundingLink[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      setErrorMsg('Geolocation is not supported by this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(coords);
        if (map) {
          map.panTo(coords);
          map.setZoom(13);
        }
      },
      () => {
        setErrorMsg('Location permission denied or unavailable.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;

      setIsSearching(true);
      setErrorMsg(null);
      setSelectedPlace(null);

      // Run Places API (New) Text Search + Gemini 4 Hydrogen Maps Grounding in parallel
      const placesPromise = (async (): Promise<MapPlaceResult[]> => {
        if (!placesLib?.Place) return [];
        const center = userLocation || DEFAULT_CENTER;
        try {
          const request: google.maps.places.SearchByTextRequest = {
            textQuery: trimmed,
            fields: [
              'id',
              'displayName',
              'formattedAddress',
              'location',
              'rating',
              'userRatingCount',
              'googleMapsURI',
              'types',
            ],
            locationBias: {
              center,
              radius: 12000,
            },
            maxResultCount: 8,
          };
          const { places: found } = await placesLib.Place.searchByText(request);
          return (found || [])
            .filter((p: google.maps.places.Place) => Boolean(p.location))
            .map((p: google.maps.places.Place) => ({
              id: p.id || String(Math.random()),
              name: p.displayName || 'Unnamed Place',
              address: p.formattedAddress || '',
              lat: p.location!.lat(),
              lng: p.location!.lng(),
              rating: p.rating ?? undefined,
              userRatingCount: p.userRatingCount ?? undefined,
              googleMapsUri: p.googleMapsURI ?? undefined,
              types: p.types ?? undefined,
            }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
          throw err;
        }
      })();

      const groundingPromise = (async () => {
        try {
          const res = await fetch('/api/maps/grounding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: trimmed,
              lat: userLocation?.lat,
              lng: userLocation?.lng,
            }),
          });
          if (!res.ok) return { text: '', links: [] };
          return (await res.json()) as {
            text?: string;
            links?: MapsGroundingLink[];
          };
        } catch {
          return { text: '', links: [] };
        }
      })();

      try {
        const [foundPlaces, grounding] = await Promise.all([
          placesPromise.catch((err) => {
            setErrorMsg(
              err instanceof Error ? err.message : 'Unable to search places.'
            );
            return [] as MapPlaceResult[];
          }),
          groundingPromise,
        ]);

        setPlaces(foundPlaces);
        setGroundingText(grounding.text || '');
        setGroundingLinks(grounding.links || []);

        if (map && coreLib && foundPlaces.length > 0) {
          const bounds = new coreLib.LatLngBounds();
          for (const p of foundPlaces) {
            bounds.extend({ lat: p.lat, lng: p.lng });
          }
          map.fitBounds(bounds);
        }
      } finally {
        setIsSearching(false);
      }
    },
    [placesLib, coreLib, query, userLocation, map]
  );

  const handleExportToSheets = () => {
    const header = ['Name', 'Address', 'Rating', 'Reviews', 'Latitude', 'Longitude', 'Google Maps Link'];
    const rows = places.map((p) => [
      p.name,
      p.address,
      p.rating != null ? String(p.rating) : '',
      p.userRatingCount != null ? String(p.userRatingCount) : '',
      String(p.lat),
      String(p.lng),
      p.googleMapsUri || '',
    ]);
    onExportPlacesToSheets([header, ...rows]);
  };

  const handleSendToChat = () => {
    const summary =
      `Google Maps Results for "${query}":\n` +
      places
        .map(
          (p, i) =>
            `${i + 1}. **${p.name}** (${p.rating ?? 'N/A'} stars) — ${p.address}${
              p.googleMapsUri ? ` — [Open in Google Maps](${p.googleMapsUri})` : ''
            }`
        )
        .join('\n') +
      (groundingText ? `\n\nGrounded Insights:\n${groundingText}` : '');
    onSendPlacesToChat(summary);
    onClose();
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full min-h-0">
      {/* Left column: Search, AI Maps Grounding Links & Place List */}
      <div className="w-full lg:w-[400px] flex flex-col gap-3 min-h-0 shrink-0">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search places, cafes, routes..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="button"
            onClick={handleLocateMe}
            className="p-2.5 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 cursor-pointer shrink-0"
            title="Use my current location"
          >
            <Crosshair className="w-4 h-4" />
          </button>
          <button
            type="submit"
            disabled={isSearching}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </form>

        <MapsStatusMonitor />

        {errorMsg && (
          <div className="p-2.5 rounded-lg border border-red-900/60 bg-red-950/30 text-xs text-red-200">
            {errorMsg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {/* Mandatory Maps Grounding Links & Review Snippets */}
          {(groundingText || groundingLinks.length > 0) && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
              <div className="text-xs font-semibold text-indigo-300">
                Google Maps Grounding Insights
              </div>
              {groundingText && (
                <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {groundingText}
                </p>
              )}
              {groundingLinks.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-zinc-800">
                  {groundingLinks.map((link, idx) => (
                    <div key={idx} className="space-y-1">
                      <a
                        href={link.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 underline"
                      >
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span>{link.title}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                      {link.reviewSnippets &&
                        link.reviewSnippets.map((snip, sIdx) => (
                          <p
                            key={sIdx}
                            className="text-[11px] text-zinc-400 pl-4 italic"
                          >
                            &ldquo;{snip}&rdquo;
                          </p>
                        ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {places.map((place) => (
            <button
              key={place.id}
              type="button"
              onClick={() => {
                setSelectedPlace(place);
                if (map) {
                  map.panTo({ lat: place.lat, lng: place.lng });
                  map.setZoom(15);
                }
              }}
              className={`w-full text-left rounded-xl border p-3 transition-colors cursor-pointer ${
                selectedPlace?.id === place.id
                  ? 'bg-zinc-800/80 border-indigo-500/60'
                  : 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-900'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-100">
                  {place.name}
                </span>
                {place.rating != null && (
                  <span className="text-xs text-amber-300 tabular-nums shrink-0">
                    {place.rating.toFixed(1)} ★
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-zinc-400">{place.address}</p>
              {place.googleMapsUri && (
                <a
                  href={place.googleMapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
                >
                  <span>View on Google Maps</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </button>
          ))}

          {places.length === 0 && !isSearching && !groundingText && (
            <div className="text-xs text-zinc-500 py-8 text-center">
              Search any city, venue, or landmark to explore interactive pins and
              Google Maps grounding links.
            </div>
          )}
        </div>

        {places.length > 0 && (
          <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={handleSendToChat}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-100 cursor-pointer whitespace-nowrap"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>Use in AI Chat</span>
            </button>
            <button
              type="button"
              onClick={handleExportToSheets}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-xs font-medium text-emerald-300 cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export to Sheets</span>
            </button>
          </div>
        )}
      </div>

      {/* Right column: Explicit-height Google Map */}
      <div className="flex-1 min-h-[320px] lg:min-h-[480px] h-[340px] lg:h-full rounded-xl overflow-hidden border border-zinc-800">
        <GoogleMap
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={12}
          mapId="DEMO_MAP_ID"
          gestureHandling="greedy"
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          style={{ width: '100%', height: '100%' }}
          onClick={() => setSelectedPlace(null)}
        >
          {userLocation && (
            <AdvancedMarker position={userLocation} title="Your Location">
              <Pin background="#6366f1" borderColor="#4338ca" glyphColor="#ffffff" />
            </AdvancedMarker>
          )}

          {places.map((place) => (
            <AdvancedMarker
              key={place.id}
              position={{ lat: place.lat, lng: place.lng }}
              title={place.name}
              ref={(marker) => {
                if (selectedPlace?.id === place.id && marker) {
                  setSelectedMarkerEl(marker);
                }
              }}
              onClick={() => setSelectedPlace(place)}
            >
              <Pin
                background={selectedPlace?.id === place.id ? '#10b981' : '#ef4444'}
                borderColor="#18181b"
                glyphColor="#ffffff"
              />
            </AdvancedMarker>
          ))}

          {selectedPlace && selectedMarkerEl && (
            <InfoWindow
              anchor={selectedMarkerEl}
              onCloseClick={() => setSelectedPlace(null)}
            >
              <div className="p-1 text-zinc-900 max-w-[220px]">
                <div className="font-semibold text-xs">{selectedPlace.name}</div>
                <div className="text-[11px] text-zinc-600 mt-0.5">
                  {selectedPlace.address}
                </div>
                {selectedPlace.googleMapsUri && (
                  <a
                    href={selectedPlace.googleMapsUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-1 text-[11px] font-medium text-indigo-600 underline"
                  >
                    Open in Google Maps
                  </a>
                )}
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </div>
    </div>
  );
};

export const MapsExplorerModal: React.FC<MapsExplorerModalProps> = ({
  isOpen,
  onClose,
  apiKey,
  onSendPlacesToChat,
  onExportPlacesToSheets,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-xs">
      <div className="w-full max-w-6xl h-[88dvh] rounded-2xl border border-zinc-800 bg-[#111114] flex flex-col overflow-hidden">
        <div className="h-14 px-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <MapPin className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Google Maps Explorer & Location Grounding
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
            aria-label="Close Google Maps Explorer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 p-4 overflow-y-auto lg:overflow-hidden">
          {!apiKey ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
              <MapPin className="w-8 h-8 text-zinc-500" />
              <p className="text-sm font-medium text-zinc-200">
                Google Maps API key not detected in runtime environment.
              </p>
              <p className="text-xs text-zinc-400 max-w-md">
                Configure your Google Maps Platform key in environment secrets to
                render interactive maps and Places search.
              </p>
            </div>
          ) : (
            <APIProvider apiKey={apiKey} libraries={['places', 'marker']}>
              <InnerMapsExplorer
                onSendPlacesToChat={onSendPlacesToChat}
                onExportPlacesToSheets={onExportPlacesToSheets}
                onClose={onClose}
              />
            </APIProvider>
          )}
        </div>
      </div>
    </div>
  );
};

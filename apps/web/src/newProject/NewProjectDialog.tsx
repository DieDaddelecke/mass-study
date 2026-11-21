import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { GeocodeResult, LonLat, LonLatRings, ParcelResult } from '../api/contract';
import { formatNumber } from '../i18n';
import { useUiStore } from '../store/uiStore';
import { createProjectWithContext, type CreatePhase } from './createFlow';
import { errorMessage, isAbort } from './errors';
import {
  dedupeVertices,
  dxfToSite,
  lonLatArea,
  parseDxfPolylines,
  parseGeoJsonSite,
  siteOutline,
  type DxfPolyline,
  type DxfReference,
  type DxfUnit,
  type SiteDraft,
} from './importSite';
import { SiteMap, type MapParcel } from './SiteMap';
import './newProject.css';

// Dev helper: `?newProject=1` opens the dialog on start (screenshots, manual testing).
if (
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('newProject') === '1'
) {
  useUiStore.getState().setNewProjectOpen(true);
}

type SiteMode = 'parcels' | 'draw' | 'import';

interface DxfState {
  fileName: string;
  polylines: DxfPolyline[];
  index: number;
  unit: DxfUnit;
  reference: DxfReference;
}

const DEBOUNCE_MS = 250;
const MIN_RADIUS = 50;
const MAX_RADIUS = 500;

export function NewProjectDialog() {
  const { t } = useTranslation('newProject');
  const close = useCallback(() => useUiStore.getState().setNewProjectOpen(false), []);

  // ---- address -----------------------------------------------------------
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [address, setAddress] = useState<GeocodeResult | null>(null);
  const [searchError, setSearchError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- map ---------------------------------------------------------------
  const [focus, setFocus] = useState<{ lonLat: LonLat; zoom: number; seq: number } | null>(null);
  const [marker, setMarker] = useState<LonLat | null>(null);
  const centerRef = useRef<LonLat>([2.35, 46.6]);

  // ---- site --------------------------------------------------------------
  const [mode, setMode] = useState<SiteMode>('parcels');
  const [seenParcels, setSeenParcels] = useState<ParcelResult[]>([]);
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [parcelBusy, setParcelBusy] = useState(false);
  const [siteMessage, setSiteMessage] = useState('');
  const [draft, setDraft] = useState<LonLat[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [drawn, setDrawn] = useState<LonLatRings | null>(null);
  const [imported, setImported] = useState<SiteDraft | null>(null);
  const [dxf, setDxf] = useState<DxfState | null>(null);
  const [importError, setImportError] = useState('');

  // ---- project -----------------------------------------------------------
  const [name, setName] = useState('');
  const nameTouched = useRef(false);
  const radius = useUiStore((s) => s.contextRadius);
  const [phase, setPhase] = useState<CreatePhase | null>(null);
  const [createError, setCreateError] = useState('');

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // ---- address search ----------------------------------------------------
  const runSearch = useCallback(
    (q: string, full: boolean) => {
      abortRef.current?.abort();
      if (q.trim().length < 3) {
        setSuggestions([]);
        setSearching(false);
        return;
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setSearching(true);
      setSearchError('');
      (full ? api.geocode(q, ctrl.signal) : api.complete(q, ctrl.signal))
        .then((res) => {
          if (ctrl.signal.aborted) return;
          setSuggestions(res.results);
          // full search: preselect the best hit so a second Enter takes it
          setActiveIdx(full && res.results.length ? 0 : -1);
          setSuggestOpen(true);
          if (full && !res.results.length) setSearchError(t('address.noResult'));
        })
        .catch((e: unknown) => {
          if (isAbort(e) || ctrl.signal.aborted) return;
          setSearchError(errorMessage(t, e));
        })
        .finally(() => {
          if (abortRef.current === ctrl) setSearching(false);
        });
    },
    [t],
  );

  const onQueryChange = (e: ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runSearch(q, false), DEBOUNCE_MS);
  };

  const chooseAddress = (r: GeocodeResult) => {
    abortRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
    setAddress(r);
    setQuery(r.label);
    setSuggestOpen(false);
    setSuggestions([]);
    setSearching(false);
    setMarker(r.lonLat);
    setFocus((f) => ({ lonLat: r.lonLat, zoom: 18, seq: (f?.seq ?? 0) + 1 }));
    if (!nameTouched.current) setName(r.label);
  };

  const onQueryKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setSuggestOpen(true);
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (timerRef.current) clearTimeout(timerRef.current);
      const pick = suggestOpen && activeIdx >= 0 ? suggestions[activeIdx] : undefined;
      // A highlighted entry is chosen; otherwise run the full search.
      if (pick) chooseAddress(pick);
      else runSearch(query, true);
    } else if (e.key === 'Escape' && suggestOpen) {
      e.preventDefault();
      e.stopPropagation();
      setSuggestOpen(false);
    }
  };

  // ---- parcels -----------------------------------------------------------
  const parcelAbort = useRef<AbortController | null>(null);
  const pickParcelAt = (lonLat: LonLat) => {
    parcelAbort.current?.abort();
    const ctrl = new AbortController();
    parcelAbort.current = ctrl;
    setParcelBusy(true);
    setSiteMessage('');
    api
      .parcelsAt(lonLat[0], lonLat[1], ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        if (!res.covered) {
          setSiteMessage(t('parcels.notCovered'));
          setMode('draw');
          return;
        }
        if (!res.parcels.length) {
          setSiteMessage(t('parcels.none'));
          return;
        }
        setSeenParcels((seen) => {
          const byRef = new Map(seen.map((p) => [p.ref, p]));
          for (const p of res.parcels) byRef.set(p.ref, p);
          return [...byRef.values()];
        });
        setSelectedRefs((sel) => {
          let next = sel;
          for (const p of res.parcels)
            next = next.includes(p.ref) ? next.filter((r) => r !== p.ref) : [...next, p.ref];
          return next;
        });
      })
      .catch((e: unknown) => {
        if (!isAbort(e) && !ctrl.signal.aborted) setSiteMessage(errorMessage(t, e));
      })
      .finally(() => {
        if (parcelAbort.current === ctrl) setParcelBusy(false);
      });
  };
  const selectedParcels = useMemo(
    () =>
      selectedRefs
        .map((r) => seenParcels.find((p) => p.ref === r))
        .filter((p): p is ParcelResult => !!p),
    [selectedRefs, seenParcels],
  );
  const mapParcels = useMemo<MapParcel[]>(
    () =>
      mode === 'parcels'
        ? seenParcels.map((p) => ({
            ref: p.ref,
            polygons: p.polygons,
            selected: selectedRefs.includes(p.ref),
          }))
        : [],
    [mode, seenParcels, selectedRefs],
  );

  // ---- drawing -----------------------------------------------------------
  const finishDrawing = useCallback(() => {
    setDraft((d) => {
      const pts = dedupeVertices(d);
      if (pts.length >= 3) {
        setDrawn([[...pts, pts[0]!]]);
        setDrawing(false);
        return [];
      }
      return pts;
    });
  }, []);
  const cancelDrawing = useCallback(() => {
    setDraft([]);
    setDrawing(false);
  }, []);
  const startDrawing = () => {
    setDrawn(null);
    setDraft([]);
    setDrawing(true);
  };

  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finishDrawing();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setDraft((d) => d.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing, finishDrawing]);

  // ---- import ------------------------------------------------------------
  const placeAt = (): LonLat => marker ?? centerRef.current;
  const applyDxf = (s: DxfState) => {
    const pl = s.polylines.find((p) => p.index === s.index) ?? s.polylines[0]!;
    const site = dxfToSite(pl, s.unit, s.reference, placeAt());
    setImported(site);
    const outline = siteOutline(site)[0]?.[0]?.[0];
    if (outline) setFocus((f) => ({ lonLat: outline, zoom: 17, seq: (f?.seq ?? 0) + 1 }));
  };
  const updateDxf = (patch: Partial<DxfState>) => {
    if (!dxf) return;
    const next = { ...dxf, ...patch };
    setDxf(next);
    try {
      applyDxf(next);
      setImportError('');
    } catch (e) {
      setImported(null);
      setImportError(errorMessage(t, e));
    }
  };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError('');
    setImported(null);
    setDxf(null);
    try {
      const text = await file.text();
      if (/\.dxf$/i.test(file.name)) {
        const polylines = parseDxfPolylines(text);
        const s: DxfState = {
          fileName: file.name,
          polylines,
          index: polylines[0]!.index,
          unit: 'm',
          reference: 'local',
        };
        setDxf(s);
        applyDxf(s);
      } else {
        const polygons = parseGeoJsonSite(text);
        setImported({ kind: 'lonlat', source: 'import', polygons });
        const p = polygons[0]![0]![0]!;
        setFocus((f) => ({ lonLat: p, zoom: 17, seq: (f?.seq ?? 0) + 1 }));
      }
    } catch (err) {
      setImportError(errorMessage(t, err));
    }
  };

  // ---- current site ------------------------------------------------------
  const site: SiteDraft | null = useMemo(() => {
    if (mode === 'parcels')
      return selectedParcels.length ? { kind: 'parcels', parcels: selectedParcels } : null;
    if (mode === 'draw')
      return drawn ? { kind: 'lonlat', source: 'drawn', polygons: [drawn] } : null;
    return imported;
  }, [mode, selectedParcels, drawn, imported]);
  const outline = useMemo(() => (site && site.kind !== 'parcels' ? siteOutline(site) : []), [site]);

  // ---- map events --------------------------------------------------------
  const onMapClick = (p: LonLat) => {
    if (phase) return;
    if (mode === 'parcels') pickParcelAt(p);
    else if (mode === 'draw') {
      if (!drawing) {
        if (drawn) return;
        setDrawing(true);
      }
      setDraft((d) => [...d, p]);
    }
  };
  const onMapDblClick = () => {
    if (mode === 'draw' && drawing) finishDrawing();
  };

  // ---- create ------------------------------------------------------------
  const busy = phase !== null;
  const canCreate = !!site && name.trim().length > 0 && !busy;
  const create = async () => {
    if (!site) return;
    setCreateError('');
    try {
      const req: Parameters<typeof createProjectWithContext>[0] = {
        name: name.trim(),
        site,
        radius,
      };
      if (address) req.address = address.label;
      const { contextError } = await createProjectWithContext(req, setPhase);
      if (contextError)
        useUiStore
          .getState()
          .setHint(t('create.contextFailed', { msg: errorMessage(t, contextError) }));
      close();
    } catch (e) {
      setCreateError(errorMessage(t, e));
      setPhase(null);
    }
  };

  const fmtArea = (a: number) => `${formatNumber(a, 0, 'fr')} m²`;
  const parcelTotal = selectedParcels.reduce((s, p) => s + (p.officialArea ?? 0), 0);
  const parcelsMissingArea = selectedParcels.some((p) => p.officialArea === undefined);

  const mapHint =
    mode === 'parcels'
      ? t('map.hintParcels')
      : mode === 'draw'
        ? drawing
          ? t('map.hintDrawing')
          : t('map.hintDraw')
        : t('map.hintImport');

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !busy && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="np-overlay" />
        <Dialog.Content
          className="np-dialog"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            if (drawing) {
              e.preventDefault();
              cancelDrawing();
            } else if (busy) e.preventDefault();
          }}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <header className="np-header">
            <Dialog.Title className="np-title">{t('title')}</Dialog.Title>
            <Dialog.Close className="np-close" aria-label={t('close')} disabled={busy}>
              ×
            </Dialog.Close>
          </header>

          <div className="np-body">
            <div className="np-steps">
              {/* 1 – address */}
              <section className="np-step">
                <h3>
                  <span className="np-num">1</span>
                  {t('address.title')}
                </h3>
                <div className="np-search">
                  <input
                    type="search"
                    role="combobox"
                    aria-expanded={suggestOpen && suggestions.length > 0}
                    aria-controls="np-suggest"
                    aria-label={t('address.title')}
                    placeholder={t('address.placeholder')}
                    value={query}
                    onChange={onQueryChange}
                    onKeyDown={onQueryKey}
                    onFocus={() => suggestions.length && setSuggestOpen(true)}
                    onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
                    autoFocus
                  />
                  {searching && <span className="np-spinner" aria-label={t('busy')} />}
                  {suggestOpen && suggestions.length > 0 && (
                    <ul id="np-suggest" role="listbox" className="np-suggest">
                      {suggestions.map((r, i) => (
                        <li
                          key={`${r.label}-${i}`}
                          role="option"
                          aria-selected={i === activeIdx}
                          className={i === activeIdx ? 'active' : ''}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            chooseAddress(r);
                          }}
                        >
                          <span>{r.label}</span>
                          <small>{t(`address.kind.${r.kind}`)}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {searchError && <p className="np-msg np-error">{searchError}</p>}
              </section>

              {/* 2 – site */}
              <section className="np-step">
                <h3>
                  <span className="np-num">2</span>
                  {t('site.title')}
                </h3>
                <div className="np-tabs" role="tablist">
                  {(['parcels', 'draw', 'import'] as const).map((m) => (
                    <button
                      key={m}
                      role="tab"
                      aria-selected={mode === m}
                      className={mode === m ? 'active' : ''}
                      onClick={() => {
                        if (m !== 'draw') cancelDrawing();
                        setMode(m);
                      }}
                      disabled={busy}
                    >
                      {t(`site.${m}`)}
                    </button>
                  ))}
                </div>
                {siteMessage && <p className="np-msg np-warn">{siteMessage}</p>}

                {mode === 'parcels' && (
                  <div className="np-pane">
                    <p className="np-help">{t('parcels.help')}</p>
                    {parcelBusy && <p className="np-help">{t('parcels.loading')}</p>}
                    {selectedParcels.length > 0 && (
                      <table className="np-table">
                        <thead>
                          <tr>
                            <th>{t('parcels.ref')}</th>
                            <th className="num">{t('parcels.area')}</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {selectedParcels.map((p) => (
                            <tr key={p.ref}>
                              <td title={p.ref}>{p.label}</td>
                              <td className="num">
                                {p.officialArea !== undefined ? fmtArea(p.officialArea) : '–'}
                              </td>
                              <td>
                                <button
                                  className="np-link"
                                  aria-label={t('parcels.remove')}
                                  title={t('parcels.remove')}
                                  onClick={() =>
                                    setSelectedRefs((s) => s.filter((r) => r !== p.ref))
                                  }
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td>
                              {t('parcels.total', { count: selectedParcels.length })}
                              {selectedParcels.length > 1 && ` · ${t('parcels.merged')}`}
                            </td>
                            <td className="num">
                              {parcelsMissingArea ? '≥ ' : ''}
                              {fmtArea(parcelTotal)}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    )}
                  </div>
                )}

                {mode === 'draw' && (
                  <div className="np-pane">
                    <p className="np-help">{t('draw.help')}</p>
                    <div className="np-row">
                      {!drawing ? (
                        <button onClick={startDrawing} disabled={busy}>
                          {drawn ? t('draw.restart') : t('draw.start')}
                        </button>
                      ) : (
                        <>
                          <button onClick={finishDrawing} disabled={draft.length < 3}>
                            {t('draw.finish')}
                          </button>
                          <button
                            onClick={() => setDraft((d) => d.slice(0, -1))}
                            disabled={!draft.length}
                          >
                            {t('draw.undo')}
                          </button>
                          <button onClick={cancelDrawing}>{t('draw.cancel')}</button>
                        </>
                      )}
                    </div>
                    {drawing && (
                      <p className="np-help">{t('draw.vertices', { count: draft.length })}</p>
                    )}
                  </div>
                )}

                {mode === 'import' && (
                  <div className="np-pane">
                    <p className="np-help">{t('import.help')}</p>
                    <label className="np-file">
                      <input
                        type="file"
                        accept=".geojson,.json,.dxf"
                        onChange={(e) => void onFile(e)}
                        disabled={busy}
                        aria-label={t('import.choose')}
                      />
                      <span>{t('import.choose')}</span>
                    </label>
                    {dxf && (
                      <div className="np-dxf">
                        <div className="np-file-name">{dxf.fileName}</div>
                        {dxf.polylines.length > 1 && (
                          <label className="np-field">
                            <span>{t('import.polyline')}</span>
                            <select
                              value={dxf.index}
                              onChange={(e) => updateDxf({ index: Number(e.target.value) })}
                            >
                              {dxf.polylines.map((p, i) => (
                                <option key={p.index} value={p.index}>
                                  {t('import.polylineOption', {
                                    n: i + 1,
                                    layer: p.layer,
                                    count: p.points.length,
                                  })}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label className="np-field">
                          <span>{t('import.unit')}</span>
                          <select
                            value={dxf.unit}
                            onChange={(e) => updateDxf({ unit: e.target.value as DxfUnit })}
                          >
                            <option value="m">m</option>
                            <option value="cm">cm</option>
                            <option value="mm">mm</option>
                          </select>
                        </label>
                        <fieldset className="np-radio">
                          <legend>{t('import.reference')}</legend>
                          <label>
                            <input
                              type="radio"
                              name="np-ref"
                              checked={dxf.reference === 'local'}
                              onChange={() => updateDxf({ reference: 'local' })}
                            />
                            {t('import.local')}
                          </label>
                          <label>
                            <input
                              type="radio"
                              name="np-ref"
                              checked={dxf.reference === 'lambert93'}
                              onChange={() => updateDxf({ reference: 'lambert93' })}
                            />
                            {t('import.lambert93')}
                          </label>
                        </fieldset>
                        {dxf.reference === 'local' && (
                          <p className="np-help">
                            {marker ? t('import.placedAtAddress') : t('import.placedAtCenter')}{' '}
                            <button className="np-link" onClick={() => updateDxf({})}>
                              {t('import.replace')}
                            </button>
                          </p>
                        )}
                      </div>
                    )}
                    {importError && <p className="np-msg np-error">{importError}</p>}
                  </div>
                )}

                {site && site.kind !== 'parcels' && (
                  <p className="np-help np-area">
                    {t('site.area')} ≈ {fmtArea(lonLatArea(outline))}
                  </p>
                )}
              </section>

              {/* 3 – project */}
              <section className="np-step">
                <h3>
                  <span className="np-num">3</span>
                  {t('project.title')}
                </h3>
                <label className="np-field">
                  <span>{t('project.name')}</span>
                  <input
                    type="text"
                    value={name}
                    placeholder={t('project.namePlaceholder')}
                    onChange={(e) => {
                      nameTouched.current = true;
                      setName(e.target.value);
                    }}
                    disabled={busy}
                  />
                </label>
                <label className="np-field">
                  <span>{t('project.radius')}</span>
                  <span className="np-slider">
                    <input
                      type="range"
                      min={MIN_RADIUS}
                      max={MAX_RADIUS}
                      step={10}
                      value={radius}
                      onChange={(e) =>
                        useUiStore.getState().setContextRadius(Number(e.target.value))
                      }
                      disabled={busy}
                    />
                    <output>{radius} m</output>
                  </span>
                </label>
              </section>
            </div>

            <div className="np-mapwrap">
              <SiteMap
                focus={focus}
                marker={marker}
                parcels={mapParcels}
                site={outline}
                draft={draft}
                drawing={mode === 'draw' && drawing}
                onClick={onMapClick}
                onDoubleClick={onMapDblClick}
                onCenterChange={(c) => (centerRef.current = c)}
              />
              <div className="np-maphint">{mapHint}</div>
            </div>
          </div>

          <footer className="np-footer">
            <div className="np-status" aria-live="polite">
              {phase && (
                <>
                  <span className="np-spinner" />
                  {t(`create.phase.${phase}`, { radius })}
                </>
              )}
              {createError && <span className="np-error">{createError}</span>}
              {!phase && !createError && !site && (
                <span className="np-muted">{t('create.needSite')}</span>
              )}
            </div>
            <Dialog.Close className="np-btn" disabled={busy}>
              {t('cancel')}
            </Dialog.Close>
            <button
              className="np-btn np-primary"
              disabled={!canCreate}
              onClick={() => void create()}
            >
              {t('create.button')}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

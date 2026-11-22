'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Copy, FlaskConical, Link2, LoaderCircle, Search, Upload, Video } from 'lucide-react';

type ProbeResult = {
  reachable: boolean;
  encoded: boolean;
  video: { codec: string; width: number | null; height: number | null; fps: number | null };
  audio: { codec: string; channels: number | null; sampleRate: number | null } | null;
  durationSeconds: number | null;
};

type ApiRequest = <T,>(url: string, init?: RequestInit) => Promise<T>;
type CollectorStatus = { phase: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'; query: string;
  requested: number; found: number; visited: number; error: string | null; note: string };
type CollectorResults = CollectorStatus & { directVideoUrls: string[] };

function safeUrlLabel(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname.slice(-42)}`;
  } catch { return 'Invalid media URL'; }
}

type MediaProbeProps = {
  request: ApiRequest;
  onMediaUrlsChange: (urls: string[]) => void;
  directActive: boolean;
  onDirectActiveChange: (active: boolean) => void;
  liveLocked: boolean;
  liveDirect: boolean;
};

export default function MediaProbePanel({ request, onMediaUrlsChange, directActive, onDirectActiveChange, liveLocked, liveDirect }: MediaProbeProps) {
  const [url, setUrl] = useState('');
  const [imported, setImported] = useState<string[]>([]);
  const [importWarning, setImportWarning] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchCount, setSearchCount] = useState(20);
  const [collector, setCollector] = useState<CollectorStatus | null>(null);
  const [collectBusy, setCollectBusy] = useState(false);

  const applyCollectedResults = useCallback((results: CollectorResults) => {
    if (results.directVideoUrls.length) {
      setImported(results.directVideoUrls);
      setUrl(results.directVideoUrls[0]);
      setError(''); setResult(null); setImportWarning(''); setCopied(false);
      onMediaUrlsChange(results.directVideoUrls);
      onDirectActiveChange(true);
    } else if (results.phase === 'completed') {
      setError('No direct MP4 elements were exposed by Instagram. Sign in, try another keyword, or use manual JSON import.');
    }
  }, [onMediaUrlsChange, onDirectActiveChange]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await request<CollectorStatus>('/api/instagram-live/media/collect/status');
      if (cancelled) return;
      // A completed collection can survive a page reload. Restore the actual
      // URLs as well as the progress indicator so Start is enabled again.
      if (status.phase === 'completed' || status.phase === 'stopped' || status.phase === 'failed') {
        const results = await request<CollectorResults>('/api/instagram-live/media/collect/results');
        if (cancelled) return;
        applyCollectedResults(results);
      }
      setCollector(status);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [request, applyCollectedResults]);

  useEffect(() => {
    if (collector?.phase !== 'running') return;
    let cancelled = false;
    const poll = setInterval(async () => {
      try {
        const status = await request<CollectorStatus>('/api/instagram-live/media/collect/status');
        if (cancelled) return;
        if (status.phase !== 'running') {
          // Fetch the MP4s BEFORE changing phase. Updating collector first
          // tears down this polling effect and discards the in-flight results.
          const results = await request<CollectorResults>('/api/instagram-live/media/collect/results');
          if (cancelled) return;
          applyCollectedResults(results);
        }
        setCollector(status);
      } catch (cause) { if (!cancelled) setError((cause as Error).message); }
    }, 1300);
    return () => { cancelled = true; clearInterval(poll); };
  }, [collector?.phase, request, applyCollectedResults]);

  async function startCollection() {
    if (liveLocked || collectBusy || collector?.phase === 'running') return;
    setCollectBusy(true); setError(''); setResult(null); setImportWarning('');
    try {
      const status = await request<CollectorStatus>('/api/instagram-live/media/collect/start', {
        method: 'POST', body: JSON.stringify({ query: searchKeyword.trim(), count: searchCount }),
      });
      setImported([]);
      setUrl('');
      onMediaUrlsChange([]);
      setCollector(status);
    } catch (cause) { setError((cause as Error).message); }
    finally { setCollectBusy(false); }
  }

  async function stopCollection() {
    try {
      const status = await request<CollectorStatus>('/api/instagram-live/media/collect/stop', { method: 'POST', body: '{}' });
      setCollector(status);
    } catch (cause) { setError((cause as Error).message); }
  }

  function exportJson() {
    if (!imported.length) return;
    const json = JSON.stringify({ source: 'streamforge-instagram-collector', searchQuery: collector?.query || null,
      exportedAt: new Date().toISOString(), directVideoUrls: imported }, null, 2);
    const objectUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = objectUrl; link.download = `instagram-${Date.now()}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  async function importJson(file: File | undefined) {
    if (!file) return;
    setError(''); setResult(null); setImportWarning(''); setCopied(false);
    try {
      if (file.size > 2_000_000) throw new Error('JSON file is too large (limit 2 MB).');
      const data: unknown = JSON.parse(await file.text());
      const record = data && typeof data === 'object' && !Array.isArray(data)
        ? data as Record<string, unknown> : {};
      const rows: unknown[] = Array.isArray(data) ? data
        : Array.isArray(record.directVideoUrls) ? record.directVideoUrls
        : Array.isArray(record.videos) ? record.videos : [];
      const links = [...new Set(rows.map((row) => typeof row === 'string' ? row
        : row && typeof row === 'object' && 'mediaUrl' in row ? (row as { mediaUrl?: unknown }).mediaUrl
        : null).filter((item): item is string => typeof item === 'string' && item.startsWith('https://')))].slice(0, 100);
      if (!links.length) throw new Error('No direct video URLs found. Export sfCollector.results() as JSON.');
      setImported(links);
      setUrl(links[0]);
      onMediaUrlsChange(links);
      const exportedAt = typeof record.exportedAt === 'string' ? Date.parse(record.exportedAt) : NaN;
      if (Number.isFinite(exportedAt) && Date.now() - exportedAt > 30 * 60_000) {
        setImportWarning('This JSON was exported over 30 minutes ago. Instagram signed MP4 links can expire. If you see 404, paste a newly copied video URL.');
      }
    } catch (cause) { setImported([]); onMediaUrlsChange([]); setError((cause as Error).message); }
  }

  async function probe(decode: boolean) {
    if (!url.trim() || busy) return;
    setBusy(true); setResult(null); setError('');
    try {
      const response = await request<ProbeResult>('/api/instagram-live/media/probe', {
        method: 'POST', body: JSON.stringify({ url: url.trim(), decode }),
      });
      setResult(response);
      } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="il-panel il-media-probe">
      <div className="il-panel-head">
        <div className="il-panel-icon il-magenta"><FlaskConical size={20}/></div>
        <div><p>DIRECT MEDIA STUDIO</p><h2>Find Instagram videos automatically</h2>
          <span>Search keyword + number of videos. Collect playable MP4 links into your direct FFmpeg playlist.</span></div>
      </div>
      <div className="il-playlist-fields">
        <div className="il-auto-collector">
          <div className="il-two-cols">
            <div><label className="il-label" htmlFor="il-search-keyword">CONTENT TITLE / SEARCH KEYWORD</label>
              <input id="il-search-keyword" type="text" maxLength={80} placeholder="e.g. naruto, puzzles, woodworking"
                value={searchKeyword} onChange={(event) => setSearchKeyword(event.target.value)}
                disabled={liveLocked || collectBusy || collector?.phase === 'running'}/></div>
            <div><label className="il-label" htmlFor="il-search-count">NUMBER OF VIDEOS (1–100)</label>
              <input id="il-search-count" type="number" min={1} max={100} value={searchCount}
                onChange={(event) => setSearchCount(Number(event.target.value))}
                disabled={liveLocked || collectBusy || collector?.phase === 'running'}/></div>
          </div>
          <div className="il-playlist-actions">
            <button type="button" className="il-playlist-paste" onClick={() => void startCollection()}
              disabled={liveLocked || collectBusy || collector?.phase === 'running' || searchKeyword.trim().length < 2 || !Number.isInteger(searchCount) || searchCount < 1 || searchCount > 100}>
              {collector?.phase === 'running' ? <LoaderCircle className="il-spin" size={17}/> : <Search size={17}/>}
              {collector?.phase === 'running' ? 'Collecting from Instagram…' : 'Find videos automatically'}
            </button>
            <button type="button" className="il-secondary-btn" onClick={() => void stopCollection()}
              disabled={collector?.phase !== 'running'}>Stop collecting</button>
          </div>
          {collector && collector.phase !== 'idle' && <div className="il-collector-progress" role="status">
            <div><b>{collector.found} / {collector.requested} videos found</b><span>{collector.phase} · {collector.visited} scroll passes</span></div>
            <progress value={collector.found} max={collector.requested || 1}/>
            {collector.note && <p>{collector.note}</p>}
            {collector.error && <p className="il-collector-error">{collector.error}</p>}
          </div>}
          <p className="il-hint">Uses only your signed-in private Chrome session and visible Instagram Search results. Results depend on what Instagram loads; the requested count is not guaranteed. No login or CAPTCHA bypass.</p>
          {liveDirect && <p className="il-hint"><b>The current live keeps playing while you search.</b> Once new videos are collected, click Replace live playlist in Live Control to switch. Switching reconnects the encoder briefly.</p>}
        </div>
        <div><label className="il-label" htmlFor="il-media-url">EXTRACTED INSTAGRAM VIDEO URL</label>
          <div className="il-url-input"><Link2 size={17}/>
            <input id="il-media-url" type="url" autoComplete="off" spellCheck={false}
              placeholder="https://instagram...fbcdn.net/...mp4?..." value={url}
              onChange={(event) => {
                const value = event.target.value;
                setUrl(value); setResult(null); setError(''); setCopied(false);
                if (!imported.includes(value)) { setImported([]); onMediaUrlsChange(value.trim() ? [value.trim()] : []); }
              }} disabled={busy || liveLocked}/>
          </div>
        </div>
        <label className="il-probe-upload"><Upload size={17}/><span>Import collector JSON</span>
          <input type="file" accept=".json,application/json" disabled={busy || liveLocked} onChange={(event) => {
            void importJson(event.target.files?.[0]); event.currentTarget.value = '';
          }}/>
        </label>
        {imported.length > 0 && <button type="button" className="il-media-copy" onClick={exportJson}><Upload size={15}/> Download collected JSON ({imported.length})</button>}
        {imported.length > 0 && <div><label className="il-label" htmlFor="il-imported-video">IMPORTED DIRECT URLS · {imported.length}</label>
          <select id="il-imported-video" value={imported.includes(url) ? url : ''} disabled={busy || liveLocked}
            onChange={(event) => { setUrl(event.target.value); setResult(null); setError(''); setCopied(false); }}>
            <option value="">Choose a collected video</option>
            {imported.map((item, index) => <option key={index} value={item}>{index + 1}. {safeUrlLabel(item)}</option>)}
          </select>
          <p className="il-hint">This dropdown chooses just the clip to <b>test</b>. Direct livestream mode plays <b>all {imported.length} imported clips</b> in JSON order.</p>
        </div>}
        <label className="il-option"><input type="checkbox" checked={directActive} disabled={liveLocked || liveDirect}
          onChange={(event) => onDirectActiveChange(event.target.checked)}/>
          <span><b>Use these MP4 links as YouTube Live source</b>
            <small>{directActive ? 'Direct FFmpeg playlist mode ON — Start livestream will stream these MP4s, NOT the VNC browser.'
              : 'OFF — Start livestream still captures the Chrome/VNC screen.'}</small></span>
        </label>
        {directActive && <p className="il-hint"><b>{imported.length || (url.trim() ? 1 : 0)} MP4(s) ready.</b> {liveDirect ? 'These are your proposed next clips. The active stream is unchanged until you click Replace live playlist.' : 'Import a fresh JSON playlist before starting.'} Signed links can expire; for best reliability use clips with consistent video and audio tracks.</p>}
        {importWarning && <p className="il-hint" role="status">{importWarning}</p>}
        {url && <button type="button" className="il-media-copy" disabled={busy} onClick={async () => {
          try { await navigator.clipboard.writeText(url); setCopied(true); }
          catch { setError('Could not copy the link. Select the URL in the field and copy it manually.'); }
        }}><Copy size={15}/>{copied ? 'Exact signed URL copied' : 'Copy exact selected URL for terminal comparison'}</button>}
      </div>
      <div className="il-playlist-actions il-probe-actions">
        <button type="button" className="il-secondary-btn" disabled={busy || !url.trim()} onClick={() => probe(false)}>
          {busy ? <LoaderCircle className="il-spin" size={17}/> : <Video size={17}/>} Check media
        </button>
        <button type="button" className="il-playlist-paste" disabled={busy || !url.trim()} onClick={() => probe(true)}>
          {busy ? <LoaderCircle className="il-spin" size={16}/> : <FlaskConical size={16}/>} Test 4s encoding
        </button>
      </div>
      {error && <p className="il-probe-result il-probe-fail" role="alert"><CircleAlert size={17}/>{error}</p>}
      {result && <div className="il-probe-result il-probe-success" role="status">
        <CheckCircle2 size={19}/><div><b>{result.encoded ? 'Direct FFmpeg encoding worked!' : 'FFprobe can read this media!'}</b>
          <span>Video: {result.video.codec} · {result.video.width || '?'}×{result.video.height || '?'} · {result.video.fps ?? '?'} FPS · {result.durationSeconds ?? '?'}s</span>
          <span>Audio: {result.audio ? `${result.audio.codec}, ${result.audio.channels ?? '?'} channel(s)` : 'No audio track (silent audio will be needed)'}</span>
        </div>
      </div>}
      <p className="il-hint">If the terminal works but this probe returns 404, use Copy exact selected URL and test that same URL using a normal <code>ffprobe</code> command. The probe now uses the same supported options as the Codespaces FFprobe installation. Only HTTPS Instagram/Meta CDN MP4 links are accepted initially; signed video URLs may expire or redirect. Imports stay in browser memory and are not saved to Git or MySQL. Stream only content you have permission to rebroadcast.</p>
    </section>
  );
}

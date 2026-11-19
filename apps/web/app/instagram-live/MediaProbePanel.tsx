'use client';

import { useState } from 'react';
import { CheckCircle2, CircleAlert, Copy, FlaskConical, Link2, LoaderCircle, Upload, Video } from 'lucide-react';

type ProbeResult = {
  reachable: boolean;
  encoded: boolean;
  video: { codec: string; width: number | null; height: number | null; fps: number | null };
  audio: { codec: string; channels: number | null; sampleRate: number | null } | null;
  durationSeconds: number | null;
};

type ApiRequest = <T,>(url: string, init?: RequestInit) => Promise<T>;

function safeUrlLabel(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname.slice(-42)}`;
  } catch { return 'Invalid media URL'; }
}

export default function MediaProbePanel({ request }: { request: ApiRequest }) {
  const [url, setUrl] = useState('');
  const [imported, setImported] = useState<string[]>([]);
  const [importWarning, setImportWarning] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState('');

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
      const exportedAt = typeof record.exportedAt === 'string' ? Date.parse(record.exportedAt) : NaN;
      if (Number.isFinite(exportedAt) && Date.now() - exportedAt > 30 * 60_000) {
        setImportWarning('This JSON was exported over 30 minutes ago. Instagram signed MP4 links can expire. If you see 404, paste a newly copied video URL.');
      }
    } catch (cause) { setImported([]); setError((cause as Error).message); }
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
        <div><p>EXPERIMENT 01</p><h2>Direct MP4 → FFmpeg</h2>
          <span>Test a video before building the continuous playlist engine. This does not start YouTube Live.</span></div>
      </div>
      <div className="il-playlist-fields">
        <div><label className="il-label" htmlFor="il-media-url">EXTRACTED INSTAGRAM VIDEO URL</label>
          <div className="il-url-input"><Link2 size={17}/>
            <input id="il-media-url" type="url" autoComplete="off" spellCheck={false}
              placeholder="https://instagram...fbcdn.net/...mp4?..." value={url}
              onChange={(event) => { setUrl(event.target.value); setResult(null); setError(''); setCopied(false); }} disabled={busy}/>
          </div>
        </div>
        <label className="il-probe-upload"><Upload size={17}/><span>Import collector JSON</span>
          <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
            void importJson(event.target.files?.[0]); event.currentTarget.value = '';
          }}/>
        </label>
        {imported.length > 0 && <div><label className="il-label" htmlFor="il-imported-video">IMPORTED DIRECT URLS · {imported.length}</label>
          <select id="il-imported-video" value={imported.includes(url) ? url : ''} disabled={busy}
            onChange={(event) => { setUrl(event.target.value); setResult(null); setError(''); setCopied(false); }}>
            <option value="">Choose a collected video</option>
            {imported.map((item, index) => <option key={index} value={item}>{index + 1}. {safeUrlLabel(item)}</option>)}
          </select>
        </div>}
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

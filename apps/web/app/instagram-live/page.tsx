'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity, ArrowLeft, BadgeCheck, Check, ChevronDown, CircleAlert, CircleCheck, Clapperboard,
  Clock3, ExternalLink, Eye, Instagram, LoaderCircle, Monitor, Music2, Play, Radio, RefreshCw,
  Save, Settings2, ShieldCheck, Square, Terminal, Tv2, VolumeX, WandSparkles,
} from 'lucide-react';
import './instagram-live.css';

type Channel = { id: string; displayName: string; handle: string; ready: boolean; hasStreamKey: boolean; youtubeConnected: boolean };
type Settings = {
  title: string; description: string; privacy: 'private' | 'unlisted' | 'public';
  scroll: 'wheel' | 'arrow'; mobileLayout: boolean; frame: 'iphone' | 'none'; captureWidth: number; captureHeight: number;
  captureX: number; captureY: number; fps: number; bitrateKbps: number;
  audio: 'silent' | 'pulse'; createBroadcast: boolean;
};
type Status = {
  running: boolean; starting: boolean; activeChannelId: string | null; startedAt: string | null;
  feed: { phase: string; activeId: number | null; currentTime: number | null; duration: number | null } | null;
  error: string | null; logs: string[]; broadcast: { title: string; url: string } | null;
};

const formatTime = (value: string | null) => {
  if (!value) return 'Not started';
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

export default function InstagramLivePage() {
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadedId, setLoadedId] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [browserReady, setBrowserReady] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);

  const request = useCallback(async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(baseUrl + url, {
      ...init, cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body as T;
  }, [baseUrl, token]);

  useEffect(() => {
    const isLocal = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    setBaseUrl(isLocal ? window.location.origin : (localStorage.getItem('streamforge-api-url') || window.location.origin).replace(/\/$/, ''));
    setToken(sessionStorage.getItem('streamforge-token') || '');
  }, []);

  const refresh = useCallback(async () => {
    if (!baseUrl) return;
    const [profiles, live] = await Promise.all([
      request<{ channels: Channel[] }>('/api/channels'), request<Status>('/api/instagram-live/status'),
    ]);
    setChannels(profiles.channels);
    setStatus(live);
    setSelectedId((current) => current || live.activeChannelId || profiles.channels.find((item) => item.ready)?.id || profiles.channels[0]?.id || '');
  }, [baseUrl, request]);

  useEffect(() => {
    if (!baseUrl) return;
    refresh().catch((cause) => setError(cause.message));
    const timer = setInterval(() => { refresh().catch(() => {}); }, 3500);
    return () => clearInterval(timer);
  }, [baseUrl, refresh]);

  useEffect(() => {
    if (!selectedId || !baseUrl) return;
    let cancelled = false;
    setSettings(null); setLoadedId(''); setRights(false); setSaveState('idle');
    request<Settings>(`/api/instagram-live/${selectedId}`).then((value) => {
      if (!cancelled) { setSettings(value); setLoadedId(selectedId); setError(''); }
    }).catch((cause) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [selectedId, baseUrl, request]);

  // Saving after every edit keeps the draft even if the user switches channels.
  useEffect(() => {
    if (!settings || !selectedId || loadedId !== selectedId || !baseUrl) return;
    setSaveState('saving');
    let cancelled = false;
    const timer = setTimeout(() => {
      request<Settings>(`/api/instagram-live/${selectedId}`, { method: 'PUT', body: JSON.stringify(settings) })
        .then(() => { if (!cancelled) setSaveState('saved'); })
        .catch((cause) => { if (!cancelled) { setSaveState('idle'); setError('Autosave failed: ' + cause.message); } });
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [settings, selectedId, loadedId, baseUrl, request]);

  const selected = channels.find((item) => item.id === selectedId) || null;
  const runningHere = Boolean(status?.running && status.activeChannelId === selectedId);
  const runningElsewhere = Boolean((status?.running || status?.starting) && status.activeChannelId !== selectedId);

  function update<K extends keyof Settings>(field: K, value: Settings[K]) {
    setSettings((current) => current ? { ...current, [field]: value } : current);
    setNotice('');
  }

  async function checkBrowser() {
    setBusy('browser'); setError(''); setNotice('');
    try {
      const response = await request<{ ready: boolean; message: string }>('/api/instagram-live/browser');
      setBrowserReady(response.ready); setNotice(response.message + '. Press play on a Reel before going live.');
    } catch (cause) { setBrowserReady(false); setError((cause as Error).message); }
    finally { setBusy(''); }
  }

  async function start() {
    if (!settings || !selectedId || !rights) return;
    setBusy('start'); setError(''); setNotice('');
    try {
      await request(`/api/instagram-live/${selectedId}`, { method: 'PUT', body: JSON.stringify(settings) });
      const live = await request<Status>(`/api/instagram-live/${selectedId}/start`, {
        method: 'POST', body: JSON.stringify({ rightsConfirmed: true }),
      });
      setStatus(live);
      setNotice('FFmpeg capture started. Confirm live video and audio in YouTube Studio.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(''); }
  }

  async function stop() {
    setBusy('stop'); setError(''); setNotice('');
    try {
      const result = await request<Status>(`/api/instagram-live/${selectedId}/stop`, { method: 'POST', body: '{}' });
      setStatus(result); setNotice('Instagram screen capture stopped.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(''); }
  }

  return (
    <div className="il-root">
      <aside className="il-sidebar">
        <Link href="/" className="il-brand"><span><Clapperboard size={21}/></span><strong>Stream<span>Forge</span></strong></Link>
        <p className="il-nav-label">WORKSPACE</p>
        <Link href="/" className="il-nav-item"><Tv2 size={18}/> Overview</Link>
        <Link href="/channels" className="il-nav-item"><Settings2 size={18}/> My Channels</Link>
        <div className="il-nav-item il-active"><Instagram size={18}/> Reels Live <span className="il-live-dot"/></div>
        <div className="il-sidebar-bottom"><ShieldCheck size={18}/><p><b>Private Android studio</b><small>Only runs on this phone. Instagram credentials stay inside your browser.</small></p></div>
      </aside>

      <main className="il-main">
        <header className="il-topbar"><div className="il-breadcrumb"><Link href="/channels"><ArrowLeft size={17}/> Channels</Link><span>/</span><b>Instagram Reels Live</b></div><span className="il-local-chip"><span/> PHONE-ONLY CONTROL</span></header>
        <div className="il-container">
          <div className="il-hero"><div><p className="il-kicker"><WandSparkles size={15}/> NEW LIVE SOURCE</p><h1>Reels to <em>YouTube Live.</em></h1><p className="il-hero-copy">Broadcast a full-height portrait Reels feed from Android, with automatic scrolling when each video finishes.</p></div><div className="il-hero-icon"><Instagram size={45}/></div></div>

          {error && <div role="alert" className="il-banner il-error"><CircleAlert size={18}/><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
          {notice && <div role="status" className="il-banner il-notice"><CircleCheck size={18}/><span>{notice}</span><button onClick={() => setNotice('')}>Dismiss</button></div>}

          <div className="il-overview">
            <div className="il-stat"><span className="il-stat-icon"><Monitor size={19}/></span><span>INSTAGRAM BROWSER</span><b>{browserReady ? 'Connected' : 'Not checked'}</b><small>Local Chromium :9222</small></div>
            <div className="il-stat"><span className="il-stat-icon il-purple"><Activity size={19}/></span><span>LIVE STATUS</span><b>{status?.running ? 'Broadcasting' : status?.starting ? 'Starting' : 'Offline'}</b><small>{status?.running ? `Started ${formatTime(status.startedAt)}` : 'Waiting for your command'}</small></div>
            <div className="il-stat"><span className="il-stat-icon il-orange"><RefreshCw size={19}/></span><span>REELS PLAYBACK</span><b>{status?.feed?.phase || 'Waiting'}</b><small>{status?.feed?.activeId ? `Reel #${status.feed.activeId} · ${status.feed.currentTime || 0}s / ${status.feed.duration || '?'}s` : 'Auto-scroll after video ends'}</small></div>
          </div>

          <div className="il-layout">
            <div className="il-left">
              <section className="il-panel"><div className="il-panel-head"><div className="il-panel-icon"><Tv2 size={20}/></div><div><p>STEP 01</p><h2>Choose your channel</h2><span>Your existing YouTube channel and saved stream key.</span></div></div>
                <label className="il-label" htmlFor="il-channel">YOUTUBE CHANNEL</label>
                <div className="il-select-wrap"><select id="il-channel" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Select a channel</option>{channels.map((item) => <option key={item.id} value={item.id}>{item.displayName || 'Untitled channel'}{!item.ready ? ' (setup incomplete)' : ''}</option>)}</select><ChevronDown size={18}/></div>
                {selected && <p className="il-inline-note">{selected.ready && selected.hasStreamKey ? <CircleCheck size={16}/> : <CircleAlert size={16}/>} {selected.ready && selected.hasStreamKey ? 'Stream key securely saved in MySQL' : 'Complete channel setup in My Channels before streaming'} <Link href="/channels">Manage <ExternalLink size={13}/></Link></p>}
                {channels.length === 0 && <p className="il-hint">No channels found. <Link href="/channels">Create your first YouTube channel profile</Link>.</p>}
              </section>

              <section className="il-panel"><div className="il-panel-head"><div className="il-panel-icon il-magenta"><Instagram size={20}/></div><div><p>STEP 02</p><h2>Prepare mobile Reels</h2><span>Remove desktop sidebar and Chromium address bar from the broadcast.</span></div></div>
                <div className="il-checklist"><div><span>1</span><p>In the <b>Termux:X11 Android app settings</b>, choose an exact portrait screen resolution of <b>540 × 960</b>, then restart X11.</p></div><div><span>2</span><p>Close the old desktop Chromium window. Reopen Chromium using <b>--kiosk</b> and <b>--app=https://www.instagram.com/reels/</b>, with debugging port <code>9222</code>.</p></div><div><span>3</span><p>Sign in manually, <b>play a Reel</b>, then start the stream. Mobile responsive mode is applied automatically.</p></div></div>
                <button type="button" className="il-secondary-btn" onClick={checkBrowser} disabled={busy === 'browser'}>{busy === 'browser' ? <LoaderCircle className="il-spin" size={17}/> : <RefreshCw size={17}/>} Check local browser</button>
                <p className="il-hint">Check the phone screenshot in YouTube Studio before going public. Browser check only finds the tab; it cannot verify X11 dimensions. Your existing Instagram login stays in Chromium.</p>
              </section>

              <section className="il-panel"><div className="il-panel-head"><div className="il-panel-icon il-purple"><Settings2 size={20}/></div><div><p>STEP 03</p><h2>Broadcast settings</h2><span>Changes automatically save to your MySQL channel profile.</span></div><div className="il-save-state">{saveState === 'saving' ? <><LoaderCircle size={14} className="il-spin"/> Saving</> : saveState === 'saved' ? <><Check size={14}/> Saved</> : <><Save size={14}/> Draft</>}</div></div>
                {settings ? <div className="il-fields"><div><label className="il-label" htmlFor="il-title">LIVE TITLE</label><input id="il-title" placeholder="e.g. Reels discovery live" maxLength={100} value={settings.title} onChange={(event) => update('title', event.target.value)}/></div><div><label className="il-label" htmlFor="il-desc">DESCRIPTION</label><textarea id="il-desc" rows={3} placeholder="Describe your livestream..." value={settings.description} onChange={(event) => update('description', event.target.value)}/></div>
                  <div className="il-two-cols"><div><label className="il-label" htmlFor="il-privacy">YOUTUBE VISIBILITY</label><select id="il-privacy" value={settings.privacy} onChange={(event) => update('privacy', event.target.value as Settings['privacy'])}><option value="private">Private (recommended for testing)</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></div><div><label className="il-label" htmlFor="il-scroll">AUTO-SCROLL METHOD</label><select id="il-scroll" value={settings.scroll} onChange={(event) => update('scroll', event.target.value as Settings['scroll'])}><option value="wheel">Mouse wheel</option><option value="arrow">Down arrow</option></select></div></div>
                  <label className="il-option"><input type="checkbox" checked={settings.mobileLayout} onChange={(event) => update('mobileLayout', event.target.checked)}/><span><b>Mobile portrait Reels (recommended)</b><small>Uses a phone-size viewport and touch emulation. Keep the X11 screen and Chromium kiosk in portrait orientation.</small></span></label>
                  <div><label className="il-label" htmlFor="il-frame">YOUTUBE LIVE VIDEO LAYOUT</label><select id="il-frame" value={settings.frame} onChange={(event) => update('frame', event.target.value as Settings['frame'])} disabled={!settings.mobileLayout}><option value="iphone">iPhone frame — zoom into current Reel (recommended)</option><option value="none">Original X11 screen — no phone frame</option></select><p className="il-hint">The iPhone frame appears in your YouTube broadcast, not the Chromium/noVNC desktop. It focuses on the playing video and hides empty Instagram page margins. Audio and auto-scroll are unchanged.</p></div>
                  <label className="il-option"><input type="checkbox" checked={settings.createBroadcast} onChange={(event) => update('createBroadcast', event.target.checked)}/><span><b>Create YouTube event automatically</b><small>Requires connected Google account. Otherwise, first prepare a live stream in YouTube Studio using this channel&apos;s key.</small></span></label>
                  <button type="button" className="il-expand" onClick={() => setAdvanced((value) => !value)}><Settings2 size={16}/> Capture and audio controls <ChevronDown size={17} className={advanced ? 'il-rotate' : ''}/></button>
                  {advanced && <div className="il-advanced"><div className="il-two-cols"><div><label className="il-label" htmlFor="il-width">CAPTURE WIDTH</label><input id="il-width" type="number" min={240} max={1920} step={2} value={settings.captureWidth} onChange={(event) => update('captureWidth', Number(event.target.value))}/></div><div><label className="il-label" htmlFor="il-height">CAPTURE HEIGHT</label><input id="il-height" type="number" min={240} max={1920} step={2} value={settings.captureHeight} onChange={(event) => update('captureHeight', Number(event.target.value))}/></div></div><div className="il-two-cols"><div><label className="il-label" htmlFor="il-x">CAPTURE X</label><input id="il-x" type="number" min={0} value={settings.captureX} onChange={(event) => update('captureX', Number(event.target.value))}/></div><div><label className="il-label" htmlFor="il-y">CAPTURE Y</label><input id="il-y" type="number" min={0} value={settings.captureY} onChange={(event) => update('captureY', Number(event.target.value))}/></div></div><div className="il-two-cols"><div><label className="il-label" htmlFor="il-fps">FRAMES / SECOND</label><select id="il-fps" value={settings.fps} onChange={(event) => update('fps', Number(event.target.value))}><option value="10">10 FPS (low CPU)</option><option value="15">15 FPS (recommended)</option><option value="20">20 FPS</option><option value="30">30 FPS</option></select></div><div><label className="il-label" htmlFor="il-bitrate">VIDEO BITRATE KBPS</label><input id="il-bitrate" type="number" min={300} max={5000} value={settings.bitrateKbps} onChange={(event) => update('bitrateKbps', Number(event.target.value))}/></div></div><label className="il-label" htmlFor="il-audio">AUDIO SOURCE</label><select id="il-audio" value={settings.audio} onChange={(event) => update('audio', event.target.value as Settings['audio'])}><option value="silent">Silent audio (stable test)</option><option value="pulse">PulseAudio monitor (experimental)</option></select><p className="il-hint">Portrait capture should match the X11 resolution (default 540 × 960) and start at X=0, Y=0. For mobile mode, width must be smaller than height. PulseAudio is experimental on Termux.</p></div>}
                </div> : <p className="il-hint">Select a channel to load saved settings.</p>}
              </section>
            </div>

            <div className="il-right"><section className="il-panel il-control"><div className="il-control-top"><span><Radio size={18}/> LIVE CONTROL</span><span className={status?.running ? 'il-live-badge' : 'il-offline-badge'}><span/>{status?.running ? 'ON AIR' : 'OFFLINE'}</span></div>
                <div className="il-phone-preview"><div className="il-phone-notch"/><div className="il-preview-inner"><Instagram size={42}/><h3>Instagram feed capture</h3><p>Reels playback appears in your Termux:X11 browser. Check YouTube Studio for the actual video preview.</p><span className="il-preview-chip"><Eye size={15}/> Screen source · X11 :1</span></div></div>
                <div className="il-preview-meta"><span><Clock3 size={16}/> {status?.startedAt ? `Live since ${formatTime(status.startedAt)}` : 'Not streaming'}</span><span><Monitor size={16}/> {settings ? `${settings.captureWidth} × ${settings.captureHeight}` : '—'}</span></div>
                <label className="il-rights"><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)}/><span><b>I have permission to rebroadcast these Reels and their audio.</b><small>Other accounts&apos; content can trigger copyright claims and platform enforcement. Only stream content you own or are licensed to share.</small></span></label>
                {runningHere ? <button className="il-stop-btn" onClick={stop} disabled={Boolean(busy)}><Square size={18} fill="currentColor"/>{busy === 'stop' ? 'Stopping…' : 'Stop livestream'}</button> : <button className="il-start-btn" onClick={start} disabled={!settings || !selected?.ready || !rights || Boolean(busy) || runningElsewhere}><Play size={19} fill="currentColor"/>{busy === 'start' ? 'Starting capture…' : runningElsewhere ? 'Another channel is live' : 'Start Reels livestream'}</button>}
                <p className="il-control-foot"><ShieldCheck size={14}/> Your YouTube stream key stays encrypted in MySQL.</p>
                {status?.broadcast?.url && <a className="il-broadcast-link" href={status.broadcast.url} target="_blank" rel="noreferrer"><ExternalLink size={16}/> View created YouTube live event</a>}
              </section>
              <section className="il-panel il-diagnostics"><div className="il-diagnostics-title"><Terminal size={19}/><h3>Live diagnostics</h3><button onClick={() => refresh().catch(() => {})}><RefreshCw size={15}/></button></div><div className="il-terminal">{status?.logs?.length ? status.logs.map((line, index) => <p key={index}><span>›</span> {line}</p>) : <p><span>›</span> Logs will appear when you start screen capture.</p>}{status?.error && <p className="il-terminal-error"><span>!</span> {status.error}</p>}</div></section>
              <div className="il-advice"><VolumeX size={21}/><p><b>First test: Private + silent audio.</b> Once video capture is confirmed in YouTube Studio, try PulseAudio. Streaming directly from a phone needs stable internet, power, and Termux background permissions.</p></div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

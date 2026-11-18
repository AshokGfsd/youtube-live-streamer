'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import {
  Activity, ArrowUpRight, Check, CheckCircle2, ChevronDown, CircleHelp, Cloud,
  ExternalLink, FileVideo2, Film, HardDrive, KeyRound, Link2, LoaderCircle,
  LogOut, Menu, MonitorPlay, Play, Radio, RefreshCcw, RotateCcw, Settings2,
  ShieldCheck, Signal, Square, TerminalSquare, UploadCloud, Wifi, X, Youtube,
  ImagePlus, CalendarClock, Sparkles, Globe2, LockKeyhole, UserRoundCheck,
  Layers3,
} from 'lucide-react';

type StreamLog = { at: string; message: string };
type VideoInfo = { name: string; sizeBytes: number; durationSeconds: number; hasAudio: boolean };
type StreamStatus = {
  phase: 'idle' | 'connecting' | 'sending' | 'reconnecting' | 'stopping';
  desiredRunning: boolean;
  startedAt: string | null;
  loop: boolean;
  hasStreamKey: boolean;
  video: VideoInfo | null;
  lastError: string | null;
  logs: StreamLog[];
};
type YouTubeAccount = {
  configured: boolean;
  connected: boolean;
  channel: string | null;
  channelId: string | null;
  description: string;
  lastBroadcast: { id: string; title: string; url: string; thumbnailSet: boolean } | null;
};

const DEFAULT_API = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const MAX_ALLOWED_EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'm4v'];

function displayDuration(seconds: number | null | undefined) {
  if (!seconds || seconds < 0) return '00:00';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? [hours, minutes, secs].map((v) => String(v).padStart(2, '0')).join(':')
    : [minutes, secs].map((v) => String(v).padStart(2, '0')).join(':');
}

function displaySize(size: number) {
  return size >= 1024 ** 3 ? (size / 1024 ** 3).toFixed(2) + ' GB' : (size / 1024 ** 2).toFixed(1) + ' MB';
}

async function readError(response: Response) {
  try {
    const json = await response.json();
    return json.error || 'Request failed';
  } catch {
    return 'Request failed with status ' + response.status;
  }
}

function isSafeEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch {
    return false;
  }
}

export default function Home() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API);
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const [checkingLocal, setCheckingLocal] = useState(true);
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [repeat, setRepeat] = useState(true);
  const [busy, setBusy] = useState<'upload' | 'start' | 'stop' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [mobileNav, setMobileNav] = useState(false);
  const [youtubeAccount, setYouTubeAccount] = useState<YouTubeAccount | null>(null);
  const [automationTab, setAutomationTab] = useState<'live' | 'channel'>('live');
  const [liveTitle, setLiveTitle] = useState('');
  const [liveDescription, setLiveDescription] = useState('');
  const [livePrivacy, setLivePrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [channelDescription, setChannelDescription] = useState('');
  const [channelBanner, setChannelBanner] = useState<File | null>(null);
  const [automationBusy, setAutomationBusy] = useState<'live' | 'channel' | 'disconnect' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchStatus = useCallback(async (currentUrl: string, currentToken: string) => {
    const response = await fetch(currentUrl.replace(/\/$/, '') + '/api/status', {
      headers: { Authorization: 'Bearer ' + currentToken },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()) as StreamStatus;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const savedUrl = localStorage.getItem('streamforge-api-url');
    const savedToken = sessionStorage.getItem('streamforge-token');
    if (savedUrl) setApiUrl(savedUrl);
    else if (!process.env.NEXT_PUBLIC_API_BASE_URL) setApiUrl(window.location.origin);
    if (savedToken) setToken(savedToken);

    // Android serves the static dashboard and its API from one loopback origin.
    // Probe the server so this works without a token or setup modal.
    if (process.env.NEXT_PUBLIC_API_BASE_URL || !['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
      setCheckingLocal(false);
      return;
    }
    (async () => {
      try {
        const origin = window.location.origin;
        const response = await fetch(origin + '/health', { cache: 'no-store' });
        if (!response.ok || (await response.json()).localOnly !== true) return;
        const currentStatus = await fetchStatus(origin, '');
        if (cancelled) return;
        setLocalOnly(true);
        setApiUrl(origin);
        setToken('');
        sessionStorage.removeItem('streamforge-token');
        localStorage.removeItem('streamforge-api-url');
        setStatus(currentStatus);
        setRepeat(currentStatus.loop);
        setConnected(true);
        setShowSetup(false);
      } catch {
        // Older or cloud servers still use the secure connection form.
      } finally {
        if (!cancelled) setCheckingLocal(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchStatus]);

  useEffect(() => {
    if (!connected) return;
    const poll = setInterval(async () => {
      try {
        setStatus(await fetchStatus(apiUrl, token));
      } catch {
        setConnected(false);
        setError('Connection lost. Check that your server is online.');
      }
    }, 4500);
    return () => clearInterval(poll);
  }, [connected, apiUrl, token, fetchStatus]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!localOnly || !connected) return;
    let cancelled = false;
    const result = new URLSearchParams(window.location.search).get('youtube');
    if (result) {
      if (result === 'connected') setNotice('Your YouTube channel is connected. You can now create a broadcast.');
      else if (result === 'failed') setError('Google connection failed. Check your OAuth setup and try again.');
      else if (result === 'cancelled') setNotice('Google sign-in was cancelled.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    fetch(apiUrl + '/api/youtube/status', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return (await response.json()) as YouTubeAccount;
      })
      .then((account) => {
        if (cancelled) return;
        setYouTubeAccount(account);
        setChannelDescription(account.description || '');
      })
      .catch(() => { if (!cancelled) setError('Could not load your YouTube automation settings.'); });
    return () => { cancelled = true; };
  }, [localOnly, connected, apiUrl]);

  async function connect() {
    setError('');
    setNotice('');
    if (!isSafeEndpoint(apiUrl)) {
      setError('Use an HTTPS server address. HTTP is only allowed for localhost.');
      return;
    }
    if (!token.trim()) {
      setError('Enter your dashboard access token.');
      return;
    }
    setConnecting(true);
    try {
      const normalizedUrl = apiUrl.replace(/\/$/, '');
      const currentStatus = await fetchStatus(normalizedUrl, token.trim());
      setStatus(currentStatus);
      setRepeat(currentStatus.loop);
      setApiUrl(normalizedUrl);
      setToken(token.trim());
      localStorage.setItem('streamforge-api-url', normalizedUrl);
      sessionStorage.setItem('streamforge-token', token.trim());
      setConnected(true);
      setShowSetup(false);
      setNotice('Connected securely to your streaming server.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to your server.');
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    setConnected(false);
    setStatus(null);
    setToken('');
    sessionStorage.removeItem('streamforge-token');
    setNotice('Dashboard disconnected. The cloud stream is not affected.');
  }

  function chooseFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setNotice('');
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !MAX_ALLOWED_EXTENSIONS.includes(extension)) {
      setError('Please choose an MP4, MOV, MKV, WebM or M4V file.');
      return;
    }
    setSelected(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files?.[0]);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
    event.target.value = '';
  }

  async function upload() {
    if (!selected || !connected) return;
    setBusy('upload');
    setProgress(0);
    setError('');
    setNotice('');
    const form = new FormData();
    form.append('video', selected);
    try {
      const result = await new Promise<StreamStatus>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl + '/api/upload');
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onerror = () => reject(new Error('Upload failed. Check the server and your connection.'));
        xhr.onload = () => {
          let response;
          try { response = JSON.parse(xhr.responseText); } catch { response = {}; }
          if (xhr.status >= 200 && xhr.status < 300) resolve(response as StreamStatus);
          else reject(new Error(response.error || 'Upload failed.'));
        };
        xhr.send(form);
      });
      setStatus(result);
      setSelected(null);
      setLiveTitle((previous) => previous || result.video?.name.replace(/\.[^.]+$/, '') || '');
      setNotice('Video uploaded and validated. You can start streaming now.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed.');
    } finally {
      setBusy(null);
    }
  }

  async function action(type: 'start' | 'stop') {
    if (!connected) return;
    setBusy(type);
    setError('');
    setNotice('');
    try {
      const response = await fetch(apiUrl + '/api/' + type, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(type === 'start' ? { loop: repeat } : {}),
      });
      if (!response.ok) throw new Error(await readError(response));
      setStatus((await response.json()) as StreamStatus);
      setNotice(type === 'start'
        ? 'Streaming requested. Confirm that your broadcast is live in YouTube Studio.'
        : 'Stop requested. Your stream is shutting down.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete the action.');
    } finally {
      setBusy(null);
    }
  }

  async function createYouTubeLive() {
    if (!youtubeAccount?.connected || !status?.video || isRunning) return;
    setAutomationBusy('live');
    setError('');
    setNotice('');
    const form = new FormData();
    form.set('title', liveTitle);
    form.set('description', liveDescription);
    form.set('privacy', livePrivacy);
    form.set('loop', String(repeat));
    if (thumbnail) form.set('thumbnail', thumbnail);
    try {
      const response = await fetch(apiUrl + '/api/youtube/broadcasts/start', { method: 'POST', body: form });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json();
      setStatus(result.stream);
      setYouTubeAccount((previous) => previous ? { ...previous, lastBroadcast: result.broadcast } : previous);
      setNotice('YouTube broadcast created and FFmpeg started. Check the YouTube Live Control Room to confirm it is live.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the YouTube broadcast.');
    } finally { setAutomationBusy(null); }
  }

  async function saveChannelBranding() {
    if (!youtubeAccount?.connected) return;
    setAutomationBusy('channel');
    setError('');
    setNotice('');
    const form = new FormData();
    form.set('description', channelDescription);
    if (channelBanner) form.set('banner', channelBanner);
    try {
      const response = await fetch(apiUrl + '/api/youtube/channel', { method: 'POST', body: form });
      if (!response.ok) throw new Error(await readError(response));
      setYouTubeAccount((await response.json()) as YouTubeAccount);
      setChannelBanner(null);
      setNotice('YouTube channel branding updated successfully.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update channel settings.');
    } finally { setAutomationBusy(null); }
  }

  async function disconnectYouTube() {
    setAutomationBusy('disconnect');
    try {
      const response = await fetch(apiUrl + '/api/youtube/disconnect', { method: 'POST' });
      if (!response.ok) throw new Error(await readError(response));
      setYouTubeAccount((await response.json()) as YouTubeAccount);
      setNotice('YouTube authorization removed from this phone. Your stream key is unchanged.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect YouTube.');
    } finally { setAutomationBusy(null); }
  }

  const online = connected && status !== null;
  const isRunning = Boolean(status?.desiredRunning);
  const isBusy = Boolean(busy);
  const elapsed = status?.startedAt && isRunning
    ? Math.max(0, (now - new Date(status.startedAt).getTime()) / 1000) : 0;
  const phase = !online ? 'Offline' : status?.phase === 'sending' ? 'Sending to YouTube'
    : status?.phase === 'connecting' ? 'Connecting'
    : status?.phase === 'reconnecting' ? 'Reconnecting'
    : status?.phase === 'stopping' ? 'Stopping' : 'Standby';
  const phaseClass = isRunning ? (status?.phase === 'sending' ? 'online' : 'warning') : 'idle';

  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (mobileNav ? 'sidebar-open' : '')}>
        <div className="brand">
          <div className="brand-mark"><Signal size={22} strokeWidth={2.5} /></div>
          <div><div className="brand-name">StreamForge<span>.</span></div><div className="brand-subtitle">BROADCAST STUDIO</div></div>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="sidebar-links" aria-label="Main navigation">
          <div className="nav-link active"><MonitorPlay size={18} /> Live Studio <span className="nav-active-dot" /></div>
          <a className="nav-link" href="/channels"><Layers3 size={18}/> My Channels <ArrowUpRight size={14} className="link-external"/></a>
          <div className="nav-link disabled" title="Coming soon"><Film size={18} /> Library <span className="soon">SOON</span></div>
          <div className="nav-link disabled" title="Coming soon"><Activity size={18} /> Analytics <span className="soon">SOON</span></div>
        </nav>
        <div className="nav-caption nav-caption-second">CONFIGURATION</div>
        <nav className="sidebar-links" aria-label="Settings navigation">
          {!localOnly && <button className="nav-link" onClick={() => { setShowSetup(true); setMobileNav(false); }}><Settings2 size={18} /> Server settings</button>}
          <a className="nav-link" href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer"><Youtube size={18} /> YouTube Studio <ExternalLink size={14} className="link-external" /></a>
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-tip"><ShieldCheck size={18} /><div><b>Private by design</b><p>Your stream key stays on your server, not in this browser.</p></div></div>
          <div className="profile-line"><div className="avatar">SF</div><div className="profile-copy"><b>My Workspace</b><span>Personal cloud studio</span></div><ChevronDown size={16} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><button className="mobile-menu icon-button" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle menu"><Menu size={21}/></button><span>Workspace</span><span className="slash">/</span><b>Live Studio</b></div>
          <div className="header-right"><span className="private-badge"><ShieldCheck size={14}/> PRIVATE STUDIO</span><span className="top-avatar">SF</span></div>
        </header>

        <div className="content">
          <div className="welcome"><div><span className="eyebrow"><span className="eyebrow-line" /> YOUR BROADCAST COMMAND CENTER</span><h1>Let&apos;s go <em>live.</em></h1><p>Upload a video, hit start, and let your {localOnly ? 'phone' : 'cloud server'} take it from there.</p><a href="/channels" className="channel-studio-link"><Layers3 size={16}/> Manage multiple channels <ArrowUpRight size={14}/></a></div><div className="welcome-time"><Cloud size={17}/><span>{localOnly ? 'Android-powered streaming' : 'Cloud-powered streaming'}</span></div></div>

          {(error || notice) && <div role={error ? 'alert' : 'status'} className={'toast-message ' + (error ? 'error-message' : 'success-message')}><span>{error || notice}</span><button aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}><X size={17}/></button></div>}

          <div className="overview-grid">
            <div className="overview-card status-overview"><div className="mini-icon"><Radio size={19}/></div><div className="overview-label">STREAM STATUS</div><div className="overview-value"><span className={'large-dot ' + phaseClass}/>{phase}</div><span className="overview-meta">{isRunning ? (localOnly ? 'Phone encoder is active' : 'Cloud encoder is active') : 'Ready when you are'}</span></div>
            <div className="overview-card"><div className="mini-icon purple"><HardDrive size={19}/></div><div className="overview-label">VIDEO READY</div><div className="overview-value">{status?.video ? '01' : '00'} <span className="overview-value-soft">file</span></div><span className="overview-meta">{status?.video ? displaySize(status.video.sizeBytes) + ' uploaded' : 'No file uploaded yet'}</span></div>
            <div className="overview-card"><div className="mini-icon orange"><Activity size={19}/></div><div className="overview-label">STREAM UPTIME</div><div className="overview-value numeric">{displayDuration(elapsed)}</div><span className="overview-meta">{isRunning ? 'Since you started streaming' : 'Not streaming currently'}</span></div>
          </div>

          <div className="studio-grid">
            <section className="panel upload-panel">
              <div className="panel-heading"><div><span className="step-label">STEP 01</span><h2>Upload your video</h2><p>Choose the video you want to broadcast on YouTube.</p></div><div className="panel-heading-icon"><UploadCloud size={22}/></div></div>

              <input ref={fileRef} type="file" accept=".mp4,.mov,.mkv,.webm,.m4v,video/*" onChange={handleFileChange} className="file-input" aria-label="Choose video file" />
              <div className={'upload-zone ' + (dragging ? 'dragging' : '') + (selected ? ' has-selected' : '')}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
                onDrop={handleDrop}>
                {selected ? <>
                  <div className="drop-icon selected-drop"><FileVideo2 size={28}/></div>
                  <h3 className="file-title">{selected.name}</h3><p>{displaySize(selected.size)} · Selected locally</p>
                  <button className="text-action" onClick={() => fileRef.current?.click()} disabled={isBusy}>Choose another file</button>
                </> : <>
                  <div className="drop-icon"><UploadCloud size={28}/></div>
                  <h3>Drag &amp; drop your video here</h3><p>or browse files from your computer</p>
                  <button className="browse-button" onClick={() => fileRef.current?.click()} disabled={isBusy || isRunning}>Browse files <ArrowUpRight size={16}/></button>
                  <span className="upload-hint">MP4, MOV, MKV, WebM, M4V · Max 4 GB by default</span>
                </>}
              </div>

              {busy === 'upload' && <div className="progress-row"><div className="progress-label"><span>Uploading to your {localOnly ? 'phone' : 'cloud server'}…</span><b>{progress}%</b></div><div className="progress-track"><div style={{ width: progress + '%' }} className="progress-fill" /></div><p>Leave this page open until the upload finishes.</p></div>}

              {status?.video && <div className="current-video"><div className="video-thumb"><Film size={22}/></div><div className="current-video-details"><span className="small-uppercase">CURRENTLY ON SERVER</span><b title={status.video.name}>{status.video.name}</b><span>{displaySize(status.video.sizeBytes)} <span className="middle-dot">·</span> {displayDuration(status.video.durationSeconds)} <span className="middle-dot">·</span> {status.video.hasAudio ? 'With audio' : 'Silent audio added'}</span></div><CheckCircle2 size={20} className="video-check"/></div>}

              {selected && <button className="primary-button upload-submit" onClick={upload} disabled={!online || isBusy || isRunning}>{busy === 'upload' ? <LoaderCircle size={18} className="spin" /> : <UploadCloud size={18}/>} {busy === 'upload' ? 'Uploading…' : 'Upload to server'}</button>}
              {!online && !checkingLocal && <div className="inline-note"><CircleHelp size={16}/> {localOnly ? 'Restart StreamForge in Termux to enable uploads.' : 'Connect your cloud server to enable uploads.'}</div>}
            </section>

            <section className="panel broadcast-panel">
              <div className="panel-heading"><div><span className="step-label">STEP 02</span><h2>Broadcast controls</h2><p>Manage your YouTube stream.</p></div><div className="panel-heading-icon"><Radio size={21}/></div></div>

              <div className="destination"><div className="youtube-logo"><Youtube size={26} fill="currentColor" strokeWidth={1.3}/></div><div><b>YouTube Live</b><span>{status?.hasStreamKey ? 'Stream key configured on server' : localOnly ? 'Add YouTube stream key in your Termux .env' : 'Add your YouTube stream key on the VM'}</span></div><span className={'destination-tag ' + (status?.hasStreamKey ? 'configured' : '')}>{status?.hasStreamKey ? <><Check size={12}/> READY</> : 'SETUP'}</span></div>

              <div className="stream-option"><div className="option-icon"><RotateCcw size={19}/></div><div className="option-copy"><b>Loop video continuously</b><p>Repeat the video until you stop streaming.</p></div><button className={'toggle ' + (repeat ? 'checked' : '')} role="switch" aria-label="Loop video" aria-checked={repeat} onClick={() => setRepeat(!repeat)} disabled={isRunning || isBusy}><span/></button></div>

              <div className="ready-list"><div><span className={'readiness-dot ' + (online ? 'pass' : '')}/>{localOnly ? (online ? 'Phone server connected' : 'Phone server not connected') : (online ? 'Cloud server connected' : 'Cloud server not connected')}</div><div><span className={'readiness-dot ' + (status?.hasStreamKey ? 'pass' : '')}/>{status?.hasStreamKey ? 'YouTube stream key ready' : 'YouTube stream key needed'}</div><div><span className={'readiness-dot ' + (status?.video ? 'pass' : '')}/>{status?.video ? 'Video uploaded and checked' : 'Video upload needed'}</div></div>

              {isRunning ? <button className="stop-button" onClick={() => action('stop')} disabled={isBusy}>{busy === 'stop' ? <LoaderCircle size={19} className="spin"/> : <Square size={17} fill="currentColor"/>} Stop streaming</button>
                : <button className="go-live-button" onClick={() => action('start')} disabled={!online || !status?.video || !status.hasStreamKey || isBusy}>{busy === 'start' ? <LoaderCircle size={19} className="spin"/> : <Play size={19} fill="currentColor"/>} Start streaming <ArrowUpRight size={18}/></button>}
              <div className="broadcast-footnote"><ShieldCheck size={15}/> {localOnly ? 'Stream continues in Termux after closing Chrome; keep the phone on.' : 'Stream runs on the VM, even after you close the browser.'}</div>
            </section>
          </div>

          {localOnly && <section className="panel automation-panel" id="youtube-automation">
            <div className="panel-heading"><div><span className="step-label">STEP 03 · OPTIONAL AUTOMATION</span><h2><Sparkles size={21} className="automation-heading-icon"/> YouTube Live Automation</h2><p>Create a YouTube event, upload its thumbnail, and start the same FFmpeg stream in one step.</p></div><span className="automation-new-tag">NEW</span></div>
            <div className="automation-account">
              <div className="automation-account-icon"><Youtube size={22}/></div>
              <div><b>{youtubeAccount?.connected ? youtubeAccount.channel : 'Connect your YouTube channel'}</b><span>{youtubeAccount?.connected ? 'Google authorization active on this phone' : youtubeAccount?.configured ? 'Authorize your Google account to manage live events' : 'One-time Google Cloud OAuth setup required'}</span></div>
              {youtubeAccount?.connected ? <span className="automation-connected"><Check size={13}/> Connected</span> : youtubeAccount?.configured ? <button className="primary-button automation-connect" onClick={() => window.location.assign(apiUrl + '/api/youtube/oauth/start')}><Link2 size={15}/> Connect Google</button> : <span className="automation-setup-tag">SETUP</span>}
            </div>

            {!youtubeAccount?.configured && <div className="automation-setup-hint"><CircleHelp size={17}/><span>In <code>~/StreamForge-Android/.env</code>, add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>, then restart Termux. Use a Google Cloud OAuth <b>Web application</b> client with redirect URL <code>http://127.0.0.1:4000/api/youtube/oauth/callback</code>.</span></div>}

            {youtubeAccount?.connected && <>
              <div className="automation-tabs" role="tablist" aria-label="YouTube automation settings">
                <button role="tab" aria-selected={automationTab === 'live'} className={automationTab === 'live' ? 'selected' : ''} onClick={() => setAutomationTab('live')}><Radio size={15}/> Create Live</button>
                <button role="tab" aria-selected={automationTab === 'channel'} className={automationTab === 'channel' ? 'selected' : ''} onClick={() => setAutomationTab('channel')}><Settings2 size={15}/> Channel Branding</button>
              </div>

              {automationTab === 'live' ? <div className="automation-form">
                <div className="automation-field"><label htmlFor="youtube-live-title">Live title <span>1–100 characters</span></label><input id="youtube-live-title" maxLength={100} value={liveTitle} onChange={(event) => setLiveTitle(event.target.value)} placeholder="My 24/7 YouTube Live"/></div>
                <div className="automation-field"><label htmlFor="youtube-live-description">Description <span>Optional</span></label><textarea id="youtube-live-description" maxLength={5000} rows={3} value={liveDescription} onChange={(event) => setLiveDescription(event.target.value)} placeholder="Describe your live event..."/></div>
                <div className="automation-field"><label htmlFor="youtube-live-privacy">Visibility</label><select id="youtube-live-privacy" value={livePrivacy} onChange={(event) => setLivePrivacy(event.target.value as 'private' | 'unlisted' | 'public')}><option value="private">Private (recommended for testing)</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></div>
                <div className="automation-field"><label htmlFor="youtube-live-thumbnail">Live thumbnail <span>JPG or PNG, up to 6 MB</span></label><label className="automation-file" htmlFor="youtube-live-thumbnail"><ImagePlus size={17}/>{thumbnail ? thumbnail.name : 'Choose thumbnail image'}</label><input id="youtube-live-thumbnail" type="file" accept="image/jpeg,image/png" className="automation-file-input" onChange={(event) => setThumbnail(event.target.files?.[0] || null)}/></div>
                <div className="automation-warning"><CalendarClock size={17}/><span>This creates a new event with Auto-start enabled, links your existing reusable YouTube stream key, and starts the uploaded video. Confirm the actual live status in YouTube Studio.</span></div>
                <button className="go-live-button" onClick={createYouTubeLive} disabled={!online || !status?.video || !status?.hasStreamKey || isRunning || !!automationBusy || !liveTitle.trim()}>{automationBusy === 'live' ? <LoaderCircle size={18} className="spin"/> : <Play size={18} fill="currentColor"/>} Create &amp; Start YouTube Live <ArrowUpRight size={16}/></button>
                {youtubeAccount.lastBroadcast && <a className="automation-live-link" href={youtubeAccount.lastBroadcast.url} target="_blank" rel="noopener noreferrer"><Youtube size={17}/> Open your last broadcast: {youtubeAccount.lastBroadcast.title} <ExternalLink size={14}/></a>}
              </div> : <div className="automation-form">
                <div className="automation-field"><label htmlFor="youtube-channel-description">Channel description <span>Up to 1,000 characters</span></label><textarea id="youtube-channel-description" maxLength={1000} rows={4} value={channelDescription} onChange={(event) => setChannelDescription(event.target.value)} placeholder="Tell viewers about your channel..."/></div>
                <div className="automation-field"><label htmlFor="youtube-channel-banner">Channel banner <span>JPG or PNG · 2560×1440 recommended · 6 MB max</span></label><label className="automation-file" htmlFor="youtube-channel-banner"><ImagePlus size={17}/>{channelBanner ? channelBanner.name : 'Choose channel banner (optional)'}</label><input id="youtube-channel-banner" type="file" accept="image/jpeg,image/png" className="automation-file-input" onChange={(event) => setChannelBanner(event.target.files?.[0] || null)}/></div>
                <div className="automation-warning"><Globe2 size={17}/><span>Channel name and handle must still be changed in YouTube Studio. These actions update only your channel description and optional banner.</span></div>
                <button className="primary-button automation-save" onClick={saveChannelBranding} disabled={!!automationBusy}>{automationBusy === 'channel' ? <LoaderCircle size={18} className="spin"/> : <Check size={17}/>} Save Channel Branding</button>
              </div>}
              <button className="automation-disconnect" onClick={disconnectYouTube} disabled={!!automationBusy}><LockKeyhole size={14}/> Disconnect Google account from this phone</button>
            </>}
            {youtubeAccount?.configured && !youtubeAccount.connected && <div className="automation-welcome"><UserRoundCheck size={22}/><span>Connect Google once to securely enable title, description, thumbnail, and channel customization controls. Your OAuth refresh token is stored only on your phone, never in GitHub or the browser.</span></div>}
          </section>}

          <div className="bottom-grid">
            <section className="panel activity-panel"><div className="bottom-heading"><div><span className="step-label">ACTIVITY</span><h2>Stream activity</h2></div><div className="live-log-label"><TerminalSquare size={15}/> ENCODER LOG</div></div>
              <div className="terminal"><div className="terminal-header"><div className="terminal-dots"><i/><i/><i/></div><span>streamforge / console</span><span className="terminal-status">{online ? 'CONNECTED' : 'NOT CONNECTED'}</span></div><div className="terminal-lines">
                {status?.logs.length ? status.logs.slice(-6).map((log, index) => <div className="terminal-line" key={index}><span>{new Date(log.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><p>{log.message}</p></div>) : <div className="terminal-empty"><span className="terminal-prompt">$</span> Waiting for stream events<span className="cursor"/></div>}
              </div></div>
            </section>
            <section className="panel help-panel"><div className="help-top"><div className="help-icon"><Wifi size={21}/></div><span>QUICK GUIDE</span></div><h2>Ready for your<br/>first broadcast?</h2><p>Make sure live streaming is enabled on your YouTube channel. In YouTube Studio, create a stream and turn on auto-start.</p><a href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer">Open YouTube Studio <ArrowUpRight size={17}/></a><div className="help-decoration"><Signal size={130} strokeWidth={0.8}/></div></section>
          </div>

          <footer className="footer"><span>© {new Date().getFullYear()} StreamForge · Your cloud, your broadcast.</span><span><span className="footer-dot"/> Self-hosted FFmpeg encoder</span></footer>
        </div>
      </main>

      {!localOnly && !checkingLocal && (!online || showSetup) && <div className="modal-overlay" role="presentation"><div className="connection-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title"><div className="modal-head"><div className="modal-icon"><Link2 size={24}/></div>{online && <button className="icon-button" aria-label="Close settings" onClick={() => setShowSetup(false)}><X size={20}/></button>}</div><span className="step-label">SECURE CONNECTION</span><h2 id="connect-title">Connect your cloud server</h2><p>Your cloud VM handles uploads and keeps FFmpeg running while this page is closed. Enter your server address and private dashboard token.</p>
        <label htmlFor="api-address">Server API URL</label><div className="input-wrap"><Cloud size={19}/><input id="api-address" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} placeholder="https://stream.example.com" autoComplete="url"/></div>
        <label htmlFor="owner-token">Dashboard access token</label><div className="input-wrap"><KeyRound size={19}/><input id="owner-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') connect(); }} placeholder="Your DASHBOARD_TOKEN from the VM" autoComplete="off"/></div>
        {error && <div className="modal-error" role="alert">{error}</div>}
        <button className="primary-button modal-connect" disabled={connecting} onClick={connect}>{connecting ? <LoaderCircle size={19} className="spin"/> : <Link2 size={19}/>} {connecting ? 'Connecting…' : 'Connect to server'}</button>
        {online && <button className="logout-button" onClick={disconnect}><LogOut size={17}/> Disconnect dashboard</button>}
        <div className="modal-footer"><ShieldCheck size={17}/><span>Token stays in this tab session. Your YouTube stream key never leaves your VM.</span></div>
      </div></div>}
    </div>
  );
}

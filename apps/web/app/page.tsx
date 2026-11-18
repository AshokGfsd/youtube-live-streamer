'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import {
  Activity, ArrowUpRight, Check, CheckCircle2, ChevronDown, CircleHelp, Cloud,
  ExternalLink, FileVideo2, Film, HardDrive, KeyRound, Link2, LoaderCircle,
  LogOut, Menu, MonitorPlay, Play, Radio, RefreshCcw, RotateCcw, Settings2,
  ShieldCheck, Signal, Square, TerminalSquare, UploadCloud, Wifi, X, Youtube,
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
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedUrl = localStorage.getItem('streamforge-api-url');
    const savedToken = sessionStorage.getItem('streamforge-token');
    if (savedUrl) setApiUrl(savedUrl);
    if (savedToken) setToken(savedToken);
  }, []);

  const fetchStatus = useCallback(async (currentUrl: string, currentToken: string) => {
    const response = await fetch(currentUrl.replace(/\/$/, '') + '/api/status', {
      headers: { Authorization: 'Bearer ' + currentToken },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()) as StreamStatus;
  }, []);

  useEffect(() => {
    if (!connected || !token) return;
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
          <div className="nav-link disabled" title="Coming soon"><Film size={18} /> Library <span className="soon">SOON</span></div>
          <div className="nav-link disabled" title="Coming soon"><Activity size={18} /> Analytics <span className="soon">SOON</span></div>
        </nav>
        <div className="nav-caption nav-caption-second">CONFIGURATION</div>
        <nav className="sidebar-links" aria-label="Settings navigation">
          <button className="nav-link" onClick={() => { setShowSetup(true); setMobileNav(false); }}><Settings2 size={18} /> Server settings</button>
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
          <div className="welcome"><div><span className="eyebrow"><span className="eyebrow-line" /> YOUR BROADCAST COMMAND CENTER</span><h1>Let&apos;s go <em>live.</em></h1><p>Upload a video, hit start, and let your cloud server take it from there.</p></div><div className="welcome-time"><Cloud size={17}/><span>Cloud-powered streaming</span></div></div>

          {(error || notice) && <div role={error ? 'alert' : 'status'} className={'toast-message ' + (error ? 'error-message' : 'success-message')}><span>{error || notice}</span><button aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}><X size={17}/></button></div>}

          <div className="overview-grid">
            <div className="overview-card status-overview"><div className="mini-icon"><Radio size={19}/></div><div className="overview-label">STREAM STATUS</div><div className="overview-value"><span className={'large-dot ' + phaseClass}/>{phase}</div><span className="overview-meta">{isRunning ? 'Cloud encoder is active' : 'Ready when you are'}</span></div>
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

              {busy === 'upload' && <div className="progress-row"><div className="progress-label"><span>Uploading to your cloud server…</span><b>{progress}%</b></div><div className="progress-track"><div style={{ width: progress + '%' }} className="progress-fill" /></div><p>Leave this page open until the upload finishes.</p></div>}

              {status?.video && <div className="current-video"><div className="video-thumb"><Film size={22}/></div><div className="current-video-details"><span className="small-uppercase">CURRENTLY ON SERVER</span><b title={status.video.name}>{status.video.name}</b><span>{displaySize(status.video.sizeBytes)} <span className="middle-dot">·</span> {displayDuration(status.video.durationSeconds)} <span className="middle-dot">·</span> {status.video.hasAudio ? 'With audio' : 'Silent audio added'}</span></div><CheckCircle2 size={20} className="video-check"/></div>}

              {selected && <button className="primary-button upload-submit" onClick={upload} disabled={!online || isBusy || isRunning}>{busy === 'upload' ? <LoaderCircle size={18} className="spin" /> : <UploadCloud size={18}/>} {busy === 'upload' ? 'Uploading…' : 'Upload to server'}</button>}
              {!online && <div className="inline-note"><CircleHelp size={16}/> Connect your cloud server to enable uploads.</div>}
            </section>

            <section className="panel broadcast-panel">
              <div className="panel-heading"><div><span className="step-label">STEP 02</span><h2>Broadcast controls</h2><p>Manage your YouTube stream.</p></div><div className="panel-heading-icon"><Radio size={21}/></div></div>

              <div className="destination"><div className="youtube-logo"><Youtube size={26} fill="currentColor" strokeWidth={1.3}/></div><div><b>YouTube Live</b><span>{status?.hasStreamKey ? 'Stream key configured on server' : 'Add your YouTube stream key on the VM'}</span></div><span className={'destination-tag ' + (status?.hasStreamKey ? 'configured' : '')}>{status?.hasStreamKey ? <><Check size={12}/> READY</> : 'SETUP'}</span></div>

              <div className="stream-option"><div className="option-icon"><RotateCcw size={19}/></div><div className="option-copy"><b>Loop video continuously</b><p>Repeat the video until you stop streaming.</p></div><button className={'toggle ' + (repeat ? 'checked' : '')} role="switch" aria-label="Loop video" aria-checked={repeat} onClick={() => setRepeat(!repeat)} disabled={isRunning || isBusy}><span/></button></div>

              <div className="ready-list"><div><span className={'readiness-dot ' + (online ? 'pass' : '')}/>{online ? 'Cloud server connected' : 'Cloud server not connected'}</div><div><span className={'readiness-dot ' + (status?.hasStreamKey ? 'pass' : '')}/>{status?.hasStreamKey ? 'YouTube stream key ready' : 'YouTube stream key needed'}</div><div><span className={'readiness-dot ' + (status?.video ? 'pass' : '')}/>{status?.video ? 'Video uploaded and checked' : 'Video upload needed'}</div></div>

              {isRunning ? <button className="stop-button" onClick={() => action('stop')} disabled={isBusy}>{busy === 'stop' ? <LoaderCircle size={19} className="spin"/> : <Square size={17} fill="currentColor"/>} Stop streaming</button>
                : <button className="go-live-button" onClick={() => action('start')} disabled={!online || !status?.video || !status.hasStreamKey || isBusy}>{busy === 'start' ? <LoaderCircle size={19} className="spin"/> : <Play size={19} fill="currentColor"/>} Start streaming <ArrowUpRight size={18}/></button>}
              <div className="broadcast-footnote"><ShieldCheck size={15}/> Stream runs on the VM, even after you close the browser.</div>
            </section>
          </div>

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

      {(!online || showSetup) && <div className="modal-overlay" role="presentation"><div className="connection-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title"><div className="modal-head"><div className="modal-icon"><Link2 size={24}/></div>{online && <button className="icon-button" aria-label="Close settings" onClick={() => setShowSetup(false)}><X size={20}/></button>}</div><span className="step-label">SECURE CONNECTION</span><h2 id="connect-title">Connect your cloud server</h2><p>Your Oracle VM handles uploads and keeps FFmpeg running while this page is closed. Enter your server address and private dashboard token.</p>
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

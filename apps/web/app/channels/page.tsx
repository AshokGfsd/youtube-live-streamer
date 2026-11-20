'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import {
  Activity, ArrowLeft, ArrowRight, BadgeCheck, Check, CheckCircle2, ChevronRight, CircleAlert,
  CircleHelp, Clapperboard, CloudUpload, Database, ExternalLink, Eye, FileVideo2,
  Globe2, HardDrive, Instagram, KeyRound, Layers3, LoaderCircle, LockKeyhole, MonitorPlay,
  MoreHorizontal, Play, Plus, Radio, RefreshCcw, Save, Search, Settings2,
  ShieldCheck, Signal, Square, Sparkles, Tv2, UploadCloud, WandSparkles, X, Youtube,
} from 'lucide-react';
import './channels.css';

type Video = { name: string; sizeBytes: number; durationSeconds: number };
type Stream = { phase: string; desiredRunning: boolean; hasStreamKey: boolean; video: Video | null; startedAt: string | null };
type Channel = {
  id: string; displayName: string; handle: string; youtubeChannelId: string; channelUrl: string;
  youtubeTitle: string; description: string; keywords: string; category: string;
  ingestUrl: string; defaultTitle: string; defaultDescription: string;
  privacy: 'private' | 'unlisted' | 'public'; loop: boolean; wizardStep: number;
  ready: boolean; hasStreamKey: boolean; youtubeConnected: boolean; stream?: Stream | null;
  updatedAt: string;
};
type Draft = Pick<Channel, 'displayName' | 'handle' | 'youtubeChannelId' | 'channelUrl' |
  'description' | 'keywords' | 'category' | 'ingestUrl' | 'defaultTitle' |
  'defaultDescription' | 'privacy' | 'loop'> & { streamKey: string };

const EMPTY_DRAFT: Draft = {
  displayName: '', handle: '', youtubeChannelId: '', channelUrl: '', description: '',
  keywords: '', category: 'Entertainment', streamKey: '',
  ingestUrl: 'rtmps://a.rtmps.youtube.com/live2', defaultTitle: '', defaultDescription: '',
  privacy: 'private', loop: true,
};
const STEPS = [
  { title: 'Identity', sub: 'Channel basics', icon: Tv2 },
  { title: 'Branding', sub: 'Your audience', icon: Sparkles },
  { title: 'Connection', sub: 'Stream destination', icon: Radio },
  { title: 'Preferences', sub: 'Go-live defaults', icon: Settings2 },
];

function formatDate(value: string) {
  if (!value) return 'Not saved';
  try { return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return 'Recently'; }
}
function videoSize(bytes: number) { return (bytes / (1024 * 1024)).toFixed(1) + ' MB'; }
async function jsonError(response: Response) {
  try { return (await response.json()).error || `Request failed (${response.status})`; }
  catch { return `Request failed (${response.status})`; }
}

export default function ChannelsPage() {
  const [apiBase, setApiBase] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [multiChannelEnabled, setMultiChannelEnabled] = useState(true);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [limit, setLimit] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [liveModal, setLiveModal] = useState(false);
  const [liveTitle, setLiveTitle] = useState('');
  const [liveDescription, setLiveDescription] = useState('');
  const [livePrivacy, setLivePrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const thumbnailInput = useRef<HTMLInputElement>(null);

  const request = useCallback(async <T,>(url: string, options: RequestInit = {}): Promise<T> => {
    const response = await fetch(apiBase + url, {
      ...options,
      headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...options.headers },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(await jsonError(response));
    return response.json() as Promise<T>;
  }, [apiBase, authToken]);

  const refresh = useCallback(async () => {
    if (!apiBase) return;
    const result = await request<{ configured: boolean; channels: Channel[]; multiChannelEnabled?: boolean; maxConcurrentStreams: number }>('/api/channels');
    setConfigured(result.configured);
    setMultiChannelEnabled(result.multiChannelEnabled !== false);
    setChannels(result.channels);
    setLimit(result.maxConcurrentStreams || 1);
    setSelectedId((current) => result.channels.some((channel) => channel.id === current)
      ? current : result.channels.find((channel) => channel.ready)?.id || result.channels[0]?.id || '');
  }, [apiBase, request]);

  useEffect(() => {
    const localPage = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    const base = localPage ? window.location.origin : localStorage.getItem('streamforge-api-url') || window.location.origin;
    setApiBase(base.replace(/\/$/, ''));
    setAuthToken(sessionStorage.getItem('streamforge-token') || '');
    const params = new URLSearchParams(window.location.search);
    if (params.get('youtube') === 'connected') setNotice('YouTube channel connected. Your authorization is saved securely.');
    if (params.has('youtube')) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  useEffect(() => {
    if (!apiBase) return;
    refresh().catch((cause) => { setError(cause instanceof Error ? cause.message : 'Could not connect to the API'); setConfigured(false); });
    const interval = setInterval(() => { refresh().catch(() => {}); }, 6000);
    return () => clearInterval(interval);
  }, [apiBase, refresh]);

  const selected = channels.find((channel) => channel.id === selectedId) || null;
  const runningCount = channels.filter((channel) => channel.stream?.desiredRunning).length;
  const matching = channels.filter((channel) => `${channel.displayName} ${channel.handle}`.toLowerCase().includes(search.toLowerCase()));

  function setField<K extends keyof Draft>(name: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [name]: value }));
    setLastSaved('');
  }

  async function create() {
    setError(''); setNotice(''); setBusy('create');
    try {
      const newChannel = await request<Channel>('/api/channels', { method: 'POST', body: '{}' });
      setEditingId(newChannel.id); setSelectedId(newChannel.id); setDraft({ ...EMPTY_DRAFT });
      setStep(1); setLastSaved('Draft created in MySQL');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create a channel'); }
    finally { setBusy(null); }
  }

  function edit(channel: Channel) {
    setError(''); setNotice(''); setSelectedId(channel.id);
    setEditingId(channel.id); setDraft({ ...EMPTY_DRAFT, ...channel, streamKey: '' });
    setStep(channel.ready ? 1 : Math.min(4, Math.max(1, channel.wizardStep + 1)));
    setLastSaved(channel.wizardStep ? `Steps 1–${channel.wizardStep} saved in MySQL` : 'Draft saved in MySQL');
  }

  async function saveStep(andContinue: boolean) {
    if (!editingId) return;
    setSaving(true); setError('');
    const payload = step === 1 ? { displayName: draft.displayName, handle: draft.handle, youtubeChannelId: draft.youtubeChannelId, channelUrl: draft.channelUrl }
      : step === 2 ? { description: draft.description, keywords: draft.keywords, category: draft.category }
      : step === 3 ? { streamKey: draft.streamKey, ingestUrl: draft.ingestUrl }
      : { defaultTitle: draft.defaultTitle, defaultDescription: draft.defaultDescription, privacy: draft.privacy, loop: draft.loop };
    try {
      await request(`/api/channels/${editingId}/steps/${step}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setLastSaved(`Step ${step} saved successfully to MySQL`);
      if (step === 3) setDraft((current) => ({ ...current, streamKey: '' }));
      if (andContinue) {
        if (step < 4) setStep((current) => current + 1);
        else {
          await request(`/api/channels/${editingId}/complete`, { method: 'POST', body: '{}' });
          setNotice('Channel is ready! Its stream key and details are saved in MySQL.');
          setEditingId(null);
        }
      }
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function perform(id: string, action: 'start' | 'stop') {
    setBusy(`${action}-${id}`); setError(''); setNotice('');
    try {
      await request(`/api/channels/${id}/${action}`, { method: 'POST', body: JSON.stringify({ loop: selected?.loop !== false }) });
      setNotice(action === 'start' ? 'Encoder started. Confirm the broadcast in YouTube Studio.' : 'Stream stop requested.');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not control stream'); }
    finally { setBusy(null); }
  }

  function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!selected || !file) return;
    setError(''); setNotice(''); setBusy('upload'); setUploadProgress(0);
    const data = new FormData(); data.set('video', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBase}/api/channels/${selected.id}/upload`);
    if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    xhr.upload.onprogress = (progress) => {
      if (progress.lengthComputable) setUploadProgress(Math.round(progress.loaded / progress.total * 100));
    };
    xhr.onload = () => {
      setBusy(null); setUploadProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) { setNotice(`${file.name} uploaded to ${selected.displayName}.`); refresh(); }
      else {
        try { setError(JSON.parse(xhr.responseText).error || 'Upload failed'); }
        catch { setError('Upload failed'); }
      }
    };
    xhr.onerror = () => { setError('Upload failed. Check your connection.'); setBusy(null); setUploadProgress(null); };
    xhr.send(data);
  }

  async function createBroadcast() {
    if (!selected) return;
    setBusy('broadcast'); setError('');
    const body = new FormData();
    body.set('title', liveTitle); body.set('description', liveDescription); body.set('privacy', livePrivacy);
    body.set('loop', String(selected.loop));
    if (thumbnail) body.set('thumbnail', thumbnail);
    try {
      await request(`/api/channels/${selected.id}/youtube/broadcasts/start`, { method: 'POST', body });
      setLiveModal(false); setNotice('Live broadcast created; encoder started. Check YouTube Studio.');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Broadcast creation failed'); }
    finally { setBusy(null); }
  }

  return (
    <div className="ch-page">
      <aside className="ch-sidebar">
        <Link href="/" className="ch-logo"><div className="ch-brand-icon"><Signal size={23}/></div><span><b>StreamForge<span className="ch-accent">.</span></b><small>BROADCAST STUDIO</small></span></Link>
        <div className="ch-nav-label">WORKSPACE</div>
        <Link href="/" className="ch-nav-item"><MonitorPlay size={18}/> Live studio</Link>
        <div className="ch-nav-item ch-nav-active"><Layers3 size={18}/> {multiChannelEnabled ? 'My channels' : 'My channel'} <span className="ch-nav-count">{channels.length}</span></div>
        <Link href="/instagram-live" className="ch-nav-item"><Instagram size={18}/> Reels Live studio <ArrowRight size={14} className="ch-end"/></Link>
        <div className="ch-nav-label ch-nav-secondary">QUICK ACCESS</div>
        <a href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer" className="ch-nav-item"><Youtube size={18}/> YouTube Studio <ExternalLink size={14} className="ch-end"/></a>
        <div className="ch-sidebar-bottom"><div className="ch-security"><ShieldCheck size={19}/><div><b>Private by design</b><p>Stream keys are encrypted in your database and never shown in this dashboard.</p></div></div><div className="ch-profile"><div>SF</div><span><b>My workspace</b><small>{multiChannelEnabled ? 'Multichannel studio' : 'Single-channel studio'}</small></span></div></div>
      </aside>

      <main className="ch-main">
        <header className="ch-topbar"><div className="ch-breadcrumb"><Link href="/">Workspace</Link><ChevronRight size={14}/><b>My Channels</b></div><div className="ch-top-right"><span><Database size={14}/> {configured ? 'MySQL connected' : 'Database setup'}</span><div className="ch-top-avatar">SF</div></div></header>
        <div className="ch-content">
          <div className="ch-hero"><div><span className="ch-eyebrow"><span/> YOUR BROADCAST STUDIO</span><h1>One studio.<br/><em>{multiChannelEnabled ? 'Every channel.' : 'One channel.'}</em></h1><p>{multiChannelEnabled ? 'Create, configure and manage your YouTube channels from one beautiful workspace.' : 'Configure your single YouTube channel from your private .env or edit its saved profile here.'} Every setup step is saved directly to MySQL.</p><div className="ch-hero-meta"><span><ShieldCheck size={15}/> Encrypted credentials</span><span><Save size={15}/> Step-by-step saving</span></div></div><div className="ch-hero-art" aria-hidden="true"><div className="ch-orbit ch-orbit-one"/><div className="ch-orbit ch-orbit-two"/><div className="ch-center-orb"><Youtube size={39}/></div><div className="ch-orb-icon ch-orb-left"><Tv2 size={23}/></div><div className="ch-orb-icon ch-orb-right"><Radio size={23}/></div><div className="ch-art-label"><span className="ch-art-pulse"/> YOUR CHANNEL</div></div></div>

          {(error || notice) && <div role={error ? 'alert' : 'status'} className={'ch-toast ' + (error ? 'ch-toast-error' : '')}><span>{error ? <CircleAlert size={18}/> : <CheckCircle2 size={18}/>} {error || notice}</span><button onClick={() => { setError(''); setNotice(''); }} aria-label="Dismiss"><X size={17}/></button></div>}

          {configured === false && <div className="ch-setup-warning"><Database size={27}/><div><h3>Connect your MySQL database</h3><p>Channel management requires MYSQL_DATABASE and CHANNEL_ENCRYPTION_KEY in your Termux .env. Install MariaDB, create your database, then restart StreamForge. Your original Live Studio still works.</p><code>pkg install mariadb -y</code></div></div>}

          <section className="ch-stats">
            <div className="ch-stat"><span className="ch-stat-icon ch-stat-teal"><Layers3 size={19}/></span><span className="ch-stat-label">TOTAL CHANNELS</span><strong>{String(channels.length).padStart(2, '0')}</strong><small>Stored in MySQL</small></div>
            <div className="ch-stat"><span className="ch-stat-icon ch-stat-blue"><CheckCircle2 size={19}/></span><span className="ch-stat-label">READY TO STREAM</span><strong>{String(channels.filter((c) => c.ready).length).padStart(2, '0')}</strong><small>Fully configured</small></div>
            <div className="ch-stat"><span className="ch-stat-icon ch-stat-red"><Radio size={19}/></span><span className="ch-stat-label">ACTIVE STREAMS</span><strong>{String(runningCount).padStart(2, '0')} <span>/ {limit}</span></strong><small>Device concurrency limit</small></div>
          </section>

          <div className="ch-section-title"><div><span className="ch-overline">CHANNEL LIBRARY</span><h2>{multiChannelEnabled ? 'Your channels' : 'Your channel'} <span>({channels.length})</span></h2><p>{multiChannelEnabled ? 'Every channel gets its own destination, video and stream controls.' : 'Single channel mode is controlled by MULTI_CHANNEL_ENABLED=false in your private .env.'}</p></div>{multiChannelEnabled && <button className="ch-primary" onClick={create} disabled={!configured || busy === 'create'}>{busy === 'create' ? <LoaderCircle size={18} className="ch-spin"/> : <Plus size={19}/>} New channel</button>}</div>
          {multiChannelEnabled && <div className="ch-search"><Search size={18}/><input aria-label="Search channels" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your channels..."/><span>{matching.length} channels</span></div>}

          {!channels.length && configured && <div className="ch-empty"><div className="ch-empty-icon"><Layers3 size={34}/></div><h3>{multiChannelEnabled ? 'Your next channel starts here.' : 'Single-channel setup is pending.'}</h3><p>{multiChannelEnabled ? 'Follow four guided steps to add branding, connect YouTube, and set your streaming preferences.' : 'Set SINGLE_CHANNEL_NAME and SINGLE_CHANNEL_STREAM_KEY in your private .env and restart the API.'}</p>{multiChannelEnabled && <button className="ch-primary" onClick={create}><Plus size={18}/> Create first channel</button>}</div>}
          <div className="ch-card-grid">{matching.map((channel, index) => {
            const active = Boolean(channel.stream?.desiredRunning);
            return <button key={channel.id} onClick={() => setSelectedId(channel.id)} className={'ch-channel-card ' + (selectedId === channel.id ? 'ch-card-selected' : '')}>
              <div className="ch-channel-top"><div className={'ch-channel-avatar ch-avatar-' + (index % 4)}>{channel.displayName?.slice(0, 2).toUpperCase() || 'YT'}</div><span className={'ch-status ' + (active ? 'ch-status-live' : channel.ready ? 'ch-status-ready' : 'ch-status-draft')}><i/>{active ? 'LIVE' : channel.ready ? 'READY' : 'DRAFT'}</span></div>
              <h3>{channel.displayName || 'Untitled channel'}</h3><p>{channel.handle ? '@' + channel.handle : channel.youtubeTitle || 'Finish setup to go live'}</p>
              <div className="ch-card-divider"/><div className="ch-card-meta"><span><FileVideo2 size={15}/>{channel.stream?.video ? 'Video ready' : 'No video'}</span><span><KeyRound size={14}/>{channel.hasStreamKey ? 'Key saved' : 'Setup needed'}</span></div>
              <div className="ch-card-footer"><span>{channel.ready ? 'Manage channel' : `Continue setup · ${channel.wizardStep}/4`}</span><ArrowRight size={17}/></div>
            </button>;
          })}</div>

          {selected && <section className="ch-details"><div className="ch-details-head"><div><span className="ch-overline">SELECTED CHANNEL</span><h2>{selected.displayName || 'Channel draft'}</h2><p>{selected.handle ? '@' + selected.handle : 'Set up your channel to unlock streaming tools.'}</p></div><button className="ch-secondary" onClick={() => edit(selected)}><Settings2 size={16}/> {selected.ready ? 'Edit settings' : 'Continue setup'}</button></div>
            <div className="ch-details-body"><div className="ch-detail-item"><span>Channel status</span><b>{selected.stream?.desiredRunning ? 'Broadcasting' : selected.ready ? 'Ready' : `Draft · Step ${selected.wizardStep}/4`}</b></div><div className="ch-detail-item"><span>YouTube ID</span><b>{selected.youtubeChannelId || 'Not added'}</b></div><div className="ch-detail-item"><span>Google connection</span><b>{selected.youtubeConnected ? 'Connected' : 'Not connected'}</b></div><div className="ch-detail-item"><span>Last updated</span><b>{formatDate(selected.updatedAt)}</b></div></div>
            <div className="ch-video-area"><div className="ch-video-symbol"><Clapperboard size={24}/></div><div><b>{selected.stream?.video?.name || 'No video uploaded'}</b><p>{selected.stream?.video ? `${videoSize(selected.stream.video.sizeBytes)} · Ready for this channel` : 'Upload a video for this specific channel to begin streaming.'}</p></div><input ref={uploadInput} type="file" accept=".mp4,.mkv,.mov,.webm,.m4v" hidden onChange={upload}/><button className="ch-secondary" disabled={!!busy || !!selected.stream?.desiredRunning} onClick={() => uploadInput.current?.click()}><UploadCloud size={17}/>{busy === 'upload' ? `Uploading ${uploadProgress ?? 0}%` : 'Upload video'}</button></div>
            {uploadProgress !== null && <div className="ch-upload-bar"><span style={{ width: `${uploadProgress}%` }}/></div>}
            <div className="ch-action-row"><div className="ch-action-hint"><ShieldCheck size={17}/> {selected.hasStreamKey ? 'YouTube stream key encrypted and stored in MySQL.' : 'Add your stream key in the connection step.'}</div><div className="ch-actions">{selected.stream?.desiredRunning ? <button className="ch-stop" disabled={!!busy} onClick={() => perform(selected.id, 'stop')}><Square size={16}/> Stop stream</button> : <button className="ch-primary" disabled={!selected.ready || !selected.stream?.video || !!busy} onClick={() => perform(selected.id, 'start')}><Play size={17} fill="currentColor"/> Start stream</button>}{selected.youtubeConnected ? <button className="ch-secondary" disabled={!selected.stream?.video || !!busy || !!selected.stream?.desiredRunning} onClick={() => { setLiveTitle(selected.defaultTitle || selected.stream?.video?.name || 'My YouTube Live'); setLiveDescription(selected.defaultDescription); setLivePrivacy(selected.privacy); setLiveModal(true); }}>Create YouTube Live</button> : <button className="ch-secondary" disabled={!selected.ready || !!busy} onClick={() => window.location.assign(`${apiBase}/api/channels/${selected.id}/youtube/oauth/start`)}><Youtube size={17}/> Connect Google</button>}</div></div>
          </section>}
          <footer className="ch-footer">StreamForge Studio · Encrypted MySQL channel profiles <span>Self-hosted on your device</span></footer>
        </div>
      </main>

      {editingId && <div className="ch-wizard-overlay"><div className="ch-wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title"><div className="ch-wizard-side"><div className="ch-wizard-side-top"><div className="ch-wizard-small-mark"><WandSparkles size={20}/></div><span>CHANNEL SETUP</span></div><h2>Let&apos;s make<br/>it <em>official.</em></h2><p>Four simple steps. Your progress is saved securely to MySQL as you go.</p><div className="ch-wizard-steps">{STEPS.map((item, index) => { const Icon = item.icon; const number = index + 1; return <div className={'ch-wizard-step ' + (step === number ? 'ch-wizard-step-active' : '') + (step > number ? ' ch-wizard-step-done' : '')} key={number}><div className="ch-step-number">{step > number ? <Check size={16}/> : <Icon size={17}/>}</div><div><b>{item.title}</b><small>{item.sub}</small></div></div>; })}</div><div className="ch-wizard-security"><LockKeyhole size={17}/> Your private keys never appear in the channel list.</div></div>
        <div className="ch-wizard-right"><div className="ch-wizard-header"><span>STEP {String(step).padStart(2, '0')} / 04</span><button aria-label="Close wizard" onClick={() => { setEditingId(null); setError(''); }}><X size={21}/></button></div><div className="ch-wizard-content"><div className="ch-step-icon">{step === 1 ? <Tv2 size={25}/> : step === 2 ? <Sparkles size={25}/> : step === 3 ? <Radio size={25}/> : <Settings2 size={25}/>}</div><h2 id="wizard-title">{step === 1 ? 'Introduce your channel' : step === 2 ? 'Shape your brand' : step === 3 ? 'Connect your stream' : 'Set your defaults'}</h2><p className="ch-step-description">{step === 1 ? 'Add the identity you want to see across your workspace.' : step === 2 ? 'Keep the description, keywords, and category in one place.' : step === 3 ? 'Your stream key stays encrypted on your server, never in the browser after saving.' : 'Choose the settings we should remember each time you go live.'}</p>
          {step === 1 && <div className="ch-fields"><label>Channel display name <em>*</em><input value={draft.displayName} onChange={(e) => setField('displayName', e.target.value)} maxLength={100} placeholder="e.g. ClueRipple Live" autoFocus/></label><label>YouTube handle <small>Optional</small><div className="ch-input-prefix"><span>@</span><input value={draft.handle.replace(/^@/, '')} onChange={(e) => setField('handle', e.target.value)} placeholder="ClueRippleLive"/></div></label><label>YouTube channel URL <small>Optional</small><input value={draft.channelUrl} onChange={(e) => setField('channelUrl', e.target.value)} placeholder="https://www.youtube.com/@yourhandle"/></label><label>YouTube channel ID <small>Optional</small><input value={draft.youtubeChannelId} onChange={(e) => setField('youtubeChannelId', e.target.value)} placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"/></label></div>}
          {step === 2 && <div className="ch-fields"><label>Channel description<textarea rows={4} maxLength={1000} value={draft.description} onChange={(e) => setField('description', e.target.value)} placeholder="Tell your viewers what makes your content special..."/></label><label>Keywords <small>Comma-separated</small><textarea rows={3} maxLength={500} value={draft.keywords} onChange={(e) => setField('keywords', e.target.value)} placeholder="brain teasers, live puzzles, satisfying videos"/></label><label>Category<select value={draft.category} onChange={(e) => setField('category', e.target.value)}><option>Entertainment</option><option>Education</option><option>Gaming</option><option>Howto &amp; Style</option><option>Science &amp; Technology</option><option>People &amp; Blogs</option></select></label><div className="ch-field-note"><CircleHelp size={16}/> Channel details here are saved as your private workspace profile; Google connection is separate.</div></div>}
          {step === 3 && <div className="ch-fields"><label>YouTube stream key <em>{channels.find((c) => c.id === editingId)?.hasStreamKey ? '' : '*'}</em><div className="ch-input-prefix"><KeyRound size={18}/><input type="password" autoComplete="off" spellCheck={false} value={draft.streamKey} onChange={(e) => setField('streamKey', e.target.value)} placeholder={channels.find((c) => c.id === editingId)?.hasStreamKey ? 'Already saved — leave blank to keep it' : 'Paste your secret YouTube stream key'}/></div></label><label>RTMPS ingest server<select value={draft.ingestUrl} onChange={(e) => setField('ingestUrl', e.target.value)}><option value="rtmps://a.rtmps.youtube.com/live2">YouTube primary · a.rtmps.youtube.com</option><option value="rtmps://b.rtmps.youtube.com/live2">YouTube backup · b.rtmps.youtube.com</option></select></label><div className="ch-secret-callout"><ShieldCheck size={20}/><div><b>Encrypted from the first save</b><p>We use AES-256-GCM encryption before writing the key to MySQL. The API never returns it.</p></div></div></div>}
          {step === 4 && <div className="ch-fields"><label>Default live title <small>Optional</small><input value={draft.defaultTitle} maxLength={100} onChange={(e) => setField('defaultTitle', e.target.value)} placeholder="e.g. LIVE Puzzle Marathon"/></label><label>Default live description<textarea rows={3} maxLength={5000} value={draft.defaultDescription} onChange={(e) => setField('defaultDescription', e.target.value)} placeholder="Your default description for new broadcasts..."/></label><label>Visibility<select value={draft.privacy} onChange={(e) => setField('privacy', e.target.value as Draft['privacy'])}><option value="private">Private — recommended for testing</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label><label className="ch-switch-row"><span><b>Loop uploaded video</b><small>Keep repeating until you stop streaming.</small></span><input type="checkbox" checked={draft.loop} onChange={(e) => setField('loop', e.target.checked)}/></label></div>}
        </div><div className="ch-wizard-bottom">{error && <div className="ch-wizard-error" role="alert"><CircleAlert size={15}/>{error}</div>}<div className="ch-save-status"><span className="ch-save-indicator"><Check size={13}/></span>{saving ? 'Saving your step...' : lastSaved || 'Your completed steps are saved in MySQL.'}</div><div className="ch-wizard-buttons">{step > 1 && <button className="ch-secondary" onClick={() => { setStep((current) => current - 1); setError(''); }} disabled={saving}><ArrowLeft size={16}/> Back</button>}<button className="ch-secondary" disabled={saving} onClick={() => saveStep(false)}><Save size={16}/> Save step</button><button className="ch-primary" disabled={saving} onClick={() => saveStep(true)}>{saving ? <LoaderCircle size={17} className="ch-spin"/> : step === 4 ? <Check size={17}/> : <ArrowRight size={17}/>} {step === 4 ? 'Finish setup' : 'Save & continue'}</button></div></div></div>
      </div></div>}

      {liveModal && selected && <div className="ch-wizard-overlay"><div className="ch-live-modal" role="dialog" aria-modal="true" aria-labelledby="live-modal-title"><div className="ch-modal-top"><div className="ch-step-icon"><Radio size={25}/></div><button onClick={() => setLiveModal(false)} aria-label="Close"><X size={20}/></button></div><h2 id="live-modal-title">Create a YouTube broadcast</h2><p>Create the event, attach your existing reusable stream key, and launch FFmpeg.</p><div className="ch-fields"><label>Live title<input maxLength={100} value={liveTitle} onChange={(e) => setLiveTitle(e.target.value)}/></label><label>Description<textarea maxLength={5000} rows={3} value={liveDescription} onChange={(e) => setLiveDescription(e.target.value)}/></label><label>Visibility<select value={livePrivacy} onChange={(e) => setLivePrivacy(e.target.value as 'private' | 'unlisted' | 'public')}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label><label>Thumbnail (JPG/PNG, max 6 MB)<input ref={thumbnailInput} type="file" accept="image/png,image/jpeg" onChange={(e) => setThumbnail(e.target.files?.[0] || null)}/></label></div>{error && <div className="ch-wizard-error" role="alert"><CircleAlert size={15}/>{error}</div>}<button className="ch-primary ch-modal-submit" disabled={!liveTitle.trim() || !!busy} onClick={createBroadcast}>{busy === 'broadcast' ? <LoaderCircle size={17} className="ch-spin"/> : <Play size={17}/>} Create &amp; start live</button></div></div>}
    </div>
  );
}

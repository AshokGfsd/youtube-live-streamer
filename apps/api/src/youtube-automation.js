import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';
const TOKEN_API = 'https://oauth2.googleapis.com/token';
const OAUTH_API = 'https://accounts.google.com/o/oauth2/v2/auth';
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';

export class YouTubeApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'YouTubeApiError';
    this.status = status;
  }
}

function apiError(response, payload) {
  const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.message || payload?.error_description;
  return new YouTubeApiError(
    `YouTube ${response.status}: ${String(reason || 'request failed').slice(0, 180)}`,
    response.status >= 500 ? 502 : 400,
  );
}

export function validateImage(file) {
  if (!file) return;
  const data = file.buffer;
  const png = file.mimetype === 'image/png' && data?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = file.mimetype === 'image/jpeg' && data?.[0] === 0xff && data?.[1] === 0xd8 && data?.[2] === 0xff;
  if (!png && !jpeg) throw new YouTubeApiError('Choose a real JPG or PNG image');
}

export function validateBroadcast(input) {
  const title = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  const privacy = String(input.privacy || 'private');
  if (title.length < 1 || title.length > 100) throw new YouTubeApiError('Live title must be 1–100 characters');
  if (description.length > 5000) throw new YouTubeApiError('Description must be at most 5,000 characters');
  if (!['private', 'unlisted', 'public'].includes(privacy)) throw new YouTubeApiError('Choose a valid privacy setting');
  return { title, description, privacy };
}

export class YouTubeAutomation {
  constructor({ dataDir, streamKey, clientId, clientSecret, port = 4000, fetchImpl = fetch, accountStore = null }) {
    this.file = path.join(dataDir, 'youtube-oauth.json');
    this.streamKey = streamKey || '';
    this.clientId = clientId || '';
    this.clientSecret = clientSecret || '';
    this.redirectUri = `http://127.0.0.1:${port}/api/youtube/oauth/callback`;
    this.fetchImpl = fetchImpl;
    this.accountStore = accountStore;
    this.account = null;
    this.accessToken = null;
    this.accessExpiresAt = 0;
    this.pendingState = null;
    this.lastBroadcast = null;
  }

  get configured() { return Boolean(this.clientId && this.clientSecret); }

  async initialize() {
    if (this.accountStore) {
      this.account = await this.accountStore.load();
      return;
    }
    try {
      const account = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (typeof account.refreshToken === 'string' && account.refreshToken) {
        this.account = account;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Saved YouTube authorization could not be loaded');
    }
  }

  status() {
    return {
      configured: this.configured,
      connected: Boolean(this.account?.refreshToken),
      channel: this.account?.channelTitle || null,
      channelId: this.account?.channelId || null,
      description: this.account?.description || '',
      lastBroadcast: this.lastBroadcast,
    };
  }

  authorize() {
    if (!this.configured) throw new YouTubeApiError('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your local .env');
    const state = crypto.randomBytes(32).toString('hex');
    this.pendingState = { value: state, expiresAt: Date.now() + 10 * 60_000 };
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: YOUTUBE_SCOPE,
      access_type: 'offline',
      prompt: 'select_account consent',
      state,
    });
    return `${OAUTH_API}?${params}`;
  }

  async exchangeCode(code, state) {
    if (!this.pendingState || Date.now() > this.pendingState.expiresAt ||
      typeof state !== 'string' ||
      !crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(state).digest()), Buffer.from(crypto.createHash('sha256').update(this.pendingState.value).digest()))) {
      throw new YouTubeApiError('Invalid or expired Google sign-in. Please try connecting again.');
    }
    this.pendingState = null;
    if (!code || typeof code !== 'string') throw new YouTubeApiError('Google did not return an authorization code');
    const response = await this.fetchImpl(TOKEN_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: this.clientId, client_secret: this.clientSecret,
        redirect_uri: this.redirectUri, grant_type: 'authorization_code',
      }),
    });
    const result = await response.json();
    if (!response.ok) throw apiError(response, result);
    if (!result.refresh_token) throw new YouTubeApiError('Google did not issue an offline refresh token. Reconnect and allow access.');
    this.accessToken = result.access_token;
    this.accessExpiresAt = Date.now() + Math.max(0, Number(result.expires_in || 3600) - 60) * 1000;
    const channel = await this.getOwnedChannel();
    this.account = {
      refreshToken: result.refresh_token,
      channelId: channel.id,
      channelTitle: channel.snippet?.title || 'My YouTube channel',
      description: channel.brandingSettings?.channel?.description || '',
    };
    await this.save();
    return this.status();
  }

  async save() {
    if (this.accountStore) {
      await this.accountStore.save(this.account);
      return;
    }
    const tmp = this.file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.account), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  async disconnect() {
    this.account = null;
    this.accessToken = null;
    this.accessExpiresAt = 0;
    this.lastBroadcast = null;
    if (this.accountStore) await this.accountStore.delete();
    else await fs.rm(this.file, { force: true });
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.accessExpiresAt) return this.accessToken;
    if (!this.configured || !this.account?.refreshToken) throw new YouTubeApiError('Connect your YouTube account first');
    const response = await this.fetchImpl(TOKEN_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: this.account.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
      }),
    });
    const data = await response.json();
    if (!response.ok) throw apiError(response, data);
    this.accessToken = data.access_token;
    this.accessExpiresAt = Date.now() + Math.max(0, Number(data.expires_in || 3600) - 60) * 1000;
    return this.accessToken;
  }

  async request(url, { method = 'GET', json, image } = {}) {
    const accessToken = await this.getAccessToken();
    const headers = { Authorization: `Bearer ${accessToken}` };
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    if (image) headers['Content-Type'] = image.mimetype;
    const response = await this.fetchImpl(url, {
      method, headers,
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      ...(image ? { body: image.buffer } : {}),
    });
    const payload = await response.json();
    if (!response.ok) throw apiError(response, payload);
    return payload;
  }

  async getOwnedChannel() {
    const result = await this.request(`${API}/channels?part=snippet,brandingSettings&mine=true`);
    const channel = result.items?.[0];
    if (!channel) throw new YouTubeApiError('No YouTube channel found for this Google account');
    return channel;
  }

  async findConfiguredStream() {
    if (!this.streamKey || this.streamKey.startsWith('your-secret-')) {
      throw new YouTubeApiError('Set your reusable YOUTUBE_STREAM_KEY in Termux .env');
    }
    let pageToken = '';
    do {
      const params = new URLSearchParams({ part: 'id,cdn', mine: 'true', maxResults: '50' });
      if (pageToken) params.set('pageToken', pageToken);
      const list = await this.request(`${API}/liveStreams?${params}`);
      const match = list.items?.find((item) => item.cdn?.ingestionInfo?.streamName === this.streamKey);
      if (match) return match.id;
      pageToken = list.nextPageToken || '';
    } while (pageToken);
    throw new YouTubeApiError('Your stream key was not found among reusable YouTube live streams. Create/select a reusable stream key in YouTube Studio, then update .env.');
  }

  async createBroadcast(input, thumbnail) {
    const { title, description, privacy } = validateBroadcast(input);
    validateImage(thumbnail);
    if (!this.account) throw new YouTubeApiError('Connect your YouTube account first');
    // Resolve the liveStream BEFORE creating an event, to avoid orphan events.
    const streamId = await this.findConfiguredStream();
    const created = await this.request(`${API}/liveBroadcasts?part=snippet,status,contentDetails`, {
      method: 'POST',
      json: {
        snippet: { title, description, scheduledStartTime: new Date(Date.now() + 2 * 60_000).toISOString() },
        status: { privacyStatus: privacy },
        contentDetails: { enableAutoStart: true, enableAutoStop: true, enableDvr: true },
      },
    });
    const id = created.id;
    if (!id) throw new YouTubeApiError('YouTube did not return a broadcast ID');
    const link = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    this.lastBroadcast = { id, title, url: link, thumbnailSet: false };
    await this.request(`${API}/liveBroadcasts/bind?part=id,snippet,contentDetails&id=${encodeURIComponent(id)}&streamId=${encodeURIComponent(streamId)}`, { method: 'POST' });
    if (thumbnail) {
      await this.request(`${UPLOAD_API}/thumbnails/set?videoId=${encodeURIComponent(id)}&uploadType=media`, { method: 'POST', image: thumbnail });
      this.lastBroadcast.thumbnailSet = true;
    }
    return this.lastBroadcast;
  }

  async updateChannel({ description, banner }) {
    if (typeof description !== 'string' || description.length > 1000) throw new YouTubeApiError('Channel description must be at most 1,000 characters');
    validateImage(banner);
    if (!this.account) throw new YouTubeApiError('Connect your YouTube account first');
    const existing = await this.getOwnedChannel();
    const brandingSettings = existing.brandingSettings || {};
    // channels.list returns read-only image/title fields. Only send back
    // mutable values so the brandingSettings update cannot reject them.
    const channel = {};
    for (const key of ['country', 'defaultLanguage', 'keywords', 'trackingAnalyticsAccountId', 'unsubscribedTrailer']) {
      if (typeof brandingSettings.channel?.[key] === 'string') channel[key] = brandingSettings.channel[key];
    }
    channel.description = description;
    const updated = { channel };
    if (banner) {
      const uploaded = await this.request(`${UPLOAD_API}/channelBanners/insert?uploadType=media`, { method: 'POST', image: banner });
      if (!uploaded.url) throw new YouTubeApiError('YouTube did not return a banner URL');
      updated.image = { bannerExternalUrl: uploaded.url };
    }
    await this.request(`${API}/channels?part=brandingSettings`, { method: 'PUT', json: { id: existing.id, brandingSettings: updated } });
    this.account.description = description;
    await this.save();
    return this.status();
  }
}

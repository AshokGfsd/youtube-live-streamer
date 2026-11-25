"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Copy,
  ExternalLink,
  FlaskConical,
  Link2,
  LoaderCircle,
  Search,
  Upload,
  Video,
} from "lucide-react";

type ProbeResult = {
  reachable: boolean;
  encoded: boolean;
  video: {
    codec: string;
    width: number | null;
    height: number | null;
    fps: number | null;
  };
  audio: {
    codec: string;
    channels: number | null;
    sampleRate: number | null;
  } | null;
  durationSeconds: number | null;
};

type ApiRequest = <T>(url: string, init?: RequestInit) => Promise<T>;
type CollectorStatus = {
  phase: "idle" | "running" | "completed" | "failed" | "stopped";
  query: string;
  requested: number;
  minFps?: number;
  minResolution?: string;
  checked?: number;
  rejected?: number;
  found: number;
  visited: number;
  error: string | null;
  note: string;
};
type CollectorResults = CollectorStatus & { directVideoUrls: string[] };

function safeUrlLabel(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname.slice(-42)}`;
  } catch {
    return "Invalid media URL";
  }
}

type MediaProbeProps = {
  request: ApiRequest;
  onMediaUrlsChange: (urls: string[]) => void;
  directActive: boolean;
  onDirectActiveChange: (active: boolean) => void;
  liveLocked: boolean;
  liveDirect: boolean;
  browserCollectorAvailable?: boolean;
};

export default function MediaProbePanel({
  request,
  onMediaUrlsChange,
  directActive,
  onDirectActiveChange,
  liveLocked,
  liveDirect,
  browserCollectorAvailable = true,
}: MediaProbeProps) {
  const [url, setUrl] = useState("");
  const [imported, setImported] = useState<string[]>([]);
  const [importWarning, setImportWarning] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchCount, setSearchCount] = useState(20);
  const [minSourceFps, setMinSourceFps] = useState(0);
  const [minSourceResolution, setMinSourceResolution] = useState("any");
  const [collector, setCollector] = useState<CollectorStatus | null>(null);
  const [collectBusy, setCollectBusy] = useState(false);

  const applyCollectedResults = useCallback(
    (results: CollectorResults) => {
      if (results.directVideoUrls.length) {
        setImported(results.directVideoUrls);
        setUrl(results.directVideoUrls[0]);
        setError("");
        setResult(null);
        setImportWarning("");
        setCopied(false);
        onMediaUrlsChange(results.directVideoUrls);
        onDirectActiveChange(true);
      } else if (results.phase === "completed") {
        setError(
          results.checked && (results.minFps || results.minResolution !== "any")
            ? `No playable MP4s matched the requested source FPS and resolution (${results.checked} inspected). Try a lower threshold or another topic.`
            : "No direct MP4 elements were exposed by Instagram. Sign in, try another keyword, or use manual JSON import.",
        );
      }
    },
    [onMediaUrlsChange, onDirectActiveChange],
  );

  useEffect(() => {
    if (!browserCollectorAvailable) return;
    let cancelled = false;
    (async () => {
      const status = await request<CollectorStatus>(
        "/api/instagram-live/media/collect/status",
      );
      if (cancelled) return;
      // A completed collection can survive a page reload. Restore the actual
      // URLs as well as the progress indicator so Start is enabled again.
      if (
        status.phase === "completed" ||
        status.phase === "stopped" ||
        status.phase === "failed"
      ) {
        const results = await request<CollectorResults>(
          "/api/instagram-live/media/collect/results",
        );
        if (cancelled) return;
        applyCollectedResults(results);
      }
      setCollector(status);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [request, applyCollectedResults, browserCollectorAvailable]);

  useEffect(() => {
    if (collector?.phase !== "running") return;
    let cancelled = false;
    const poll = setInterval(async () => {
      try {
        const status = await request<CollectorStatus>(
          "/api/instagram-live/media/collect/status",
        );
        if (cancelled) return;
        if (status.phase !== "running") {
          // Fetch the MP4s BEFORE changing phase. Updating collector first
          // tears down this polling effect and discards the in-flight results.
          const results = await request<CollectorResults>(
            "/api/instagram-live/media/collect/results",
          );
          if (cancelled) return;
          applyCollectedResults(results);
        }
        setCollector(status);
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    }, 1300);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [collector?.phase, request, applyCollectedResults]);

  async function startCollection() {
    if (liveLocked || collectBusy || collector?.phase === "running") return;
    setCollectBusy(true);
    setError("");
    setResult(null);
    setImportWarning("");
    try {
      const status = await request<CollectorStatus>(
        "/api/instagram-live/media/collect/start",
        {
          method: "POST",
          body: JSON.stringify({
            query: searchKeyword.trim(),
            count: searchCount,
            minFps: minSourceFps,
            minResolution: minSourceResolution,
          }),
        },
      );
      setImported([]);
      setUrl("");
      onMediaUrlsChange([]);
      setCollector(status);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setCollectBusy(false);
    }
  }

  async function stopCollection() {
    try {
      const status = await request<CollectorStatus>(
        "/api/instagram-live/media/collect/stop",
        { method: "POST", body: "{}" },
      );
      setCollector(status);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function launchChrome() {
    try {
      setCollectBusy(true);
      setError("");
      const res = await request<{ ok: boolean; message: string }>(
        "/api/instagram-live/browser/launch",
        { method: "POST" },
      );
      if (res.ok) {
        setImportWarning(
          "Chrome opened on port 9222. Please log in to Instagram in that window, then click Find videos automatically.",
        );
      } else {
        setError(
          res.message ||
            "Could not launch Chrome automatically. Ensure Google Chrome is installed.",
        );
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setCollectBusy(false);
    }
  }

  function exportJson() {
    if (!imported.length) return;
    const json = JSON.stringify(
      {
        source: "streamforge-instagram-collector",
        searchQuery: collector?.query || null,
        exportedAt: new Date().toISOString(),
        directVideoUrls: imported,
      },
      null,
      2,
    );
    const objectUrl = URL.createObjectURL(
      new Blob([json], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `instagram-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  async function importJson(file: File | undefined) {
    if (!file) return;
    setError("");
    setResult(null);
    setImportWarning("");
    setCopied(false);
    try {
      if (file.size > 2_000_000)
        throw new Error("JSON file is too large (limit 2 MB).");
      const data: unknown = JSON.parse(await file.text());
      const record =
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : {};
      const rows: unknown[] = Array.isArray(data)
        ? data
        : Array.isArray(record.directVideoUrls)
          ? record.directVideoUrls
          : Array.isArray(record.videos)
            ? record.videos
            : [];
      const links = [
        ...new Set(
          rows
            .map((row) =>
              typeof row === "string"
                ? row
                : row && typeof row === "object" && "mediaUrl" in row
                  ? (row as { mediaUrl?: unknown }).mediaUrl
                  : null,
            )
            .filter(
              (item): item is string =>
                typeof item === "string" && item.startsWith("https://"),
            ),
        ),
      ].slice(0, 50000);
      if (!links.length)
        throw new Error(
          "No direct video URLs found. Export sfCollector.results() as JSON.",
        );
      setImported(links);
      setUrl(links[0]);
      onMediaUrlsChange(links);
      const exportedAt =
        typeof record.exportedAt === "string"
          ? Date.parse(record.exportedAt)
          : NaN;
      if (
        Number.isFinite(exportedAt) &&
        Date.now() - exportedAt > 30 * 60_000
      ) {
        setImportWarning(
          "This JSON was exported over 30 minutes ago. Instagram signed MP4 links can expire. If you see 404, paste a newly copied video URL.",
        );
      }
    } catch (cause) {
      setImported([]);
      onMediaUrlsChange([]);
      setError((cause as Error).message);
    }
  }

  async function probe(decode: boolean) {
    if (!url.trim() || busy) return;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const response = await request<ProbeResult>(
        "/api/instagram-live/media/probe",
        {
          method: "POST",
          body: JSON.stringify({ url: url.trim(), decode }),
        },
      );
      setResult(response);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="il-panel il-media-probe" id="il-media-discovery">
      <div className="il-panel-head">
        <div className="il-panel-icon il-magenta">
          <FlaskConical size={20} />
        </div>
        <div>
          <p>Video discovery</p>
          <h2>
            {browserCollectorAvailable
              ? "Find videos for your stream"
              : "Build your MP4 playlist"}
          </h2>
          <span>
            {browserCollectorAvailable
              ? "Search Instagram by topic, then collect clips for a new live playlist."
              : "Use permitted Instagram/Meta CDN video links, or import a playlist JSON. No Chrome or X11 required."}
          </span>
        </div>
      </div>
      <div className="il-playlist-fields">
        {browserCollectorAvailable ? (
          <div className="il-auto-collector">
            <div className="il-two-cols">
              <div>
                <label className="il-label" htmlFor="il-search-keyword">
                  Topic or search keyword
                </label>
                <input
                  id="il-search-keyword"
                  type="text"
                  maxLength={80}
                  placeholder="e.g. naruto, puzzles, woodworking"
                  value={searchKeyword}
                  onChange={(event) => setSearchKeyword(event.target.value)}
                  disabled={
                    liveLocked || collectBusy || collector?.phase === "running"
                  }
                />
              </div>
              <div>
                <label className="il-label" htmlFor="il-search-count">
                  Number of videos (or 0 for unlimited / ∞)
                </label>
                <input
                  id="il-search-count"
                  type="number"
                  min={0}
                  max={50000}
                  placeholder="e.g. 200 (or 0 for ∞)"
                  value={searchCount}
                  onChange={(event) =>
                    setSearchCount(Number(event.target.value))
                  }
                  disabled={
                    liveLocked || collectBusy || collector?.phase === "running"
                  }
                />
              </div>
            </div>
            <div className="il-two-cols">
              <div>
                <label className="il-label" htmlFor="il-filter-source-fps">Minimum source FPS</label>
                <select
                  id="il-filter-source-fps"
                  value={minSourceFps}
                  onChange={(event) => setMinSourceFps(Number(event.target.value))}
                  disabled={liveLocked || collectBusy || collector?.phase === "running"}
                >
                  <option value={0}>Any FPS</option>
                  <option value={24}>24 FPS or higher</option>
                  <option value={30}>30 FPS or higher</option>
                  <option value={40}>40 FPS or higher</option>
                  <option value={60}>60 FPS or higher</option>
                </select>
              </div>
              <div>
                <label className="il-label" htmlFor="il-filter-source-resolution">Minimum source resolution</label>
                <select
                  id="il-filter-source-resolution"
                  value={minSourceResolution}
                  onChange={(event) => setMinSourceResolution(event.target.value)}
                  disabled={liveLocked || collectBusy || collector?.phase === "running"}
                >
                  <option value="any">Any resolution</option>
                  <option value="480p">480p (480 × 854) or higher</option>
                  <option value="720p">720p (720 × 1280) or higher</option>
                  <option value="1080p">1080p (1080 × 1920) or higher</option>
                </select>
              </div>
            </div>
            <p className="il-hint">
              Optional filters check each candidate MP4 with server-side FFprobe <b>before adding it to the playlist</b>.
              Portrait and landscape videos both work; 29.97 FPS counts as 30 FPS.
              Unknown metadata or expired URLs are skipped. Filtering can take longer.
            </p>
            <div className="il-playlist-actions">
              <button
                type="button"
                className="il-playlist-paste"
                onClick={() => void startCollection()}
                disabled={
                  liveLocked ||
                  collectBusy ||
                  collector?.phase === "running" ||
                  searchKeyword.trim().length < 2 ||
                  !Number.isInteger(searchCount) ||
                  searchCount < 0
                }
              >
                {collector?.phase === "running" ? (
                  <LoaderCircle className="il-spin" size={17} />
                ) : (
                  <Search size={17} />
                )}
                {collector?.phase === "running"
                  ? "Collecting from Instagram…"
                  : searchCount === 0
                    ? "Find videos (unlimited)"
                    : "Find videos automatically"}
              </button>
              <button
                type="button"
                className="il-secondary-btn"
                onClick={() => void stopCollection()}
                disabled={collector?.phase !== "running"}
              >
                Stop collecting
              </button>
              <button
                type="button"
                className="il-secondary-btn"
                title="Launch Chrome with remote debugging on port 9222"
                disabled={
                  liveLocked || collectBusy || collector?.phase === "running"
                }
                onClick={() => void launchChrome()}
              >
                <ExternalLink size={16} /> Launch Chrome (port 9222)
              </button>
            </div>
            {collector && collector.phase !== "idle" && (
              <div className="il-collector-progress" role="status">
                <div>
                  <b>
                    {collector.requested > 0
                      ? `${collector.found} / ${collector.requested} videos found`
                      : `${collector.found} videos found (unlimited mode)`}
                  </b>
                  <span>
                    {collector.phase} · {collector.visited} scroll passes
                    {collector.minFps || (collector.minResolution && collector.minResolution !== "any")
                      ? ` · ${collector.checked ?? 0} inspected · ${collector.rejected ?? 0} skipped`
                      : ""}
                  </span>
                </div>
                <progress
                  value={collector.found}
                  max={
                    collector.requested > 0
                      ? collector.requested
                      : Math.max(100, collector.found + 20)
                  }
                />
                {collector.note && <p>{collector.note}</p>}
                {collector.error && (
                  <div className="il-collector-error">
                    <p>{collector.error}</p>
                    {collector.error.includes("Chrome") && (
                      <button
                        type="button"
                        className="il-secondary-btn"
                        style={{ marginTop: "8px" }}
                        onClick={() => void launchChrome()}
                      >
                        <ExternalLink size={14} /> Open Chrome (port 9222)
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <p className="il-hint">
              Uses only your signed-in private Chrome session and visible
              Instagram Search results. Results depend on what Instagram loads;
              the requested count is not guaranteed. No login or CAPTCHA bypass.
            </p>
            {liveDirect && (
              <p className="il-hint">
                <b>The current live keeps playing while you search.</b> Once new
                videos are collected, click Replace live playlist in Live
                Control to switch. Switching reconnects the encoder briefly.
              </p>
            )}
          </div>
        ) : (
          <div className="il-android-tip" role="note">
            <Video size={19} />
            <div>
              <b>Termux · Direct video mode</b>
              <p>
                Paste a supported Instagram/Meta CDN HTTPS MP4 URL below, or
                import a JSON file containing <code>directVideoUrls</code>. You
                can prepare the playlist on a desktop and transfer the JSON to
                your phone.
              </p>
            </div>
          </div>
        )}
        <div>
          <label className="il-label" htmlFor="il-media-url">
            Direct video URL
          </label>
          <div className="il-url-input">
            <Link2 size={17} />
            <input
              id="il-media-url"
              type="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://instagram...fbcdn.net/...mp4?..."
              value={url}
              onChange={(event) => {
                const value = event.target.value;
                setUrl(value);
                setResult(null);
                setError("");
                setCopied(false);
                if (!imported.includes(value)) {
                  setImported([]);
                  onMediaUrlsChange(value.trim() ? [value.trim()] : []);
                }
              }}
              disabled={busy || liveLocked}
            />
          </div>
        </div>
        <label className="il-probe-upload">
          <Upload size={17} />
          <span>Import MP4 playlist JSON</span>
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy || liveLocked}
            onChange={(event) => {
              void importJson(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {imported.length > 0 && (
          <button type="button" className="il-media-copy" onClick={exportJson}>
            <Upload size={15} /> Download collected JSON ({imported.length})
          </button>
        )}
        {imported.length > 0 && (
          <div>
            <label className="il-label" htmlFor="il-imported-video">
              Collected video URLs · {imported.length}
            </label>
            <select
              id="il-imported-video"
              value={imported.includes(url) ? url : ""}
              disabled={busy || liveLocked}
              onChange={(event) => {
                setUrl(event.target.value);
                setResult(null);
                setError("");
                setCopied(false);
              }}
            >
              <option value="">Choose a collected video</option>
              {imported.map((item, index) => (
                <option key={index} value={item}>
                  {index + 1}. {safeUrlLabel(item)}
                </option>
              ))}
            </select>
            <p className="il-hint">
              This dropdown chooses just the clip to <b>test</b>. Direct
              livestream mode plays <b>all {imported.length} imported clips</b>{" "}
              in JSON order.
            </p>
          </div>
        )}
        <label className="il-option">
          <input
            type="checkbox"
            checked={directActive}
            disabled={
              liveLocked ||
              liveDirect ||
              (!browserCollectorAvailable && directActive)
            }
            onChange={(event) => onDirectActiveChange(event.target.checked)}
          />
          <span>
            <b>Use these MP4 links as YouTube Live source</b>
            <small>
              {directActive
                ? "Direct FFmpeg playlist mode ON — Start livestream will stream these MP4s, NOT the VNC browser."
                : browserCollectorAvailable
                  ? "OFF — Start livestream still captures the Chrome/VNC screen."
                  : "Enable this to convert an older Browser-mode channel to Android Direct MP4 mode."}
            </small>
          </span>
        </label>
        {directActive && (
          <p className="il-hint">
            <b>{imported.length || (url.trim() ? 1 : 0)} MP4(s) ready.</b>{" "}
            {liveDirect
              ? "These are your proposed next clips. The active stream is unchanged until you click Replace live playlist."
              : "Import a fresh JSON playlist before starting."}{" "}
            Signed links can expire; for best reliability use clips with
            consistent video and audio tracks.
          </p>
        )}
        {importWarning && (
          <p className="il-hint" role="status">
            {importWarning}
          </p>
        )}
        {url && (
          <button
            type="button"
            className="il-media-copy"
            disabled={busy}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                setError(
                  "Could not copy the link. Select the URL in the field and copy it manually.",
                );
              }
            }}
          >
            <Copy size={15} />
            {copied
              ? "Exact signed URL copied"
              : "Copy exact selected URL for terminal comparison"}
          </button>
        )}
      </div>
      <div className="il-playlist-actions il-probe-actions">
        <button
          type="button"
          className="il-secondary-btn"
          disabled={busy || !url.trim()}
          onClick={() => probe(false)}
        >
          {busy ? (
            <LoaderCircle className="il-spin" size={17} />
          ) : (
            <Video size={17} />
          )}{" "}
          Check media
        </button>
        <button
          type="button"
          className="il-playlist-paste"
          disabled={busy || !url.trim()}
          onClick={() => probe(true)}
        >
          {busy ? (
            <LoaderCircle className="il-spin" size={16} />
          ) : (
            <FlaskConical size={16} />
          )}{" "}
          Test 4s encoding
        </button>
      </div>
      {error && (
        <p className="il-probe-result il-probe-fail" role="alert">
          <CircleAlert size={17} />
          {error}
        </p>
      )}
      {result && (
        <div className="il-probe-result il-probe-success" role="status">
          <CheckCircle2 size={19} />
          <div>
            <b>
              {result.encoded
                ? "Direct FFmpeg encoding worked!"
                : "FFprobe can read this media!"}
            </b>
            <span>
              Video: {result.video.codec} · {result.video.width || "?"}×
              {result.video.height || "?"} · {result.video.fps ?? "?"} FPS ·{" "}
              {result.durationSeconds ?? "?"}s
            </span>
            <span>
              Audio:{" "}
              {result.audio
                ? `${result.audio.codec}, ${result.audio.channels ?? "?"} channel(s)`
                : "No audio track (silent audio will be needed)"}
            </span>
          </div>
        </div>
      )}
      <p className="il-hint">
        If the terminal works but this probe returns 404, copy the exact URL and
        test it with <code>ffprobe</code>. Only supported HTTPS media hosts are
        accepted; signed links may expire. Imports stay in browser memory, not
        the channel database. Stream only content you have permission to
        rebroadcast.
      </p>
    </section>
  );
}

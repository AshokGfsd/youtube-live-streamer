import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { StreamManager } from '../src/stream-manager.js';

const sample = { fileName: '11aa22bb-33cc-44dd-55ee-66ff77889900.mp4', originalName: 'sample.mp4', sizeBytes: 1000, durationSeconds: 10, hasAudio: true };

function fakeSpawner(processes) {
  return (_bin, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
    processes.push({ child, args });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
}

test('builds a looping RTMPS broadcast and stop preserves the video', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-test-'));
  const processes = [];
  try {
    const manager = new StreamManager({ dataDir: dir, streamKey: 'test-secret', rtmpsUrl: 'rtmps://test.youtube.com/live2/', spawnProcess: fakeSpawner(processes) });
    await manager.initialize();
    await fs.writeFile(path.join(dir, 'uploads', sample.fileName), 'video');
    await manager.setVideo(sample);
    await manager.start(true);
    assert.equal(processes.length, 1);
    assert.ok(processes[0].args.includes('-stream_loop'));
    assert.equal(processes[0].args.at(-1), 'rtmps://test.youtube.com/live2/test-secret');
    assert.equal(manager.getStatus().hasStreamKey, true);
    await manager.stop();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(manager.getStatus().desiredRunning, false);
    assert.equal(manager.getStatus().video.name, sample.originalName);
    assert.equal(manager.getStatus().logs.some((item) => item.message.includes('test-secret')), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('restores a previously requested stream after API restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-test-'));
  const processes = [];
  try {
    await fs.mkdir(path.join(dir, 'uploads'));
    await fs.writeFile(path.join(dir, 'uploads', sample.fileName), 'video');
    await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({ video: sample, desiredRunning: true, loop: true, startedAt: new Date().toISOString() }));
    const manager = new StreamManager({ dataDir: dir, streamKey: 'a-stream-key', rtmpsUrl: 'rtmps://test.youtube.com/live2', spawnProcess: fakeSpawner(processes) });
    await manager.initialize();
    assert.equal(processes.length, 1);
    assert.equal(manager.getStatus().desiredRunning, true);
    manager.shutdown();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('adds a silent audio track when the source video has no sound', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-test-'));
  try {
    const manager = new StreamManager({ dataDir: dir, streamKey: 'secret', rtmpsUrl: 'rtmps://example.test/live' });
    manager.state.video = { ...sample, hasAudio: false };
    const args = manager.buildArguments();
    assert.ok(args.some((value) => value.startsWith('anullsrc=')));
    assert.ok(args.includes('1:a:0'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

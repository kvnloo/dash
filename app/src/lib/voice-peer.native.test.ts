import { describe, expect, mock, test } from "bun:test";

// Exercise the Android implementation without opening real audio hardware.
class FakeTrack {
  enabled = true;
  stops = 0;
  stop(): void { this.stops++; }
}
class FakeStream {
  readonly audio = [new FakeTrack(), new FakeTrack()];
  readonly other = new FakeTrack();
  releases = 0;
  getAudioTracks(): FakeTrack[] { return this.audio; }
  getTracks(): FakeTrack[] { return [...this.audio, this.other]; }
  release(): void { this.releases++; }
}
class FakeChannel {
  readyState = "open";
  bufferedAmount = 0;
  closes = 0;
  readonly sent: string[] = [];
  addEventListener(_type: string, _handler: (...args: unknown[]) => void): void {}
  send(value: string): void { this.sent.push(value); }
  close(): void { this.closes++; this.readyState = "closed"; }
}
class FakeConnection {
  connectionState = "connecting";
  localDescription: { sdp: string } | null = null;
  readonly channel = new FakeChannel();
  readonly added: FakeTrack[] = [];
  closes = 0;
  addTrack(track: FakeTrack, _stream: FakeStream): void { this.added.push(track); }
  createDataChannel(_label: string): FakeChannel { return this.channel; }
  addEventListener(_type: string, _handler: (...args: unknown[]) => void): void {}
  async createOffer(): Promise<{ sdp: string }> { return { sdp: "v=0\r\n" }; }
  async setLocalDescription(value: { sdp: string }): Promise<void> { this.localDescription = value; }
  async setRemoteDescription(_value: { sdp: string }): Promise<void> {}
  close(): void { this.closes++; this.connectionState = "closed"; }
}

const streams: FakeStream[] = [];
const connections: FakeConnection[] = [];
let permission = "granted";
let mediaFails = false;
mock.module("expo-constants", () => ({
  default: { executionEnvironment: "bare" },
  ExecutionEnvironment: { StoreClient: "storeClient" },
}));
mock.module("react-native", () => ({
  Platform: { OS: "android" },
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: "android.permission.RECORD_AUDIO" },
    RESULTS: { GRANTED: "granted" },
    request: async () => permission,
  },
}));
mock.module("react-native-webrtc", () => ({
  RTCPeerConnection: class extends FakeConnection {
    constructor() { super(); connections.push(this); }
  },
  mediaDevices: {
    getUserMedia: async () => {
      if (mediaFails) throw new Error("Mic unavailable");
      const stream = new FakeStream(); streams.push(stream); return stream;
    },
  },
}));

const { createVoicePeer } = await import("./voice-peer.native");
// Pass react-native explicitly: another test file may already own the process-wide module mock.
const host = {
  Platform: { OS: "android" },
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: "android.permission.RECORD_AUDIO" },
    RESULTS: { GRANTED: "granted" },
    request: async () => permission,
  },
} as unknown as import("./voice-peer.native").VoicePeerHost;

describe("Android realtime peer teardown", () => {
  test("End disables and stops every local track and closes channel, peer and stream once", async () => {
    const peer = await createVoicePeer(() => {}, () => {}, () => {}, host);
    const stream = streams.at(-1);
    const connection = connections.at(-1);
    expect(stream).toBeDefined();
    expect(connection).toBeDefined();
    expect(connection?.added).toHaveLength(2);
    expect(stream?.audio.every(track => !track.enabled)).toBe(true);
    peer.mute(false);
    expect(stream?.audio.every(track => track.enabled)).toBe(true);
    peer.close();
    expect(stream?.getTracks().every(track => !track.enabled && track.stops === 1)).toBe(true);
    expect(stream?.releases).toBe(1);
    expect(connection?.channel.closes).toBe(1);
    expect(connection?.closes).toBe(1);
    peer.close();
    peer.mute(false);
    peer.send({ type: "session.update" });
    expect(stream?.getTracks().every(track => !track.enabled && track.stops === 1)).toBe(true);
    expect(stream?.releases).toBe(1);
    expect(connection?.channel.closes).toBe(1);
    expect(connection?.closes).toBe(1);
    expect(connection?.channel.sent).toHaveLength(0);
  });

  test("a new call after End acquires a distinct peer and microphone stream", async () => {
    const first = await createVoicePeer(() => {}, () => {}, () => {}, host);
    const oldStream = streams.at(-1);
    const oldConnection = connections.at(-1);
    first.close();
    const next = await createVoicePeer(() => {}, () => {}, () => {}, host);
    const newStream = streams.at(-1);
    const newConnection = connections.at(-1);
    expect(newStream).not.toBe(oldStream);
    expect(newConnection).not.toBe(oldConnection);
    expect(newStream?.audio.every(track => !track.enabled && track.stops === 0)).toBe(true);
    expect((await next.offer()).startsWith("v=0")).toBe(true);
    await next.answer("v=0\r\n");
    next.close();
    expect(oldStream?.releases).toBe(1);
    expect(newStream?.releases).toBe(1);
    expect(newStream?.getTracks().every(track => track.stops === 1)).toBe(true);
  });

  test("a failed microphone acquisition closes its peer and allows retry", async () => {
    mediaFails = true;
    const before = connections.length;
    try {
      await expect(createVoicePeer(() => {}, () => {}, () => {}, host)).rejects.toThrow("Mic unavailable");
      expect(connections.length).toBe(before + 1);
      expect(connections.at(-1)?.closes).toBe(1);
    } finally { mediaFails = false; }
    const next = await createVoicePeer(() => {}, () => {}, () => {}, host);
    next.close();
    expect(streams.at(-1)?.releases).toBe(1);
  });

  test("denied microphone permission cannot allocate a peer", async () => {
    const before = connections.length;
    permission = "denied";
    try {
      await expect(createVoicePeer(() => {}, () => {}, () => {}, host)).rejects.toThrow("Microphone permission denied.");
      expect(connections.length).toBe(before);
    } finally { permission = "granted"; }
  });
});

# Jamulus Web client

Join a Jamulus session from the browser. An Angular front end talks to a Node
bridge over WebSocket; the bridge speaks the Jamulus UDP protocol to the server
and streams audio for you. Microphone is **push-to-talk** (hold the button or
the space bar).

```
Browser (Angular)  ⇄  WebSocket  ⇄  Node bridge  ⇄  UDP  ⇄  Jamulus server
```

## ⚠️ Requirement: Jamulus 3.12.5+ with raw audio

Browsers cannot speak Jamulus's UDP protocol or its **custom, non-standard Opus**
codec, so the bridge avoids the codec by using Jamulus's **raw (uncompressed)
audio** mode instead of decoding/encoding Opus.

Raw audio is a **new feature** (upstream changelog: "Added uncompressed audio
transmission", PR #3653, released in **3.12.5 / 4.0.0**). It is **not present**
in older releases — for example 3.9.0, 3.10.0 and 3.11.0 do not define
`PROTMESSID_RAWAUDIO_SUPPORTED` at all.

Therefore the server must be:

- **Jamulus 3.12.5 or newer** (or the 4.0.0 pre-release), and
- **not** started with `--noraw` (raw audio is on by default).

If the server does not offer raw audio, the bridge detects this within ~1.5 s and
reports a clear error instead of sending unusable audio.

## Getting started

```bash
npm install

# 1. Point the bridge at your server (see .env)
#    SERVER_ADDRESS=host:22124  (default port 22124)

# 2. Start the bridge (HTTP + WebSocket on :8080)
npm run dev:server

# 3. Start the web app (dev server on :4200, proxies /ws to the bridge)
npm run dev:web
```

Then open <http://localhost:4200/>, choose **Join session**, allow the microphone
and hold **Push to talk**.

For a production build, build the web app first; the bridge serves
`apps/web/dist/web/browser` automatically and an Angular dev server is not
needed:

```bash
npm run build          # builds all workspaces
npm start              # starts the bridge on :8080, serving the built app
```

> Microphone access requires a **secure context** — `https://` or `localhost`.
> Accessing the dev server over a plain-http LAN IP will block `getUserMedia`.

## Configuration (`.env`)

| Variable         | Default      | Purpose                                            |
| ---------------- | ------------ | -------------------------------------------------- |
| `SERVER_ADDRESS` | jamulus.app  | Jamulus `host:port` to connect to (port 22124)     |
| `HTTP_PORT`      | `8080`       | Bridge HTTP/WebSocket port                          |
| `WS_PATH`        | `/ws`        | WebSocket path                                      |
| `CLIENT_NAME`    | `Web Client` | Default display name                                |
| `JITTER_BLOCKS`  | `3`          | Jitter buffer (blocks) requested from the server    |
| `MAX_SESSIONS`   | `8`          | Maximum concurrent Jamulus channels                 |
| `SPIN_NS`        | `500000`     | Frame-clock busy-spin window in nanoseconds         |
| `FRAME_SAMPLES`  | `128`        | Audio frame size (128 = standard OPUS / 375 pps)    |
| `CHANNELS`       | `1`          | Audio channels per session (1 = mono)               |

Environment variables override `.env`.

## Project layout

| Path                 | Contents                                                        |
| -------------------- | --------------------------------------------------------------- |
| `packages/protocol`  | Clean-room TypeScript Jamulus protocol: framing, CRC, codecs     |
| `apps/server`        | UDP client, frame clock, session manager, Fastify + `ws` bridge  |
| `apps/web`           | Angular 20 app (signals, SCSS, AudioWorklet capture/playback)    |
| `scripts/`           | Diagnostics: `spike`, `probe`, `diag`, `lanScan`, `wsSmoke`      |

## Diagnostics

These helped enormously while bringing the protocol up; they are kept because
they make network problems quick to diagnose.

```bash
# Join a server and record the downlink mix to spike-output.wav
node scripts/spike.ts 8 host:22124

# Connection-less ping probe (checks UDP reachability + our framing/CRC)
node scripts/probe.ts host:22124

# DNS + IPv4/IPv6 diagnostics for one host
node scripts/diag.ts host 22124

# Find Jamulus servers on the local network
node scripts/lanScan.ts 192.168.0 22124

# Drive the WebSocket bridge without a browser
node scripts/wsSmoke.ts ws://127.0.0.1:8080/ws 6
```

## Troubleshooting

| Symptom                                   | Likely cause                                                       |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `no reply` from a ping                    | Server down, wrong port, firewall, or no NAT port-forward (UDP)     |
| Public hostname unreachable from your LAN | Many routers do not support NAT loopback — use the LAN address      |
| "does not offer raw audio"                 | Server older than 3.12.5, or started with `--noraw`                |
| "Microphone unavailable"                   | Not a secure context (needs HTTPS or `localhost`)                   |
| Audio plays but sounds wrong               | Bridge connected to a server without raw audio support             |

## Tests

```bash
npm test --workspace @jamulus-web/protocol
```

The protocol tests cover framing, CRC (verified against the CRC-16/CCITT-FALSE
vector), split-message reassembly and the message codecs.

## Licensing

The protocol package is a clean-room implementation written from the published
protocol documentation; it does **not** link or copy Jamulus C++ sources. Jamulus
itself is AGPL-3.0 — if you ever compile its codec into this project, the AGPL
network provisions apply.

## Status and roadmap

Working: protocol layer, UDP session, handshake, raw-PCM streaming, precise
375 pps frame clock, WebSocket bridge, Angular UI and AudioWorklet pipeline.

Not yet done: end-to-end verification against a raw-enabled server; the custom
Opus path for compatibility with released servers (see above); per-user
faders/pan; text chat.


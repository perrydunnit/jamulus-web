# Publishing the web client at jamulus.perry.party

## The one thing that changes your requirement

You asked for the site on **port 80**. Traefik can serve it there, but the app
will not work that way: `navigator.mediaDevices.getUserMedia` — microphone
capture — only exists in a **secure context**. On plain `http://` the browser
either hides `mediaDevices` entirely or rejects the request, so nobody could
ever connect a mic.

So the stack below defines *two* routers on `jamulus.perry.party`:

| Router | Entrypoint | Behaviour |
| --- | --- | --- |
| `jamulus-web-secure` | `websecure` (443) | Serves the app, TLS via `letsencrypt` |
| `jamulus-web` | `web` (80) | Redirects to HTTPS |

Port 80 is still what users type, and it still lands on your container — it just
bounces to HTTPS first. That is the only way the microphone part works.

## Why the build comes from GitHub

The compose file uses a **git URL as the build context**:

```yaml
build:
  context: https://github.com/perrydunnit/jamulus-web.git#master
  dockerfile: deploy/web/Dockerfile
```

Docker BuildKit clones the repo itself during the build, which sidesteps a real
problem: `/opt/stacks` is root-owned and `perry` is not in the `docker` group,
so copying source onto the host means `scp` + `sudo` on every change. With a git
context you never touch the host filesystem — push, then Deploy.

Requirements: **the repo must be public**, or BuildKit needs git credentials.
`perrydunnit/jamulus-web` is public, so this works as written. Two details worth
knowing:

- The branch is **`master`**, not `main`. If you rename it, update the fragment
  after `#` or drop the ref entirely to follow the default branch.
- On Deckge's first build this clones and compiles Angular, so it takes a
  couple of minutes.

**Alternative if you'd rather not depend on GitHub being up:** clone or copy the
repo to `/opt/stacks/jamulus-web/repo` and change the context to `./repo`. That
needs `ssh -t wurk` for `sudo`, because the stack directory is root-owned.

## Deploy in Dockge

1. Create a new stack named **`jamulus-web`**.
2. Paste the contents of `compose.yaml`.
3. Save, then Deploy. The first build compiles the Angular app, so expect a
   couple of minutes; later deploys reuse the cached dependency layer.
4. Watch the log for `Jamulus bridge ready — target 192.168.0.39:22124`.

## Updating after a push

Because the image is built from git, `docker compose up -d` on its own will
**not** pick up your changes: the image already exists locally, and Compose only
builds when an image is missing. Force a rebuild:

```bash
ssh -t wurk 'sudo docker compose -f /opt/stacks/jamulus-web/compose.yaml up -d --build'
```

The `-t` matters: without a TTY, `sudo` refuses to read the password. The
`pull_policy: build` and `image:` keys in compose.yaml are there so Compose
builds rather than trying to pull a local-only image — that also makes Dockge's
Update button behave. After a push the sequence is: push, rebuild, check
`/health`.

## Verify

DNS and port forwarding need nothing new: `jamulus.perry.party` already resolves
and 80/443 already reach this host for the other subdomains.

```bash
curl -sI http://jamulus.perry.party     # expect a redirect to https://
curl -s  https://jamulus.perry.party/health
```

Then open `https://jamulus.perry.party` and connect — the browser should prompt
for the microphone. If it does not prompt, you are on `http://`.

## How the pieces fit

```
browser --wss--> Traefik --http--> jamulus-web --udp--> jamulus (22124)
                          (media_default)          (published on the host)
```

- The bridge reaches the Jamulus server over the host's published UDP port
  (`192.168.0.39:22124`), deliberately: it avoids depending on the name of the
  `jamulus` stack's network, so the two stacks stay independent. If you later
  want a direct container-to-container path, join the Jamulus network and use
  `SERVER_ADDRESS: "jamulus:22124"`.
- **Native Jamulus clients are unaffected.** The musician's desktop client still
  connects straight to UDP 22124; web users arrive over WebSocket and appear as
  ordinary channels.
- **Channel budget:** each browser session occupies one channel, and the server
  runs `--numchannels 16`. Web sessions count against that total alongside native
  clients.
- The frontend connects to the relative path `/ws`, so it resolves against the
  page origin — `wss://jamulus.perry.party/ws` with no rebuild. Traefik upgrades
  WebSockets transparently, so no extra label is needed.

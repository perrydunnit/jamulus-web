# Upgrading the Jamulus server so raw audio works

## Short answer to "can I update it from Dockge?"

No. Two independent reasons:

1. **The image you're running is frozen.** `grundic/jamulus` on Docker Hub has
   only 11 tags and the newest is `3.9.0`, last pushed **2022-08-13**. `latest`
   points at that same 3.9.0 digest. Dockge's *Update* button re-pulls `latest`,
   which is already what you have.
2. **Even a current release wouldn't be enough.** Uncompressed audio
   transmission ([#3653](https://github.com/jamulussoftware/jamulus/pull/3653))
   is **not in any stable release**. It only exists in the 4.0.0 pre-releases
   (4.0.0beta1 / beta2 / beta3). Stable 3.12.5 has no `FS_RAW_AUDIO` feature
   bit at all.

So the server has to be built from a 4.0.0 beta, which is what the `Dockerfile`
here does.

## Getting the files onto the host

Dockge's stack editor only manages two files per stack: `compose.yaml` and
`.env`. There is no file browser for anything else, so a `Dockerfile` cannot be
added through the UI. That leaves two routes.

### Route A - no SSH at all (`compose.inline.yaml`)

If your Docker Compose is **v2.24.0 or newer**, the whole image definition can
live inside `compose.yaml` via `dockerfile_inline`. Nothing needs to be copied
to the host.

Check the version first. Open Dockge's **Console** page (`/console`) and run:

```bash
docker compose version
```

If it is 2.24.0+, open the `jamulus` stack, paste the contents of
`compose.inline.yaml` over the existing `compose.yaml`, **Save**, then
**Deploy**. Done - skip the rest of this section.

> Verified on `wurk`: **Docker Compose v2.40.3**, so Route A is available. The
> previous `compose.yaml` is kept in `compose.old.yaml` as a restore point.
> Your old file also carried `version: "3.7"`, which Compose v2 flags as
> obsolete; the new file omits it.

### Route B - SSH, for older Compose versions

> On `wurk` the user `perry` is **not** in the `docker` group (the API socket
> returns *permission denied*), so prefix every `docker` and `docker build`
> command below with `sudo`.

**1. Find the stack directory.** Ask Docker rather than guessing, because
`DOCKGE_STACKS_DIR` is configurable and the default varies by image:

```bash
docker inspect jamulus \
  --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'
```

That prints the absolute path, typically something like `/opt/stacks/jamulus`.
Cross-check against where Dockge thinks its stacks live:

```bash
docker inspect dockge \
  --format '{{range .Mounts}}{{.Source}} => {{.Destination}}{{"\n"}}{{end}}'
```

**2. Copy the two files there.** From this repo on your machine:

```bash
STACK=$(ssh you@host 'docker inspect jamulus \
  --format "{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}"')

scp deploy/jamulus/Dockerfile    you@host:"$STACK/"
scp deploy/jamulus/compose.yaml  you@host:"$STACK/"
```

The stack directory is normally root-owned, so if `scp` fails with *permission
denied*, push through `tee` instead:

```bash
ssh you@host "sudo tee $STACK/Dockerfile >/dev/null" < deploy/jamulus/Dockerfile
```

**3. Deploy.** Back in Dockge the file list will not show the new Dockerfile,
but the `jamulus` service will now have a `build:` section. **Save** then
**Deploy** - the build downloads the `.deb` and installs Qt5 dependencies, so
give it a minute and watch the log.

### Optional: pre-build on the host

If you would rather not let Dockge build, build the image by hand and drop the
`build:` section, leaving only `image: jamulus-raw:4.0.0beta3`:

```bash
cd "$STACK" && docker build -t jamulus-raw:4.0.0beta3 .
```

## Verify it took effect

From the container, confirm the version and that raw audio is advertised:

```bash
docker exec jamulus jamulus-headless --version
```

Then from this repo, against the server's LAN address:

```bash
node scripts/spike.ts 8 192.168.0.39:22124
```

You want `RAWAUDIO_SUPPORTED` in the feature list. If you don't see it, check
the entrypoint has not picked up `--noraw`.

## Troubleshooting

**`exec: "Jamulus": executable file not found in $PATH`** — the headless package
installs the binary as `jamulus-headless`, not `Jamulus`
(upstream `linux/debian/jamulus-headless.install`). Both the image `ENTRYPOINT`
and the compose `entrypoint:` list name that binary, and the compose list
overrides the image, so fixing only one of them is not enough.

**Dockge's `Update` fails with `pull access denied for jamulus-raw`** — `Update`
runs `docker compose pull` before recreating, and `jamulus-raw` exists only
locally. Use **Restart** to cycle this stack. If you want `Update` to work,
delete the `image:` line so Compose stops looking for a registry copy.

**`sudo` over SSH says a terminal is required** — Docker on this host needs
root, so interactive `sudo` needs a TTY: `ssh -t wurk 'sudo docker ps'`.

## Dockge rewrites compose.yaml on save

Before trusting comments in the Dockge-managed copy, know that Dockge parses the
YAML and writes it back through its own serialiser. It drops the leading `---`
and the comments above `services:`, and it renders the `dockerfile_inline` block
in folded style (`>`) with blank lines inserted between lines. That is a
faithful round-trip, not corruption: blank lines and extra-indented lines are
exactly what stops a folded scalar from collapsing newlines into spaces. Keep
the annotated copy in this directory as the source of truth.

## Things to be aware of

- **It's beta software on a live rehearsal room.** A 4.0.0beta3 server still
  serves 3.x clients over Opus, so the other musician connected right now won't
  be locked out — but they will be dropped for the duration of the restart, so
  pick your moment.
- **IPv6 is enabled by default in 4.0.** Docker maps IPv4 UDP for
  `22124:22124/udp`. Jamulus binds the IPv4 socket first, so this normally
  works; if clients suddenly can't reach the server, add `--noipv6` to the
  entrypoint as a diagnostic.
- **When 4.0.0 ships stable**, bump the two `ARG` defaults in the Dockerfile
  (and the `image:` tag) and re-deploy.
- **Alternative if you'd rather not run a beta:** the bridge would need a
  custom-Opus path (libopus built with `CUSTOM_MODES`) to interoperate with a
  released server. That's a larger piece of work than this upgrade.

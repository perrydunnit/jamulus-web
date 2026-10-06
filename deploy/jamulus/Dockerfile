# Jamulus server with uncompressed ("raw") audio transmission enabled.
#
# WHY THIS FILE EXISTS
# -------------------
# The web bridge in this repo sends 48 kHz / 16-bit PCM to the browser. A
# Jamulus server only accepts that if it advertises FS_RAW_AUDIO (feature bit 6,
# i.e. protocol message RAWAUDIO_SUPPORTED = 36). That capability comes from
# "Added uncompressed audio transmission" (#3653), which is:
#
#   * NOT present in any stable release -- 3.12.5 and older do not have it;
#   * only present in the 4.0.0 pre-releases (4.0.0beta1 / beta2 / beta3).
#
# The image this stack used before, `grundic/jamulus:latest`, is frozen at
# Jamulus 3.9.0 (Docker Hub tag last pushed 2022-08-13), so pressing "Update"
# in Dockge can never get you there.
#
# Built from the official Jamulus CI "headless" .deb. That package is built on
# Ubuntu 22.04, so the base image matches to keep the Qt5 ABI aligned.
#
# SERVER FLAGS THAT MATTER
# ------------------------
#   --noraw    DISABLES uncompressed audio. Never pass this here.
#   --noipv6   Only as a troubleshooting step: 4.0 enables IPv6 by default and
#              may bind an extra socket. Docker's IPv4 UDP mapping normally
#              still works, because Jamulus binds IPv4 first.
#
# To move to a newer build, change the two ARG defaults (or pass --build-arg).

FROM ubuntu:22.04

# r4_0_0beta3 is the GitHub *release tag*; 4.0.0beta3 is the *asset version*.
ARG JAMULUS_RELEASE=r4_0_0beta3
ARG JAMULUS_VERSION=4.0.0beta3
ARG JAMULUS_ARCH=amd64

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL -o /tmp/jamulus.deb \
      "https://github.com/jamulussoftware/jamulus/releases/download/${JAMULUS_RELEASE}/jamulus-headless_${JAMULUS_VERSION}_ubuntu_${JAMULUS_ARCH}.deb" \
 && apt-get install -y /tmp/jamulus.deb \
 && rm -f /tmp/jamulus.deb \
 && rm -rf /var/lib/apt/lists/*

EXPOSE 22124/udp

# The headless package installs /usr/bin/jamulus-headless, NOT "Jamulus".
# Upstream: linux/debian/jamulus-headless.install
ENTRYPOINT ["jamulus-headless"]

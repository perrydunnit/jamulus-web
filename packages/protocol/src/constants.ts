/**
 * Jamulus protocol constants.
 *
 * Values mirror the wire format documented in the Jamulus source
 * (`src/protocol.h`, `src/global.h`, `src/util.h`) and are part of the
 * interoperable protocol, so they must not be changed.
 *
 * This is a clean-room implementation based on the published protocol
 * documentation, not a port of the Jamulus C++ sources.
 */

/** Message IDs for messages that require an acknowledgement (ID < 1000). */
export const MessageId = {
  Illegal: 0,
  Ack: 1,
  JitBufSize: 10,
  ReqJitBufSize: 11,
  /** OLD, unused. */
  NetBlkSizeFactor: 12,
  ChannelGain: 13,
  /** OLD, unused. */
  ConnClientsListName: 14,
  /** OLD, unused. */
  ServerFull: 15,
  ReqConnClientsList: 16,
  /** OLD, unused. */
  ChannelName: 17,
  ChatText: 18,
  /** OLD, unused. */
  PingMs: 19,
  NetwTransportProps: 20,
  ReqNetwTransportProps: 21,
  /** OLD, unused. */
  Disconnection: 22,
  ReqChannelInfos: 23,
  ConnClientsList: 24,
  ChannelInfos: 25,
  OpusSupported: 26,
  LicenceRequired: 27,
  ReqChannelLevelList: 28,
  VersionAndOs: 29,
  ChannelPan: 30,
  MuteStateChanged: 31,
  ClientId: 32,
  RecorderState: 33,
  ReqSplitMessSupport: 34,
  SplitMessSupported: 35,
  RawAudioSupported: 36,
} as const;

/** Message IDs for connection-less messages (1000..1999). */
export const ConnectionLessMessageId = {
  PingMs: 1001,
  PingMsWithNumClients: 1002,
  ServerFull: 1003,
  RegisterServer: 1004,
  UnregisterServer: 1005,
  ServerList: 1006,
  ReqServerList: 1007,
  SendEmptyMessage: 1008,
  EmptyMessage: 1009,
  Disconnection: 1010,
  VersionAndOs: 1011,
  ReqVersionAndOs: 1012,
  ConnClientsList: 1013,
  ReqConnClientsList: 1014,
  ChannelLevelList: 1015,
  RegisterServerResp: 1016,
  RegisterServerEx: 1017,
  RedServerList: 1018,
  ServerFeatures: 1019,
  ReqServerFeatures: 1020,
  WelcomeMessage: 1021,
  ReqWelcomeMessage: 1022,
} as const;

/** Container ID used when a message body is split across several packets. */
export const SpecialSplitMessageId = 2001;

/** Audio compression types (wire values are fixed). */
export const AudioCodec = {
  None: 0,
  Celt: 1,
  Opus: 2,
  /** OPUS with 64-sample frame size. */
  Opus64: 3,
} as const;
export type AudioCodec = (typeof AudioCodec)[keyof typeof AudioCodec];

/** Network transport flags (wire values are fixed). */
export const NetwFlags = {
  None: 0,
  /** A one-byte packet counter is prefixed to each audio packet. */
  WithCounter: 1,
} as const;
export type NetwFlags = (typeof NetwFlags)[keyof typeof NetwFlags];

/** Preferred sound-card frame-size factors (in units of 64 samples). */
export const FrameSizeFactor = {
  /** 64 samples accumulated frame size. */
  Preferred: 1,
  /** 128 samples accumulated frame size. */
  Default: 2,
  /** 256 samples accumulated frame size. */
  Safe: 4,
} as const;

/** Sample rate used by the Jamulus audio stream. */
export const SystemSampleRateHz = 48000;
/** Base audio coder block size in samples. */
export const SystemFrameSizeSamples = 64;
/** Doubled block size used by the standard OPUS codec. */
export const DoubleSystemFrameSizeSamples = 128;

/** Header length in bytes: TAG(2) + ID(2) + cnt(1) + len(2). */
export const MessageHeaderLength = 7;
/** Total message length without the data body: header + CRC(2). */
export const MessageLengthWithoutData = MessageHeaderLength + 2;
/** Payload size of one split-message part. */
export const SplitPartSizeBytes = 550;
/** Maximum number of split-message parts. */
export const MaxSplitParts = Math.floor(20000 / SplitPartSizeBytes);

/** Minimum number of coded bytes accepted for the audio payload. */
export const CeltMinimumNumBytes = 10;
/** Maximum protocol buffer size accepted by the reference implementation. */
export const MaxSizeBytesNetwBuf = 20000;

/** Jitter buffer size bounds (in blocks). */
export const MinNetBufSizeNumBl = 1;
export const MaxNetBufSizeNumBl = 20;
/** Sentinel meaning "let the client pick automatically". */
export const AutoNetBufSizeForProtocol = 0;

/** Coded byte counts per OPUS frame (single 64-sample frame). */
export const OpusBytesMono = { low: 12, normal: 22, high: 36 } as const;
/** Coded byte counts per OPUS frame (double, 128-sample frame). */
export const OpusBytesMonoDouble = { low: 25, normal: 45, high: 82 } as const;
/** Coded byte counts per OPUS frame (stereo, single 64-sample frame). */
export const OpusBytesStereo = { low: 24, normal: 35, high: 73 } as const;
/** Coded byte counts per OPUS frame (stereo, double 128-sample frame). */
export const OpusBytesStereoDouble = { low: 47, normal: 71, high: 165 } as const;

/** Recorder states. */
export const RecorderState = {
  NotInitialised: 1,
  NotEnabled: 2,
  Recording: 3,
} as const;

/** Licence types. */
export const LicenceType = {
  NoLicence: 0,
  CreativeCommons: 1,
} as const;

/** Operating system identifiers sent in VERSION_AND_OS. */
export const OpSystemType = {
  Windows: 0,
  Mac: 1,
  Linux: 2,
  Android: 3,
  iOS: 4,
} as const;

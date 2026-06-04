/*    Lightweight EBML parser for MKV container files. */
/*    Extracts: Segment Info, Tracks, Cluster offsets. */
/*  */
/** Read an EBML Element ID from buffer.
 *  EBML IDs keep the leading marker bit(s) as part of the value.
 *  Returns { value: number, length: number } or null on error. */
function readEBMLId(dataView, offset) {
  if (offset >= dataView.byteLength) return null;
  var firstByte = dataView.getUint8(offset);
  if (firstByte === 0) return null;

  var length;
  if      (firstByte & 0x80) length = 1;
  else if (firstByte & 0x40) length = 2;
  else if (firstByte & 0x20) length = 3;
  else if (firstByte & 0x10) length = 4;
  else return null; // IDs longer than 4 bytes are unusual, skip

  if (offset + length > dataView.byteLength) return null;

  // Build ID as hex-integer — preserve ALL bits (including marker)
  var value = firstByte;
  for (var i = 1; i < length; i++) {
    value = (value * 256) + dataView.getUint8(offset + i);
  }
  return { value: value, length: length };
}

/** Read an EBML variable-length size (VINT) from buffer.
 *  The leading marker bit is stripped from the value.
 *  Returns { value: number, length: number } or null on error. */
function readVINT(dataView, offset) {
  if (offset >= dataView.byteLength) return null;
  var firstByte = dataView.getUint8(offset);
  if (firstByte === 0) return null;

  var length, mask;
  if      (firstByte & 0x80) { length = 1; mask = 0x7F; }
  else if (firstByte & 0x40) { length = 2; mask = 0x3F; }
  else if (firstByte & 0x20) { length = 3; mask = 0x1F; }
  else if (firstByte & 0x10) { length = 4; mask = 0x0F; }
  else if (firstByte & 0x08) { length = 5; mask = 0x07; }
  else if (firstByte & 0x04) { length = 6; mask = 0x03; }
  else if (firstByte & 0x02) { length = 7; mask = 0x01; }
  else if (firstByte & 0x01) { length = 8; mask = 0x00; }
  else return null;

  if (offset + length > dataView.byteLength) return null;

  var value = firstByte & mask;
  for (var i = 1; i < length; i++) {
    value = (value * 256) + dataView.getUint8(offset + i);
  }
  return { value: value, length: length };
}

/** Read an EBML element at the given offset.
 *  Returns { id, size, dataOffset, nextOffset } or null. */
function readEBMLElement(dataView, offset) {
  if (offset + 2 > dataView.byteLength) return null;
  // IDs use readEBMLId (keep marker bits); sizes use readVINT (strip marker)
  var idResult = readEBMLId(dataView, offset);
  if (!idResult) return null;
  var sizeResult = readVINT(dataView, offset + idResult.length);
  if (!sizeResult) return null;

  var dataOffset = offset + idResult.length + sizeResult.length;
  var elementSize = sizeResult.value;

  // Unknown/unbounded size sentinel values (all data bits = 1)
  // 1-byte: 0x7F, 2-byte: 0x3FFF, 4-byte: 0x0FFFFFFF, 8-byte: 0x00FFFFFFFFFFFFFF
  var isUnknown = (
    (sizeResult.length === 1 && elementSize === 0x7F) ||
    (sizeResult.length === 2 && elementSize === 0x3FFF) ||
    (sizeResult.length === 4 && elementSize === 0x0FFFFFFF) ||
    (sizeResult.length === 8 && elementSize >= 0x00FFFFFFFFFFFFFF)
  );
  if (isUnknown) {
    elementSize = dataView.byteLength - dataOffset;
  }

  var nextOffset = dataOffset + elementSize;
  if (nextOffset > dataView.byteLength) {
    // Clamp both nextOffset AND elementSize to prevent out-of-bounds reads
    elementSize = dataView.byteLength - dataOffset;
    nextOffset = dataView.byteLength;
  }

  return {
    id: idResult.value,
    size: elementSize,
    dataOffset: dataOffset,
    nextOffset: nextOffset
  };
}

/** Read a big-endian unsigned integer of given byte length from buffer.
 *  Returns 0 if read would exceed buffer bounds. */
function readUintBE(dataView, offset, byteLength) {
  if (offset + byteLength > dataView.byteLength) return 0;
  var value = 0;
  for (var i = 0; i < byteLength; i++) {
    value = (value * 256) + dataView.getUint8(offset + i);
  }
  return value;
}

/** Read a big-endian float from buffer (4 or 8 bytes).
 *  Returns 0 if read would exceed buffer bounds. */
function readFloatBE(dataView, offset, byteLength) {
  if (offset + byteLength > dataView.byteLength) return 0;
  if (byteLength === 4) return dataView.getFloat32(offset, false);
  if (byteLength === 8) return dataView.getFloat64(offset, false);
  return 0;
}

/** Parse an MKV file from ArrayBuffer.
 *  Returns { duration, timecodeScale, tracks, clusterOffsets }.
 *  Tolerates partial/truncated files — returns whatever was parsed so far. */
function parseMKV(arrayBuffer) {
  var view = new DataView(arrayBuffer);
  var result = {
    duration: 0,
    timecodeScale: 1000000, // default 1ms in nanoseconds
    tracks: [],
    clusterOffsets: []
  };

  try {
    var offset = 0;
    while (offset < view.byteLength - 8) {
      var el = readEBMLElement(view, offset);
      if (!el) break;

      switch (el.id) {
        case 0x1A45DFA3: // EBML header — skip contents
          break;

        case 0x18538067: // Segment (contains Info, Tracks, Clusters)
          parseSegmentContent(view, el.dataOffset, el.nextOffset, result);
          offset = el.nextOffset;
          continue;

        default:
          break;
      }
      offset = el.nextOffset;
    }
  } catch (e) {
    console.warn('[Prism MKV] Parse incomplete:', e.message);
  }
  return result;
}

/** Parse children of the Segment element */
function parseSegmentContent(view, startOffset, endOffset, result) {
  var offset = startOffset;
  while (offset < endOffset - 4) {
    var el = readEBMLElement(view, offset);
    if (!el || el.dataOffset > endOffset) break;
    // Safety: ensure we always make forward progress
    if (el.nextOffset <= offset) break;

    switch (el.id) {
      case 0x1549A966: // Info
        try { parseSegmentInfo(view, el.dataOffset, el.nextOffset, result); } catch(e) {}
        break;
      case 0x1654AE6B: // Tracks
        try { parseTracks(view, el.dataOffset, el.nextOffset, result); } catch(e) {}
        break;
      case 0x1F43B675: // Cluster
        result.clusterOffsets.push(offset);
        break;
    }
    offset = el.nextOffset;
  }
}

/** Parse Segment Info — extract Duration and TimecodeScale */
function parseSegmentInfo(view, startOffset, endOffset, result) {
  var offset = startOffset;
  while (offset < endOffset - 2) {
    var el = readEBMLElement(view, offset);
    if (!el || el.dataOffset > endOffset) break;

    switch (el.id) {
      case 0x2AD7B1: // TimecodeScale
        if (el.size <= 8) {
          result.timecodeScale = readUintBE(view, el.dataOffset, el.size);
        }
        break;
      case 0x4489: // Duration
        if (el.size === 4 || el.size === 8) {
          result.duration = readFloatBE(view, el.dataOffset, el.size);
        }
        break;
    }
    offset = el.nextOffset;
  }
}

/** Parse Tracks — extract video/audio/subtitle track info */
function parseTracks(view, startOffset, endOffset, result) {
  var offset = startOffset;
  while (offset < endOffset - 2) {
    var el = readEBMLElement(view, offset);
    if (!el || el.dataOffset > endOffset) break;

    if (el.id === 0xAE) { // TrackEntry
      var track = parseTrackEntry(view, el.dataOffset, el.nextOffset);
      if (track) result.tracks.push(track);
    }
    offset = el.nextOffset;
  }
}

/** Parse a single TrackEntry element */
function parseTrackEntry(view, startOffset, endOffset) {
  var track = {
    trackNumber: 0,
    trackUID: 0,
    trackType: 0,
    codecID: '',
    codecPrivate: null,
    defaultDuration: 0,
    video: { pixelWidth: 0, pixelHeight: 0 },
    audio: { samplingFrequency: 0, channels: 0, bitDepth: 0 }
  };

  var offset = startOffset;
  while (offset < endOffset - 2) {
    var el = readEBMLElement(view, offset);
    if (!el || el.dataOffset > endOffset) break;

    switch (el.id) {
      case 0xD7: // TrackNumber
        track.trackNumber = readUintBE(view, el.dataOffset, Math.min(el.size, 4));
        break;
      case 0x73C5: // TrackUID
        track.trackUID = readUintBE(view, el.dataOffset, Math.min(el.size, 8));
        break;
      case 0x83: // TrackType
        track.trackType = view.getUint8(el.dataOffset);
        break;
      case 0x86: // CodecID
        var codecBytes = [];
        for (var i = 0; i < el.size && i < 64; i++) {
          codecBytes.push(view.getUint8(el.dataOffset + i));
        }
        track.codecID = String.fromCharCode.apply(null, codecBytes);
        break;
      case 0x63A2: // CodecPrivate
        if (el.dataOffset + el.size <= view.byteLength) {
          track.codecPrivate = new Uint8Array(view.buffer, el.dataOffset, el.size);
        }
        break;
      case 0x23E383: // DefaultDuration
        track.defaultDuration = readUintBE(view, el.dataOffset, Math.min(el.size, 8));
        break;
      case 0xE0: // Video
        parseVideoSettings(view, el.dataOffset, el.nextOffset, track.video);
        break;
      case 0xE1: // Audio
        parseAudioSettings(view, el.dataOffset, el.nextOffset, track.audio);
        break;
    }
    offset = el.nextOffset;
  }
  return track;
}

/** Parse Video settings within a TrackEntry */
function parseVideoSettings(view, startOffset, endOffset, videoObj) {
  var offset = startOffset;
  while (offset < endOffset - 2) {
    var el = readEBMLElement(view, offset);
    if (!el || el.dataOffset > endOffset) break;
    switch (el.id) {
      case 0xB0: // PixelWidth
        videoObj.pixelWidth = readUintBE(view, el.dataOffset, Math.min(el.size, 4));
        break;
      case 0xBA: // PixelHeight
        videoObj.pixelHeight = readUintBE(view, el.dataOffset, Math.min(el.size, 4));
        break;
    }
    offset = el.nextOffset;
  }
}

/** Parse Audio settings within a TrackEntry */
function parseAudioSettings(view, startOffset, endOffset, audioObj) {
  var offset = startOffset;
  while (offset < endOffset - 2) {
    var el = readEBMLElement(view, offset);
    if (!el || el.dataOffset > endOffset) break;
    switch (el.id) {
      case 0xB5: // SamplingFrequency
        if (el.size <= 8) audioObj.samplingFrequency = readFloatBE(view, el.dataOffset, el.size);
        break;
      case 0x9F: // Channels
        audioObj.channels = readUintBE(view, el.dataOffset, Math.min(el.size, 4));
        break;
      case 0x6264: // BitDepth
        audioObj.bitDepth = readUintBE(view, el.dataOffset, Math.min(el.size, 2));
        break;
    }
    offset = el.nextOffset;
  }
}


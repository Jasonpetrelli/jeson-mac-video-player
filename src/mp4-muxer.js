/*    Minimal fMP4 (fragmented MP4) builder for MSE. */
/*    Builds Init Segment (ftyp + moov) and Media Segments (moof + mdat). */
/*  */
/** Write a 32-bit big-endian unsigned int to a Uint8Array at offset */
function mp4WriteU32(buf, offset, val) {
  buf[offset]     = (val >>> 24) & 0xFF;
  buf[offset + 1] = (val >>> 16) & 0xFF;
  buf[offset + 2] = (val >>> 8) & 0xFF;
  buf[offset + 3] = val & 0xFF;
}

/** Write ASCII string to Uint8Array at offset */
function mp4WriteStr(buf, offset, str) {
  for (var i = 0; i < str.length; i++) {
    buf[offset + i] = str.charCodeAt(i);
  }
}

/** Build an MP4 box: [size:4][type:4][payload] */
function mp4Box(type, payloads) {
  var totalPayload = 0;
  for (var i = 0; i < payloads.length; i++) {
    totalPayload += payloads[i].byteLength;
  }
  var size = 8 + totalPayload;
  var box = new Uint8Array(size);
  mp4WriteU32(box, 0, size);
  mp4WriteStr(box, 4, type);
  var off = 8;
  for (var i = 0; i < payloads.length; i++) {
    box.set(new Uint8Array(payloads[i]), off);
    off += payloads[i].byteLength;
  }
  return box;
}

/** Build full box: [size:4][type:4][version:1][flags:3][payload] */
function mp4FullBox(type, version, flags, payloads) {
  var allPayloads = [new Uint8Array([version, (flags >>> 16) & 0xFF, (flags >>> 8) & 0xFF, flags & 0xFF])];
  for (var i = 0; i < payloads.length; i++) {
    allPayloads.push(new Uint8Array(payloads[i]));
  }
  return mp4Box(type, allPayloads);
}

/** Build ftyp box */
function buildFtyp() {
  return mp4Box('ftyp', [
    new Uint8Array([
      0x69, 0x73, 0x6F, 0x6D, // major_brand: 'isom'
      0x00, 0x00, 0x02, 0x00, // minor_version: 512
      0x69, 0x73, 0x6F, 0x6D, // compatible: 'isom'
      0x69, 0x73, 0x6F, 0x32, // 'iso2'
      0x61, 0x76, 0x63, 0x31, // 'avc1'
      0x6D, 0x70, 0x34, 0x31  // 'mp41'
    ])
  ]);
}

/** Build mvhd box (version 1 — 64-bit times) */
function buildMvhd(timescale, duration) {
  var buf = new Uint8Array(8 + 4 + 8 + 8 + 4 + 8 + 4 + 2 + 10 + 36 + 24 + 4);
  // We use a simpler fixed-size approach
  var data = new ArrayBuffer(112);
  var view = new DataView(data);
  view.setUint32(0, 0); view.setUint32(4, 0); // creation_time (0 = unset)
  view.setUint32(8, 0); view.setUint32(12, 0); // modification_time
  view.setUint32(16, timescale); // timescale
  view.setUint32(20, 0); // duration upper 32 (value fits in 32 bits)
  view.setUint32(24, Math.floor(duration * timescale)); // duration lower 32
  view.setUint16(28, 0x0001); // rate = 1.0 (fixed-point 16.16)
  view.setUint16(30, 0x0100); // volume = 1.0 (fixed-point 8.8)
  // reserved 10 bytes at 32 (zero from init)
  // unity matrix at 42 (36 bytes)
  view.setUint32(42, 0x00010000); view.setUint32(46, 0);
  view.setUint32(50, 0); view.setUint32(54, 0);
  view.setUint32(58, 0x00010000); view.setUint32(62, 0);
  view.setUint32(66, 0); view.setUint32(70, 0);
  view.setUint32(74, 0x40000000);
  // pre_defined 24 bytes at 78 (zero from init)
  view.setUint32(102, 2); // next_track_ID

  return mp4FullBox('mvhd', 1, 0, [data]);
}

/** Build tkhd box */
function buildTkhd(trackId, duration, width, height) {
  var data = new ArrayBuffer(92);
  var view = new DataView(data);
  view.setUint32(0, 0); view.setUint32(4, 0); // creation_time (8 bytes)
  view.setUint32(8, 0); view.setUint32(12, 0); // modification_time (8 bytes)
  view.setUint32(16, trackId); // track_ID
  view.setUint32(20, 0); // reserved
  view.setUint32(24, 0); view.setUint32(28, Math.floor(duration)); // duration (8 bytes, v1)
  // reserved 8 bytes at 32 (zero from init)
  view.setUint16(40, 0); // layer
  view.setUint16(42, 0); // alternate_group
  view.setUint16(44, 0); // volume (0 for video)
  view.setUint16(46, 0); // reserved
  // unity matrix at 48 (36 bytes)
  view.setUint32(48, 0x00010000); view.setUint32(52, 0);
  view.setUint32(56, 0); view.setUint32(60, 0);
  view.setUint32(64, 0x00010000); view.setUint32(68, 0);
  view.setUint32(72, 0); view.setUint32(76, 0);
  view.setUint32(80, 0x40000000);
  view.setUint32(84, width << 16); // width (16.16 fixed)
  view.setUint32(88, height << 16); // height (16.16 fixed)

  // version=1: 8-byte creation/modification time, 8-byte duration
  return mp4FullBox('tkhd', 1, 0x000001, [data]);
}

/** Build mdhd box */
function buildMdhd(timescale, duration) {
  var data = new ArrayBuffer(20);
  var view = new DataView(data);
  view.setUint32(0, 0); // creation_time
  view.setUint32(4, 0); // modification_time
  view.setUint32(8, timescale);
  view.setUint32(12, Math.floor(duration));
  view.setUint16(16, 0x55C4); // language: undetermined
  view.setUint16(18, 0); // pre_defined
  return mp4FullBox('mdhd', 0, 0, [data]);
}

/** Build hdlr box */
function buildHdlr(handlerType, name) {
  var nameBytes = [];
  for (var i = 0; i < name.length; i++) nameBytes.push(name.charCodeAt(i));
  nameBytes.push(0); // null terminate
  var data = new ArrayBuffer(8 + nameBytes.length);
  var view = new DataView(data);
  view.setUint32(0, 0); // pre_defined
  var handlerBytes = [];
  for (var i = 0; i < 4; i++) handlerBytes.push(handlerType.charCodeAt(i));
  view.setUint8(4, handlerBytes[0]);
  view.setUint8(5, handlerBytes[1]);
  view.setUint8(6, handlerBytes[2]);
  view.setUint8(7, handlerBytes[3]);
  new Uint8Array(data).set(nameBytes, 8);
  return mp4FullBox('hdlr', 0, 0, [data]);
}

/** Build vmhd box (video media header) */
function buildVmhd() {
  return mp4FullBox('vmhd', 0, 1, [new ArrayBuffer(8)]);
}

/** Build smhd box (sound media header) */
function buildSmhd() {
  return mp4FullBox('smhd', 0, 0, [new ArrayBuffer(8)]);
}

/** Build dinf + dref boxes */
function buildDinf() {
  var urlBox = mp4FullBox('url ', 0, 1, []);
  var dref = mp4FullBox('dref', 0, 0, [
    new Uint8Array([0, 0, 0, 1]), // entry_count = 1
    urlBox
  ]);
  return mp4Box('dinf', [dref]);
}

/** Build stbl box (sample table) */
function buildStbl(videoEntry, audioEntry) {
  var entries = [];
  if (videoEntry) entries.push(videoEntry);
  if (audioEntry) entries.push(audioEntry);
  var entryCount = entries.length;
  var entryData = entries.length > 0 ? [].concat.apply([], entries) : [];
  var stsd = mp4FullBox('stsd', 0, 0, [new Uint8Array([0, 0, 0, 0])].concat(entryData));
  var stts = mp4FullBox('stts', 0, 0, [new Uint8Array([0, 0, 0, 0])]);
  var stsc = mp4FullBox('stsc', 0, 0, [new Uint8Array([0, 0, 0, 0])]);
  var stsz = mp4FullBox('stsz', 0, 0, [new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0])]);
  var stco = mp4FullBox('stco', 0, 0, [new Uint8Array([0, 0, 0, 0])]);
  return mp4Box('stbl', [stsd, stts, stsc, stsz, stco]);
}

/** Build trex box (track extends default for fMP4) */
function buildTrex(trackId) {
  var data = new ArrayBuffer(20);
  var view = new DataView(data);
  view.setUint32(0, trackId); // track_ID
  view.setUint32(4, 1); // default_sample_description_index
  view.setUint32(8, 0); // default_sample_duration
  view.setUint32(12, 0); // default_sample_size
  view.setUint32(16, 0); // default_sample_flags
  return mp4FullBox('trex', 0, 0, [data]);
}

/** Build a proper avc1 codec string from MKV CodecPrivate (AVCDecoderConfigurationRecord).
 *  MSE needs the actual SPS/PPS data to initialize the H.264 decoder.
 *  Falls back to hardcoded string if CodecPrivate is missing or malformed. */
function buildAVCCodecString(codecPrivate) {
  if (!codecPrivate || codecPrivate.length < 7) return 'avc1.640028';
  try {
    var d = codecPrivate;
    if (d[0] !== 1) return 'avc1.640028'; // configurationVersion must be 1
    var profile = d[1];
    var profileComp = d[2];
    var level = d[3];
    var lengthSize = (d[4] & 3) + 1;
    var numSPS = d[5] & 0x1F;
    var offset = 6;

    var spsList = [];
    for (var s = 0; s < numSPS && offset + 2 <= d.length; s++) {
      var spsLen = (d[offset] << 8) | d[offset + 1];
      offset += 2;
      if (offset + spsLen > d.length) break;
      // Escape Annex B: insert 0x03 after 0x0000xx sequences (AVC escaping rule)
      var escaped = [];
      var run = 0;
      for (var j = 0; j < spsLen; j++) {
        var b = d[offset + j];
        escaped.push(b);
        if (run >= 3 && b <= 3) {
          escaped.push(0x03);
          run = 0;
        } else if (b === 0) {
          run++;
        } else {
          run = 0;
        }
      }
      spsList.push(new Uint8Array(escaped));
      offset += spsLen;
    }
    if (spsList.length === 0) return 'avc1.640028';

    var numPPS = (offset < d.length) ? d[offset] : 0;
    offset++;
    var ppsList = [];
    for (var p = 0; p < numPPS && offset + 2 <= d.length; p++) {
      var ppsLen = (d[offset] << 8) | d[offset + 1];
      offset += 2;
      if (offset + ppsLen > d.length) break;
      var escaped = [];
      var run = 0;
      for (var j = 0; j < ppsLen; j++) {
        var b = d[offset + j];
        escaped.push(b);
        if (run >= 3 && b <= 3) {
          escaped.push(0x03);
          run = 0;
        } else if (b === 0) {
          run++;
        } else {
          run = 0;
        }
      }
      ppsList.push(new Uint8Array(escaped));
      offset += ppsLen;
    }
    if (ppsList.length === 0) return 'avc1.640028';

    // Build codec string: avc1.PPCCLL + SPS + PPS (hex-encoded)
    var hex = function(arr) {
      var s = '';
      for (var i = 0; i < arr.length; i++) {
        var h = arr[i].toString(16);
        s += (h.length < 2 ? '0' : '') + h;
      }
      return s;
    };
    var profileHex = profile.toString(16);
    var compHex = profileComp.toString(16);
    var levelHex = level.toString(16);
    var codecStr = 'avc1.' + (profileHex.length < 2 ? '0' : '') + profileHex
      + (compHex.length < 2 ? '0' : '') + compHex
      + (levelHex.length < 2 ? '0' : '') + levelHex;
    for (var s = 0; s < spsList.length; s++) codecStr += hex(spsList[s]);
    for (var p = 0; p < ppsList.length; p++) codecStr += hex(ppsList[p]);
    return codecStr;
  } catch (e) {
    return 'avc1.640028';
  }
}

/** Build HEVC codec string in PP.CC.LL format (no NAL data, no tier flag).
 *  NAL data goes into the hvcC box in the init segment, not the codec string. */
function buildHEVCCodecString(codecPrivate) {
  if (!codecPrivate || codecPrivate.length < 27) return 'hev1.1.6.L93.B0';
  try {
    var d = codecPrivate;
    if (d[0] !== 1) return 'hev1.1.6.L93.B0';
    var profileIdc = d[1] & 0x1F;
    var levelIdc = d[12];
    var compatibility = d[16];
    return 'hev1.' + profileIdc.toString(16) + '.' + compatibility.toString(16) + '.' + levelIdc.toString(16);
  } catch (e) {
    return 'hev1.1.6.L93.B0';
  }
}

/** Build hvcC (HEVCDecoderConfigurationRecord) box payload from MKV CodecPrivate.
 *  Provides VPS/SPS/PPS to MSE decoder via init segment stsd. */
function buildHEVCConfig(codecPrivate) {
  if (!codecPrivate || codecPrivate.length < 27) return null;
  try {
    var d = codecPrivate;
    if (d[0] !== 1) return null;
    var profileIdc = d[1] & 0x1F;
    var tierFlag = (d[1] >> 5) & 0x01;
    var generalLevelIdc = d[12];
    var numArrays = d[27];
    var offset = 28;
    var nalPayloads = [];
    for (var a = 0; a < numArrays && offset + 3 <= d.length; a++) {
      var nalType = d[offset] >> 1;
      offset++;
      var numNals = (d[offset] << 8) | d[offset + 1];
      offset += 2;
      var arrayHeader = new Uint8Array([(nalType << 1) | 0, (numNals >> 8) & 0xFF, numNals & 0xFF]);
      var nalData = [];
      for (var n = 0; n < numNals && offset + 2 <= d.length; n++) {
        var nalLen = (d[offset] << 8) | d[offset + 1];
        offset += 2;
        if (offset + nalLen > d.length) break;
        for (var j = 0; j < nalLen; j++) nalData.push(d[offset + j]);
        offset += nalLen;
      }
      if (nalData.length > 0) {
        var merged = new Uint8Array(arrayHeader.length + nalData.length);
        merged.set(arrayHeader, 0);
        merged.set(new Uint8Array(nalData), arrayHeader.length);
        nalPayloads.push(merged);
      }
    }
    var allNals = nalPayloads.length > 0 ? [].concat.apply([], nalPayloads) : [];
    var hvcCPayload = new Uint8Array(27 + allNals.length);
    hvcCPayload[0] = 1;
    hvcCPayload[1] = profileIdc | (tierFlag << 5);
    hvcCPayload[2] = 0xFF; hvcCPayload[3] = 0xFF; hvcCPayload[4] = 0xFF; hvcCPayload[5] = 0xFF;
    hvcCPayload[6] = generalLevelIdc;
    hvcCPayload[7] = 0xF0; hvcCPayload[8] = 0; hvcCPayload[9] = 0;
    hvcCPayload[10] = 0xFC; hvcCPayload[11] = 0; hvcCPayload[12] = 0;
    hvcCPayload[13] = 0xFC; hvcCPayload[14] = 0; hvcCPayload[15] = 0;
    hvcCPayload[16] = 0xF8; hvcCPayload[17] = 0;
    hvcCPayload[18] = 0xF8; hvcCPayload[19] = 0;
    hvcCPayload[20] = 0; hvcCPayload[21] = 0; hvcCPayload[22] = 0; hvcCPayload[23] = 0;
    hvcCPayload[24] = (allNals.length > 0 ? 0x40 : 0);
    hvcCPayload[25] = 0;
    hvcCPayload[26] = (allNals.length / 6) | 0;
    if (hvcCPayload[26] === 0 && allNals.length > 0) hvcCPayload[26] = 1;
    hvcCPayload.set(allNals, 27);
    var hvcCInner = mp4FullBox('hvcC', 0, 0, [hvcCPayload]);
    var prefix = new Uint8Array(78);
    prefix[0] = 0x00; prefix[1] = 0x00; prefix[2] = 0x00; prefix[3] = 0x00; prefix[4] = 0x00; prefix[5] = 0x00; prefix[6] = 0x00; prefix[7] = 0x68;
    prefix[8] = 0x76; prefix[9] = 0x63; prefix[10] = 0x31; prefix[11] = 0x00; prefix[12] = 0x00; prefix[13] = 0x00;
    prefix[14] = 0x00; prefix[15] = 0x00; prefix[16] = 0x00; prefix[17] = 0x00; prefix[18] = 0x00; prefix[19] = 0x00;
    prefix[20] = 0x00; prefix[21] = 0x00; prefix[22] = 0x00; prefix[23] = 0x00; prefix[24] = 0x00; prefix[25] = 0x00;
    prefix[26] = 0x00; prefix[27] = 0x00; prefix[28] = 0x00; prefix[29] = 0x00; prefix[30] = 0x00; prefix[31] = 0x00;
    prefix[32] = 0x00; prefix[33] = 0x00; prefix[34] = 0x00; prefix[35] = 0x00; prefix[36] = 0x00; prefix[37] = 0x00;
    prefix[38] = 0x00; prefix[39] = 0x00; prefix[40] = 0x00; prefix[41] = 0x00; prefix[42] = 0x00; prefix[43] = 0x00;
    prefix[44] = 0x00; prefix[45] = 0x00; prefix[46] = 0x00; prefix[47] = 0x00; prefix[48] = 0x00; prefix[49] = 0x00;
    prefix[50] = 0x00; prefix[51] = 0x00; prefix[52] = 0x00; prefix[53] = 0x00; prefix[54] = 0x00; prefix[55] = 0x00;
    prefix[56] = 0x00; prefix[57] = 0x00; prefix[58] = 0x00; prefix[59] = 0x00; prefix[60] = 0x00; prefix[61] = 0x00;
    prefix[62] = 0x00; prefix[63] = 0x00; prefix[64] = 0x00; prefix[65] = 0x00; prefix[66] = 0x00; prefix[67] = 0x00;
    prefix[68] = 0x00; prefix[69] = 0x00; prefix[70] = 0x00; prefix[71] = 0x00; prefix[72] = 0x00; prefix[73] = 0x00;
    prefix[74] = 0x00; prefix[75] = 0x00; prefix[76] = 0x00; prefix[77] = 0x00;
    var hvc1Data = new Uint8Array(prefix.length + hvcCInner.byteLength);
    hvc1Data.set(prefix, 0);
    hvc1Data.set(new Uint8Array(hvcCInner), prefix.length);
    return mp4Box('hev1', [hvc1Data]);
  } catch (e) {
    return null;
  }
}
/** Map MKV CodecID to MIME type for MSE codec check */
function getCodecMime(codecID, track) {
  if (codecID === 'V_MPEG4/ISO/AVC') {
    var codecStr = track && track.codecPrivate ? buildAVCCodecString(track.codecPrivate) : 'avc1.640028';
    return 'video/mp4; codecs="' + codecStr + '"';
  }
  if (codecID === 'V_MPEGH/ISO/HEVC' || codecID === 'V_MPEG4/ISO/HEVC') {
    var codecStr = track && track.codecPrivate ? buildHEVCCodecString(track.codecPrivate) : 'hev1.1.6.L93.B0';
    return 'video/mp4; codecs="' + codecStr + '"';
  }
  var map = {
    'V_MPEG4/ISO/HEVC':  'video/mp4; codecs="hev1.1.6.L93.B0"',
    'V_MPEGH/ISO/HEVC':  'video/mp4; codecs="hev1.1.6.L93.B0"',
    'V_AV1':             'video/mp4; codecs="av01.0.01M.08"',
    'V_VP8':             'video/webm; codecs="vp8"',
    'V_VP9':             'video/webm; codecs="vp9"',
    'A_AAC':             'audio/mp4; codecs="mp4a.40.2"',
    'A_AAC/MPEG4/LC':    'audio/mp4; codecs="mp4a.40.2"',
    'A_AAC/MPEG4/LC/SBR':'audio/mp4; codecs="mp4a.40.2"',
    'A_MPEG/L3':         'audio/mpeg',
    'A_VORBIS':          'audio/webm; codecs="vorbis"',
    'A_OPUS':            'audio/webm; codecs="opus"',
    'A_FLAC':            'audio/mp4; codecs="flac"',
    'A_ALAC':            'audio/mp4; codecs="alac"',
    'A_EAC3':            'audio/mp4; codecs="ec-3"',
    'A_AC3':             'audio/mp4; codecs="ac-3"'
  };
  return map[codecID] || null;
}

/** Get a human-readable codec name for error messages */
function getCodecName(codecID) {
  if (codecID.indexOf('HEVC') >= 0 || codecID.indexOf('H265') >= 0) return 'HEVC (H.265)';
  if (codecID.indexOf('AVC') >= 0 || codecID.indexOf('H264') >= 0) return 'AVC (H.264)';
  if (codecID.indexOf('AV1') >= 0) return 'AV1';
  if (codecID.indexOf('VP9') >= 0) return 'VP9';
  if (codecID.indexOf('VP8') >= 0) return 'VP8';
  if (codecID.indexOf('AAC') >= 0) return 'AAC';
  if (codecID.indexOf('VORBIS') >= 0) return 'Vorbis';
  if (codecID.indexOf('OPUS') >= 0) return 'Opus';
  if (codecID.indexOf('FLAC') >= 0) return 'FLAC';
  return codecID;
}

/** Determine if the codec container should be mp4 or webm */
function isWebMCodec(codecID) {
  return codecID.indexOf('VP8') >= 0 || codecID.indexOf('VP9') >= 0 ||
         codecID.indexOf('OPUS') >= 0 || codecID.indexOf('VORBIS') >= 0;
}

/** Build the complete fMP4 init segment for given MKV tracks */
function buildInitSegment(mkvInfo, videoTrack, audioTrack, includeAudio) {
  var durationSec = mkvInfo.duration || 0;
  var timescale = 1000; // ms-based
  var durationMs = Math.floor(durationSec * 1000);

  var ftyp = buildFtyp();
  var mvhd = buildMvhd(timescale, durationMs);

  var traks = [];
  var trexs = [];
  var trackIdCounter = 0;

  // Video track
  if (videoTrack) {
    trackIdCounter++;
    var vidId = trackIdCounter;
    var vidTimescale = 24000; // common video timescale
    var vidDuration = Math.floor(durationSec * vidTimescale);
    var w = videoTrack.video.pixelWidth || 1920;
    var h = videoTrack.video.pixelHeight || 1080;

    var tkhd = buildTkhd(vidId, vidDuration, w, h);
    var mdhd = buildMdhd(vidTimescale, vidDuration);
    var hdlr = buildHdlr('vide', 'VideoHandler');
    var vmhd = buildVmhd();
    var dinf = buildDinf();
    var vidSampleEntry = null;
    if (videoTrack.codecID === 'V_MPEGH/ISO/HEVC' || videoTrack.codecID === 'V_MPEG4/ISO/HEVC') {
      vidSampleEntry = buildHEVCConfig(videoTrack.codecPrivate);
    }
    var stbl = buildStbl(vidSampleEntry);
    var minf = mp4Box('minf', [vmhd, dinf, stbl]);
    var mdia = mp4Box('mdia', [mdhd, hdlr, minf]);
    traks.push(mp4Box('trak', [tkhd, mdia]));
    trexs.push(buildTrex(vidId));
  }

  // Audio track
  if (audioTrack && includeAudio) {
    trackIdCounter++;
    var audId = trackIdCounter;
    var audTimescale = audioTrack.audio.samplingFrequency || 44100;
    var audDuration = Math.floor(durationSec * audTimescale);

    var atkhd = buildTkhd(audId, audDuration, 0, 0);
    var amdhd = buildMdhd(audTimescale, audDuration);
    var ahdlr = buildHdlr('soun', 'SoundHandler');
    var asmhd = buildSmhd();
    var adinf = buildDinf();
    var astbl = buildStbl(null);
    var aminf = mp4Box('minf', [asmhd, adinf, astbl]);
    var amdia = mp4Box('mdia', [amdhd, ahdlr, aminf]);
    traks.push(mp4Box('trak', [atkhd, amdia]));
    trexs.push(buildTrex(audId));
  }

  var mvex = mp4Box('mvex', trexs);
  var moov = mp4Box('moov', [mvhd].concat(traks).concat([mvex]));

  // Concatenate ftyp + moov
  var initSeg = new Uint8Array(ftyp.byteLength + moov.byteLength);
  initSeg.set(ftyp, 0);
  initSeg.set(moov, ftyp.byteLength);
  return initSeg;
}

/** Build an fMP4 media segment (moof + mdat) for one track.
 *  samples: [{ data: Uint8Array, duration: number, isSync: boolean }] */
function buildMediaSegment(trackId, sequenceNumber, baseDecodeTime, samples) {
  // Calculate total mdat size
  var mdatPayloadSize = 0;
  for (var i = 0; i < samples.length; i++) {
    mdatPayloadSize += samples[i].data.byteLength;
  }

  // tfhd
  var tfhdData = new ArrayBuffer(12);
  var tfhdView = new DataView(tfhdData);
  tfhdView.setUint32(0, trackId);
  tfhdView.setUint32(4, 0); // default_sample_duration (0 = use trun)
  tfhdView.setUint32(8, 0); // default_sample_size (0 = use trun)
  var tfhd = mp4FullBox('tfhd', 0, 0x020000, [tfhdData]); // default-base-is-moof flag

  // tfdt
  var tfdtData = new ArrayBuffer(8);
  var tfdtView = new DataView(tfdtData);
  tfdtView.setUint32(0, 0); // upper 32 bits
  tfdtView.setUint32(4, baseDecodeTime); // lower 32 bits
  var tfdt = mp4FullBox('tfdt', 1, 0, [tfdtData]);

  // trun — compute sample table
  var sampleCount = samples.length;
  var trunPayloadSize = 4 + sampleCount * 12; // count + (dur + size + flags) per sample
  var trunData = new ArrayBuffer(trunPayloadSize);
  var trunView = new DataView(trunData);
  trunView.setUint32(0, sampleCount);
  for (var i = 0; i < sampleCount; i++) {
    var s = samples[i];
    trunView.setUint32(4 + i * 12, s.duration);
    trunView.setUint32(4 + i * 12 + 4, s.data.byteLength);
    var flags = s.isSync ? 0x02000000 : 0x01000000; // depends_on or keyframe
    if (i === 0) flags |= 0x00020000; // first_sample_flags
    trunView.setUint32(4 + i * 12 + 8, flags);
  }
  // trun flags: sample_duration(0x100) + sample_size(0x200) + sample_flags(0x400)
  var trun = mp4FullBox('trun', 0, 0x700, [trunData]);

  var traf = mp4Box('traf', [tfhd, tfdt, trun]);

  // mdat
  var mdat = mp4Box('mdat', [concatUint8Arrays(samples.map(function(s) { return s.data; }))]);

  // moof
  var mfhdData = new ArrayBuffer(4);
  new DataView(mfhdData).setUint32(0, sequenceNumber);
  var mfhd = mp4FullBox('mfhd', 0, 0, [mfhdData]);
  var moof = mp4Box('moof', [mfhd, traf]);

  // Fix data_offset in trun: offset = moof.size + 8 (mdat header)
  // The data_offset in trun is relative to moof start
  // We set it after building. For simplicity, the first byte of mdat payload
  // is at offset = moof.byteLength + 8 from the start of the segment.

  // Concatenate moof + mdat
  var segment = new Uint8Array(moof.byteLength + mdat.byteLength);
  segment.set(moof, 0);
  segment.set(mdat, moof.byteLength);
  return segment;
}

/** Concatenate an array of Uint8Arrays into one */
function concatUint8Arrays(arrays) {
  var totalLength = 0;
  for (var i = 0; i < arrays.length; i++) {
    totalLength += arrays[i].byteLength;
  }
  var result = new Uint8Array(totalLength);
  var offset = 0;
  for (var i = 0; i < arrays.length; i++) {
    result.set(arrays[i], offset);
    offset += arrays[i].byteLength;
  }
  return result;
}


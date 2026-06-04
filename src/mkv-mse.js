/*    Orchestrates MKV demux + fMP4 remux + MSE playback. */
var _msePipeline = null;

/** Destroy current MSE pipeline if active */
function destroyMSEPipeline() {
  if (_msePipeline) {
    _msePipeline.destroy();
    _msePipeline = null;
  }
  playback.isMSEMode = false;
  if (DOM.mseBadge) DOM.mseBadge.classList.remove('visible');
}

/** Show MKV loading overlay */
function showMSELoading(text, sub) {
  DOM.mkvLoadingText.textContent = text || '正在解析 MKV 文件…';
  DOM.mkvLoadingSub.textContent = sub || '';
  DOM.mkvLoading.classList.add('visible');
}

/** Hide MKV loading overlay */
function hideMSELoading() {
  DOM.mkvLoading.classList.remove('visible');
}

/** Main entry: load a video item via MSE pipeline */
async function loadViaMSE(item) {
  // Check MSE availability
  if (typeof MediaSource === 'undefined') {
    toast('⚠ 浏览器不支持 MediaSource Extensions');
    return;
  }

  // Set flag to prevent thumbnail generation from seeking during auto-play
  _pendingAutoPlay = true;

  // Show loading overlay
  var fileSizeMB = item._fileRef ? (item._fileRef.size / 1048576) : 0;
  var sizeHint = fileSizeMB > 1024 ? '文件较大，首次加载可能需要数秒' : '';
  showMSELoading('正在解析 MKV 文件…', sizeHint);

  try {
    // Read file as ArrayBuffer
    // In Electron, prefer reading by file path (bypasses File object limitations)
    var arrayBuffer;
    if (IS_ELECTRON && item._filePath && !item._fileRef) {
      arrayBuffer = await window.electronAPI.readFileAsBuffer(item._filePath);
      // Also get file size hint if not already known
      if (fileSizeMB === 0 && arrayBuffer) {
        fileSizeMB = arrayBuffer.byteLength / 1048576;
        sizeHint = fileSizeMB > 1024 ? '文件较大，首次加载可能需要数秒' : '';
        showMSELoading('正在解析 MKV 文件…', sizeHint);
      }
    } else {
      arrayBuffer = await readFileAsArrayBuffer(item._fileRef);
    }
    showMSELoading('正在提取轨道信息…', '');

    // Parse MKV structure
    var mkvInfo = parseMKV(arrayBuffer);
    if (!mkvInfo || mkvInfo.tracks.length === 0) {
      hideMSELoading();
      _pendingAutoPlay = false;
      toast('⚠ 无法解析此 MKV 文件');
      // Fallback: try native playback
      DOM.video.src = item.url;
      DOM.video.load();
      return;
    }

    // Find video and audio tracks
    var videoTrack = null;
    var audioTrack = null;
    for (var i = 0; i < mkvInfo.tracks.length; i++) {
      var t = mkvInfo.tracks[i];
      if (t.trackType === 1 && !videoTrack) videoTrack = t;
      else if (t.trackType === 2 && !audioTrack) audioTrack = t;
      else if (t.trackType === 17) {
        // Subtitle track — extract for T03 subtitle system
        extractMKVSubtitleTrack(t, mkvInfo.timecodeScale);
      }
    }

    if (!videoTrack && !audioTrack) {
      hideMSELoading();
      _pendingAutoPlay = false;
      toast('⚠ 未找到可播放的音视频轨道');
      return;
    }

    // Check codec support
    var videoMime = videoTrack ? getCodecMime(videoTrack.codecID, videoTrack) : null;
    var audioMime = audioTrack ? getCodecMime(audioTrack.codecID, audioTrack) : null;

    if (videoTrack && videoMime) {
      var containerType = isWebMCodec(videoTrack.codecID) ? 'webm' : 'mp4';
      var fullVideoMime = containerType === 'webm'
        ? 'video/webm; codecs="' + videoMime.split('"')[1] + '"'
        : videoMime;
      console.log('[Prism MSE] _initMSE videoMime:', videoMime, 'fullVideoMime:', fullVideoMime, 'isTypeSupported:', MediaSource.isTypeSupported(fullVideoMime));
      if (!MediaSource.isTypeSupported(fullVideoMime)) {
        console.warn('[Prism MSE] Video codec not supported by MSE, falling back to native playback');
        item._mseUnsupported = true;
        hideMSELoading();
        _pendingAutoPlay = false;
        playback.isMSEMode = false;
        if (IS_ELECTRON && item._filePath && (!item.url || item.unavailable)) {
          item.url = getLocalFileURL(item._filePath);
          item.unavailable = false;
        }
        DOM.video.src = item.url;
        DOM.video.load();
        videoPlay();
        return;
      }
    }

    // Create MSE pipeline
    showMSELoading('正在初始化播放管线…', '');
    var pipeline = new MKVMSEPipeline(DOM.video, arrayBuffer, mkvInfo, videoTrack, audioTrack);
    await pipeline.init();
    _msePipeline = pipeline;

    playback.isMSEMode = true;
    DOM.mseBadge.classList.add('visible');
    hideMSELoading();

    // Set duration
    var durationSec = mkvInfo.duration || 0;
    if (durationSec > 0) {
      playback.duration = durationSec;
    }

    // Update titlebar & sidebar
    updateTitlebar();
    renderSidebar();
    renderFavBtns();

    // Auto play
    videoPlay();

    // Resume from last position
    if (item.lastPosition && item.lastPosition > 2) {
      videoSeek(item.lastPosition);
    }

  } catch (err) {
    hideMSELoading();
    _pendingAutoPlay = false;
    console.error('[Prism MSE]', err);
    toast('⚠ MKV 播放失败：' + (err.message || '未知错误'));

    // Fallback: try native
    try {
      item._mseUnsupported = true;
      DOM.video.src = item.url;
      DOM.video.load();
      videoPlay();
    } catch (e) { /* ignore */ }
  }
}

/** Read a File as ArrayBuffer */
function readFileAsArrayBuffer(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.onerror = function() { reject(new Error('文件读取失败')); };
    reader.readAsArrayBuffer(file);
  });
}

/** Extract embedded MKV subtitle track and load into T03 subtitle system */
function extractMKVSubtitleTrack(track, timecodeScale) {
  // MKV subtitle tracks (TrackType=17) contain codec data in their blocks.
  // For SRT/ASS-style subtitles, we need to extract text from blocks.
  // This is a best-effort extraction for common subtitle codecs.
  if (track.codecID === 'S_TEXT/UTF8' || track.codecID === 'S_TEXT/SSA' ||
      track.codecID === 'S_TEXT/ASS' || track.codecID === 'S_TEXT/USF') {
    // Note: Full extraction requires parsing all blocks for this track,
    // which is done during cluster parsing in the pipeline.
    // We mark this track for the pipeline to extract subtitles from.
    if (!_msePipeline) return;
    _msePipeline._subtitleTrackNum = track.trackNumber;
    _msePipeline._subtitleCodecID = track.codecID;
    _msePipeline._subtitleTimecodeScale = timecodeScale;
  }
}

/* ── MKV MSE Pipeline Class ── */

/**
 * Manages MKV → fMP4 → MSE playback pipeline.
 * @constructor
 */
function MKVMSEPipeline(videoEl, arrayBuffer, mkvInfo, videoTrack, audioTrack) {
  this.video = videoEl;
  this.arrayBuffer = arrayBuffer;
  this.dataView = new DataView(arrayBuffer);
  this.mkvInfo = mkvInfo;
  this.videoTrack = videoTrack;
  this.audioTrack = audioTrack;
  this.mediaSource = null;
  this.videoSourceBuffer = null;
  this.audioSourceBuffer = null;
  this.destroyed = false;
  this.sequenceNumber = 1;
  this._subtitleTrackNum = 0;
  this._subtitleCodecID = '';
  this._subtitleTimecodeScale = 1000000;
  this._feedIndex = 0; // which cluster we're currently feeding
  this._feeding = false;
  this._videoTimescale = 24000;
  this._audioTimescale = audioTrack ? (audioTrack.audio.samplingFrequency || 44100) : 44100;
  this._videoDecodeTime = 0;
  this._audioDecodeTime = 0;
  this._timecodeScale = mkvInfo.timecodeScale || 1000000;
}

/** Initialize the pipeline: create MediaSource, SourceBuffers, feed init segment */
MKVMSEPipeline.prototype.init = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    if (self.destroyed) { reject(new Error('Pipeline destroyed')); return; }

    var mediaSource = new MediaSource();
    self.mediaSource = mediaSource;

    mediaSource.addEventListener('sourceopen', function() {
      try {
        // Determine container
        var isWebM = self.videoTrack && isWebMCodec(self.videoTrack.codecID);
        var videoMime = null;
        var audioMime = null;

        if (self.videoTrack) {
          var vMime = getCodecMime(self.videoTrack.codecID, self.videoTrack);
          console.log('[Prism MSE] video codecID:', self.videoTrack.codecID, 'videoMime:', vMime, 'isWebM:', isWebM, 'isTypeSupported:', vMime ? MediaSource.isTypeSupported(vMime) : 'n/a');
          videoMime = isWebM
            ? 'video/webm; codecs="' + vMime.split('"')[1] + '"'
            : vMime;
        }
        if (self.audioTrack) {
          var aIsWebM = isWebMCodec(self.audioTrack.codecID);
          var aCodecStr = getCodecMime(self.audioTrack.codecID);
          audioMime = aIsWebM
            ? 'audio/webm; codecs="' + aCodecStr.split('"')[1] + '"'
            : aCodecStr;
          console.log('[Prism MSE] audio codecID:', self.audioTrack.codecID, 'audioMime:', audioMime, 'isTypeSupported:', audioMime ? MediaSource.isTypeSupported(audioMime) : 'n/a');
        }

        // Create SourceBuffers — try even if isTypeSupported returned false
        if (videoMime) {
          try {
            self.videoSourceBuffer = mediaSource.addSourceBuffer(videoMime);
            self.videoSourceBuffer.mode = 'segments';
            self.videoSourceBuffer.addEventListener('error', function(e) {
              console.error('[Prism MSE] Video SourceBuffer error', e);
            });
          } catch (e) {
            console.warn('[Prism MSE] addSourceBuffer(video) failed:', e.message);
          }
        }
        if (audioMime) {
          try {
            self.audioSourceBuffer = mediaSource.addSourceBuffer(audioMime);
            self.audioSourceBuffer.mode = 'segments';
            self.audioSourceBuffer.addEventListener('error', function(e) {
              console.error('[Prism MSE] Audio SourceBuffer error', e);
            });
          } catch (e) {
            console.warn('[Prism MSE] addSourceBuffer(audio) failed:', e.message);
          }
        }

        if (!self.videoSourceBuffer && !self.audioSourceBuffer) {
          reject(new Error('无可用 SourceBuffer'));
          return;
        }
        console.log('[Prism MSE] SourceBuffers ready: video=' + !!self.videoSourceBuffer + ' audio=' + !!self.audioSourceBuffer);

        // Build and append init segment
        if (!isWebM) {
          var initSeg = buildInitSegment(self.mkvInfo, self.videoTrack, self.audioTrack, !!self.audioSourceBuffer);
          var appendPromises = [];

          // For fMP4, we append the init segment to both buffers
          // The init segment contains moov with both tracks, but MSE will
          // filter by track. We need to append to the video buffer first.
          if (self.videoSourceBuffer) {
            appendPromises.push(appendToBuffer(self.videoSourceBuffer, initSeg));
          }
          if (self.audioSourceBuffer && self.videoSourceBuffer !== self.audioSourceBuffer) {
            appendPromises.push(appendToBuffer(self.audioSourceBuffer, initSeg));
          }

          Promise.all(appendPromises).then(function() {
            // Start feeding media segments
            self.startFeeding();
            resolve();
          }).catch(function(e) {
            reject(e);
          });
        } else {
          // WebM — feed raw data directly
          self.startFeeding();
          resolve();
        }
      } catch (e) {
        reject(e);
      }
    });

    mediaSource.addEventListener('error', function(e) {
      reject(new Error('MediaSource error'));
    });

    // Attach MediaSource to video element
    self.video.src = URL.createObjectURL(mediaSource);
  });
};

/** Start feeding cluster data as media segments */
MKVMSEPipeline.prototype.startFeeding = function() {
  if (this.destroyed) return;
  this._feedIndex = 0;
  this._feeding = true;
  this._videoDecodeTime = 0;
  this._audioDecodeTime = 0;
  this.feedNextCluster();
};

/** Feed the next cluster to SourceBuffers */
MKVMSEPipeline.prototype.feedNextCluster = function() {
  var self = this;
  if (self.destroyed || !self._feeding) return;
  if (self._feedIndex >= self.mkvInfo.clusterOffsets.length) {
    // All clusters fed
    self._feeding = false;
    // End of stream if this was the last cluster
    if (self.mediaSource && self.mediaSource.readyState === 'open') {
      try { self.mediaSource.endOfStream(); } catch (e) { /* ignore */ }
    }
    return;
  }

  var clusterOffset = self.mkvInfo.clusterOffsets[self._feedIndex];
  var clusterData = self.parseCluster(clusterOffset);
  if (!clusterData) {
    self._feedIndex++;
    self.feedNextCluster();
    return;
  }

  // Build media segments from cluster blocks
  var videoSamples = clusterData.videoSamples || [];
  var audioSamples = clusterData.audioSamples || [];

  var appendOps = [];

  if (videoSamples.length > 0 && self.videoSourceBuffer) {
    var vidSegment = buildMediaSegment(
      1, // trackId for video
      self.sequenceNumber,
      self._videoDecodeTime,
      videoSamples
    );
    self._videoDecodeTime += videoSamples.reduce(function(sum, s) { return sum + s.duration; }, 0);
    self.sequenceNumber++;
    appendOps.push(appendToBuffer(self.videoSourceBuffer, vidSegment));
  }

  if (audioSamples.length > 0 && self.audioSourceBuffer) {
    var audSegment = buildMediaSegment(
      2, // trackId for audio
      self.sequenceNumber,
      self._audioDecodeTime,
      audioSamples
    );
    self._audioDecodeTime += audioSamples.reduce(function(sum, s) { return sum + s.duration; }, 0);
    self.sequenceNumber++;
    appendOps.push(appendToBuffer(self.audioSourceBuffer, audSegment));
  }

  // Extract embedded subtitles
  if (clusterData.subtitleSamples && clusterData.subtitleSamples.length > 0) {
    self.processMKVSubtitles(clusterData.subtitleSamples);
  }

  if (appendOps.length === 0) {
    self._feedIndex++;
    self.feedNextCluster();
    return;
  }

  Promise.all(appendOps).then(function() {
    self._feedIndex++;
    // Feed next cluster with a small delay to avoid blocking UI
    setTimeout(function() { self.feedNextCluster(); }, 20);
  }).catch(function(e) {
    console.warn('[Prism MSE] Append error, stopping feed:', e);
    self._feeding = false;
  });
};

/** Parse a single Cluster from the MKV buffer.
 *  Returns { videoSamples, audioSamples, subtitleSamples, clusterTimecode } */
MKVMSEPipeline.prototype.parseCluster = function(clusterOffset) {
  var view = this.dataView;
  try {
  var clusterEl = readEBMLElement(view, clusterOffset);
  if (!clusterEl || clusterEl.id !== 0x1F43B675) return null;

  var result = {
    clusterTimecode: 0,
    videoSamples: [],
    audioSamples: [],
    subtitleSamples: []
  };

  var offset = clusterEl.dataOffset;
  var endOffset = clusterEl.nextOffset;

  while (offset < endOffset - 4) {
    var el = readEBMLElement(view, offset);
    if (!el) break;

    switch (el.id) {
      case 0xE7: // Timecode (cluster timestamp in TimecodeScale units)
        result.clusterTimecode = readUintBE(view, el.dataOffset, Math.min(el.size, 8));
        break;

      case 0xA3: // SimpleBlock
        this.parseBlock(view, el.dataOffset, el.size, result, false);
        break;

      case 0xA0: // BlockGroup — contains Block + BlockDuration
        var blockDuration = 0;
        var blockData = null;
        var bOffset = el.dataOffset;
        while (bOffset < el.nextOffset - 2) {
          var bEl = readEBMLElement(view, bOffset);
          if (!bEl) break;
          if (bEl.id === 0xA1) { // Block
            blockData = { offset: bEl.dataOffset, size: bEl.size };
          } else if (bEl.id === 0x9B) { // BlockDuration
            blockDuration = readUintBE(view, bEl.dataOffset, Math.min(bEl.size, 8));
          }
          bOffset = bEl.nextOffset;
        }
        if (blockData) {
          this.parseBlock(view, blockData.offset, blockData.size, result, true, blockDuration);
        }
        break;
    }
    offset = el.nextOffset;
  }
  return result;
  } catch (e) {
    console.warn('[Prism MKV] Cluster parse incomplete:', e.message);
    return null;
  }
};

/** Parse a Block/SimpleBlock and extract sample data.
 *  Block format: [trackNum:VINT][timecode:2s][flags:1][frameData...] */
MKVMSEPipeline.prototype.parseBlock = function(view, dataOffset, dataSize, result, isBlockGroup, blockDuration) {
  try {
  var offset = dataOffset;
  var trackNumResult = readVINT(view, offset);
  if (!trackNumResult) return;
  var trackNumber = trackNumResult.value;
  offset += trackNumResult.length;

  if (offset + 3 > dataOffset + dataSize) return;
  // Bounds check before direct DataView access
  if (offset + 3 > view.byteLength) return;

  // Relative timecode (int16)
  var relTimecode = view.getInt16(offset);
  offset += 2;

  // Flags byte (for SimpleBlock: keyframe bit 7, invisible bit 3, lacing bits 1-0)
  var flags = view.getUint8(offset);
  offset += 1;

  var isKeyframe = !!(flags & 0x80);
  var lacing = (flags & 0x06) >> 1;

  // Calculate absolute timestamp in seconds
  var absTimecodeNs = (result.clusterTimecode + relTimecode) * this._timecodeScale;
  var absTimeSec = absTimecodeNs / 1000000000;

  // Parse lacing if present
  var frameOffsets = [];
  var frameSizes = [];

  if (lacing === 0) {
    // No lacing — single frame
    var frameSize = dataSize - (offset - dataOffset);
    frameOffsets.push(offset);
    frameSizes.push(frameSize);
  } else {
    // Xiph lacing (1), EBML lacing (3), or fixed-size (2)
    var numFrames = view.getUint8(offset);
    offset += 1;
    numFrames += 1; // number of frames = value + 1

    if (lacing === 1) {
      // Xiph lacing
      var sizes = [];
      var totalRead = 0;
      for (var f = 0; f < numFrames - 1; f++) {
        var size = 0;
        var b;
        do {
          b = view.getUint8(offset);
          size += b;
          offset++;
        } while (b === 255);
        sizes.push(size);
        totalRead += size;
      }
      sizes.push(dataSize - (offset - dataOffset) - totalRead);
      for (var f = 0; f < sizes.length; f++) {
        frameOffsets.push(offset);
        frameSizes.push(sizes[f]);
        offset += sizes[f];
      }
    } else if (lacing === 3) {
      // EBML lacing
      var sizes = [];
      var firstSize = 0;
      var vs = readVINT(view, offset);
      if (vs) {
        firstSize = vs.value;
        offset += vs.length;
      }
      sizes.push(firstSize);
      var accumulated = firstSize;
      for (var f = 1; f < numFrames - 1; f++) {
        var diffVs = readVINT(view, offset);
        if (diffVs) {
          var diff = diffVs.value;
          // EBML signed value: if diff >= 2^(7*length-1), subtract 2^(7*length)
          var byteLen = diffVs.length;
          var halfRange = Math.pow(2, 7 * byteLen - 1);
          if (diff >= halfRange) diff -= 2 * halfRange;
          accumulated += diff;
          sizes.push(accumulated);
          offset += diffVs.length;
        }
      }
      // Last frame
      sizes.push(dataSize - (offset - dataOffset) - sizes.reduce(function(a, b) { return a + b; }, 0));
      var curOffset = offset;
      for (var f = 0; f < sizes.length; f++) {
        frameOffsets.push(curOffset);
        frameSizes.push(sizes[f]);
        curOffset += sizes[f];
      }
    } else {
      // Fixed-size lacing
      var payloadSize = dataSize - (offset - dataOffset);
      var frameSize = Math.floor(payloadSize / numFrames);
      for (var f = 0; f < numFrames; f++) {
        frameOffsets.push(offset + f * frameSize);
        frameSizes.push(frameSize);
      }
    }
  }

  // Extract frame data
  var trackNum = trackNumber;
  var isVideoTrack = this.videoTrack && this.videoTrack.trackNumber === trackNum;
  var isAudioTrack = this.audioTrack && this.audioTrack.trackNumber === trackNum;
  var isSubTrack = this._subtitleTrackNum === trackNum;

  for (var f = 0; f < frameOffsets.length; f++) {
    var fOffset = frameOffsets[f];
    var fSize = frameSizes[f];
    if (fOffset + fSize > this.arrayBuffer.byteLength) continue;
    var frameData = new Uint8Array(this.arrayBuffer, fOffset, fSize);

    if (isVideoTrack) {
      // Convert H.264 NAL units from Annex B to AVCC format if needed
      var processedFrame = frameData;
      if (this.videoTrack && (this.videoTrack.codecID === 'V_MPEG4/ISO/AVC' || this.videoTrack.codecID === 'V_MPEGH/ISO/HEVC')) {
        processedFrame = this.convertAVCToAVCC(frameData);
      }
      // Default duration: use track's DefaultDuration or estimate 24fps
      var durNs = this.videoTrack.defaultDuration || 41666666; // ~24fps
      var durTimescale = Math.round(durNs * this._videoTimescale / 1000000000);
      if (durTimescale <= 0) durTimescale = 1;
      result.videoSamples.push({
        data: processedFrame,
        duration: durTimescale,
        isSync: isKeyframe,
        timeSec: absTimeSec
      });
    } else if (isAudioTrack) {
      var durNs = this.audioTrack.defaultDuration || 23219955; // ~44100 samples/frame
      var durTimescale = Math.round(durNs * this._audioTimescale / 1000000000);
      if (durTimescale <= 0) durTimescale = 1024; // AAC default
      result.audioSamples.push({
        data: frameData,
        duration: durTimescale,
        isSync: true,
        timeSec: absTimeSec
      });
    } else if (isSubTrack) {
      result.subtitleSamples.push({
        data: frameData,
        timeSec: absTimeSec,
        isKeyframe: isKeyframe
      });
    }
  }
  } catch (e) {
    // Silently skip malformed blocks — don't crash the pipeline
    console.warn('[Prism MKV] Block parse skipped:', e.message);
  }
};

/** Convert H.264 Annex B NAL units to AVCC length-prefixed format */
MKVMSEPipeline.prototype.convertAVCToAVCC = function(annexBData) {
  // Find NAL unit boundaries (00 00 01 or 00 00 00 01 start codes)
  var nals = [];
  var i = 0;
  var len = annexBData.length;

  while (i < len - 3) {
    // Look for start code
    if (annexBData[i] === 0 && annexBData[i + 1] === 0) {
      var startCodeLen = 0;
      if (annexBData[i + 2] === 1) {
        startCodeLen = 3;
      } else if (i < len - 4 && annexBData[i + 2] === 0 && annexBData[i + 3] === 1) {
        startCodeLen = 4;
      }

      if (startCodeLen > 0 && nals.length > 0) {
        // End of previous NAL — update its length
        nals[nals.length - 1].end = i;
      }

      if (startCodeLen > 0) {
        nals.push({ start: i + startCodeLen, end: len });
        i += startCodeLen;
        continue;
      }
    }
    i++;
  }

  if (nals.length === 0) {
    // No start codes found — data might already be in AVCC format
    return annexBData;
  }

  // Build AVCC format: [4-byte length][NAL data] for each NAL
  var totalSize = 0;
  for (var n = 0; n < nals.length; n++) {
    var nalSize = nals[n].end - nals[n].start;
    totalSize += 4 + nalSize;
  }

  var avccData = new Uint8Array(totalSize);
  var outOffset = 0;
  for (var n = 0; n < nals.length; n++) {
    var nalSize = nals[n].end - nals[n].start;
    mp4WriteU32(avccData, outOffset, nalSize);
    avccData.set(annexBData.subarray(nals[n].start, nals[n].end), outOffset + 4);
    outOffset += 4 + nalSize;
  }

  return avccData;
};

/** Process embedded MKV subtitle blocks into the subtitle system */
MKVMSEPipeline.prototype.processMKVSubtitles = function(subtitleSamples) {
  if (subtitleSamples.length === 0) return;

  var newSubs = [];
  for (var i = 0; i < subtitleSamples.length; i++) {
    var sample = subtitleSamples[i];
    // Decode subtitle text
    var text = '';
    try {
      var decoder = new TextDecoder('utf-8');
      text = decoder.decode(sample.data);
    } catch (e) {
      continue;
    }
    if (!text || text.trim() === '') continue;

    // ASS format: read order after 9th comma
    if (this._subtitleCodecID === 'S_TEXT/ASS' || this._subtitleCodecID === 'S_TEXT/SSA') {
      var parts = text.split(',');
      if (parts.length >= 10) {
        text = parts.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').trim();
      }
    }

    // Estimate duration: until next subtitle or 3 seconds
    var startTime = sample.timeSec;
    var endTime = startTime + 3;
    if (i + 1 < subtitleSamples.length) {
      endTime = subtitleSamples[i + 1].timeSec;
    }

    newSubs.push({
      id: subtitleTracks.length + i + 1,
      start: startTime,
      end: endTime,
      text: text
    });
  }

  if (newSubs.length > 0) {
    // Merge into existing subtitle tracks
    subtitleTracks = subtitleTracks.concat(newSubs);
    // Sort by start time
    subtitleTracks.sort(function(a, b) { return a.start - b.start; });
    // Auto-enable subtitles
    subOn = true;
    DOM.subBtn.classList.add('active');
    updateSubtitlePanel();
    toast('💬 检测到内嵌字幕（' + newSubs.length + ' 条）');
  }
};

/** Seek to a specific time in MSE mode */
MKVMSEPipeline.prototype.seek = function(targetTimeSec) {
  // For MSE with 'segments' mode, we can just set video.currentTime
  // and the browser handles the rest, as long as the data is buffered.
  // If the target is not buffered, we need to feed from the nearest cluster.
  if (this.video) {
    this.video.currentTime = targetTimeSec;
  }
};

/** Destroy the pipeline and clean up resources */
MKVMSEPipeline.prototype.destroy = function() {
  this.destroyed = true;
  this._feeding = false;

  try {
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      try { this.mediaSource.endOfStream(); } catch (e) { /* ignore */ }
    }
    if (this.videoSourceBuffer) {
      try {
        if (this.mediaSource && this.mediaSource.readyState === 'open') {
          this.mediaSource.removeSourceBuffer(this.videoSourceBuffer);
        }
      } catch (e) { /* ignore */ }
      this.videoSourceBuffer = null;
    }
    if (this.audioSourceBuffer) {
      try {
        if (this.mediaSource && this.mediaSource.readyState === 'open') {
          this.mediaSource.removeSourceBuffer(this.audioSourceBuffer);
        }
      } catch (e) { /* ignore */ }
      this.audioSourceBuffer = null;
    }
    if (this.video && this.video.src) {
      URL.revokeObjectURL(this.video.src);
      this.video.removeAttribute('src');
      this.video.load();
    }
  } catch (e) { /* ignore errors during cleanup */ }

  this.mediaSource = null;
  this.arrayBuffer = null;
  this.dataView = null;
  this.mkvInfo = null;
};

/* ── Utility: Append to SourceBuffer as a Promise ── */

function appendToBuffer(sourceBuffer, data) {
  return new Promise(function(resolve, reject) {
    try {
      sourceBuffer.addEventListener('updateend', function onUpdateEnd() {
        sourceBuffer.removeEventListener('updateend', onUpdateEnd);
        sourceBuffer.removeEventListener('error', onError);
        resolve();
      });
      sourceBuffer.addEventListener('error', function onError(e) {
        sourceBuffer.removeEventListener('updateend', onUpdateEnd);
        sourceBuffer.removeEventListener('error', onError);
        console.error('[Prism MSE] SourceBuffer append error:', e);
        reject(e);
      });
      sourceBuffer.appendBuffer(data);
    } catch (e) {
      // If appendBuffer throws synchronously (e.g., QuotaExceededError)
      reject(e);
    }
  });
}

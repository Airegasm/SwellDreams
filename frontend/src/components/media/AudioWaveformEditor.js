import React, { useState, useEffect, useRef, useCallback } from 'react';
import './AudioWaveformEditor.css';

/**
 * Audio Waveform Editor with zoom, trim, and preview capabilities
 * @param {File} file - The audio file to edit
 * @param {function} onSave - Callback with trimmed audio blob
 * @param {function} onCancel - Callback when cancelled
 */
function AudioWaveformEditor({ file, onSave, onCancel }) {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioBufferRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null); // Store blob URL to set after render
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [scrollPosition, setScrollPosition] = useState(0);

  // Trim handles (in seconds)
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  // Dragging state
  const [dragging, setDragging] = useState(null); // 'start', 'end', or null

  // Load and decode audio
  useEffect(() => {
    let cancelled = false;

    const loadAudio = async () => {
      try {
        setLoading(true);
        setError(null);

        // Create audio context
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContextRef.current = new AudioContext();

        // Read file as ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();

        // Decode audio data
        const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);

        if (cancelled) return;

        audioBufferRef.current = audioBuffer;
        setDuration(audioBuffer.duration);
        setTrimEnd(audioBuffer.duration);

        // Create object URL for audio playback
        const url = URL.createObjectURL(file);
        setAudioUrl(url);
        console.log('[Waveform] Audio URL created:', url);

        setLoading(false);
        drawWaveform();
      } catch (err) {
        console.error('Failed to load audio:', err);
        setError('Failed to load audio file');
        setLoading(false);
      }
    };

    loadAudio();

    return () => {
      cancelled = true;
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [file]);

  // Set audio src when URL is ready and component is loaded
  useEffect(() => {
    if (audioUrl && !loading && audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.load();
      console.log('[Waveform] Audio src applied to element:', audioUrl);
    }
  }, [audioUrl, loading]);

  // Draw waveform
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const audioBuffer = audioBufferRef.current;
    if (!canvas || !audioBuffer) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = '#1a1c1f';
    ctx.fillRect(0, 0, width, height);

    // Get audio data
    const data = audioBuffer.getChannelData(0);
    const totalSamples = data.length;
    const duration = audioBuffer.duration;

    // Calculate visible range based on zoom and scroll
    const visibleDuration = duration / zoom;
    const startTime = scrollPosition * (duration - visibleDuration);
    const endTime = startTime + visibleDuration;

    const startSample = Math.floor((startTime / duration) * totalSamples);
    const endSample = Math.floor((endTime / duration) * totalSamples);
    const samplesPerPixel = (endSample - startSample) / width;

    // Draw waveform
    ctx.beginPath();
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 1;

    const centerY = height / 2;

    for (let x = 0; x < width; x++) {
      const sampleStart = startSample + Math.floor(x * samplesPerPixel);
      const sampleEnd = Math.min(sampleStart + Math.ceil(samplesPerPixel), totalSamples);

      let min = 0;
      let max = 0;

      for (let i = sampleStart; i < sampleEnd; i++) {
        const val = data[i];
        if (val < min) min = val;
        if (val > max) max = val;
      }

      const y1 = centerY + min * centerY;
      const y2 = centerY + max * centerY;

      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
    }

    ctx.stroke();

    // Draw trim regions (dimmed areas)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';

    const trimStartX = ((trimStart - startTime) / visibleDuration) * width;
    const trimEndX = ((trimEnd - startTime) / visibleDuration) * width;

    if (trimStartX > 0) {
      ctx.fillRect(0, 0, Math.max(0, trimStartX), height);
    }
    if (trimEndX < width) {
      ctx.fillRect(Math.min(width, trimEndX), 0, width - trimEndX, height);
    }

    // Draw trim handles
    ctx.fillStyle = '#f44336';
    const handleWidth = 4;

    if (trimStartX >= 0 && trimStartX <= width) {
      ctx.fillRect(trimStartX - handleWidth / 2, 0, handleWidth, height);
    }

    ctx.fillStyle = '#2196F3';
    if (trimEndX >= 0 && trimEndX <= width) {
      ctx.fillRect(trimEndX - handleWidth / 2, 0, handleWidth, height);
    }

    // Draw playhead
    const playheadX = ((currentTime - startTime) / visibleDuration) * width;
    if (playheadX >= 0 && playheadX <= width) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    }
  }, [zoom, scrollPosition, trimStart, trimEnd, currentTime]);

  // Redraw on state changes
  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  // Update playhead during playback
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      // Stop at trim end and reset to trim start
      if (audio.currentTime >= trimEnd) {
        audio.pause();
        audio.currentTime = trimStart;
        setCurrentTime(trimStart);
        setIsPlaying(false);
      }
    };

    const handleEnded = () => {
      // Reset to trim start
      audio.currentTime = trimStart;
      setCurrentTime(trimStart);
      setIsPlaying(false);
    };

    const handleCanPlay = () => {
      console.log('[Waveform] Audio can play, duration:', audio.duration);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('canplay', handleCanPlay);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('canplay', handleCanPlay);
    };
  }, [trimEnd, trimStart]);

  // Handle canvas mouse events for trim handles
  const handleCanvasMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    // Account for CSS scaling - use displayed width, not canvas.width
    const scaleX = canvas.width / rect.width;
    const x = (e.clientX - rect.left) * scaleX;
    const width = canvas.width;

    const visibleDuration = duration / zoom;
    const startTime = scrollPosition * (duration - visibleDuration);

    const trimStartX = ((trimStart - startTime) / visibleDuration) * width;
    const trimEndX = ((trimEnd - startTime) / visibleDuration) * width;

    const threshold = 15; // Increased for easier grabbing

    console.log('[Waveform] Click at x:', x, 'trimStartX:', trimStartX, 'trimEndX:', trimEndX);

    if (Math.abs(x - trimStartX) < threshold) {
      setDragging('start');
      console.log('[Waveform] Dragging START handle');
    } else if (Math.abs(x - trimEndX) < threshold) {
      setDragging('end');
      console.log('[Waveform] Dragging END handle');
    }
  };

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e) => {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      // Account for CSS scaling
      const scaleX = canvas.width / rect.width;
      const x = (e.clientX - rect.left) * scaleX;
      const width = canvas.width;

      const visibleDuration = duration / zoom;
      const startTime = scrollPosition * (duration - visibleDuration);

      const time = startTime + (x / width) * visibleDuration;
      const clampedTime = Math.max(0, Math.min(duration, time));

      if (dragging === 'start') {
        setTrimStart(Math.min(clampedTime, trimEnd - 0.1));
      } else if (dragging === 'end') {
        setTrimEnd(Math.max(clampedTime, trimStart + 0.1));
      }
    };

    const handleMouseUp = () => {
      console.log('[Waveform] Stopped dragging, trim:', trimStart, '-', trimEnd);
      setDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, duration, zoom, scrollPosition, trimStart, trimEnd]);

  // Playback controls
  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) {
      console.log('[Waveform] No audio element');
      return;
    }

    console.log('[Waveform] Play/Pause clicked, isPlaying:', isPlaying,
      'currentTime:', audio.currentTime,
      'readyState:', audio.readyState,
      'src:', audio.src ? 'set' : 'empty',
      'duration:', audio.duration);

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      // Start from trim start if before trim region or past trim end
      if (audio.currentTime < trimStart || audio.currentTime >= trimEnd) {
        audio.currentTime = trimStart;
      }
      setIsPlaying(true);
      const playPromise = audio.play();
      if (playPromise) {
        playPromise.then(() => {
          console.log('[Waveform] Play started successfully');
        }).catch((e) => {
          console.log('[Waveform] Play error:', e.name, e.message);
          setIsPlaying(false);
        });
      }
    }
  };

  // Zoom controls
  const handleZoomIn = () => {
    setZoom(Math.min(zoom * 1.5, 10));
  };

  const handleZoomOut = () => {
    setZoom(Math.max(zoom / 1.5, 1));
  };

  // Scroll handling
  const handleScroll = (e) => {
    if (zoom <= 1) return;
    const newPosition = Math.max(0, Math.min(1, scrollPosition + e.deltaX * 0.001));
    setScrollPosition(newPosition);
  };

  // Save trimmed audio
  const handleSave = async () => {
    try {
      const audioBuffer = audioBufferRef.current;
      if (!audioBuffer) return;

      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(trimStart * sampleRate);
      const endSample = Math.floor(trimEnd * sampleRate);
      const trimmedLength = endSample - startSample;

      // Create new audio buffer for trimmed audio
      const trimmedBuffer = audioContextRef.current.createBuffer(
        audioBuffer.numberOfChannels,
        trimmedLength,
        sampleRate
      );

      // Copy samples
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const sourceData = audioBuffer.getChannelData(channel);
        const destData = trimmedBuffer.getChannelData(channel);
        for (let i = 0; i < trimmedLength; i++) {
          destData[i] = sourceData[startSample + i];
        }
      }

      // Convert to WAV blob
      const wavBlob = audioBufferToWav(trimmedBuffer);

      // Create new File with original extension if not trimming, or .wav if trimmed
      const isTrimmed = trimStart > 0.01 || trimEnd < duration - 0.01;
      if (isTrimmed) {
        const trimmedFile = new File([wavBlob], file.name.replace(/\.[^.]+$/, '.wav'), {
          type: 'audio/wav'
        });
        onSave(trimmedFile);
      } else {
        // No trimming, use original file
        onSave(file);
      }
    } catch (err) {
      console.error('Failed to save trimmed audio:', err);
      // Fallback to original file
      onSave(file);
    }
  };

  // Convert AudioBuffer to WAV Blob
  const audioBufferToWav = (buffer) => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const samples = buffer.length;
    const dataSize = samples * blockAlign;
    const bufferSize = 44 + dataSize;

    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);

    // WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write interleaved samples
    let offset = 44;
    for (let i = 0; i < samples; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  };

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onCancel}>
        <div className="modal waveform-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-body" style={{ textAlign: 'center', padding: '3rem' }}>
            <div className="loading-spinner"></div>
            <p style={{ marginTop: '1rem' }}>Loading audio...</p>
          </div>
          <audio ref={audioRef} style={{ display: 'none' }} preload="auto" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="modal-overlay" onClick={onCancel}>
        <div className="modal waveform-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h3>Error</h3>
            <button className="modal-close" onClick={onCancel}>&times;</button>
          </div>
          <div className="modal-body">
            <p className="form-error">{error}</p>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onCancel}>Close</button>
          </div>
          <audio ref={audioRef} style={{ display: 'none' }} preload="auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal waveform-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Audio</h3>
          <button className="modal-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="waveform-container">
            <canvas
              ref={canvasRef}
              width={600}
              height={120}
              onMouseDown={handleCanvasMouseDown}
              onWheel={handleScroll}
              style={{ cursor: dragging ? 'grabbing' : 'crosshair' }}
            />
          </div>

          <div className="waveform-controls">
            <div className="playback-controls">
              <button className="btn btn-sm" onClick={handlePlayPause}>
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button className="btn btn-sm" onClick={() => {
                if (audioRef.current) {
                  audioRef.current.currentTime = trimStart;
                  setCurrentTime(trimStart);
                }
              }}>
                Reset
              </button>
              <input
                type="range"
                className="seek-bar"
                min={trimStart}
                max={trimEnd}
                step={0.01}
                value={currentTime}
                onChange={(e) => {
                  const newTime = parseFloat(e.target.value);
                  if (audioRef.current) {
                    audioRef.current.currentTime = newTime;
                  }
                  setCurrentTime(newTime);
                }}
              />
              <span className="time-display">
                {formatTime(currentTime)} / {formatTime(trimEnd - trimStart)}
              </span>
            </div>

            <div className="zoom-controls">
              <button className="btn btn-sm" onClick={handleZoomOut} disabled={zoom <= 1}>
                -
              </button>
              <span className="zoom-level">Zoom: {zoom.toFixed(1)}x</span>
              <button className="btn btn-sm" onClick={handleZoomIn} disabled={zoom >= 10}>
                +
              </button>
            </div>
          </div>

          <div className="trim-info">
            <div className="trim-handle-info">
              <span className="trim-label start">Start:</span>
              <span className="trim-value">{formatTime(trimStart)}</span>
            </div>
            <div className="trim-handle-info">
              <span className="trim-label end">End:</span>
              <span className="trim-value">{formatTime(trimEnd)}</span>
            </div>
            <div className="trim-handle-info">
              <span className="trim-label">Duration:</span>
              <span className="trim-value">{formatTime(trimEnd - trimStart)}</span>
            </div>
          </div>

          <p className="waveform-hint">
            Drag the red (start) and blue (end) handles to trim. Scroll horizontally to navigate when zoomed.
          </p>

          <audio ref={audioRef} style={{ display: 'none' }} preload="auto" />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Continue</button>
        </div>
      </div>
    </div>
  );
}

export default AudioWaveformEditor;

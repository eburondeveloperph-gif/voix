import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLogStore } from '@/lib/state';
import { useCctvVisionStore } from '@/lib/vision/cctv-store';
import { ObjectDetectionService } from '@/lib/vision/object-detection-service';

const isVideoUrl = (url: string) => /\.(m3u8|mp4|webm|ogg)(?:[?#].*)?$/i.test(url);

export default function CctvVisionPanel() {
  const {
    config,
    lastResult,
    error,
    closeMonitor,
    setLastFrame,
    setLastResult,
    setError,
  } = useCctvVisionStore();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const usesVideo = useMemo(() => Boolean(config?.streamUrl && isVideoUrl(config.streamUrl)), [config?.streamUrl]);

  const captureAndDetect = useCallback(async () => {
    if (!config || isScanning) return;
    const source = usesVideo ? videoRef.current : imageRef.current;
    if (!source) return;
    const width =
      source instanceof HTMLVideoElement
        ? source.videoWidth || source.clientWidth
        : source.naturalWidth || source.clientWidth;
    const height =
      source instanceof HTMLVideoElement
        ? source.videoHeight || source.clientHeight
        : source.naturalHeight || source.clientHeight;
    if (!width || !height) return;

    setIsScanning(true);
    setError(null);
    try {
      const canvas = canvasRef.current || document.createElement('canvas');
      canvasRef.current = canvas;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create CCTV frame canvas.');
      context.drawImage(source, 0, 0, width, height);
      const frame = canvas.toDataURL('image/jpeg', 0.82);
      setLastFrame(frame);
      const result = await ObjectDetectionService.detectElement(canvas, config.sourceLabel);
      setLastResult(result);

      useLogStore.getState().addTurn({
        role: 'system',
        text: `CCTV object detection: ${result.summary}`,
        isFinal: true,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} If this is RTSP or a cross-origin camera, expose an HTTP/MJPEG/HLS snapshot endpoint with CORS enabled.`
          : 'CCTV detection failed.',
      );
    } finally {
      setIsScanning(false);
    }
  }, [config, isScanning, setError, setLastFrame, setLastResult, usesVideo]);

  useEffect(() => {
    if (!config?.enabled) return undefined;
    const interval = window.setInterval(() => {
      void captureAndDetect();
    }, config.intervalMs);
    return () => window.clearInterval(interval);
  }, [captureAndDetect, config?.enabled, config?.intervalMs]);

  if (!config) return null;

  return (
    <div style={styles.shell} role="dialog" aria-modal="true" aria-label="CCTV object detection monitor">
      <div style={styles.backdrop} onClick={closeMonitor} />
      <section style={styles.panel}>
        <header style={styles.header}>
          <div>
            <p style={styles.kicker}>Beatrice Vision Tool</p>
            <h2 style={styles.title}>{config.sourceLabel}</h2>
            <p style={styles.subtitle}>YOLO-style detection output: boxes, labels, confidence, threat flags.</p>
          </div>
          <button style={styles.iconButton} onClick={closeMonitor} aria-label="Close CCTV monitor">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div style={styles.feedWrap}>
          {usesVideo ? (
            <video
              ref={videoRef}
              src={config.streamUrl}
              style={styles.feed}
              autoPlay
              muted
              playsInline
              controls
              crossOrigin="anonymous"
            />
          ) : (
            <img
              ref={imageRef}
              src={config.streamUrl}
              alt={config.sourceLabel}
              style={styles.feed}
              crossOrigin="anonymous"
            />
          )}
          {lastResult?.annotatedDataUrl ? (
            <img src={lastResult.annotatedDataUrl} alt="Detected CCTV frame overlay" style={styles.overlayPreview} />
          ) : null}
        </div>

        <div style={styles.actionRow}>
          <button style={styles.primaryButton} onClick={captureAndDetect} disabled={isScanning}>
            <span className="material-symbols-outlined">{isScanning ? 'progress_activity' : 'center_focus_strong'}</span>
            {isScanning ? 'Detecting' : 'Scan Frame'}
          </button>
          <span style={styles.intervalText}>Auto every {Math.round(config.intervalMs / 1000)}s</span>
        </div>

        {error ? <div style={styles.error}>{error}</div> : null}

        {lastResult ? (
          <div style={styles.resultPanel}>
            <div style={styles.summary}>{lastResult.summary}</div>
            <div style={styles.detectionList}>
              {lastResult.detections.map(detection => (
                <div key={detection.id} style={styles.detectionRow}>
                  <span style={{ ...styles.dot, background: detection.threat ? '#ef4444' : '#22c55e' }} />
                  <span style={styles.label}>{detection.label}</span>
                  <span style={styles.score}>{Math.round(detection.score * 100)}%</span>
                  <span style={styles.box}>
                    x{Math.round(detection.box.x)} y{Math.round(detection.box.y)} w
                    {Math.round(detection.box.width)} h{Math.round(detection.box.height)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  shell: {
    position: 'fixed',
    inset: 0,
    zIndex: 1600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  backdrop: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.74)',
    backdropFilter: 'blur(18px)',
  },
  panel: {
    position: 'relative',
    width: 'min(940px, 96vw)',
    maxHeight: '92vh',
    overflowY: 'auto',
    borderRadius: 24,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(11, 12, 18, 0.96)',
    padding: 18,
    color: '#f8fafc',
    boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 18,
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  kicker: {
    margin: 0,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: '#a78bfa',
  },
  title: {
    margin: '4px 0 2px',
    fontSize: 22,
    fontWeight: 650,
  },
  subtitle: {
    margin: 0,
    color: '#94a3b8',
    fontSize: 13,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.05)',
    color: '#fff',
    cursor: 'pointer',
  },
  feedWrap: {
    position: 'relative',
    minHeight: 280,
    borderRadius: 18,
    overflow: 'hidden',
    background: '#020617',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  feed: {
    width: '100%',
    maxHeight: '56vh',
    objectFit: 'contain',
    display: 'block',
  },
  overlayPreview: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    background: 'rgba(2,6,23,0.64)',
  },
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: 'none',
    borderRadius: 999,
    padding: '11px 16px',
    color: '#fff',
    background: 'linear-gradient(135deg, #8b5cf6, #d946ef)',
    cursor: 'pointer',
    fontWeight: 650,
  },
  intervalText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  error: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    color: '#fecaca',
    background: 'rgba(239,68,68,0.14)',
    border: '1px solid rgba(239,68,68,0.28)',
    fontSize: 13,
  },
  resultPanel: {
    marginTop: 14,
    borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    padding: 14,
  },
  summary: {
    fontSize: 14,
    lineHeight: 1.5,
    marginBottom: 10,
  },
  detectionList: {
    display: 'grid',
    gap: 8,
  },
  detectionRow: {
    display: 'grid',
    gridTemplateColumns: '10px minmax(90px, 1fr) 56px minmax(150px, 1.4fr)',
    alignItems: 'center',
    gap: 8,
    color: '#cbd5e1',
    fontSize: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  label: {
    color: '#fff',
    fontWeight: 600,
  },
  score: {
    color: '#a7f3d0',
  },
  box: {
    color: '#94a3b8',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
};

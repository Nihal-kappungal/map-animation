import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Globe from 'react-globe.gl';
import { RotateCcw, Search, Play, Square, Map as MapIcon, X } from 'lucide-react';
import * as THREE from 'three';

const EARTH_IMG_URL = '//unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const BUMP_IMG_URL = '//unpkg.com/three-globe/example/img/earth-topology.png';
const GEOJSON_URL = 'https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson';

const DEFAULT_TEXT_OPTIONS = {
  fontSize: 64,
  textColor: '#ffffff',
  bgColor: '#0f172a',
  bgOpacity: 0.7,
  borderColor: '#4f46e5',
  borderWidth: 2,
  borderRadius: 12,
  shadowBlur: 15,
  labelAnimation: 'slideUp'
};

const LABEL_ANIMATION_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'fadeInOut', label: 'Fade in / out' },
  { value: 'slideUp', label: 'Slide up' },
  { value: 'zoomPop', label: 'Zoom pop' },
  { value: 'float', label: 'Float' }
];

const MAP_ANIMATION_OPTIONS = [
  { value: 'borderMoving', label: 'Border moving' },
  { value: 'breathing', label: 'Breathing' },
  { value: 'pulse', label: 'Pulse glow' },
  { value: 'none', label: 'None' }
];

const QUALITY_OPTIONS = [
  { value: '720p', label: '720p', width: 1280, bitrate: 2500000 },
  { value: '1080p', label: '1080p HD', width: 1920, bitrate: 8000000 },
  { value: '4k', label: '4K Ultra HD', width: 3840, bitrate: 50000000 }
];

const EXPORT_FORMAT_OPTIONS = [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'webm', label: 'WebM' }
];

const RECORDING_MIME_CANDIDATES = {
  mp4: [
    { mimeType: 'video/mp4; codecs="avc1.42E01E"', extension: 'mp4', label: 'MP4' },
    { mimeType: 'video/mp4; codecs=avc1.42E01E', extension: 'mp4', label: 'MP4' },
    { mimeType: 'video/mp4', extension: 'mp4', label: 'MP4' }
  ],
  webm: [
    { mimeType: 'video/webm; codecs=h264', extension: 'webm', label: 'WebM H.264' },
    { mimeType: 'video/webm; codecs=vp9', extension: 'webm', label: 'WebM VP9' },
    { mimeType: 'video/webm; codecs=vp8', extension: 'webm', label: 'WebM VP8' },
    { mimeType: 'video/webm', extension: 'webm', label: 'WebM' }
  ]
};

const getQualityOption = (value) => (
  QUALITY_OPTIONS.find(option => option.value === value) || QUALITY_OPTIONS[1]
);

const getRecordingOptions = (format, videoBitsPerSecond) => {
  const requestedCandidates = RECORDING_MIME_CANDIDATES[format] || RECORDING_MIME_CANDIDATES.webm;
  const fallbackCandidates = format === 'webm' ? [] : RECORDING_MIME_CANDIDATES.webm;
  const candidates = [...requestedCandidates, ...fallbackCandidates];

  const selected = candidates.find(candidate => MediaRecorder.isTypeSupported(candidate.mimeType));

  if (!selected) {
    return {
      options: { videoBitsPerSecond },
      extension: 'webm',
      label: 'browser default',
      usedFallback: format !== 'webm'
    };
  }

  return {
    options: { mimeType: selected.mimeType, videoBitsPerSecond },
    extension: selected.extension,
    label: selected.label,
    usedFallback: format !== selected.extension
  };
};

const getCountryBounds = (country) => {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  let lat = 0, lng = 0, pts = 0;
  
  const getC = (coords) => {
    if (typeof coords[0] === 'number') {
       const cLng = coords[0];
       const cLat = coords[1];
       lng += cLng; lat += cLat; pts++;
       if (cLat < minLat) minLat = cLat;
       if (cLat > maxLat) maxLat = cLat;
       if (cLng < minLng) minLng = cLng;
       if (cLng > maxLng) maxLng = cLng;
    } else {
       coords.forEach(getC);
    }
  };
  
  if (country && country.geometry) {
    getC(country.geometry.coordinates);
  }
  
  return { minLat, maxLat, minLng, maxLng, latSum: lat, lngSum: lng, pts };
};

const getCountryCenter = (country) => {
  const bounds = getCountryBounds(country);
  let lat = 0, lng = 0;

  if (bounds.pts > 0) {
    if (bounds.maxLng - bounds.minLng > 300) {
      lat = bounds.latSum / bounds.pts;
      lng = bounds.lngSum / bounds.pts;
    } else {
      lat = (bounds.minLat + bounds.maxLat) / 2;
      lng = (bounds.minLng + bounds.maxLng) / 2;
    }
  }

  let maxSpan = Math.max(bounds.maxLat - bounds.minLat, bounds.maxLng - bounds.minLng);
  if (bounds.maxLng - bounds.minLng > 300) maxSpan = Math.max(bounds.maxLat - bounds.minLat, 60);

  return { lat, lng, maxSpan, bounds };
};

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);
const easeOutCubic = (value) => 1 - Math.pow(1 - clamp(value), 3);

const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const createTextSprite = (text, opts) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  const fontSize = opts.fontSize;
  const fontFamily = 'Outfit, sans-serif';
  
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  const textMetrics = ctx.measureText(text);
  const textWidth = textMetrics.width;
  
  const paddingH = 32;
  const paddingV = 16;
  const shadowBlur = opts.shadowBlur;
  const borderWidth = opts.borderWidth;
  
  const canvasW = textWidth + paddingH * 2 + shadowBlur * 2 + borderWidth * 2;
  const canvasH = fontSize + paddingV * 2 + shadowBlur * 2 + borderWidth * 2;
  
  canvas.width = canvasW;
  canvas.height = canvasH;
  
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  
  // Shadows
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = shadowBlur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0; 
  
  // Background
  ctx.fillStyle = hexToRgba(opts.bgColor, opts.bgOpacity);
  ctx.strokeStyle = opts.borderColor;
  ctx.lineWidth = borderWidth;
  
  const x = shadowBlur + borderWidth;
  const y = shadowBlur + borderWidth;
  const w = textWidth + paddingH * 2;
  const h = fontSize + paddingV * 2;
  const r = opts.borderRadius;
  
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  
  if (borderWidth > 0) {
    ctx.shadowColor = 'transparent';
    ctx.stroke();
  }
  
  // Text
  ctx.fillStyle = opts.textColor;
  ctx.shadowColor = 'transparent';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + fontSize * 0.05);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(spriteMaterial);
  
  // Dynamic scale factor based on country maxSpan so the label isn't huge on small countries
  let scaleFactor = 0.035;
  if (opts.maxSpan) {
     scaleFactor = Math.max(0.006, Math.min(opts.maxSpan * 0.0018, 0.06));
  }
  
  sprite.scale.set(canvas.width * scaleFactor, canvas.height * scaleFactor, 1);
  sprite.userData.baseScale = sprite.scale.clone();
  return sprite;
};

const getOuterRings = (country) => {
  const geometry = country?.geometry;
  if (!geometry) return [];

  if (geometry.type === 'Polygon') {
    return geometry.coordinates[0] ? [geometry.coordinates[0]] : [];
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((polygon) => polygon[0])
      .filter(Boolean);
  }

  return [];
};

const createCountryBorderObject = (country, color, globe) => {
  const group = new THREE.Group();
  const rings = getOuterRings(country);

  rings.forEach((ring) => {
    const points = ring
      .map(([lng, lat]) => globe?.getCoords(lat, lng, 0.045))
      .filter(Boolean);

    if (points.length < 2) return;

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      dashSize: 1.4,
      gapSize: 0.7,
      depthTest: false
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    group.add(line);
  });

  group.userData.baseScale = group.scale.clone();
  return group;
};

const getLabelAnimationState = (style, elapsed) => {
  if (style === 'fadeInOut') {
    return {
      opacity: 0.35 + (Math.sin(elapsed * 2.8) + 1) * 0.325,
      scale: 1,
      altitudeOffset: 0
    };
  }

  if (style === 'slideUp') {
    const progress = easeOutCubic(elapsed / 0.7);
    return {
      opacity: progress,
      scale: 0.96 + progress * 0.04,
      altitudeOffset: -0.045 * (1 - progress)
    };
  }

  if (style === 'zoomPop') {
    const progress = easeOutCubic(elapsed / 0.55);
    const settle = Math.sin(clamp(elapsed / 0.55) * Math.PI) * 0.12;
    return {
      opacity: progress,
      scale: 0.6 + progress * 0.4 + settle,
      altitudeOffset: 0
    };
  }

  if (style === 'float') {
    return {
      opacity: 1,
      scale: 1,
      altitudeOffset: Math.sin(elapsed * 2.2) * 0.018
    };
  }

  return { opacity: 1, scale: 1, altitudeOffset: 0 };
};

function App() {
  const globeEl = useRef();
  
  const [countriesData, setCountriesData] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCountries, setSelectedCountries] = useState([]);
  const [editingIso, setEditingIso] = useState(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAnimIndex, setCurrentAnimIndex] = useState(-1);

  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [previewQuality, setPreviewQuality] = useState('720p');
  const [exportQuality, setExportQuality] = useState('1080p');
  const [exportFormat, setExportFormat] = useState('mp4');
  const [fps, setFps] = useState(60);
  const [earthScale, setEarthScale] = useState(1);
  const [resetBeforePlay, setResetBeforePlay] = useState(true);
  const [cameraArrived, setCameraArrived] = useState(false);
  const [labelAnimationStart, setLabelAnimationStart] = useState(0);
  const [recordingNotice, setRecordingNotice] = useState('');
  
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const wrapperRef = useRef(null);
  const playStartTimeoutRef = useRef(null);
  const recordingFrameRef = useRef(null);
  const captureFrameLoopRef = useRef(null);
  const [scale, setScale] = useState(1);

  const activeCountry = useMemo(() => {
    if (!isPlaying || currentAnimIndex < 0) return null;
    return selectedCountries[currentAnimIndex] || null;
  }, [isPlaying, currentAnimIndex, selectedCountries]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase();
    return countriesData.filter(country => 
      country.properties.ADMIN.toLowerCase().includes(query) ||
      country.properties.ISO_A2.toLowerCase().includes(query)
    ).slice(0, 5);
  }, [searchQuery, countriesData]);

  const revealLabel = useCallback(() => {
    setLabelAnimationStart(performance.now() / 1000);
    setCameraArrived(true);
  }, []);

  const resetCameraView = useCallback((duration = 1000) => {
    setEditingIso(null);
    setCameraArrived(false);
    if (globeEl.current) {
      globeEl.current.pointOfView({ lat: 18, lng: 0, altitude: 2.5 / earthScale }, duration);
    }
  }, [earthScale]);

  const renderSize = useMemo(() => {
    const activeQuality = isPlaying ? exportQuality : previewQuality;
    const base = getQualityOption(activeQuality).width;

    let w = base;
    let h = base * (9/16);

    if (aspectRatio === '9:16') {
      h = base;
      w = base * (9/16);
    } else if (aspectRatio === '1:1') {
      w = base;
      h = base;
    }
    return { 
      cssWidth: Math.round(w), 
      cssHeight: Math.round(h),
      actualWidth: Math.round(w),
      actualHeight: Math.round(h)
    };
  }, [previewQuality, exportQuality, aspectRatio, isPlaying]);

  useEffect(() => {
    const updateScale = () => {
      if (!wrapperRef.current) return;
      const { clientWidth, clientHeight } = wrapperRef.current;
      const padding = 40;
      const availW = clientWidth - padding;
      const availH = clientHeight - padding;
      
      const scaleX = availW / renderSize.cssWidth;
      const scaleY = availH / renderSize.cssHeight;
      setScale(Math.min(scaleX, scaleY, 1));
    };
    
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [renderSize]);

  useEffect(() => {
    fetch(GEOJSON_URL)
      .then(res => res.json())
      .then(data => setCountriesData(data.features))
      .catch(err => console.error("Error loading GeoJSON", err));
  }, []);

  useEffect(() => {
    if (globeEl.current) {
      const renderer = globeEl.current.renderer?.();
      renderer?.setPixelRatio?.(1);

      const controls = globeEl.current.controls();
      controls.autoRotate = !isPlaying && !editingIso;
      controls.autoRotateSpeed = 0.5;
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.enableRotate = true;
      controls.enableZoom = true;
    }
  }, [isPlaying, editingIso]);

  const flyToCountry = useCallback((country, duration = 1500) => {
    const bounds = getCountryBounds(country);
    let lat = 0, lng = 0;
    
    if (bounds.pts > 0) {
      if (bounds.maxLng - bounds.minLng > 300) {
        lat = bounds.latSum / bounds.pts;
        lng = bounds.lngSum / bounds.pts;
      } else {
        lat = (bounds.minLat + bounds.maxLat) / 2;
        lng = (bounds.minLng + bounds.maxLng) / 2;
      }
    }

    let adjustedLngSpan = bounds.maxLng - bounds.minLng;
    let adjustedLatSpan = bounds.maxLat - bounds.minLat;
    
    if (aspectRatio === '9:16') {
        adjustedLngSpan *= (16 / 9);
    } else if (aspectRatio === '16:9') {
        adjustedLatSpan *= (16 / 9);
    }
    
    let maxSpan = Math.max(adjustedLatSpan, adjustedLngSpan);
    if (bounds.maxLng - bounds.minLng > 300) maxSpan = Math.max(adjustedLatSpan, 60);

    let calculatedAltitude = maxSpan * 0.022; 
    
    if (calculatedAltitude < 0.15) calculatedAltitude = 0.15;
    if (calculatedAltitude > 2.5) calculatedAltitude = 2.5;
    
    const finalAltitude = calculatedAltitude / earthScale;

    if (globeEl.current) {
      globeEl.current.pointOfView({ lat, lng, altitude: finalAltitude }, duration);
    }
  }, [aspectRatio, earthScale]);

  const addCountry = (country) => {
    if (!selectedCountries.find(c => c.properties.ISO_A2 === country.properties.ISO_A2)) {
      const newCountry = { 
        ...country, 
        customColor: '#4F46E5',
        mapAnimationStyle: 'borderMoving',
        textOptions: DEFAULT_TEXT_OPTIONS
      };
      setSelectedCountries([...selectedCountries, newCountry]);
      setEditingIso(country.properties.ISO_A2);
      if (!isPlaying) {
         revealLabel();
         flyToCountry(newCountry);
      }
    }
    setSearchQuery('');
  };

  const removeCountry = (isoA2) => {
    setSelectedCountries(selectedCountries.filter(c => c.properties.ISO_A2 !== isoA2));
    if (editingIso === isoA2) {
      setEditingIso(null);
      setCameraArrived(false);
      if (globeEl.current) {
        globeEl.current.pointOfView({ altitude: 2.5 / earthScale }, 1000);
      }
    }
  };

  const updateCountryColor = (isoA2, color) => {
    setSelectedCountries(selectedCountries.map(c => 
      c.properties.ISO_A2 === isoA2 ? { ...c, customColor: color } : c
    ));
  };

  const updateTextOpts = (iso, key, val) => {
    setSelectedCountries(selectedCountries.map(c => {
       if (c.properties.ISO_A2 === iso) {
           return {
               ...c,
               textOptions: {
                   ...c.textOptions,
                   [key]: val
               }
           };
       }
       return c;
    }));
  };

  const updateMapAnimationStyle = (iso, style) => {
    setSelectedCountries(selectedCountries.map(c => 
      c.properties.ISO_A2 === iso ? { ...c, mapAnimationStyle: style } : c
    ));
  };

  useEffect(() => {
    if (!isPlaying && !editingIso && globeEl.current && selectedCountries.length === 0) {
      globeEl.current.pointOfView({ altitude: 2.5 / earthScale }, 1000);
    }
  }, [earthScale, isPlaying, editingIso, selectedCountries.length]);

  const stopRecording = useCallback(() => {
    if (captureFrameLoopRef.current) {
      cancelAnimationFrame(captureFrameLoopRef.current);
      captureFrameLoopRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  useEffect(() => () => {
    window.clearTimeout(playStartTimeoutRef.current);
    if (recordingFrameRef.current) cancelAnimationFrame(recordingFrameRef.current);
    if (captureFrameLoopRef.current) cancelAnimationFrame(captureFrameLoopRef.current);
  }, []);

  useEffect(() => {
    let timeoutId1, timeoutId2;
    
    if (isPlaying && selectedCountries.length > 0) {
      if (currentAnimIndex >= 0 && currentAnimIndex < selectedCountries.length) {
        const targetCountry = selectedCountries[currentAnimIndex];
        
        flyToCountry(targetCountry, 2500);

        timeoutId1 = setTimeout(() => {
          revealLabel();

          if (currentAnimIndex === selectedCountries.length - 1) {
            timeoutId2 = setTimeout(() => {
              setIsPlaying(false);
              setCurrentAnimIndex(-1);
              setCameraArrived(false);
              stopRecording();
              if (globeEl.current) {
                 globeEl.current.pointOfView({ lat: 18, lng: 0, altitude: 2.5 / earthScale }, 2000);
              }
            }, 3000);
          } else {
            timeoutId2 = setTimeout(() => {
               setCameraArrived(false);
               setCurrentAnimIndex(prev => prev + 1);
            }, 3000);
          }
        }, 2500);
      }
    }
    
    return () => {
      clearTimeout(timeoutId1);
      clearTimeout(timeoutId2);
    };
  }, [isPlaying, currentAnimIndex, selectedCountries, earthScale, flyToCountry, revealLabel, stopRecording]);

  const startRecording = useCallback(() => {
    recordedChunksRef.current = [];
    const canvas = document.querySelector('.globe-container canvas');
    if (!canvas) return;

    const bps = getQualityOption(exportQuality).bitrate;

    const manualStream = canvas.captureStream(0);
    const manualTrack = manualStream.getVideoTracks()[0];
    const canRequestFrames = typeof manualTrack?.requestFrame === 'function';
    const stream = canRequestFrames ? manualStream : canvas.captureStream(fps);
    const recordingConfig = getRecordingOptions(exportFormat, bps);
    setRecordingNotice(
      recordingConfig.usedFallback
        ? 'MP4 recording is not available in this browser, so this export will download as WebM.'
        : canRequestFrames
          ? 'Using steady frame pacing for this export.'
          : ''
    );
    
    try {
      const mediaRecorder = new MediaRecorder(stream, recordingConfig.options);
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        if (captureFrameLoopRef.current) {
          cancelAnimationFrame(captureFrameLoopRef.current);
          captureFrameLoopRef.current = null;
        }
        if (recordedChunksRef.current.length === 0) return;
        const blob = new Blob(recordedChunksRef.current, {
          type: recordingConfig.options.mimeType || 'video/webm'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        document.body.appendChild(a);
        a.style = 'display: none';
        a.href = url;
        a.download = `geo-animation-${Date.now()}.${recordingConfig.extension}`;
        a.click();
        window.URL.revokeObjectURL(url);
      };
      
      mediaRecorder.start(500);
      mediaRecorderRef.current = mediaRecorder;

      if (canRequestFrames) {
        const frameInterval = 1000 / fps;
        let nextFrameAt = performance.now();

        const requestNextFrame = (now) => {
          if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;

          if (now >= nextFrameAt) {
            manualTrack.requestFrame();
            nextFrameAt += frameInterval;

            if (now - nextFrameAt > frameInterval) {
              nextFrameAt = now + frameInterval;
            }
          }

          captureFrameLoopRef.current = requestAnimationFrame(requestNextFrame);
        };

        manualTrack.requestFrame();
        captureFrameLoopRef.current = requestAnimationFrame(requestNextFrame);
      }
    } catch (e) {
      console.error("MediaRecorder error:", e);
      setRecordingNotice('Recording failed. Try WebM, 1080p, or 30 FPS for a lighter export.');
    }
  }, [exportFormat, exportQuality, fps]);

  const handlePlay = () => {
    if (selectedCountries.length === 0) return;
    window.clearTimeout(playStartTimeoutRef.current);
    if (recordingFrameRef.current) cancelAnimationFrame(recordingFrameRef.current);

    setIsPlaying(true);
    setEditingIso(null);
    setCurrentAnimIndex(-1);
    setCameraArrived(false);
    setRecordingNotice('');

    if (resetBeforePlay) {
      resetCameraView(900);
    }

    recordingFrameRef.current = requestAnimationFrame(() => {
      recordingFrameRef.current = requestAnimationFrame(() => {
        startRecording();
      });
    });

    playStartTimeoutRef.current = window.setTimeout(() => {
      setCurrentAnimIndex(0);
    }, resetBeforePlay ? 950 : 0);
  };
  
  const handleStop = () => {
    window.clearTimeout(playStartTimeoutRef.current);
    if (recordingFrameRef.current) cancelAnimationFrame(recordingFrameRef.current);
    setIsPlaying(false);
    setCurrentAnimIndex(-1);
    setCameraArrived(false);
    stopRecording();
    resetCameraView(2000);
  };

  const getPolygonAltitude = useCallback((feat) => {
    const selected = selectedCountries.find(c => c.properties.ISO_A2 === feat.properties.ISO_A2);
    const isActive = isPlaying && activeCountry && feat.properties.ISO_A2 === activeCountry.properties.ISO_A2;
    const isEditing = !isPlaying && editingIso === feat.properties.ISO_A2;
    if (isActive || isEditing) {
      const style = selected?.mapAnimationStyle || 'borderMoving';
      if (style === 'breathing') return 0.045;
      if (style === 'pulse') return 0.04;
      return 0.035;
    }
    return 0.01;
  }, [isPlaying, activeCountry, editingIso, selectedCountries]);

  const getPolygonColor = useCallback((feat) => {
    const selected = selectedCountries.find(c => c.properties.ISO_A2 === feat.properties.ISO_A2);
    const isActive = isPlaying && activeCountry && feat.properties.ISO_A2 === activeCountry.properties.ISO_A2;
    const isEditing = !isPlaying && editingIso === feat.properties.ISO_A2;
    
    if (isActive || isEditing) {
      return hexToRgba(selected ? selected.customColor : '#4F46E5', 0.5);
    } else if (selected) {
      return hexToRgba(selected.customColor, 0.15); 
    }
    return 'rgba(255, 255, 255, 0.05)';
  }, [isPlaying, activeCountry, editingIso, selectedCountries]);

  const getPolygonStrokeColor = useCallback((feat) => {
    const selected = selectedCountries.find(c => c.properties.ISO_A2 === feat.properties.ISO_A2);
    const isActive = isPlaying && activeCountry && feat.properties.ISO_A2 === activeCountry.properties.ISO_A2;
    const isEditing = !isPlaying && editingIso === feat.properties.ISO_A2;
    
    if (isActive || isEditing) {
      return hexToRgba(selected ? selected.customColor : '#818CF8', 0.9);
    } else if (selected) {
      return hexToRgba(selected.customColor, 0.5);
    }
    return 'rgba(255, 255, 255, 0.15)';
  }, [isPlaying, activeCountry, editingIso, selectedCountries]);

  const customLayerData = useMemo(() => {
    const targetCountry = isPlaying
      ? activeCountry
      : editingIso
        ? selectedCountries.find(c => c.properties.ISO_A2 === editingIso)
        : null;

    if (!targetCountry) return [];

    const { lat, lng, maxSpan } = getCountryCenter(targetCountry);
    const layerItems = [{
      type: 'countryBorder',
      id: `border-${targetCountry.properties.ISO_A2}-${targetCountry.customColor}-${targetCountry.mapAnimationStyle}`,
      country: targetCountry,
      color: targetCountry.customColor || '#4F46E5',
      animationStyle: targetCountry.mapAnimationStyle || 'borderMoving'
    }];

    if (!cameraArrived) return layerItems;

    layerItems.push({ 
      type: 'label',
      id: `label-${targetCountry.properties.ISO_A2}-${JSON.stringify(targetCountry.textOptions)}`, 
      lat, 
      lng, 
      altitude: 0.08, 
      text: targetCountry.properties.ADMIN,
      animationStart: labelAnimationStart,
      opts: { ...targetCountry.textOptions, maxSpan } 
    });

    return layerItems;
  }, [activeCountry, cameraArrived, isPlaying, editingIso, selectedCountries, labelAnimationStart]);

  return (
    <div className="app-container">
      <div className="globe-wrapper" ref={wrapperRef}>
        <div 
          className="globe-container" 
          data-aspect={aspectRatio}
          style={{ 
            width: renderSize.cssWidth, 
            height: renderSize.cssHeight,
            transform: `scale(${scale})`,
            transformOrigin: 'center center'
          }}
        >
          <Globe
            ref={globeEl}
            width={renderSize.cssWidth}
            height={renderSize.cssHeight}
            rendererConfig={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
            globeImageUrl={EARTH_IMG_URL}
            bumpImageUrl={BUMP_IMG_URL}
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            polygonsData={countriesData}
            polygonAltitude={getPolygonAltitude}
            polygonCapColor={getPolygonColor}
            polygonSideColor={() => 'rgba(0, 0, 0, 0.1)'}
            polygonStrokeColor={getPolygonStrokeColor}
            polygonsTransitionDuration={600}
            customLayerData={customLayerData}
            customThreeObject={(d) => {
              if (d.type === 'countryBorder') {
                return createCountryBorderObject(d.country, d.color, globeEl.current);
              }
              return createTextSprite(d.text, d.opts);
            }}
            customThreeObjectUpdate={(obj, d) => {
              if (d.type === 'countryBorder') {
                obj.userData.animationStyle = d.animationStyle || 'borderMoving';
                obj.userData.color = d.color;
                obj.children.forEach((line) => {
                  line.onBeforeRender = () => {
                    const time = performance.now() / 1000;
                    const style = obj.userData.animationStyle;
                    const pulse = (Math.sin(time * 4) + 1) / 2;
                    line.material.color.set(obj.userData.color);
                    line.material.opacity = style === 'none'
                      ? 0.8
                      : style === 'breathing'
                        ? 0.45 + pulse * 0.35
                        : style === 'pulse'
                          ? 0.35 + ((Math.sin(time * 6) + 1) / 2) * 0.55
                          : 0.65 + pulse * 0.25;
                    line.material.dashOffset = style === 'borderMoving' ? -time * 8 : 0;
                    const scaleAmount = style === 'breathing' ? 1 + Math.sin(time * 3.2) * 0.012 : 1;
                    obj.scale.copy(obj.userData.baseScale).multiplyScalar(scaleAmount);
                  };
                });
                return;
              }

              obj.userData.labelData = d;
              obj.onBeforeRender = () => {
                const labelData = obj.userData.labelData;
                const elapsed = Math.max(0, performance.now() / 1000 - labelData.animationStart);
                const animation = getLabelAnimationState(labelData.opts.labelAnimation, elapsed);
                const coords = globeEl.current?.getCoords(
                  labelData.lat,
                  labelData.lng,
                  labelData.altitude + animation.altitudeOffset
                );
                if (coords) Object.assign(obj.position, coords);
                obj.material.opacity = animation.opacity;
                if (obj.userData.baseScale) {
                  obj.scale.copy(obj.userData.baseScale).multiplyScalar(animation.scale);
                }
              };
            }}
            atmosphereColor="#4F46E5"
            atmosphereAltitude={0.15}
          />
        </div>
      </div>

      <div className="ui-overlay">
        <div className="brand glass-panel">
          <MapIcon size={24} color="#818CF8" />
          <h1>GeoAnimator</h1>
        </div>

        <div className="sidebar glass-panel">
          <div className="sidebar-scroll">
            <div className="sidebar-section search-section">
              <label className="section-label">Select Countries to Animate</label>
              <div className="search-input-wrapper">
                <Search size={18} className="search-icon" />
                <input 
                  type="text" 
                  className="search-input"
                  placeholder="Search a country..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={isPlaying}
                />
              </div>
              
              {searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map((country, idx) => (
                    <div 
                      key={idx} 
                      className="search-result-item"
                      onClick={() => addCountry(country)}
                    >
                      {country.properties.ADMIN} ({country.properties.ISO_A2})
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="sidebar-divider" />

            <div className="sidebar-section">
              <label className="section-label">Recording Settings</label>
              <div className="setting-row">
                <span className="setting-label">Aspect Ratio</span>
                <select className="settings-select" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} disabled={isPlaying}>
                  <option value="16:9">16:9 (Standard)</option>
                  <option value="9:16">9:16 (Shorts/Reels)</option>
                  <option value="1:1">1:1 (Square)</option>
                </select>
              </div>
              <div className="setting-row">
                <span className="setting-label">Preview</span>
                <select className="settings-select" value={previewQuality} onChange={e => setPreviewQuality(e.target.value)} disabled={isPlaying}>
                  {QUALITY_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="setting-row">
                <span className="setting-label">Export</span>
                <select className="settings-select" value={exportQuality} onChange={e => setExportQuality(e.target.value)} disabled={isPlaying}>
                  {QUALITY_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="setting-row">
                <span className="setting-label">Format</span>
                <select className="settings-select" value={exportFormat} onChange={e => setExportFormat(e.target.value)} disabled={isPlaying}>
                  {EXPORT_FORMAT_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="setting-row">
                <span className="setting-label">Framerate</span>
                <select className="settings-select" value={fps} onChange={e => setFps(Number(e.target.value))} disabled={isPlaying}>
                  <option value={30}>30 FPS</option>
                  <option value={60}>60 FPS</option>
                  <option value={120}>120 FPS</option>
                  <option value={144}>144 FPS</option>
                </select>
              </div>
              <div className="setting-row">
                <span className="setting-label">Earth Zoom</span>
                <div className="setting-inline">
                  <input 
                    type="range" 
                    min="0.5" 
                    max="2" 
                    step="0.1" 
                    value={earthScale} 
                    onChange={e => setEarthScale(Number(e.target.value))}
                    className="slider"
                    disabled={isPlaying}
                  />
                  <span className="slider-value">{earthScale.toFixed(1)}x</span>
                </div>
              </div>
              <label className="setting-row checkbox-row">
                <span className="setting-label">Fresh Start</span>
                <input
                  type="checkbox"
                  checked={resetBeforePlay}
                  onChange={e => setResetBeforePlay(e.target.checked)}
                  disabled={isPlaying}
                />
              </label>
              <button
                className="btn btn-secondary btn-compact"
                onClick={() => resetCameraView()}
                disabled={isPlaying}
              >
                <RotateCcw size={16} />
                Reset View
              </button>
              {recordingNotice && (
                <div className="notice-text">{recordingNotice}</div>
              )}
            </div>

            <div className="sidebar-divider" />

            <div className="sidebar-section">
              <div className="section-header">
                <label className="section-label">Animation Sequence</label>
                <span className="badge">{selectedCountries.length}</span>
              </div>
              
              {selectedCountries.length === 0 ? (
                <div className="empty-state">No countries selected yet.</div>
              ) : (
                <div className="country-list">
                  {selectedCountries.map((country, idx) => {
                    const isEditing = editingIso === country.properties.ISO_A2;
                    return (
                      <div key={idx} style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.25rem'}}>
                        <div 
                          className={`country-item ${isEditing ? 'editing' : ''}`}
                          style={{
                             borderColor: (activeCountry && activeCountry.properties.ISO_A2 === country.properties.ISO_A2) || isEditing
                              ? country.customColor : 'rgba(255,255,255,0.05)',
                             background: (activeCountry && activeCountry.properties.ISO_A2 === country.properties.ISO_A2) || isEditing
                              ? hexToRgba(country.customColor, 0.1) : 'rgba(255,255,255,0.03)',
                             cursor: isPlaying ? 'default' : 'pointer'
                          }}
                          onClick={() => {
                             if (!isPlaying) {
                                if (isEditing) {
                                    setEditingIso(null);
                                    setCameraArrived(false);
                                } else {
                                    setEditingIso(country.properties.ISO_A2);
                                    revealLabel();
                                    flyToCountry(country);
                                }
                             }
                          }}
                        >
                          <div className="country-item-content">
                            <input 
                              type="color" 
                              className="color-picker"
                              value={country.customColor}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => updateCountryColor(country.properties.ISO_A2, e.target.value)}
                              disabled={isPlaying}
                            />
                            <span>{idx + 1}. {country.properties.ADMIN}</span>
                          </div>
                          <div className="country-item-actions">
                            <button 
                              className="icon-btn danger" 
                              onClick={(e) => {
                                 e.stopPropagation();
                                 removeCountry(country.properties.ISO_A2);
                              }}
                              disabled={isPlaying}
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>

                        {isEditing && !isPlaying && (
                          <div className="label-editing-panel">
                            <div className="panel-header">Animation Options</div>

                            <div className="setting-row">
                              <span className="setting-label">Map Style</span>
                              <select
                                className="settings-select"
                                value={country.mapAnimationStyle || 'borderMoving'}
                                onChange={e => updateMapAnimationStyle(country.properties.ISO_A2, e.target.value)}
                              >
                                {MAP_ANIMATION_OPTIONS.map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>

                            <div className="setting-row">
                              <span className="setting-label">Label Motion</span>
                              <select
                                className="settings-select"
                                value={country.textOptions.labelAnimation || 'slideUp'}
                                onChange={e => updateTextOpts(country.properties.ISO_A2, 'labelAnimation', e.target.value)}
                              >
                                {LABEL_ANIMATION_OPTIONS.map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>

                            <div className="panel-header">Label Options</div>
                            
                            <div className="setting-row">
                              <span className="setting-label">Text Color</span>
                              <input type="color" className="color-picker" value={country.textOptions.textColor} onChange={e => updateTextOpts(country.properties.ISO_A2, 'textColor', e.target.value)} />
                            </div>
                            
                            <div className="setting-row">
                              <span className="setting-label">Background</span>
                              <div className="setting-inline">
                                <input type="color" className="color-picker" value={country.textOptions.bgColor} onChange={e => updateTextOpts(country.properties.ISO_A2, 'bgColor', e.target.value)} />
                                <input type="range" className="slider" min="0" max="1" step="0.1" value={country.textOptions.bgOpacity} onChange={e => updateTextOpts(country.properties.ISO_A2, 'bgOpacity', Number(e.target.value))} />
                              </div>
                            </div>

                            <div className="setting-row">
                              <span className="setting-label">Border</span>
                              <div className="setting-inline">
                                <input type="color" className="color-picker" value={country.textOptions.borderColor} onChange={e => updateTextOpts(country.properties.ISO_A2, 'borderColor', e.target.value)} />
                                <input type="range" className="slider" min="0" max="10" value={country.textOptions.borderWidth} onChange={e => updateTextOpts(country.properties.ISO_A2, 'borderWidth', Number(e.target.value))} />
                              </div>
                            </div>

                            <div className="setting-row">
                              <span className="setting-label">Size</span>
                              <input type="range" className="slider" min="32" max="120" value={country.textOptions.fontSize} onChange={e => updateTextOpts(country.properties.ISO_A2, 'fontSize', Number(e.target.value))} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="action-buttons">
                {!isPlaying ? (
                  <button 
                    className="btn btn-primary" 
                    onClick={handlePlay}
                    disabled={selectedCountries.length === 0}
                  >
                    <Play size={18} />
                    Start Animation
                  </button>
                ) : (
                  <button 
                    className="btn btn-secondary" 
                    onClick={handleStop}
                  >
                    <Square size={18} fill="white" />
                    Stop
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bottom-bar">
          {isPlaying && (
            <div className="recording-status glass-panel">
              <div className="pulse-dot"></div>
              <span style={{ fontWeight: 600 }}>Animation in Progress</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginLeft: '0.5rem' }}>
                Screen record for high-quality video
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Globe from 'react-globe.gl';
import { Search, Play, Square, Map as MapIcon, X, Check, Camera } from 'lucide-react';
import * as THREE from 'three';

const EARTH_IMG_URL = '//unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const BUMP_IMG_URL = '//unpkg.com/three-globe/example/img/earth-topology.png';
const GEOJSON_URL = 'https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson';

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
  ctx.shadowOffsetY = 0; // Symmetrical shadow for perfect centering
  
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
  
  const scaleFactor = 0.035; 
  sprite.scale.set(canvas.width * scaleFactor, canvas.height * scaleFactor, 1);
  return sprite;
};

function App() {
  const globeEl = useRef();
  
  const [countriesData, setCountriesData] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCountries, setSelectedCountries] = useState([]);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAnimIndex, setCurrentAnimIndex] = useState(-1);
  const [activeCountry, setActiveCountry] = useState(null);

  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [quality, setQuality] = useState('1080p');
  const [fps, setFps] = useState(60);
  const [earthScale, setEarthScale] = useState(1);
  const [pulse, setPulse] = useState(false);
  const [cameraArrived, setCameraArrived] = useState(false);
  const [textOptions, setTextOptions] = useState({
    fontSize: 64,
    textColor: '#ffffff',
    bgColor: '#0f172a',
    bgOpacity: 0.7,
    borderColor: '#4f46e5',
    borderWidth: 2,
    borderRadius: 12,
    shadowBlur: 15
  });
  
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const wrapperRef = useRef(null);
  const [scale, setScale] = useState(1);

  const renderSize = useMemo(() => {
    let base = 1920;
    if (quality === '720p') base = 1280;
    else if (quality === '1080p') base = 1920;
    else if (quality === '4k') base = 3840;

    let w = base;
    let h = base * (9/16);

    if (aspectRatio === '9:16') {
      h = base;
      w = base * (9/16);
    } else if (aspectRatio === '1:1') {
      w = base;
      h = base;
    }
    
    // Adjust for device pixel ratio so that the internal WebGL buffer matches the EXACT target resolution
    const dpr = window.devicePixelRatio || 1;
    return { 
      cssWidth: Math.round(w / dpr), 
      cssHeight: Math.round(h / dpr),
      actualWidth: Math.round(w),
      actualHeight: Math.round(h)
    };
  }, [quality, aspectRatio]);

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

  // Fetch GeoJSON
  useEffect(() => {
    fetch(GEOJSON_URL)
      .then(res => res.json())
      .then(data => {
        setCountriesData(data.features);
      })
      .catch(err => console.error("Error loading GeoJSON", err));
  }, []);

  // Set initial globe state
  useEffect(() => {
    if (globeEl.current) {
      const controls = globeEl.current.controls();
      controls.autoRotate = !isPlaying && selectedCountries.length === 0;
      controls.autoRotateSpeed = 0.5;
      controls.enableDamping = true;
    }
  }, [isPlaying, selectedCountries.length]);

  // Handle Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const query = searchQuery.toLowerCase();
    const results = countriesData.filter(country => 
      country.properties.ADMIN.toLowerCase().includes(query) ||
      country.properties.ISO_A2.toLowerCase().includes(query)
    ).slice(0, 5); // Limit results
    setSearchResults(results);
  }, [searchQuery, countriesData]);

  const addCountry = (country) => {
    if (!selectedCountries.find(c => c.properties.ISO_A2 === country.properties.ISO_A2)) {
      setSelectedCountries([...selectedCountries, { ...country, customColor: '#4F46E5' }]);
    }
    setSearchQuery('');
    setSearchResults([]);
  };

  const removeCountry = (isoA2) => {
    setSelectedCountries(selectedCountries.filter(c => c.properties.ISO_A2 !== isoA2));
    if (activeCountry && activeCountry.properties.ISO_A2 === isoA2) {
      setActiveCountry(null);
    }
  };

  const updateCountryColor = (isoA2, color) => {
    setSelectedCountries(selectedCountries.map(c => 
      c.properties.ISO_A2 === isoA2 ? { ...c, customColor: color } : c
    ));
  };

  // Adjust camera when earthScale changes (idle only)
  useEffect(() => {
    if (!isPlaying && globeEl.current && selectedCountries.length === 0) {
      globeEl.current.pointOfView({ altitude: 2.5 / earthScale }, 1000);
    }
  }, [earthScale, isPlaying, selectedCountries.length]);

  // Animation Sequence
  useEffect(() => {
    let timeoutId1, timeoutId2;
    
    if (isPlaying && selectedCountries.length > 0) {
      if (currentAnimIndex >= 0 && currentAnimIndex < selectedCountries.length) {
        const targetCountry = selectedCountries[currentAnimIndex];
        setActiveCountry(targetCountry);
        
        const bounds = getCountryBounds(targetCountry);
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
        
        // Compensate for aspect ratio constraints to ensure full visibility
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
          globeEl.current.pointOfView({ lat, lng, altitude: finalAltitude }, 2500);
        }

        timeoutId1 = setTimeout(() => {
          setCameraArrived(true);

          if (currentAnimIndex === selectedCountries.length - 1) {
            timeoutId2 = setTimeout(() => {
              setIsPlaying(false);
              setCurrentAnimIndex(-1);
              setActiveCountry(null);
              setCameraArrived(false);
              setPulse(false);
              stopRecording();
              if (globeEl.current) {
                 globeEl.current.pointOfView({ altitude: 2.5 / earthScale }, 2000);
              }
            }, 3000);
          } else {
            timeoutId2 = setTimeout(() => {
               setCameraArrived(false);
               setCurrentAnimIndex(prev => prev + 1);
            }, 3000);
          }
        }, 2500);
      } else if (currentAnimIndex === -1) {
         setCurrentAnimIndex(0);
      }
    }
    
    return () => {
      clearTimeout(timeoutId1);
      clearTimeout(timeoutId2);
    };
  }, [isPlaying, currentAnimIndex, selectedCountries, earthScale]);

  // Pulse effect for animated outline and keeping WebGL render loop alive
  useEffect(() => {
    let interval;
    if (isPlaying && activeCountry) {
      interval = setInterval(() => {
        setPulse(p => !p);
      }, 600); // 600ms syncs with 600ms transition, creating an infinite render loop
    } else {
      setPulse(false);
    }
    return () => clearInterval(interval);
  }, [isPlaying, activeCountry]);

  const startRecording = () => {
    recordedChunksRef.current = [];
    const canvas = document.querySelector('.globe-container canvas');
    if (!canvas) return;

    let bps = 8000000; // 1080p default
    if (quality === '4k') bps = 50000000; // 50 Mbps for pristine 4K
    if (quality === '720p') bps = 2500000;

    const stream = canvas.captureStream(fps);
    let options = { videoBitsPerSecond: bps };
    
    // VP9 produces significantly better quality than VP8 for screen recordings
    if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
      options.mimeType = 'video/webm; codecs=vp9';
    } else if (MediaRecorder.isTypeSupported('video/webm; codecs=h264')) {
      options.mimeType = 'video/webm; codecs=h264';
    } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8')) {
      options.mimeType = 'video/webm; codecs=vp8';
    } else {
      options.mimeType = 'video/webm';
    }
    
    try {
      const mediaRecorder = new MediaRecorder(stream, options);
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        if (recordedChunksRef.current.length === 0) {
          console.error("Recording failed: No video data captured.");
          return;
        }
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        document.body.appendChild(a);
        a.style = 'display: none';
        a.href = url;
        a.download = `geo-animation-${Date.now()}.webm`;
        a.click();
        window.URL.revokeObjectURL(url);
      };
      
      // Start recording with a 500ms timeslice to ensure data is continuously pushed
      mediaRecorder.start(500);
      mediaRecorderRef.current = mediaRecorder;
    } catch (e) {
      console.error("MediaRecorder error:", e);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  // Handle Play
  const handlePlay = () => {
    if (selectedCountries.length === 0) return;
    setIsPlaying(true);
    setCurrentAnimIndex(-1);
    startRecording();
  };
  
  const handleStop = () => {
    setIsPlaying(false);
    setCurrentAnimIndex(-1);
    setActiveCountry(null);
    setCameraArrived(false);
    stopRecording();
    if (globeEl.current) {
      globeEl.current.pointOfView({ altitude: 2.5 / earthScale }, 2000);
    }
  };

  const updateTextOpts = (key, val) => {
    setTextOptions(prev => ({ ...prev, [key]: val }));
  };

  // Polygon colors
  const getPolygonColor = useCallback((feat) => {
    const selected = selectedCountries.find(c => c.properties.ISO_A2 === feat.properties.ISO_A2);
    
    if (activeCountry && feat.properties.ISO_A2 === activeCountry.properties.ISO_A2) {
      return hexToRgba(selected ? selected.customColor : '#4F46E5', 0.6);
    } else if (selected) {
      return hexToRgba(selected.customColor, 0.15); // Show faint highlight for all selected
    }
    return 'rgba(255, 255, 255, 0.05)';
  }, [activeCountry, selectedCountries]);

  const getPolygonStrokeColor = useCallback((feat) => {
    const selected = selectedCountries.find(c => c.properties.ISO_A2 === feat.properties.ISO_A2);
    
    if (activeCountry && feat.properties.ISO_A2 === activeCountry.properties.ISO_A2) {
      const baseColor = selected ? selected.customColor : '#818CF8';
      // Pulse the outline between full brightness and low opacity
      return pulse ? baseColor : hexToRgba(baseColor, 0.1);
    } else if (selected) {
      return hexToRgba(selected.customColor, 0.5);
    }
    return 'rgba(255, 255, 255, 0.15)';
  }, [activeCountry, selectedCountries, pulse]);

  // Active country 3D Label data
  const labelData = useMemo(() => {
    if (!activeCountry || !cameraArrived) return [];
    const bounds = getCountryBounds(activeCountry);
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
    
    return [{ 
      id: activeCountry.properties.ISO_A2, 
      lat, 
      lng, 
      altitude: 0.08, 
      text: activeCountry.properties.ADMIN,
      opts: textOptions 
    }];
  }, [activeCountry, textOptions]);

  return (
    <div className="app-container">
      {/* 3D Globe */}
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
            globeImageUrl={EARTH_IMG_URL}
            bumpImageUrl={BUMP_IMG_URL}
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            polygonsData={countriesData}
            polygonAltitude={d => {
              if (activeCountry && d.properties.ISO_A2 === activeCountry.properties.ISO_A2) {
                // "Breathing" animated 3D overlay
                return pulse ? 0.045 : 0.025;
              }
              return 0.01;
            }}
            polygonCapColor={getPolygonColor}
            polygonSideColor={() => 'rgba(0, 0, 0, 0.1)'}
            polygonStrokeColor={getPolygonStrokeColor}
            polygonsTransitionDuration={600}
            customLayerData={labelData}
            customThreeObject={(d) => createTextSprite(d.text, d.opts)}
            atmosphereColor="#4F46E5"
            atmosphereAltitude={0.15}
          />
        </div>
      </div>

      {/* UI Overlay */}
      <div className="ui-overlay">
        <div className="top-bar">
          <div className="brand glass-panel">
            <MapIcon size={24} color="#818CF8" />
            <h1>GeoAnimator</h1>
          </div>
          
          <div className="controls-panel glass-panel">
            <div className="search-section">
              <label>Select Countries to Animate</label>
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

            <div className="recording-settings">
              <label>Recording Aspect Ratio</label>
              <div className="settings-row">
                <select className="settings-select" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} disabled={isPlaying}>
                  <option value="16:9">16:9 (Standard)</option>
                  <option value="9:16">9:16 (Shorts/Reels)</option>
                  <option value="1:1">1:1 (Square)</option>
                </select>
              </div>
              <label>Video Quality</label>
              <div className="settings-row">
                <select className="settings-select" value={quality} onChange={e => setQuality(e.target.value)} disabled={isPlaying}>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p HD</option>
                  <option value="4k">4K Ultra HD</option>
                </select>
              </div>
              <label>Framerate (FPS)</label>
              <div className="settings-row">
                <select className="settings-select" value={fps} onChange={e => setFps(Number(e.target.value))} disabled={isPlaying}>
                  <option value={30}>30 FPS (Stable)</option>
                  <option value={60}>60 FPS (Smooth)</option>
                </select>
              </div>
              <div className="setting-group" style={{display:'flex', alignItems:'center', gap:'0.5rem', marginTop:'0.5rem'}}>
                <label style={{fontSize:'0.8rem', color:'var(--text-muted)'}}>Earth Zoom</label>
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

            <div className="selected-countries">
              <h3>
                Animation Sequence
                <span className="badge">{selectedCountries.length}</span>
              </h3>
              
              {selectedCountries.length === 0 ? (
                <div style={{color: 'var(--text-muted)', fontSize: '0.875rem', fontStyle: 'italic', padding: '0.5rem 0'}}>
                  No countries selected yet.
                </div>
              ) : (
                <div className="country-list">
                  {selectedCountries.map((country, idx) => (
                    <div 
                      key={idx} 
                      className="country-item"
                      style={{
                         borderColor: (activeCountry && activeCountry.properties.ISO_A2 === country.properties.ISO_A2) 
                          ? country.customColor : 'rgba(255,255,255,0.05)',
                         background: (activeCountry && activeCountry.properties.ISO_A2 === country.properties.ISO_A2) 
                          ? hexToRgba(country.customColor, 0.1) : 'rgba(255,255,255,0.03)'
                      }}
                    >
                      <div className="country-item-content">
                        <input 
                          type="color" 
                          className="color-picker"
                          value={country.customColor}
                          onChange={(e) => updateCountryColor(country.properties.ISO_A2, e.target.value)}
                          disabled={isPlaying}
                        />
                        <span>{idx + 1}. {country.properties.ADMIN}</span>
                      </div>
                      <div className="country-item-actions">
                        <button 
                          className="icon-btn danger" 
                          onClick={() => removeCountry(country.properties.ISO_A2)}
                          disabled={isPlaying}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

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

        <div className="glass-panel text-settings-panel">
          <h3>Label Styling</h3>
          
          <div className="setting-group">
            <label>Text Color</label>
            <input type="color" className="color-picker" value={textOptions.textColor} onChange={e => updateTextOpts('textColor', e.target.value)} disabled={isPlaying} />
          </div>
          
          <div className="setting-group">
            <label>Background</label>
            <div className="setting-controls">
              <input type="color" className="color-picker" value={textOptions.bgColor} onChange={e => updateTextOpts('bgColor', e.target.value)} disabled={isPlaying} />
              <input type="range" className="slider" min="0" max="1" step="0.1" value={textOptions.bgOpacity} onChange={e => updateTextOpts('bgOpacity', Number(e.target.value))} disabled={isPlaying} title="Opacity" />
            </div>
          </div>

          <div className="setting-group">
            <label>Border</label>
            <div className="setting-controls">
              <input type="color" className="color-picker" value={textOptions.borderColor} onChange={e => updateTextOpts('borderColor', e.target.value)} disabled={isPlaying} />
              <input type="range" className="slider" min="0" max="10" value={textOptions.borderWidth} onChange={e => updateTextOpts('borderWidth', Number(e.target.value))} disabled={isPlaying} title="Width" />
            </div>
          </div>

          <div className="setting-group">
            <label>Size</label>
            <input type="range" className="slider" min="32" max="120" value={textOptions.fontSize} onChange={e => updateTextOpts('fontSize', Number(e.target.value))} disabled={isPlaying} />
          </div>
          
          <div className="setting-group">
            <label>Rounding</label>
            <input type="range" className="slider" min="0" max="40" value={textOptions.borderRadius} onChange={e => updateTextOpts('borderRadius', Number(e.target.value))} disabled={isPlaying} />
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

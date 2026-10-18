import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { hasCoordinates, personState } from './feed';
import type { MapPerson, Mode } from './feed';

type Props = { people: MapPerson[]; mode: Mode; selectedId: string | null; onSelect(id: string | null): void; reducedMotion: boolean };
const CENTER = { lat: 34.188, lng: -118.15 };
const imagery = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
export default function LiveMapScene({ people, mode, selectedId, onSelect, reducedMotion }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const pinLayer = useRef<HTMLDivElement>(null);
  const credits = useRef<HTMLDivElement>(null);
  const viewer = useRef<Cesium.Viewer | null>(null);
  const [status, setStatus] = useState<'loading' | 'satellite' | 'fallback'>('loading');
  const [ready, setReady] = useState(0);
  const [reset, setReset] = useState(0);
  const statusRef = useRef(status);
  statusRef.current = status;
  const selected = people.find((person) => person.client.id === selectedId);
  const positioned = people.filter(hasCoordinates);

  useEffect(() => {
    if (!host.current || !credits.current) return;
    let disposed = false;
    let instance: Cesium.Viewer | null = null;
    let removeProjection: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let loaded = false;
    let failed = false;
    const fail = () => { if (!disposed) { failed = true; if (instance && !instance.isDestroyed()) instance.useDefaultRenderLoop = false; setStatus('fallback'); } };
    try {
      Cesium.Ion.defaultAccessToken = '';
      instance = new Cesium.Viewer(host.current, {
        animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
        sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false,
        selectionIndicator: false, infoBox: false, baseLayer: false, creditContainer: credits.current,
        shouldAnimate: false, requestRenderMode: true, maximumRenderTimeChange: Infinity,
        msaaSamples: 1, contextOptions: { webgl: { preserveDrawingBuffer: true, powerPreference: 'low-power' } },
      });
      viewer.current = instance;
      instance.resolutionScale = Math.min(window.devicePixelRatio, 1.5) / window.devicePixelRatio;
      instance.scene.backgroundColor = Cesium.Color.fromCssColorString('#101e25');
      instance.scene.globe.baseColor = Cesium.Color.fromCssColorString('#263c44');
      instance.scene.globe.enableLighting = false;
      instance.scene.globe.depthTestAgainstTerrain = false;
      instance.scene.fog.enabled = false;
      if (instance.scene.skyBox) instance.scene.skyBox.show = false;
      instance.scene.screenSpaceCameraController.minimumZoomDistance = 500;
      instance.scene.screenSpaceCameraController.maximumZoomDistance = 500000;
      instance.scene.renderError.addEventListener(fail);
      instance.canvas.addEventListener('webglcontextlost', fail);
      let errors = 0;
      void Cesium.ArcGisMapServerImageryProvider.fromUrl(imagery, { credit: 'Esri · Maxar · Earthstar Geographics · GIS User Community', enablePickFeatures: false }).then((provider) => {
        if (disposed || failed || !instance || instance.isDestroyed()) return;
        const requestImage = provider.requestImage.bind(provider);
        provider.requestImage = (...args) => requestImage(...args)?.then((image) => {
          if (image && !disposed && !failed && !loaded) { loaded = true; clearTimeout(timeout); setStatus('satellite'); }
          return image;
        });
        const layer = instance.imageryLayers.addImageryProvider(provider);
        layer.brightness = .68; layer.contrast = 1.15; layer.saturation = .55;
        provider.errorEvent.addEventListener(() => { errors++; if (errors > 12) fail(); });
      }).catch(fail);
      const occluder = new Cesium.EllipsoidalOccluder(instance.scene.globe.ellipsoid, instance.camera.positionWC);
      const vector = new Cesium.Cartesian3();
      removeProjection = instance.scene.preRender.addEventListener(() => {
        if (!instance || instance.isDestroyed() || !pinLayer.current || statusRef.current === 'fallback') return;
        occluder.cameraPosition = instance.camera.positionWC;
        for (const pin of pinLayer.current.querySelectorAll<HTMLElement>('[data-lat]')) {
          const anchor = Cesium.Cartesian3.fromDegrees(Number(pin.dataset.lng), Number(pin.dataset.lat), 30);
          const screen = Cesium.SceneTransforms.worldToWindowCoordinates(instance.scene, anchor);
          Cesium.Cartesian3.subtract(anchor, instance.camera.positionWC, vector);
          const visible = screen && Cesium.Cartesian3.dot(vector, instance.camera.directionWC) > 0 && occluder.isPointVisible(anchor) && screen.x > -50 && screen.y > -50 && screen.x < instance.canvas.clientWidth + 50 && screen.y < instance.canvas.clientHeight + 50;
          pin.style.visibility = visible ? 'visible' : 'hidden';
          if (screen && visible) pin.style.transform = `translate(${screen.x}px,${screen.y}px) translate(-50%,-50%)`;
        }
      });
      setReady((value) => value + 1);
      timeout = setTimeout(() => { if (!loaded) fail(); }, 14000);
    } catch { fail(); }
    return () => { disposed = true; clearTimeout(timeout); removeProjection?.(); if (instance && !instance.isDestroyed()) instance.destroy(); viewer.current = null; };
  }, []);

  useEffect(() => { const instance = viewer.current; if (instance && !instance.isDestroyed()) instance.scene.requestRender(); }, [people, ready, status]);

  useEffect(() => {
    const instance = viewer.current;
    if (!instance || instance.isDestroyed() || status === 'fallback') return;
    const valid = selected && hasCoordinates(selected);
    // A selected patient without a position must not appear at the map center.
    if (selected && !valid) return;
    const lng = valid ? selected.client.lng! : CENTER.lng;
    const lat = valid ? selected.client.lat! : CENTER.lat;
    instance.camera.cancelFlight();
    const target = Cesium.Cartesian3.fromDegrees(lng, lat);
    const offset = new Cesium.HeadingPitchRange(Cesium.Math.toRadians(10), Cesium.Math.toRadians(-55), valid ? 5000 * Math.max(1, 300 / Math.max(180, instance.canvas.clientHeight)) : 10500);
    if (reducedMotion || !selected) { instance.camera.lookAt(target, offset); instance.camera.lookAtTransform(Cesium.Matrix4.IDENTITY); }
    else { void instance.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), { duration: .8, offset }); }
  }, [selectedId, selected?.client.lat, selected?.client.lng, ready, reset, reducedMotion, status]);

  const fallbackStyle = (person: MapPerson) => status === 'fallback' ? { left: `${Math.max(8, Math.min(92, (person.client.lng! + 118.176) / .052 * 100))}%`, top: `${Math.max(22, Math.min(84, (34.215 - person.client.lat!) / .052 * 100))}%`, visibility: 'visible' as const, transform: 'translate(-50%,-50%)' } : {};
  return <div className={`hm-map-scene ${status === 'fallback' ? 'hm-map-fallback' : ''}`}>
    <div className="hm-cesium-host" ref={host} aria-label="Interactive satellite map around west Altadena" />
    {status === 'fallback' && <div className="hm-fallback-geography"><svg viewBox="0 0 1000 850" preserveAspectRatio="none" aria-hidden="true"><defs><pattern id="hm-grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="#4a6871" strokeWidth=".6" /></pattern></defs><rect width="1000" height="850" fill="url(#hm-grid)" /><g fill="none" stroke="#617e74" opacity=".22">{[0, 30, 60, 90, 120, 150].map((offset) => <path key={offset} d={`M-60 ${180 + offset}Q180 ${-70 + offset} 420 ${140 + offset}T1060 ${60 + offset}`} />)}</g><text x="450" y="160">SAN GABRIEL MOUNTAINS</text><text x="430" y="530">WEST ALTADENA</text><text x="490" y="730">PASADENA</text></svg></div>}
    <div className="hm-map-vignette" />
    <div className="hm-map-controls"><button onClick={() => { onSelect(null); setReset((value) => value + 1); }}>Recenter map<span>↗</span></button><span>{status === 'satellite' ? 'SATELLITE' : status === 'fallback' ? 'GEOGRAPHIC FALLBACK' : 'LOADING IMAGERY'}</span></div>
    <div className="hm-live-pins" ref={pinLayer}>{positioned.map((person) => {
      const state = personState(person, mode);
      const selected = selectedId === person.client.id;
      return <button className={`hm-pin hm-tone-${state.tone} ${selected ? 'hm-pin-selected' : ''} ${state.tone === 'red' && mode === 'crisis' ? 'hm-pin-urgent' : ''}`} data-lat={person.client.lat} data-lng={person.client.lng} style={fallbackStyle(person)} key={person.client.id} onClick={() => onSelect(person.client.id)} aria-pressed={selected} aria-label={`${person.client.name}: ${state.label}`}><span className="hm-pin-dot"><i /></span>{selected && <span className="hm-pin-label"><small>{state.label}</small><strong>{person.client.name}</strong><span>{person.client.needs_ride ? 'Needs a ride · ' : ''}Fictional position</span></span>}</button>;
    })}</div>
    <div className="hm-map-legend"><span><i className="hm-tone-red" />Needs a person now</span><span><i className="hm-tone-amber" />Follow up / no answer</span><span><i className="hm-tone-mint" />Confirmed okay</span><span><i className="hm-tone-blue" />Calling</span></div>
    <div className="hm-map-credits"><span>{status === 'fallback' ? 'Illustrated geographic fallback · rough coordinates' : 'Present-day satellite imagery'}</span><div ref={credits} /></div>
  </div>;
}

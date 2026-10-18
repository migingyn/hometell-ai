import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { cameraAt } from './camera';
import { SITES } from './scenario';
import { theme } from './theme';
import {
  fallbackPoint, fallbackRelocationPath, relocationEndpointVisible,
  relocationGeometry, relocationHeightsChanged,
} from './relocation';
import type { PlaybackState, ScenarioSnapshot } from './types';
import { Icon } from './icons';
import { camerasAt } from './cctv';
import type { ScenarioCamera } from './cctv';

type Props = {state:PlaybackState;snapshot:ScenarioSnapshot;reducedMotion:boolean;exploring:boolean;onExplore:()=>void;onSelect:(id:string|null)=>void;camerasEnabled:boolean;activeCameraId:string|null;focusedCamera:ScenarioCamera|null;onCameraSelect:(id:ScenarioCamera['id'])=>void};
type MapStatus = 'loading'|'satellite'|'fallback';
const imageryUrl = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';

export function MapScene({ state, snapshot, reducedMotion, exploring, onExplore, onSelect, camerasEnabled, activeCameraId, focusedCamera, onCameraSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<Cesium.Viewer | null>(null);
  const pinLayer = useRef<HTMLDivElement>(null);
  const credits = useRef<HTMLDivElement>(null);
  const arc = useRef<Cesium.Polyline | null>(null);
  const [status, setStatus] = useState<MapStatus>('loading');
  const [terrain, setTerrain] = useState(false);
  const [mapReady, setMapReady] = useState(0);
  const onExploreRef = useRef(onExplore);
  onExploreRef.current = onExplore;
  const statusRef = useRef(status);
  statusRef.current = status;
  const approvedRef = useRef(false);
  approvedRef.current = Boolean(snapshot.approvedFacts);

  useEffect(() => {
    if (!container.current || !credits.current) return;
    let disposed = false;
    let v: Cesium.Viewer | null = null;
    let removeProjection: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout>;
    let failures = 0;
    let imageryLoaded = false;
    let failed = false;
    let terrainProvider: Cesium.CesiumTerrainProvider | null = null;
    let arcPositions: Cesium.Cartesian3[] | null = null;
    let arcCollection: Cesium.PolylineCollection | null = null;
    let arcHeights: number[] | null = null;
    const fail = () => { if (!disposed) { failed = true; setStatus('fallback'); } };
    try {
      Cesium.Ion.defaultAccessToken = '';
      v = new Cesium.Viewer(container.current, {
        animation:false, timeline:false, baseLayerPicker:false, geocoder:false, homeButton:false,
        sceneModePicker:false, navigationHelpButton:false, fullscreenButton:false, selectionIndicator:false,
        infoBox:false, baseLayer:false, creditContainer:credits.current, shouldAnimate:false,
        contextOptions:{webgl:{preserveDrawingBuffer:true}}, msaaSamples:2,
      });
      viewer.current = v;
      v.resolutionScale = Math.min(window.devicePixelRatio, 1.5) / window.devicePixelRatio;
      v.scene.backgroundColor = Cesium.Color.fromCssColorString(theme.colors.canvas);
      v.scene.globe.baseColor = Cesium.Color.fromCssColorString(theme.colors.faint);
      v.scene.globe.enableLighting = false;
      v.scene.globe.depthTestAgainstTerrain = false;
      v.scene.fog.enabled = theme.map.fog;
      if (v.scene.skyBox) v.scene.skyBox.show = false;
      if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true;
      v.scene.screenSpaceCameraController.minimumZoomDistance = 700;
      v.scene.screenSpaceCameraController.maximumZoomDistance = 8000000;
      v.scene.globe.maximumScreenSpaceError = 2;
      v.scene.renderError.addEventListener(fail);
      v.canvas.addEventListener('webglcontextlost', fail);
      v.canvas.addEventListener('pointerdown', () => onExploreRef.current());
      v.canvas.addEventListener('wheel', () => onExploreRef.current(), {passive:true});
      setMapReady(value => value + 1);

      Cesium.ArcGisMapServerImageryProvider.fromUrl(imageryUrl, {
        credit:'Esri · Maxar · Earthstar Geographics · GIS User Community', enablePickFeatures:false,
      }).then(provider => {
        if (disposed || failed || !v || v.isDestroyed()) return;
        const requestImage = provider.requestImage.bind(provider);
        provider.requestImage = (...args) => {
          const pending = requestImage(...args);
          return pending?.then(image => {
            if (image && !disposed && !failed && !imageryLoaded) {
              imageryLoaded = true;
              clearTimeout(timeout);
              setStatus('satellite');
            }
            return image;
          });
        };
        const layer = v.imageryLayers.addImageryProvider(provider);
        layer.brightness = theme.map.brightness;
        layer.contrast = theme.map.contrast;
        layer.saturation = theme.map.saturation;
        layer.gamma = theme.map.gamma;
        provider.errorEvent.addEventListener(() => { failures++; if (failures > 15) fail(); });
      }).catch(fail);

      Cesium.CesiumTerrainProvider.fromUrl('https://terrain.reearth.land/cesium-mesh/ellipsoid', {requestVertexNormals:false})
        .then(provider => {
          if (disposed || !v || v.isDestroyed()) return;
          terrainProvider = provider;
          let terrainErrors = 0;
          provider.errorEvent.addEventListener(() => {
            terrainErrors++;
            if (terrainErrors > 8 && v && !v.isDestroyed()) {
              v.terrainProvider = new Cesium.EllipsoidTerrainProvider();
              setTerrain(false);
            }
          });
          v.terrainProvider = provider;
          setTerrain(true);
        }).catch(() => { /* The satellite globe remains fully usable without terrain. */ });

      const occluder = new Cesium.EllipsoidalOccluder(v.scene.globe.ellipsoid, v.camera.positionWC);
      const toPoint = new Cesium.Cartesian3();
      const project = () => {
        if (!v || v.isDestroyed() || !pinLayer.current) return;
        if (statusRef.current === 'fallback') {
          for (const node of pinLayer.current.querySelectorAll<HTMLElement>('[data-lat]')) node.style.visibility = 'visible';
          if (arc.current) arc.current.show = false;
          return;
        }
        const width = v.canvas.clientWidth, height = v.canvas.clientHeight;
        occluder.cameraPosition = v.camera.positionWC;
        // Each site is projected once per frame. Its pin and the arc therefore
        // use exactly the same terrain height, including newly loaded terrain.
        const projected = new Map<string, {
          point: Cesium.Cartesian3; screen: Cesium.Cartesian2 | undefined;
          height: number; visible: boolean; arcVisible: boolean;
        }>();
        const projectLocation = (lat: number, lon: number) => {
          const key = `${lat},${lon}`;
          const cached = projected.get(key);
          if (cached) return cached;
          const cartographic = Cesium.Cartographic.fromDegrees(lon, lat);
          const anchorHeight = (v!.scene.globe.getHeight(cartographic) ?? (terrainProvider ? 130 : 0)) + 35;
          const point = Cesium.Cartesian3.fromDegrees(lon, lat, anchorHeight);
          const screen = Cesium.SceneTransforms.worldToWindowCoordinates(v!.scene, point);
          Cesium.Cartesian3.subtract(point, v!.camera.positionWC, toPoint);
          const inFront = Cesium.Cartesian3.dot(toPoint, v!.camera.directionWC) > 0;
          const globeVisible = occluder.isPointVisible(point);
          const visible = Boolean(screen && inFront && globeVisible &&
            screen.x >= 0 && screen.x <= width && screen.y >= 0 && screen.y <= height &&
            Cesium.Cartesian3.magnitude(toPoint) < 2500000);
          const value = {
            point, screen, height: anchorHeight, visible,
            arcVisible: visible && relocationEndpointVisible(screen, width, height, inFront, globeVisible),
          };
          projected.set(key, value);
          return value;
        };
        const nodes = pinLayer.current.querySelectorAll<HTMLElement>('[data-lat]');
        for (const node of nodes) {
          const lat = Number(node.dataset.lat), lon = Number(node.dataset.lon);
          const projection = projectLocation(lat, lon);
          if (projection.visible && projection.screen) {
            node.style.transform = `translate(${projection.screen.x}px, ${projection.screen.y}px) translate(-50%, -50%)`;
            node.style.visibility = 'visible';
          } else node.style.visibility = 'hidden';
        }
        const school = projectLocation(SITES.school.lat, SITES.school.lon);
        const destination = projectLocation(SITES.destination.lat, SITES.destination.lon);
        const show = approvedRef.current && school.arcVisible && destination.arcVisible;
        if (!show) {
          if (arc.current) arc.current.show = false;
          return;
        }
        const heights = [school.height, destination.height];
        if (relocationHeightsChanged(arcHeights, heights)) {
          const positions = relocationGeometry(
            { ...SITES.school, height: school.height },
            { ...SITES.destination, height: destination.height },
          ).map(anchor => Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat, anchor.height));
          arcPositions = positions;
          if (arc.current) arc.current.positions = positions;
          arcHeights = heights;
        }
        if (!arc.current) {
          // A direct scene polyline has synchronous show/buffer updates. Unlike
          // an Entity visualizer it cannot briefly retain old geometry on seek.
          arcCollection = v.scene.primitives.add(new Cesium.PolylineCollection());
          arc.current = arcCollection!.add({ id: 'relocation', show: true,
            positions: arcPositions!, width: 2,
            material: Cesium.Material.fromType(Cesium.Material.ColorType, {
              color: Cesium.Color.fromCssColorString(theme.colors.green).withAlpha(.72),
            }),
          });
        } else arc.current.show = true;
      };
      // Cull before drawing, rather than leaving a dangling segment for the
      // first frame after a seek, close-up or manual camera movement.
      removeProjection = v.scene.preRender.addEventListener(project);
      timeout = setTimeout(() => { if (!imageryLoaded) fail(); }, 16000);
    } catch { fail(); }
    return () => {
      disposed = true;
      clearTimeout(timeout);
      removeProjection?.();
      if (v && !v.isDestroyed()) v.destroy();
      viewer.current = null;
      arc.current = null;
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v || v.isDestroyed() || exploring) return;
    const frame = focusedCamera ? {...focusedCamera, range:3600, heading:12, pitch:-52} : cameraAt(state.launched ? state.elapsed : 26, reducedMotion);
    v.camera.cancelFlight();
    v.camera.lookAt(Cesium.Cartesian3.fromDegrees(frame.lon, frame.lat, terrain ? 130 : 0),
      new Cesium.HeadingPitchRange(Cesium.Math.toRadians(frame.heading), Cesium.Math.toRadians(frame.pitch), frame.range));
    v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }, [state.elapsed, state.launched, reducedMotion, exploring, terrain, mapReady, focusedCamera]);

  const sitePins = state.launched && state.elapsed >= 40;
  const visibleReports = state.launched ? snapshot.reports : [];
  // Absolute positions keep markers inspectable even when WebGL cannot initialize.
  function fallbackStyle(lat:number, lon:number) {
    const point = fallbackPoint(lat, lon);
    return status === 'fallback' ? {left:`${point.x / 10}%`,top:`${point.y / 8}%`,transform:'translate(-50%, -50%)',visibility:'visible' as const} : {};
  }
  return <div className={`map-scene ${status === 'fallback' ? 'is-fallback' : ''}`}>
    <div ref={container} className="cesium-host" aria-label="Interactive geographic view of Los Angeles" />
    {status === 'fallback' && <div className="geographic-fallback">
      <svg viewBox="0 0 1000 800" preserveAspectRatio="none" aria-hidden="true">
        <defs><pattern id="terrain" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M0 60 Q40 0 80 60M-20 70Q40 10 100 70M-20 80Q40 20 100 80" fill="none" stroke="currentColor" opacity=".18"/></pattern></defs>
        <rect width="1000" height="800" fill="url(#terrain)"/>
        <path d="M555 -20C540 130 610 230 680 330S740 510 780 600S870 730 890 830" className="river"/>
        <path d="M-20 490Q300 450 600 440T1020 470M510 -10L530 200 570 380 650 580 690 820" className="road"/>
        {snapshot.approvedFacts && <path d={fallbackRelocationPath(fallbackPoint(SITES.school.lat, SITES.school.lon), fallbackPoint(SITES.destination.lat, SITES.destination.lon))} className="fallback-arc"/>}
        <text x="650" y="420">LOS ANGELES</text><text x="110" y="500">SANTA MONICA</text><text x="790" y="130">PASADENA</text>
      </svg>
      <div className="fallback-note"><Icon name="layers" size={15}/><span>Local geographic fallback · approximate context</span></div>
    </div>}
    <div className="map-vignette" />
    {status === 'loading' && <div className="map-loading"><span className="small-spinner"/>Loading satellite geography</div>}
    <div className="map-pins" ref={pinLayer}>
      {state.launched && camerasEnabled && camerasAt(state.elapsed).map(camera => <button key={`camera-${camera.id}`} className={`camera-map-pin ${activeCameraId === camera.id ? 'active' : ''}`} data-lat={camera.lat} data-lon={camera.lon} style={fallbackStyle(camera.lat,camera.lon)} aria-label={`Open camera: ${camera.name}`} title={`${camera.name} · simulated frame`} onClick={() => onCameraSelect(camera.id)}><span><Icon name="camera" size={13}/></span></button>)}
      {visibleReports.map((report, index) => <button key={report.id} data-lat={report.lat} data-lon={report.lon}
        className={`report-pin tone-${report.tone} ${state.selectedReportId === report.id ? 'selected' : ''} ${report.relatedSite && sitePins ? 'quiet-pin' : ''}`}
        style={fallbackStyle(report.lat, report.lon)} onClick={() => onSelect(report.id)} title={`${report.title} · simulated report`} aria-label={`Inspect report: ${report.title}`}>
        <span className="report-dot"><Icon name={report.category} size={12}/></span>
        {(state.selectedReportId === report.id || (state.elapsed < 40 && index >= visibleReports.length - 2)) && <span className="report-pin-label">{report.title}<small>Reported · simulated</small></span>}
      </button>)}
      {sitePins && Object.values(SITES).map(site => {
        const approved = !!snapshot.approvedFacts;
        const label = site.id === 'school' ? (approved ? 'Former distribution location' : 'Needs verification') : (approved ? 'Reviewed pickup location' : 'Reported · awaiting review');
        return <button key={site.id} data-lat={site.lat} data-lon={site.lon} className={`site-pin ${site.id === 'destination' && approved ? 'tone-green' : site.id === 'school' && approved ? 'tone-muted' : 'tone-amber'}`} style={fallbackStyle(site.lat,site.lon)}
          onClick={() => onSelect(visibleReports.find(report => report.relatedSite === site.id)?.id ?? null)} aria-label={`${site.name}: ${label}`}>
          <span className="site-beacon">{site.id === 'destination' && approved ? <Icon name="check" size={17}/> : <Icon name="water" size={16}/>}</span>
          <span className="site-pin-label"><small>{label}</small><strong>{site.id === 'school' ? 'John Marshall High' : '1000 Vin Scully Avenue'}</strong><span>{site.id === 'school' ? '3939 Tracy Street' : 'Dodger Stadium parking lot'}</span></span>
        </button>;
      })}
    </div>
    <div className="map-attribution"><span>{status === 'fallback' ? 'Illustrated geography' : `Present-day imagery${terrain ? ' · Re:Earth / Mapterhorn terrain' : ''}`}</span><div ref={credits}/></div>
  </div>;
}

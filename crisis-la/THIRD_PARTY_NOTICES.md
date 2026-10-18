# Third-party notices

## God's Eye View reference patterns — MIT

Necessary Cesium viewer, imagery, terrain, and Vite asset-handling patterns were referenced or adapted from [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view), local reference commit `992412f` (2026-10-02). Reference paths: `src/app/viewer.js`, `src/maps/imagery.js`, `src/maps/terrain.js`, and `build/vite.js`. This prototype uses its own small application rather than embedding the full reference application.

The following notice applies to copied or substantially adapted source patterns:

```text
MIT License

Copyright (c) 2026 Bilawal Sidhu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The reference project's MIT grant covers source code, not its third-party datasets, recordings, models, or imagery. Its unrelated datasets and media are not part of this replay's asset inventory.

## CesiumJS — Apache License 2.0

[CesiumJS](https://github.com/CesiumGS/cesium), Copyright Cesium GS, Inc. and contributors, is distributed under the [Apache License 2.0](https://github.com/CesiumGS/cesium/blob/1.146/LICENSE.md). Preserve the notices included with the installed package and any distributed Cesium assets. Cesium source licensing does not grant rights to third-party imagery or terrain.

## Map imagery and terrain — separate data terms

- **Esri World Imagery:** Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community. The service's returned attribution may name additional suppliers; preserve that attribution in the viewer. [Service metadata](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=pjson). Remote imagery is present-day geographic context; it does not depict the fictional storm.
- **OpenStreetMap**, used only for coordinate cross-checks: © OpenStreetMap contributors, [Open Database License / attribution](https://www.openstreetmap.org/copyright). No OpenStreetMap tiles are loaded by this prototype.
- **Re:Earth / Mapterhorn terrain**, if loaded: preserve the terrain provider's attribution. The reference implementation identifies its ellipsoidal quantized-mesh terrain as CC BY 4.0. [Terrain service metadata](https://terrain.reearth.land/cesium-mesh/ellipsoid/layer.json), [Mapterhorn](https://mapterhorn.com/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). No terrain availability, historical surface date, or offline delivery is guaranteed.

## Prepared-playback inspiration

The local HealthLink reference's `SampleCaseGraph.vue` and `sampleCaseGraph.js` informed the pattern of an authored event sequence synchronizing highlights, captions, activity, and playback controls. That reference demonstrates prepared playback; it is not evidence of concurrent model execution. No HealthLink clinical records or recordings are included.

## Authored LA scenario

Hurricane Rachel, all damage reports, dialogue, and the aid relocation are fictional exercise fixtures. Real facility names and geographic anchors do not imply emergency operations or endorsement. See [scenario notes](docs/SOURCES.md). Local speech uses stock synthetic voices; it contains no recordings of real disaster calls.

## Speech generation tools

Prepared speech uses [Kokoro-82M v1.0](https://huggingface.co/hexgrad/Kokoro-82M), an Apache-2.0 licensed model, through [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx), licensed under MIT. These are development tools: only rendered speech ships with the app, not model weights or the inference runtime. Voice identifiers and reproduction details appear in [the audio inventory](docs/AUDIO_ASSETS.md).

## Camera illustrations

The two camera images are generated scene recreations for this fictional scenario, not third-party CCTV recordings or exact depictions of the named facilities. See [camera asset provenance and prompts](docs/CAMERA_ASSETS.md).

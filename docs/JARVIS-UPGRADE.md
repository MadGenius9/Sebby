# Sebby 0.11 — hybrid assistant and creative workspace

Chuck's target is the combined assistant workflow from five JARVIS demonstrations, integrated into Sebby with its existing identity and Orbit companion. Hybrid mode means an explicit choice between local Ollama and the existing cloud profiles. Local inference must never silently become a paid cloud request.

This checkpoint implements working source paths and tests. It does not complete every video capability and is not a tested Windows installer.

## Reference demonstrations

| Reference | Requested behavior |
|---|---|
| [3D workspace](https://www.youtube.com/watch?v=34J8xhaAn4U) | Generate and edit objects, exploded views, floor-plan conversion, rendering, voice-directed changes and computer actions. |
| [Local JARVIS](https://www.youtube.com/watch?v=BgpRjk4Yoqk) | Local models, model switching, local voices, knowledge retrieval, calendar tools and website analysis. |
| [Offline JARVIS](https://www.youtube.com/watch?v=OTb1DR47LSo) | Installed local inference and speech, hardware-aware setup, offline everyday work. Internet tools still need connectivity. |
| [REA workflows](https://www.youtube.com/watch?v=84CkBM_jF4g) | Inspect a website/application, retain an evidence-backed report, discuss it by voice, then build and test an original implementation. |
| [Multilingual JARVIS](https://www.youtube.com/watch?v=acsXZP3SA6w) | Separate listening/reply languages, matching voices, translated documents/screens, and tool results in the chosen language. |

The public video descriptions and chapter lists were inspected; the complete videos were not played. Their promotional claims are requirements inspiration, not evidence that Sebby already performs those actions.

## Delivered versus remaining

| Area | Implemented in this checkpoint | Still needed for the complete target |
|---|---|---|
| Hybrid models | Ollama profile; installed-model discovery; loopback-only inference; streaming, cancellation, output limits and function-call conversion for the existing bounded agent runtime. Existing cloud profiles preserved. | Real model/Windows validation; hardware profiling; model recommendations based on Chuck's PC; optional explicit cloud escalation. |
| 3D Studio | Editable boxes/spheres/cylinders/cones/tori, selection, transforms, materials, robot/room presets, exploded view, undo/redo, per-workspace autosave, JSON import/export, GLB export and PNG snapshots. AI proposals use the selected real chat provider and apply only after validation/review. | Automatic floor-plan image understanding, arbitrary mesh generation/import, Blender integration, photorealistic rendering and model quality evaluation. |
| Floor plans | Draw or trace a raster plan into wall segments, set overall width and wall height, create editable 3D walls. | Automatic recognition, dimension extraction, doors/windows, reliable scale calibration. Current image canvas is 3:2. |
| Knowledge | Local notes, text/Markdown/JSON report import, full-text keyword search, exact note insertion into an unsent chat draft. | Semantic retrieval, watched folders, PDF/OCR ingestion, citations to original files, integrated backup and automatic scoped retrieval. |
| Voice and languages | Existing push-to-talk transcription can draft Studio requests. Chat supports 16 reply-language instructions. Local response reading selects an installed local voice for that language. | Local speech recognition, VoiceStudio adapter/cloning, independent explicit listening-language settings, voice interruption, long-response narration and hands-free conversation. Current transcription still requires the existing OpenAI voice path. |
| REA | Its reports can be imported and searched in Knowledge. No REA execution was added. | Native stdio MCP integration, fixed approved installation/target selection, evidence capture, report storage, and analysis-to-build orchestration. |
| Actions and app building | Existing bounded specialist tools, task reviews, connectors and file-edit workflows remain intact. | Real isolated build/test execution, interactive app preview, browser/desktop automation, calendar OAuth/actions, screen capture/translation and optional calling. Existing execution gates remain unchanged. |

The adapter rejects advertised remote models and cloud model identifiers. The local Ollama process itself remains trusted: a malicious/reconfigured local server could misreport its behavior. Sebby does not download models or change Ollama's settings.

## Start and exercise the source

Use the existing Windows first-run guide and Node.js 24 LTS. From this branch:

```powershell
npm ci
npm run gauntlet
npm start
```

1. Open **Studio**. Change the robot's color, size or position; delete an object, Undo, Redo. Try Room. Export JSON, GLB and PNG to new filenames. Reopen the JSON and confirm dimensions/materials.
2. For AI scenes, configure a cloud profile or install/start Ollama separately. In **Settings**, create a **Local / Ollama** profile, click **Refresh installed models**, choose its exact name, save, and click **Use this profile**. No key is required. **Test local model** performs one small local inference. A profile alone does not verify availability.
3. In **Studio → Build with Sebby**, request a change such as “Give the robot copper armor and larger shoulders.” Review the returned scene and apply it. If the model returns invalid/truncated JSON, the scene remains unchanged. Reduce scene size or raise the saved output budget if necessary.
4. In **Floor plan**, draw wall endpoints or load/trace a 3:2 image. Set dimensions and create the walls. This replaces the scene; Undo restores it.
5. In **Knowledge**, save a note or import a teardown report; search it, then use it in a chat draft. This does not run REA.
6. In **Chat**, select a reply language. Type or dictate a question. Local reading requires a matching installed OS voice; it never silently substitutes a remote voice.

Studio scenes and Knowledge notes use device-local browser storage inside Electron, separately from the existing app-data backup. Studio JSON export is the portable scene backup. Keep original Knowledge reports; integrated bank backup is outstanding. Storage errors are surfaced without claiming successful persistence. Nothing installs or changes software on Chuck's PC from this cloud workspace.

## Gauntlet loop

For each workflow: define an observable outcome → implement → test normal and failure paths → inspect changes for regressions → fix observed failures → rerun the affected checks → run the complete gate before delivery. Stop at a failed stage; never relabel an unavailable native/live check as passed.

`npm run gauntlet` runs service tests, interface tests, typecheck/production build, and formatting sequentially. It exits nonzero on the first failing stage and writes `.gauntlet/latest.json`. It does not automatically rewrite code, call a provider, install a model, or replay a failed request.

Observed and fixed during this loop: an undo-history closure captured the new scene instead of the previous scene, preventing restoration after deletion. The regression test now covers deleting, undoing, redoing, autosaving and reopening. Additional checks cover malformed scene fields, duplicate IDs, invalid numbers, actual mesh transforms, floor-plan dimensions, completed AI proposal application, cancellation races, stale proposal rejection, local-model rejection, incomplete streams, tool-call conversion, native export signatures/extensions and create-only writes.

## Remaining native acceptance gate

Validation on November 12, 2026: `npm run gauntlet` passed all four stages: 375 service tests, 99 interface tests, TypeScript/production build, and formatting. The build reports a nonfatal Three.js chunk-size warning. Chromium could not launch in this workspace because of a sandbox socket restriction, so browser visual checks remain unverified. No live AI inference, microphone test, Windows packaging or native acceptance test was performed.

- On Chuck's Windows PC, record CPU, installed RAM, GPU/VRAM and Ollama version; test an installed model with networking disabled. Confirm the app never selects a cloud profile automatically.
- Validate real model completion and a bounded specialist tool loop, including cancellation and RAM exhaustion. Mock tests cannot establish model competence or interoperability.
- Verify WebGL scene rendering, selection and camera controls at common display scales. Open an exported GLB in Blender and a PNG in an image viewer. Verify native save/cancel dialogs and no overwrite behavior.
- Test actual microphone permission/transcription, the selected language's OS voice, tab changes during requests, close/reopen persistence, and recovery after a failed save.
- Run the existing Windows packaging and native acceptance checks before distributing an installer. No installer or live model evidence is supplied with this checkpoint.

## Next implementation order

1. Validate this checkpoint on Windows and choose local model sizes based on actual hardware.
2. Add local ASR and a separate local voice service adapter, then voice sessions with interruption and distinct listening/reply language settings. Keep each service independently testable.
3. Add stdio MCP and REA target selection/report capture, followed by a real isolated build/test runner. Then connect teardown → implementation → test → preview, with saved evidence for every stage.
4. Add semantic knowledge retrieval and original-file citations; integrate scene/knowledge backups.
5. Add approved screen/browser/desktop actions and calendar connections, then vision-based floor-plan conversion and Blender rendering.

Primary integration sources: [Ollama API](https://github.com/ollama/ollama/blob/main/docs/api.md), [REA](https://github.com/morluto/rea), [VoiceStudio](https://github.com/debpalash/VoiceStudio). Their source/API and licensing need review when integrating each component; no external project code was copied into this checkpoint.

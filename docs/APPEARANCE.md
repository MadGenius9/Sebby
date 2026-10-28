# Companion appearance

Sebby remains the app and assistant name. Orbit, Scout, Wisp, Luma, Nook, Finch, Tidal, Moss and Piper are selectable visual pals, not separate account identities or provider personalities. The default stays **Orbit in ice blue**, preserving the user's chosen starting identity.

## Local configuration

`AppearanceStore(userData)` persists `sebby-appearance.json` as `{version:1,appearance}`. Call `load()` first; `get()` returns a clone; `save(input)` validates and returns the complete saved config.

```js
{
  pal: 'orbit', // orbit | scout | wisp | luma | nook | finch | tidal | moss | piper
  palettePreset: 'ice', // ice | mint | lavender | ember | custom
  colors: {body:'#78C5F5',accent:'#3D9BD8',glow:'#B9EAFF'},
  motion: true
}
```

`colors` may be omitted when saving a named preset; the authored palette is authoritative. If supplied, colors are still validated before canonical preset colors are applied. Custom requires all three fields. Every color is exactly `#RRGGBB` and normalizes to uppercase. Unknown keys, asset URLs, scripts, CSS snippets, named CSS colors, partial hex, and invalid booleans are rejected.

| Preset | Body | Accent | Glow |
|---|---|---|---|
| Ice | `#78C5F5` | `#3D9BD8` | `#B9EAFF` |
| Mint | `#83D6BC` | `#348C81` | `#BBF9DF` |
| Lavender | `#B5A0EA` | `#7963BB` | `#E5D8FF` |
| Ember | `#EEAD7A` | `#B75D43` | `#FFE0AF` |

The module exports the frozen nine-ID `PAL_IDS` catalog, `APPEARANCE_PRESETS`, `DEFAULT_APPEARANCE`, and `validateAppearance(input)` for shared documented behavior. It never fetches assets, evaluates code, sets CSS directly, or handles credentials.

## Renderer integration

Map pal IDs to bundled, code-owned original asset paths. Apply the validated body/accent/glow values only to the designated material slots. Preserve neutral face/eye features and model geometry. Never turn imported user metadata into an asset URL, shader program, arbitrary CSS string or remote texture request. Use the actual original bundled models and PNGs, not recolored crops of a concept board.

Honor both the saved motion preference and operating-system reduced-motion preference; turning motion off should stop idle animation without preventing static preview. Palette preference does not assert contrast/accessibility certification. Test selected materials, face readability, and color customization on real rendered assets.

The appearance service does not assert third-party commercial licensing or provenance beyond the separately documented original procedural asset notes. Any additional licensing review belongs to release preparation.

## Persistence and backup

Writes serialize through a unique create-only temporary file followed by rename. Store size is limited to 4 KiB. Malformed, linked, oversized, version-mismatched, or internally inconsistent stored preset colors fail closed without overwriting the existing file. Backups include this strict metadata store, not arbitrary asset files or paths. Loading a new preset does not affect the assistant name, memory, models, credentials, or task permissions.

## Bundled asset catalog

The new six looks are optional selections; **Orbit remains the unchanged default**. All paths are fixed in source, not accepted from user settings. This is not an external model importer. The app packages only GLB models and PNG fallback images; editable Blender source projects remain a separate artifact.

| ID | Visual pal | Model | Fallback |
|---|---|---|---|
| `orbit` | Original ice-blue Orbit | `./pals/orbit.glb` | `./orbit.png` (original unchanged) |
| `scout` | Scout | `./pals/scout.glb` | `./pals/scout.png` |
| `wisp` | Wisp | `./pals/wisp.glb` | `./pals/wisp.png` |
| `luma` | Bright little fox | `./pals/luma.glb` | `./pals/luma.png` |
| `nook` | Thoughtful owl | `./pals/nook.glb` | `./pals/nook.png` |
| `finch` | Gentle little dragon | `./pals/finch.glb` | `./pals/finch.png` |
| `tidal` | Floating daydreamer | `./pals/tidal.glb` | `./pals/tidal.png` |
| `moss` | Grounded sprout | `./pals/moss.glb` | `./pals/moss.png` |
| `piper` | Four-legged helper | `./pals/piper.glb` | `./pals/piper.png` |

`public/pals/catalog-manifest.json` records the stable nine-ID catalog and the six newly integrated models' original source filenames, authored descriptions, triangle counts, material slots, byte sizes, and SHA-256 hashes. The six assets were copied without image editing or mesh conversion from the asset worker's version-2 originals. Provenance recorded there: original procedural Blender geometry/materials; no downloaded meshes, textures, character references, rigs, or third-party character licenses.

All nine GLBs are self-contained: their glTF buffers/images have no external URI dependencies. Renderer customization still touches **only** the authored `body`, `accent`, and `glow` material names. Eyes and visor remain unchanged for contrast. Optional material slots vary; these changes do not add executable shaders, remote asset URLs, or texture imports.

## Verification

- Store roundtrip tests cover all nine pals across all four presets; unknown IDs and arbitrary URLs still reject.
- Asset tests verify GLB magic/version/length, embedded-only resources, the three editable material names, PNG signatures, the six copied asset hashes/byte counts, and absence of `.blend` files from the public asset directory.
- Component tests exercise every selector ID, browser persistence, fixed local fallback mapping, unchanged Orbit default, and unknown-ID refusal.
- These are source, storage, structural-asset and jsdom fallback tests. They do **not** establish GPU rendering, animation quality, real GLB material appearance, Windows native behavior, accessibility certification, or visual fidelity. Those need separate browser/GPU/native verification.

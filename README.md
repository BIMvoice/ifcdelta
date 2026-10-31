# ifcdelta

**See exactly what changed between two versions of an IFC model, in geometry and in data.**

Use it at [ifcdelta.bimvoice.com](https://ifcdelta.bimvoice.com), or run it yourself.

Choose an old and a new IFC file. ifcdelta lists every element that was added, modified or deleted, shows each one in 3D, and tells you the old and new value of everything that differs. Everything runs in your browser: your files are never uploaded.

## What it shows

- **3D model:** unchanged elements fade to a blue X-ray, and changes stand out in colour. Switch between Overlay, Old, New, and a Wipe with a seam you can drag across the two versions.
- **Data table:** one row per changed property, with the element's GlobalId and old and new values, across property sets, quantities, attributes, materials, classifications and assigned types. Search it, or filter by kind of change, by IFC class, and by geometry or data.
- **Export:** save what the table shows as CSV for Excel, as a list of elements or a list of changed properties. Filters apply.
- **Measured geometry:** a moved element shows its old and new position on each axis, and a reshaped one its old and new size and volume.
- **Re-exported models:** an element whose GlobalId changed is paired by its content. If it is otherwise identical it counts as unchanged instead of a false delete and add.

Controls: drag to orbit, shift-drag to pan, scroll to zoom, click to select, `↑` `↓` to step through changes, `F` to fit, `Esc` to clear.

## Getting started

Needs Node.js 20+ and a browser with WebGPU (recent Chrome, Edge, Firefox or Safari). Without WebGPU the data comparison still works, but there is no 3D view.

```bash
npm install
npm run dev
```

| Command | What it does |
|---|---|
| `npm run build` | Typecheck and build for production into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests |
| `npm run check:browser` | Run the production build in headless Chromium against `fixtures/`, a pair where every difference is known |

To host it, the server must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, because IFClite's WASM geometry uses `SharedArrayBuffer`. `vercel.json` sets them on Vercel. GitHub Pages cannot set these headers.

## How it works

ifcdelta is a thin interface on top of [IFClite](https://ifclite.dev), which does the heavy lifting:

| Package | Role |
|---|---|
| `@ifc-lite/parser` | Reads the IFC file, its properties, quantities, materials and classifications |
| `@ifc-lite/geometry` | Builds the meshes, and a position-independent fingerprint of each element's geometry |
| `@ifc-lite/diff` | Matches elements across versions and classifies each one |
| `@ifc-lite/renderer` | WebGPU viewer with the X-ray, colour overrides and picking |

The code in this repo connects those pieces and adds what they leave to the application:

- `src/engine`: what to fingerprint for each element, and turning a "this changed" verdict into readable old and new values
- `src/viewer`: which elements are solid, ghosted or hidden in each view
- `src/ui`: the interface

## What it does not do

- Differences under 1 mm count as unchanged. That tolerance filters out export noise.
- `IfcOpeningElement` is left out, because an opening is only the void between a wall and a door. A wall whose opening changed still shows as changed.
- Products with no geometry of their own, such as an `IfcSite`, are compared on their data only. A move of one of those is not detected.
- It compares two files. It does not manage revisions, and it does not edit IFC files.

## License

[MPL-2.0](LICENSE)

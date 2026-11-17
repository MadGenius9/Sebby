# Editable 3D meshes

The Studio now supports primitives and editable polygon meshes. Add **Editable cube**, or select a box and **Convert to editable mesh**. Existing saved primitive scenes remain compatible. Select an object from the scene list or viewport. Translate/rotate/scale gizmos commit one undoable object transform when released; numeric transforms remain available. Snap uses 0.25 meters, 15 degrees and 0.1 scale increments.

Select a face by clicking it or using the face selector. The selected face is tinted. **Extrude selected face** extends it along its local normal; **Inset selected face** scales its boundary toward the centroid and creates a ring. The inset ratio is not a constant-distance architectural offset. Vertex editing uses local coordinates. Quads must remain planar; triangulate the mesh before deforming individual vertices. Undo/redo restores session checkpoints, and Save persists the resulting mesh with the project revision.

Meshes contain bounded vertices and polygon indices, not arbitrary scripts. Validation checks finite coordinates, index ranges, repeated indices, measurable area, planarity and convex turns. Each mesh allows at most 2,048 vertices/faces and 3–16 indices per polygon. Export triangulates convex faces, retains object transforms/materials and produces a GLB. Geometry is not checked for self-intersections, watertightness, duplicate faces or topology suitable for fabrication. Arbitrary concave polygons, bevel, UV editing, textures, grouping, rigging and Blender-equivalent modeling remain future work.

Assigned agents can read and propose validated mesh scenes through the existing scene tools. Proposals remain unapplied until user review; stale proposals cannot overwrite a newer scene. Scene changes remain visible as before/after JSON in review.

## Evidence

Tests verify deterministic, non-mutating extrusion/inset, a closed oriented fixture, invalid topology rejection, owner/revision checks, persistence after a separate process read and review/application of an agent mesh proposal. The actual Three.js geometry pipeline and GLTFExporter produce the GLB used by the test. With `SEBBY_BLENDER_BIN=/usr/bin/blender`, Blender 4.3.2 independently imported the fixture: one mesh, 108 vertices, 36 polygons and the expected X dimension. This passed here. The test FileReader shim supplies browser Blob reads only; it does not replace the exporter.

Viewport gizmo picking, highlighted-face rendering, browser GLB download and mobile controls are not certified by the headless Blender check. `npm run test:browser` exercises mesh controls, numeric transforms, persistence and browser downloads on a Chromium-capable host; current local Chromium cannot launch under this environment's process restrictions.

Hosted Chromium acceptance passed for mesh editing controls, numeric transforms, undo/redo, persistence and GLB download in GitHub Actions run 44011023185. Desktop and mobile screenshots were reviewed. Actual gizmo dragging still needs its own interaction check.

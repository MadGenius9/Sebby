import { useState, useEffect } from "react";
import type { Project, SceneObject } from "./api";
import { Viewport, exportGlb, type TransformMode } from "./Viewport";
import {
  boxMesh,
  extrudeFace,
  insetFace,
  moveVertex,
  triangulateMesh,
  type PolygonMesh,
  type Vec3,
} from "@shared/workspace/mesh";
export function StudioPanel({
  project,
  update,
}: {
  project: Project;
  update: (p: Project) => void;
}) {
  const [selectedId, select] = useState<string | null>(null),
    [error, setError] = useState(""),
    [exporting, setExporting] = useState(false);
  const [mode, setMode] = useState<TransformMode>("translate"),
    [snap, setSnap] = useState(false),
    [face, setFace] = useState(0),
    [distance, setDistance] = useState(0.25),
    [inset, setInset] = useState(0.2),
    [vertex, setVertex] = useState(0),
    [position, setPosition] = useState<Vec3>([0, 0, 0]);
  const objects = project.scene.objects,
    selected = objects.find((o) => o.id === selectedId),
    mesh = selected?.kind === "mesh" ? selected.mesh : null;
  const faceIndex = mesh ? Math.min(face, mesh.faces.length - 1) : 0,
    vertexIndex = mesh ? Math.min(vertex, mesh.vertices.length - 1) : 0;
  useEffect(() => {
    if (mesh) setPosition([...mesh.vertices[vertexIndex]]);
  }, [mesh, vertexIndex]);
  const change = (next: SceneObject[]) =>
    update({ ...project, scene: { objects: next } });
  const patch = (value: Partial<SceneObject>) =>
    change(
      objects.map((o) =>
        o.id === selectedId ? ({ ...o, ...value } as SceneObject) : o,
      ),
    );
  const applyMesh = (operation: (mesh: PolygonMesh) => PolygonMesh) => {
    if (!mesh) return;
    try {
      const next = operation(mesh);
      patch({ mesh: next });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  function add(kind: SceneObject["kind"]) {
    if (objects.length >= 100) return;
    const base = {
      id: crypto.randomUUID(),
      name: `${kind[0].toUpperCase() + kind.slice(1)} ${objects.length + 1}`,
      position: [0, 0.5, 0] as Vec3,
      rotation: [0, 0, 0] as Vec3,
      scale: [1, 1, 1] as Vec3,
      color: "#83ceff",
    };
    const object: SceneObject =
      kind === "mesh" ? { ...base, kind, mesh: boxMesh() } : { ...base, kind };
    change([...objects, object]);
    select(object.id);
    setFace(0);
    setVertex(0);
  }
  return (
    <div className="studio-layout">
      <div className="studio-main">
        <div className="studio-toolbar">
          <span>Add object</span>
          {(["box", "sphere", "cylinder", "mesh"] as const).map((kind) => (
            <button
              className="btn btn--secondary"
              type="button"
              key={kind}
              disabled={objects.length >= 100}
              onClick={() => add(kind)}
            >
              + {kind === "mesh" ? "Editable cube" : kind}
            </button>
          ))}
          <button
            className="btn btn--secondary export-glb"
            type="button"
            disabled={!objects.length || exporting}
            onClick={async () => {
              setExporting(true);
              setError("");
              try {
                await exportGlb(objects);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? "Exporting…" : "Export GLB"}
          </button>
        </div>
        <div className="studio-toolbar" aria-label="Transform tools">
          {(["translate", "rotate", "scale"] as const).map((value) => (
            <button
              className="btn btn--secondary"
              type="button"
              key={value}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value}
            </button>
          ))}
          <label>
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => setSnap(e.target.checked)}
            />{" "}
            Snap (0.25 m / 15° / 0.1 scale)
          </label>
        </div>
        <Viewport
          objects={objects}
          selectedId={selectedId}
          select={(id) => {
            select(id);
          }}
          mode={mode}
          snap={snap}
          selectFace={setFace}
          selectedFace={faceIndex}
          commit={(id, value) =>
            change(objects.map((o) => (o.id === id ? { ...o, ...value } : o)))
          }
        />
        <p className="workspace-note">
          Object transforms use meters and degrees. Mesh edits use local
          coordinates. Save to persist; Undo restores earlier edits.
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
      <aside className="inspector">
        <h2>Scene</h2>
        <div className="object-list">
          {!objects.length ? (
            <p>Add an object to start your scene.</p>
          ) : (
            objects.map((o) => (
              <button
                type="button"
                key={o.id}
                className={o.id === selectedId ? "is-active" : ""}
                onClick={() => {
                  select(o.id);
                  setFace(0);
                  setVertex(0);
                }}
              >
                {o.name}
                <span>{o.kind}</span>
              </button>
            ))
          )}
        </div>
        {selected ? (
          <div className="object-properties">
            <h2>Object properties</h2>
            <label>
              Name
              <input
                aria-label="Object name"
                maxLength={80}
                value={selected.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            {(["position", "rotation", "scale"] as const).map((prop) => (
              <div className="transform-group" key={prop}>
                <h3>
                  {prop}
                  {prop === "rotation" ? " (°)" : ""}
                </h3>
                <div className="transform-inputs">
                  {selected[prop].map((value, axis) => (
                    <label key={axis}>
                      {["X", "Y", "Z"][axis]}
                      <input
                        type="number"
                        aria-label={`${prop} ${["X", "Y", "Z"][axis]}`}
                        value={value}
                        min={prop === "scale" ? 0.01 : -10000}
                        max={prop === "scale" ? 1000 : 10000}
                        step={prop === "rotation" ? 5 : 0.1}
                        onChange={(e) => {
                          const n = e.target.valueAsNumber;
                          if (
                            !Number.isFinite(n) ||
                            n < (prop === "scale" ? 0.01 : -10000) ||
                            n > (prop === "scale" ? 1000 : 10000)
                          )
                            return;
                          const vec = [...selected[prop]] as Vec3;
                          vec[axis] = n;
                          patch({ [prop]: vec });
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <label>
              Material color
              <input
                aria-label="Material color"
                type="color"
                value={selected.color}
                onChange={(e) => patch({ color: e.target.value })}
              />
            </label>
            {selected.kind === "box" && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  patch({ kind: "mesh", mesh: boxMesh() });
                  setFace(0);
                  setVertex(0);
                }}
              >
                Convert to editable mesh
              </button>
            )}
            {mesh && (
              <section className="mesh-tools">
                <h2>Mesh tools</h2>
                <p>
                  {mesh.vertices.length} vertices · {mesh.faces.length} faces
                </p>
                <label>
                  Face
                  <select
                    aria-label="Mesh face"
                    value={faceIndex}
                    onChange={(e) => setFace(Number(e.target.value))}
                  >
                    {mesh.faces.map((_, i) => (
                      <option key={i} value={i}>
                        Face {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Extrusion distance (m)
                  <input
                    aria-label="Extrusion distance"
                    type="number"
                    min={-1000}
                    max={1000}
                    step={0.05}
                    value={distance}
                    onChange={(e) => setDistance(e.target.valueAsNumber)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() =>
                    applyMesh((m) => extrudeFace(m, faceIndex, distance))
                  }
                >
                  Extrude selected face
                </button>
                <label>
                  Inset ratio
                  <input
                    aria-label="Inset ratio"
                    type="number"
                    min={0.01}
                    max={0.9}
                    step={0.05}
                    value={inset}
                    onChange={(e) => setInset(e.target.valueAsNumber)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() =>
                    applyMesh((m) => insetFace(m, faceIndex, inset))
                  }
                >
                  Inset selected face
                </button>
                <label>
                  Vertex
                  <select
                    aria-label="Mesh vertex"
                    value={vertexIndex}
                    onChange={(e) => setVertex(Number(e.target.value))}
                  >
                    {mesh.vertices.map((_, i) => (
                      <option key={i} value={i}>
                        Vertex {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="transform-inputs">
                  {position.map((n, i) => (
                    <label key={i}>
                      {["X", "Y", "Z"][i]}
                      <input
                        aria-label={`Vertex ${["X", "Y", "Z"][i]}`}
                        type="number"
                        min={-10000}
                        max={10000}
                        step={0.05}
                        value={n}
                        onChange={(e) => {
                          const next = [...position] as Vec3;
                          next[i] = e.target.valueAsNumber;
                          setPosition(next);
                        }}
                      />
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() =>
                    applyMesh((m) => moveVertex(m, vertexIndex, position))
                  }
                >
                  Move selected vertex
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => applyMesh(triangulateMesh)}
                >
                  Triangulate mesh
                </button>
                <p>
                  Faces must stay planar and convex. Triangulate before moving
                  individual vertices on a quad. Self-intersections are not
                  checked.
                </p>
              </section>
            )}
            <button
              className="btn btn--secondary"
              type="button"
              disabled={objects.length >= 100}
              onClick={() => {
                const copy = {
                  ...structuredClone(selected),
                  id: crypto.randomUUID(),
                  name: `${selected.name.slice(0, 70)} copy`,
                  position: [
                    Math.min(10000, selected.position[0] + 1),
                    ...selected.position.slice(1),
                  ] as Vec3,
                };
                change([...objects, copy]);
                select(copy.id);
              }}
            >
              Duplicate object
            </button>
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => {
                change(objects.filter((o) => o.id !== selectedId));
                select(null);
              }}
            >
              Remove object
            </button>
          </div>
        ) : (
          <p className="workspace-note">
            Select an object to edit its properties.
          </p>
        )}
      </aside>
    </div>
  );
}

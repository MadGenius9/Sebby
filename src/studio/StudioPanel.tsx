import { useRef, useState } from "react";
import { Viewport } from "./Viewport";
import { Assistant } from "./Assistant";
import { FloorPlan } from "./FloorPlan";
import { exportGlb, saveStudioFile } from "./export";
import {
  MAX_PARTS,
  SHAPES,
  parseScene,
  part,
  preset,
  validateScene,
  type Part,
  type SceneDocument,
  type Vec3,
} from "./model";
import "./studio.css";
export function StudioPanel({ workspace }: { workspace: string }) {
  const storageKey = `sebby.studio.v1:${workspace}`;
  const initial = useRef<{ scene: SceneDocument; note: string } | null>(null);
  if (!initial.current) {
    try {
      const raw = localStorage.getItem(storageKey);
      initial.current = {
        scene: raw ? parseScene(raw) : preset("robot"),
        note: raw
          ? "Restored your saved scene."
          : "Start with this robot, open a room, or build something new.",
      };
    } catch {
      initial.current = {
        scene: preset("robot"),
        note: "Saved scene could not be loaded. It has not been overwritten. Export your work before closing if storage is unavailable.",
      };
    }
  }
  const [scene, setScene] = useState(initial.current.scene),
    [selected, setSelected] = useState(
      initial.current.scene.parts[0]?.id || "",
    ),
    [past, setPast] = useState<SceneDocument[]>([]),
    [future, setFuture] = useState<SceneDocument[]>([]),
    [explode, setExplode] = useState(0),
    [notice, setNotice] = useState(initial.current.note),
    [tab, setTab] = useState("objects"),
    [exporting, setExporting] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    current = useRef(scene);
  current.current = scene;
  function persist(doc: SceneDocument) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(doc));
      setNotice("Scene saved on this device.");
    } catch {
      setNotice(
        "Scene changed, but device storage failed. Export JSON before closing.",
      );
    }
  }
  function apply(value: SceneDocument) {
    try {
      const doc = validateScene(value);
      const previous = current.current;
      setPast((p) => [...p.slice(-29), previous]);
      setFuture([]);
      setScene(doc);
      current.current = doc;
      if (!doc.parts.some((p) => p.id === selected))
        setSelected(doc.parts[0]?.id || "");
      persist(doc);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function update(patch: Partial<Part>) {
    apply({
      ...scene,
      parts: scene.parts.map((p) =>
        p.id === selected ? { ...p, ...patch } : p,
      ),
    });
  }
  function history(direction: "undo" | "redo") {
    const source = direction === "undo" ? past : future;
    if (!source.length) return;
    const next = source[source.length - 1];
    if (direction === "undo") {
      setPast(source.slice(0, -1));
      setFuture((v) => [...v, scene]);
    } else {
      setFuture(source.slice(0, -1));
      setPast((v) => [...v, scene]);
    }
    setScene(next);
    current.current = next;
    setSelected(next.parts[0]?.id || "");
    persist(next);
  }
  const active = scene.parts.find((p) => p.id === selected);
  async function output(kind: "json" | "glb") {
    if (exporting) return;
    setExporting(true);
    try {
      const result =
        kind === "glb"
          ? await exportGlb(scene)
          : await saveStudioFile(
              "json",
              new TextEncoder().encode(JSON.stringify(scene, null, 2)),
            );
      setNotice(
        result.saved
          ? `${kind.toUpperCase()} export requested.`
          : "Export cancelled.",
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="studio">
      <div className="studio-heading">
        <div>
          <span className="studio-eyebrow">SEBBY / CREATIVE WORKSPACE</span>
          <h2>{scene.name}</h2>
          <p>Build it. Change it. Make it yours.</p>
        </div>
        <span className="studio-count">{scene.parts.length} objects</span>
      </div>
      <div className="studio-toolbar">
        <button onClick={() => apply(preset("robot"))}>Robot</button>
        <button onClick={() => apply(preset("room"))}>Room</button>
        <button onClick={() => apply(preset("empty"))}>Empty scene</button>
        <button disabled={!past.length} onClick={() => history("undo")}>
          Undo
        </button>
        <button disabled={!future.length} onClick={() => history("redo")}>
          Redo
        </button>
        <button onClick={() => input.current?.click()}>Import JSON</button>
        <button disabled={exporting} onClick={() => void output("json")}>
          Export JSON
        </button>
        <button
          disabled={exporting || !scene.parts.length}
          onClick={() => void output("glb")}
        >
          Export GLB
        </button>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept=".json,application/json"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            if (file.size > 64 * 1024)
              throw Error("Scene file exceeds 64 KiB.");
            apply(parseScene(await file.text()));
          } catch (err) {
            setNotice((err as Error).message);
          }
        }}
      />
      <Viewport
        scene={scene}
        selected={selected}
        explode={explode}
        onSelect={setSelected}
        report={setNotice}
      />
      <label className="studio-explode">
        Exploded view
        <input
          aria-label="Exploded view"
          type="range"
          min="0"
          max="4"
          step=".05"
          value={explode}
          onChange={(e) => setExplode(Number(e.target.value))}
        />
        <output>{explode.toFixed(2)} m</output>
        <span>View only · exports keep original positions</span>
      </label>
      <p className="studio-notice" role="status">
        {notice}
      </p>
      <div className="studio-tabs" role="tablist" aria-label="Studio tools">
        {[
          ["objects", "Objects & materials"],
          ["assistant", "Build with Sebby"],
          ["floor", "Floor plan"],
        ].map(([id, label]) => (
          <button
            role="tab"
            aria-selected={tab === id}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "assistant" ? (
          <Assistant scene={scene} apply={apply} />
        ) : tab === "floor" ? (
          <FloorPlan apply={apply} report={setNotice} />
        ) : (
          <div className="studio-edit">
            <div className="studio-objects">
              <label>
                Scene name
                <input
                  aria-label="Scene name"
                  value={scene.name}
                  maxLength={100}
                  onChange={(e) => {
                    if (e.target.value.trim())
                      apply({ ...scene, name: e.target.value });
                  }}
                />
              </label>
              <label>
                Add object
                <select
                  aria-label="Add object"
                  value=""
                  disabled={scene.parts.length >= MAX_PARTS}
                  onChange={(e) => {
                    const shape = e.target.value as Part["shape"];
                    if (!shape) return;
                    const next = part(
                      `New ${shape}`,
                      shape,
                      [0, 0.5, 0],
                      [1, 1, 1],
                    );
                    apply({ ...scene, parts: [...scene.parts, next] });
                    setSelected(next.id);
                  }}
                >
                  <option value="">Choose a shape…</option>
                  {SHAPES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <div className="studio-object-list" aria-label="Scene objects">
                {scene.parts.map((p) => (
                  <button
                    key={p.id}
                    aria-pressed={selected === p.id}
                    onClick={() => setSelected(p.id)}
                  >
                    <span>{p.name}</span>
                    <small>{p.shape}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="studio-properties">
              {active ? (
                <>
                  <label>
                    Object name
                    <input
                      aria-label="Object name"
                      value={active.name}
                      maxLength={80}
                      onChange={(e) => {
                        if (e.target.value.trim())
                          update({ name: e.target.value });
                      }}
                    />
                  </label>
                  <div className="studio-vectors">
                    {(
                      [
                        ["position", "Position (m)", -100, 100],
                        ["rotation", "Rotation (degrees)", -360, 360],
                        ["size", "Size (m)", 0.02, 100],
                      ] as const
                    ).map(([field, label, min, max]) => (
                      <fieldset key={field}>
                        <legend>{label}</legend>
                        {["X", "Y", "Z"].map((axis, index) => (
                          <label key={axis}>
                            {axis}
                            <input
                              aria-label={`${label} ${axis}`}
                              type="number"
                              step=".1"
                              min={min}
                              max={max}
                              value={active[field][index]}
                              onChange={(e) => {
                                if (!e.target.value) return;
                                const value = Number(e.target.value);
                                if (
                                  !Number.isFinite(value) ||
                                  value < min ||
                                  value > max
                                )
                                  return;
                                const v = [...active[field]] as Vec3;
                                v[index] = value;
                                update({ [field]: v });
                              }}
                            />
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  </div>
                  <div className="studio-material">
                    <label>
                      Color
                      <input
                        aria-label="Object color"
                        type="color"
                        value={active.color}
                        onChange={(e) => update({ color: e.target.value })}
                      />
                    </label>
                    {(["metalness", "roughness"] as const).map((key) => (
                      <label key={key}>
                        {key}
                        <input
                          aria-label={key}
                          type="range"
                          min="0"
                          max="1"
                          step=".05"
                          value={active[key]}
                          onChange={(e) =>
                            update({ [key]: Number(e.target.value) })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div className="button-row">
                    <button
                      disabled={scene.parts.length >= MAX_PARTS}
                      onClick={() => {
                        const copy = {
                          ...structuredClone(active),
                          id: crypto.randomUUID(),
                          name: active.name.slice(0, 70) + " copy",
                          position: [
                            Math.min(100, active.position[0] + 1),
                            active.position[1],
                            active.position[2],
                          ] as Vec3,
                        };
                        apply({ ...scene, parts: [...scene.parts, copy] });
                        setSelected(copy.id);
                      }}
                    >
                      Duplicate object
                    </button>
                    <button
                      onClick={() =>
                        apply({
                          ...scene,
                          parts: scene.parts.filter((p) => p.id !== active.id),
                        })
                      }
                    >
                      Delete object
                    </button>
                  </div>
                </>
              ) : (
                <p>Select an object, or add a shape to begin.</p>
              )}
            </div>
          </div>
        )}
      </div>
      <p className="studio-footnote">
        Scenes autosave per workspace on this device. Export JSON for a portable
        backup; Studio scenes are separate from Sebby’s app-data backup. GLB
        opens in Blender and other 3D tools. Realtime shading is not a
        photorealistic renderer.
      </p>
    </div>
  );
}

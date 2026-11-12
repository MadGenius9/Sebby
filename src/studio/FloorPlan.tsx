import { useRef, useState } from "react";
import { wallsToScene, type Wall, type SceneDocument } from "./model";
export function FloorPlan({
  apply,
  report,
}: {
  apply: (scene: SceneDocument) => void;
  report: (text: string) => void;
}) {
  const [walls, setWalls] = useState<Wall[]>([]),
    [start, setStart] = useState<[number, number] | null>(null),
    [width, setWidth] = useState(12),
    [height, setHeight] = useState(2.7),
    [image, setImage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className="studio-floor">
      <h3>Floor plan → 3D walls</h3>
      <p>
        Draw wall segments with two clicks, or load a plan image and trace its
        walls. Set the full plan width in meters. This is manual tracing, not
        automatic image recognition. Conversion replaces the current scene; Undo
        restores it.
      </p>
      <div className="button-row">
        <button onClick={() => input.current?.click()}>Load plan image</button>
        <button
          onClick={() => {
            setWalls((v) => v.slice(0, -1));
            setStart(null);
          }}
        >
          Undo wall
        </button>
        <button
          onClick={() => {
            setWalls([]);
            setStart(null);
            setImage("");
          }}
        >
          Clear tracing
        </button>
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            if (
              file.size > 5 * 1024 * 1024 ||
              !["image/png", "image/jpeg", "image/webp"].includes(file.type)
            )
              throw Error("Choose a PNG, JPEG or WebP under 5 MiB.");
            const data = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result));
              r.onerror = () => reject(Error("Image could not be read."));
              r.readAsDataURL(file);
            });
            setImage(data);
            setWalls([]);
            setStart(null);
          } catch (err) {
            report((err as Error).message);
          }
        }}
      />
      <svg
        viewBox="0 0 600 400"
        className="studio-plan"
        role="img"
        aria-label="Floor plan drawing area. Click pairs of points to draw walls."
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const point: [number, number] = [
            Math.max(
              0,
              Math.min(
                1,
                Math.round(((e.clientX - r.left) / r.width) * 60) / 60,
              ),
            ),
            Math.max(
              0,
              Math.min(
                1,
                Math.round(((e.clientY - r.top) / r.height) * 40) / 40,
              ),
            ),
          ];
          if (!start) {
            setStart(point);
            return;
          }
          if (Math.hypot(point[0] - start[0], point[1] - start[1]) < 0.01)
            return;
          if (walls.length >= 60) {
            report("Maximum 60 walls reached.");
            return;
          }
          setWalls((v) => [...v, { a: start, b: point }]);
          setStart(null);
        }}
      >
        {image && (
          <image
            href={image}
            width="600"
            height="400"
            preserveAspectRatio="none"
            opacity="0.6"
          />
        )}
        {Array.from({ length: 31 }, (_, i) => (
          <line
            key={`x${i}`}
            x1={i * 20}
            x2={i * 20}
            y1="0"
            y2="400"
            stroke="#547086"
            opacity=".25"
          />
        ))}
        {Array.from({ length: 21 }, (_, i) => (
          <line
            key={`z${i}`}
            y1={i * 20}
            y2={i * 20}
            x1="0"
            x2="600"
            stroke="#547086"
            opacity=".25"
          />
        ))}
        {walls.map((w, i) => (
          <line
            key={i}
            x1={w.a[0] * 600}
            y1={w.a[1] * 400}
            x2={w.b[0] * 600}
            y2={w.b[1] * 400}
            stroke="#9ee8ff"
            strokeWidth="5"
          />
        ))}
        {start && (
          <circle
            cx={start[0] * 600}
            cy={start[1] * 400}
            r="6"
            fill="#f4bc7b"
          />
        )}
      </svg>
      <div className="button-row">
        <label>
          Plan width (m)
          <input
            type="number"
            min="1"
            max="50"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <label>
          Wall height (m)
          <input
            type="number"
            min="0.5"
            max="10"
            step="0.1"
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </label>
        <button
          className="primary"
          disabled={!walls.length}
          onClick={() => {
            try {
              apply(wallsToScene(walls, width, height));
              report("Traced walls converted into editable 3D objects.");
            } catch (e) {
              report((e as Error).message);
            }
          }}
        >
          Create 3D walls
        </button>
      </div>
      <p>
        {walls.length} walls ·{" "}
        {start ? "Choose the end of this wall." : "Choose the start of a wall."}{" "}
        The image uses a 3:2 canvas; use a plan cropped to that ratio for
        accurate proportions.
      </p>
    </section>
  );
}

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type * as THREE from "three";
export const PAL_IDS = [
  "orbit",
  "scout",
  "wisp",
  "luma",
  "nook",
  "finch",
  "tidal",
  "moss",
  "piper",
] as const;
export type PalId = (typeof PAL_IDS)[number];
export type Appearance = {
  pal: PalId;
  palettePreset: "ice" | "mint" | "lavender" | "ember" | "custom";
  colors: { body: string; accent: string; glow: string };
  motion: boolean;
};
export const PALETTES = {
  ice: { body: "#78C5F5", accent: "#3D9BD8", glow: "#B9EAFF" },
  mint: { body: "#83D6BC", accent: "#348C81", glow: "#BBF9DF" },
  lavender: { body: "#B5A0EA", accent: "#7963BB", glow: "#E5D8FF" },
  ember: { body: "#EEAD7A", accent: "#B75D43", glow: "#FFE0AF" },
} as const;
const DEFAULT: Appearance = {
  pal: "orbit",
  palettePreset: "ice",
  colors: { ...PALETTES.ice },
  motion: true,
};
export const PAL_ASSETS = {
  orbit: {
    glb: "./pals/orbit.glb",
    png: "./orbit.png",
    alt: "Sebby, your ice-blue Orbit companion",
  },
  scout: {
    glb: "./pals/scout.glb",
    png: "./pals/scout.png",
    alt: "Sebby, your Scout companion",
  },
  wisp: {
    glb: "./pals/wisp.glb",
    png: "./pals/wisp.png",
    alt: "Sebby, your Wisp companion",
  },
  luma: {
    glb: "./pals/luma.glb",
    png: "./pals/luma.png",
    alt: "Sebby, your Luma companion",
  },
  nook: {
    glb: "./pals/nook.glb",
    png: "./pals/nook.png",
    alt: "Sebby, your Nook companion",
  },
  finch: {
    glb: "./pals/finch.glb",
    png: "./pals/finch.png",
    alt: "Sebby, your Finch companion",
  },
  tidal: {
    glb: "./pals/tidal.glb",
    png: "./pals/tidal.png",
    alt: "Sebby, your Tidal companion",
  },
  moss: {
    glb: "./pals/moss.glb",
    png: "./pals/moss.png",
    alt: "Sebby, your Moss companion",
  },
  piper: {
    glb: "./pals/piper.glb",
    png: "./pals/piper.png",
    alt: "Sebby, your Piper companion",
  },
} as const;
const ASSETS = PAL_ASSETS;
type AppearanceAPI = {
  getAppearance?: () => Promise<Appearance>;
  saveAppearance?: (value: Appearance) => Promise<Appearance>;
};
const api = () => window.sebby as unknown as AppearanceAPI | undefined;
function valid(value: unknown): Appearance {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid appearance settings.");
  const x = value as Appearance;
  if (
    Object.keys(x).some(
      (key) => !["pal", "palettePreset", "colors", "motion"].includes(key),
    ) ||
    !PAL_IDS.includes(x.pal) ||
    !["ice", "mint", "lavender", "ember", "custom"].includes(x.palettePreset) ||
    typeof x.motion !== "boolean" ||
    !x.colors ||
    Object.keys(x.colors).some(
      (key) => !["body", "accent", "glow"].includes(key),
    )
  )
    throw Error("Invalid appearance settings.");
  for (const key of ["body", "accent", "glow"] as const)
    if (
      typeof x.colors[key] !== "string" ||
      !/^#[a-fA-F0-9]{6}$/.test(x.colors[key])
    )
      throw Error("Use six-digit hex colors.");
  return {
    pal: x.pal,
    palettePreset: x.palettePreset,
    motion: x.motion,
    colors:
      x.palettePreset === "custom"
        ? {
            body: x.colors.body.toUpperCase(),
            accent: x.colors.accent.toUpperCase(),
            glow: x.colors.glow.toUpperCase(),
          }
        : { ...PALETTES[x.palettePreset] },
  };
}
type AppearanceContextValue = {
  appearance: Appearance;
  saveAppearance: (value: Appearance) => Promise<void>;
  loading: boolean;
  error: string;
  desktop: boolean;
};
const Context = createContext<AppearanceContextValue>({
  appearance: DEFAULT,
  saveAppearance: async () => {
    throw Error("Appearance provider is not mounted.");
  },
  loading: false,
  error: "",
  desktop: false,
});
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const desktop = typeof api()?.getAppearance === "function";
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const backend = api();
        const raw = backend?.getAppearance
          ? await backend.getAppearance()
          : JSON.parse(
              localStorage.getItem("sebby.appearance") ||
                JSON.stringify(DEFAULT),
            );
        const value = valid(raw);
        if (!disposed) setAppearance(value);
      } catch {
        if (!disposed)
          setError(
            "Saved appearance could not be loaded. The original file was not changed.",
          );
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);
  async function saveAppearance(input: Appearance) {
    const value = valid(input),
      backend = api();
    if (backend?.saveAppearance) {
      const saved = valid(await backend.saveAppearance(value));
      setAppearance(saved);
    } else {
      localStorage.setItem("sebby.appearance", JSON.stringify(value));
      setAppearance(value);
    }
    setError("");
  }
  return (
    <Context.Provider
      value={{ appearance, saveAppearance, loading, error, desktop }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAppearance() {
  return useContext(Context);
}
function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)"),
      change = () => setReduced(query.matches);
    query.addEventListener?.("change", change);
    return () => query.removeEventListener?.("change", change);
  }, []);
  return reduced;
}
export function PalView({ className = "companion" }: { className?: string }) {
  const { appearance } = useAppearance(),
    host = useRef<HTMLDivElement>(null),
    [rendered, setRendered] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false,
      animation = 0,
      observer: ResizeObserver | undefined,
      renderer: THREE.WebGLRenderer | undefined,
      model: THREE.Group | undefined,
      environment: THREE.WebGLRenderTarget | undefined,
      manager: THREE.LoadingManager | undefined;
    let cleanupScene: (() => void) | undefined;
    setRendered(false);
    if (
      typeof window.WebGLRenderingContext === "undefined" &&
      typeof window.WebGL2RenderingContext === "undefined"
    )
      return;
    function disposeModel(object: THREE.Object3D) {
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>(),
        textures = new Set<THREE.Texture>();
      object.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material)
          for (const material of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]) {
            materials.add(material);
            for (const value of Object.values(material))
              if (
                value &&
                typeof value === "object" &&
                (value as THREE.Texture).isTexture
              )
                textures.add(value as THREE.Texture);
          }
      });
      textures.forEach((item) => item.dispose());
      materials.forEach((item) => item.dispose());
      geometries.forEach((item) => item.dispose());
    }
    (async () => {
      try {
        const [T, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([
          import("three"),
          import("three/addons/loaders/GLTFLoader.js"),
          import("three/addons/environments/RoomEnvironment.js"),
        ]);
        if (disposed) return;
        renderer = new T.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "low-power",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = T.SRGBColorSpace;
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        renderer.domElement.className = "pal-canvas";
        renderer.domElement.hidden = true;
        renderer.domElement.setAttribute(
          "aria-label",
          ASSETS[appearance.pal].alt + " · 3D preview",
        );
        renderer.domElement.setAttribute("role", "img");
        element.appendChild(renderer.domElement);
        const scene = new T.Scene(),
          camera = new T.PerspectiveCamera(32, 1, 0.01, 1000);
        const room = new RoomEnvironment(),
          pmrem = new T.PMREMGenerator(renderer);
        environment = pmrem.fromScene(room, 0.04);
        scene.environment = environment.texture;
        room.dispose();
        pmrem.dispose();
        scene.add(new T.HemisphereLight("#d9efff", "#243446", 2));
        const key = new T.DirectionalLight("#ffffff", 3);
        key.position.set(3, 5, 6);
        scene.add(key);
        const rim = new T.DirectionalLight("#a5d7ff", 2);
        rim.position.set(-3, 2, -2);
        scene.add(rim);
        manager = new T.LoadingManager();
        const asset = await new GLTFLoader(manager).loadAsync(
          ASSETS[appearance.pal].glb,
        );
        if (disposed) {
          disposeModel(asset.scene);
          return;
        }
        model = asset.scene;
        model.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.material) return;
          for (const material of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]) {
            const surface = material as THREE.MeshStandardMaterial;
            const slot = material.name.toLowerCase();
            if (
              (slot === "body" || slot === "accent" || slot === "glow") &&
              surface.color
            ) {
              surface.color.set(appearance.colors[slot]);
              if (slot === "glow" && surface.emissive) {
                surface.emissive.set(appearance.colors.glow);
                surface.emissiveIntensity = 0.65;
              }
              surface.needsUpdate = true;
            }
          }
        });
        const bounds = new T.Box3().setFromObject(model),
          center = bounds.getCenter(new T.Vector3()),
          sphere = bounds.getBoundingSphere(new T.Sphere());
        if (!Number.isFinite(sphere.radius) || sphere.radius <= 0)
          throw Error("Invalid companion bounds.");
        model.position.sub(center);
        scene.add(model);
        const radius = sphere.radius;
        const draw = () => {
          if (!disposed && renderer) renderer.render(scene, camera);
        };
        const resize = () => {
          if (disposed || !renderer) return;
          const width = Math.max(1, element.clientWidth || 300),
            height = Math.max(1, element.clientHeight || 290);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          const fov =
            2 *
            Math.atan(
              Math.tan(T.MathUtils.degToRad(camera.fov / 2)) *
                Math.min(1, camera.aspect),
            );
          camera.position.set(
            0,
            radius * 0.06,
            (radius / Math.sin(fov / 2)) * 1.12,
          );
          camera.near = Math.max(0.01, radius / 100);
          camera.far = radius * 100;
          camera.lookAt(0, 0, 0);
          camera.updateProjectionMatrix();
          draw();
        };
        resize();
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(resize);
          observer.observe(element);
        }
        window.addEventListener("resize", resize);
        cleanupScene = () => window.removeEventListener("resize", resize);
        renderer.domElement.hidden = false;
        setRendered(true);
        if (appearance.motion && !reduced) {
          const originY = model.position.y,
            start = performance.now();
          const tick = (now: number) => {
            if (disposed) return;
            if (model) {
              const elapsed = (now - start) / 1000;
              model.rotation.y = Math.sin(elapsed * 0.55) * 0.1;
              model.position.y =
                originY + Math.sin(elapsed * 0.9) * radius * 0.025;
            }
            if (!document.hidden) draw();
            animation = requestAnimationFrame(tick);
          };
          animation = requestAnimationFrame(tick);
        } else draw();
      } catch {
        if (!disposed) setRendered(false);
        renderer?.domElement.remove();
        renderer?.dispose();
        renderer?.forceContextLoss();
        environment?.dispose();
        if (model) {
          disposeModel(model);
          model = undefined;
        }
      }
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(animation);
      observer?.disconnect();
      cleanupScene?.();
      manager?.abort();
      if (model) disposeModel(model);
      environment?.dispose();
      renderer?.domElement.remove();
      renderer?.dispose();
      renderer?.forceContextLoss();
    };
  }, [
    appearance.pal,
    appearance.colors.body,
    appearance.colors.accent,
    appearance.colors.glow,
    appearance.motion,
    reduced,
  ]);
  return (
    <div ref={host} className={`${className} pal-view`}>
      <img
        className="pal-fallback"
        src={ASSETS[appearance.pal].png}
        alt={ASSETS[appearance.pal].alt}
        hidden={rendered}
      />
    </div>
  );
}
export function AppearancePanel({
  report,
}: {
  report: (message: string) => void;
}) {
  const { appearance, saveAppearance, loading, error, desktop } =
    useAppearance();
  const [draft, setDraft] = useState(appearance),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    setDraft(appearance);
  }, [appearance]);
  function change(value: Appearance) {
    setDraft(value);
    setSaved(false);
  }
  return (
    <section aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">Make Sebby feel like yours.</h2>
      <p className="muted">
        Choose a pal and a palette. Sebby’s name, memory, and permissions stay
        the same.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="personality-preview">
        <Context.Provider
          value={{ appearance: draft, saveAppearance, loading, error, desktop }}
        >
          <PalView className="companion appearance-preview" />
        </Context.Provider>
        <div>
          <h3>Preview your companion</h3>
          <p className="muted">
            Save to apply your changes. Original 3D models have editable
            material colors. If 3D is unavailable, the original image is shown;
            image fallback does not recolor.
          </p>
          <small>
            {desktop
              ? "Saved in Sebby’s local settings."
              : "Browser preview · stored in this browser only."}
          </small>
        </div>
      </div>
      <fieldset disabled={loading || saving}>
        <legend>Your pal</legend>
        <div className="appearance-pal-options">
          {PAL_IDS.map((pal) => (
            <label className="radio" key={pal}>
              <input
                type="radio"
                name="appearance-pal"
                checked={draft.pal === pal}
                onChange={() => change({ ...draft, pal })}
              />
              {pal[0].toUpperCase() + pal.slice(1)}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field-label" htmlFor="appearance-palette">
        Palette
      </label>
      <select
        id="appearance-palette"
        disabled={loading || saving}
        value={draft.palettePreset}
        onChange={(event) => {
          const palettePreset = event.target
            .value as Appearance["palettePreset"];
          change({
            ...draft,
            palettePreset,
            colors:
              palettePreset === "custom"
                ? draft.colors
                : { ...PALETTES[palettePreset] },
          });
        }}
      >
        {["ice", "mint", "lavender", "ember", "custom"].map((name) => (
          <option key={name} value={name}>
            {name[0].toUpperCase() + name.slice(1)}
          </option>
        ))}
      </select>
      <div className="appearance-color-grid">
        {(["body", "accent", "glow"] as const).map((slot) => (
          <label key={slot} className="field-label">
            {slot[0].toUpperCase() + slot.slice(1)} color
            <input
              type="color"
              aria-label={`${slot[0].toUpperCase() + slot.slice(1)} color`}
              value={draft.colors[slot]}
              disabled={loading || saving}
              onChange={(event) =>
                change({
                  ...draft,
                  palettePreset: "custom",
                  colors: {
                    ...draft.colors,
                    [slot]: event.target.value.toUpperCase(),
                  },
                })
              }
            />
            <code>{draft.colors[slot]}</code>
          </label>
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.motion}
          disabled={loading || saving}
          onChange={(event) =>
            change({ ...draft, motion: event.target.checked })
          }
        />
        Gentle idle motion (also respects reduced-motion settings)
      </label>
      <button
        className="primary"
        disabled={loading || saving}
        onClick={async () => {
          setSaving(true);
          try {
            await saveAppearance(draft);
            setSaved(true);
          } catch (e) {
            report(
              e instanceof Error ? e.message : "Appearance could not be saved.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving…" : "Save appearance"}
      </button>
      <p role="status" className="muted">
        {saved ? "Appearance saved." : ""}
      </p>
    </section>
  );
}

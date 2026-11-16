import { useState } from 'react';
import type { Project, SceneObject } from './api';
import { Viewport, exportGlb } from './Viewport';
export function StudioPanel({ project, update }: { project: Project; update: (p: Project) => void }) {
  const [selectedId, select] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const objects = project.scene.objects;
  const selected = objects.find(o => o.id === selectedId);
  const change = (next: SceneObject[]) => update({ ...project, scene: { objects: next } });
  const patch = (value: Partial<SceneObject>) => change(objects.map(o => o.id === selectedId ? { ...o, ...value } : o));
  const add = (kind: SceneObject['kind']) => {
    if (objects.length >= 100) return;
    const o: SceneObject = { id: crypto.randomUUID(), name: `${kind[0].toUpperCase()+kind.slice(1)} ${objects.length+1}`, kind, position: [0, 0.5, 0], rotation: [0,0,0], scale: [1,1,1], color: '#83ceff' };
    change([...objects, o]); select(o.id);
  };
  const exportScene = async () => { setExporting(true); setError(''); try { await exportGlb(objects); } catch(e) { setError((e as Error).message); } finally { setExporting(false); } };
  return <div className="studio-layout">
    <div className="studio-main"><div className="studio-toolbar"><span>Add object</span>{(['box','sphere','cylinder'] as const).map(kind => <button className="btn btn--secondary" type="button" key={kind} disabled={objects.length >= 100} onClick={() => add(kind)}>+ {kind[0].toUpperCase()+kind.slice(1)}</button>)}<button className="btn btn--secondary export-glb" type="button" disabled={!objects.length || exporting} onClick={exportScene}>{exporting ? 'Exporting…' : 'Export GLB'}</button></div>
      <Viewport objects={objects} selectedId={selectedId} select={select}/>
      <p className="workspace-note">Scene tools · Object transforms in meters and degrees. Mesh editing and AI modeling are planned.</p>{error && <p role="alert">{error}</p>}
    </div>
    <aside className="inspector"><h2>Scene</h2><div className="object-list">{objects.length === 0 ? <p>Add an object to start your scene.</p> : objects.map(o => <button type="button" key={o.id} className={selectedId === o.id ? 'is-active' : ''} onClick={() => select(o.id)}>{o.name}<span>{o.kind}</span></button>)}</div>
      {selected ? <div className="object-properties"><h2>Object properties</h2><label>Name<input aria-label="Object name" maxLength={80} value={selected.name} onChange={e => patch({ name: e.target.value })}/></label>
        {(['position','rotation','scale'] as const).map(prop => <div className="transform-group" key={prop}><h3>{prop[0].toUpperCase()+prop.slice(1)}{prop === 'rotation' ? ' (°)' : ''}</h3><div className="transform-inputs">{selected[prop].map((value, axis) => <label key={axis}>{['X','Y','Z'][axis]}<input type="number" aria-label={`${prop} ${['X','Y','Z'][axis]}`} value={value} min={prop === 'scale' ? .01 : -10000} max={prop === 'scale' ? 1000 : 10000} step={prop === 'rotation' ? 5 : .1} onChange={e => {
          const n = e.target.valueAsNumber; if (!Number.isFinite(n) || n < (prop === 'scale' ? .01 : -10000) || n > (prop === 'scale' ? 1000 : 10000)) return;
          const vec = [...selected[prop]] as [number,number,number]; vec[axis] = n; patch({ [prop]: vec });
        }}/></label>)}</div></div>)}
        <label>Material color<input aria-label="Material color" type="color" value={selected.color} onChange={e => patch({ color: e.target.value })}/></label>
        <button className="btn btn--secondary" type="button" disabled={objects.length >= 100} onClick={() => { const o = { ...selected, id: crypto.randomUUID(), name: `${selected.name.slice(0, 70)} copy`, position: [Math.min(10000,selected.position[0]+1), ...selected.position.slice(1)] as [number,number,number] }; change([...objects,o]); select(o.id); }}>Duplicate object</button>
        <button className="btn btn--secondary" type="button" onClick={() => { change(objects.filter(o => o.id !== selectedId)); select(null); }}>Remove object</button>
      </div> : <p className="workspace-note">Select an object to edit its properties.</p>}
    </aside>
  </div>;
}

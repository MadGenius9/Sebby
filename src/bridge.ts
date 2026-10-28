export type Personality={warmth:'balanced'|'warm'|'direct';humor:boolean};
export type State={memory:string;personality:Personality;workspace:null|{name:string;path:string};provider:{status:string};platform:string};
export type FileEntry={path:string;size:number};
export interface Bridge {getState():Promise<State>;saveMemory(text:string):Promise<State>;savePersonality(value:Personality):Promise<State>;chooseWorkspace():Promise<State|null>;listFiles():Promise<FileEntry[]>;readFile(path:string):Promise<{path:string;content:string}>;createNote(value:{name:string;content:string}):Promise<{created:boolean;path?:string}>;}
declare global {interface Window {sebby?:Bridge}}
const initial:State={memory:'',personality:{warmth:'balanced',humor:true},workspace:null,provider:{status:'not-configured'},platform:'browser-preview'};
function getPreview():State {try{return {...initial,...JSON.parse(localStorage.getItem('sebby.preview')||'{}'),workspace:null,platform:'browser-preview'};}catch{return initial;}}
async function save(value:Partial<State>){const state={...getPreview(),...value};localStorage.setItem('sebby.preview',JSON.stringify(state));return state;}
export const desktop=!!window.sebby;
export const bridge:Bridge=window.sebby??{getState:async()=>getPreview(),saveMemory:memory=>save({memory}),savePersonality:personality=>save({personality}),chooseWorkspace:async()=>{throw Error('Folder access is available in the desktop app. Browser preview cannot access your files.');},listFiles:async()=>[],readFile:async()=>{throw Error('Open the desktop app to read workspace files.');},createNote:async()=>{throw Error('Open the desktop app to create a note.');}};

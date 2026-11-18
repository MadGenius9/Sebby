import { zipSync, strToU8, unzipSync } from 'fflate';
import { browserFixtures } from './browser-fixtures.mjs';
import {randomUUID} from 'node:crypto';
// Real browser acceptance on a browser-capable host. Uses disposable local data only.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root=await mkdtemp(path.join(os.tmpdir(),'sebby-browser-')),qa=process.env.SEBBY_QA_DIR||path.join(root,'qa'),port=String(25000+Math.floor(Math.random()*25000)),base=`http://127.0.0.1:${port}`;
await mkdir(qa,{recursive:true});
const child=spawn(process.execPath,['server/dist/workspace-server.js'],{stdio:['ignore','pipe','pipe'],env:{...process.env,SEBBY_WORKSPACE_ONLY:'1',DEV_LOGIN:'1',SESSION_SECRET:randomUUID(),APP_URL:base,PORT:port,DB_PATH:path.join(root,'workspace.db'),SEBBY_RUNS_DIR:path.join(root,'runs'),SEBBY_RUNNER_IMAGE:'',SEBBY_GOOGLE_CLIENT_ID:'',SEBBY_CONNECTOR_KEY:'',XAI_API_KEY:''}});
const exited=new Promise(resolve=>child.once('exit',resolve));let browser,fixtures,logs='',timer;const errors=[];
try{
 await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Workspace did not start: '+logs)),10000);child.stdout.on('data',b=>{logs+=b;if(logs.includes('Sebby workspace:'))resolve();});child.stderr.on('data',b=>logs+=b);child.once('error',reject);child.once('exit',code=>reject(new Error('Workspace exited '+code)));});clearTimeout(timer);
 browser=await chromium.launch({headless:true,...(process.env.SEBBY_CHROMIUM_BIN?{executablePath:process.env.SEBBY_CHROMIUM_BIN}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.goto(base+'/workspace');assert.equal(await page.title(),'Sebby');await page.getByLabel('Email',{exact:true}).fill('browser-fixture@example.test');await page.getByRole('button',{name:'Open workspace',exact:true}).click();
 await page.getByLabel('New project',{exact:true}).fill('Browser acceptance');await page.getByRole('button',{name:'Create project',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Projects',exact:true}).isVisible(),false);await page.getByRole('textbox',{name:'Edit README.md',exact:true}).fill('# Browser acceptance\nPersistent source and scene fixture.');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved · revision 2',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Project brain',exact:true}).click();await page.getByRole('button',{name:'Create project brief',exact:true}).click();await page.locator('#knowledge-note').fill('# Goal\nBrowseracceptance requires editable meshes.');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved · revision 3',{exact:true}).waitFor();await page.getByLabel('Keywords',{exact:true}).fill('Browseracceptance');await page.getByRole('button',{name:'Search saved project',exact:true}).click();await page.getByRole('heading',{name:/SEBBY.md:/}).waitFor();
 await page.getByRole('button',{name:'3D Studio',exact:true}).click();await page.getByRole('button',{name:'+ Editable cube',exact:true}).click();await page.getByText('8 vertices · 6 faces',{exact:true}).waitFor();await page.getByLabel('Mesh face',{exact:true}).selectOption('3');await page.getByRole('button',{name:'Extrude selected face',exact:true}).click();await page.getByText('12 vertices · 10 faces',{exact:true}).waitFor();await page.getByRole('button',{name:'Inset selected face',exact:true}).click();await page.getByText('16 vertices · 14 faces',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByText('12 vertices · 10 faces',{exact:true}).waitFor();await page.getByRole('button',{name:'Redo',exact:true}).click();await page.getByText('16 vertices · 14 faces',{exact:true}).waitFor();await page.getByLabel('position X',{exact:true}).fill('2');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved · revision 4',{exact:true}).waitFor();
 // The green Y-axis handle position comes from the reviewed desktop fixture screenshot.
 const canvas=await page.getByLabel('3D scene viewport',{exact:true}).boundingBox();assert.ok(canvas);
 const handle={x:canvas.x+canvas.width*.633,y:canvas.y+canvas.height*.47};
 await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(handle.x,handle.y-35,{steps:10});await page.mouse.up();
 await page.waitForFunction(()=>Number(document.querySelector('input[aria-label="position Y"]')?.value)>.5);
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved · revision 5',{exact:true}).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export GLB',exact:true}).click();const file=await download;const glbPath=path.join(qa,'browser-prop.glb');await file.saveAs(glbPath);const glb=await readFile(glbPath);assert.equal(glb.readUInt32LE(0),0x46546c67);assert.equal(glb.readUInt32LE(8),glb.length);
 assert.equal(await page.getByRole('alert').count(),0);await page.screenshot({path:path.join(qa,'desktop-modeling.png')});
 await page.reload();await page.getByRole('navigation',{name:'Projects',exact:true}).getByRole('button',{name:'Browser acceptance',exact:true}).click();await page.getByRole('button',{name:'3D Studio',exact:true}).click();await page.getByRole('button',{name:/Mesh 1/}).click();await page.getByText('16 vertices · 14 faces',{exact:true}).waitFor();assert.equal(await page.getByLabel('position X',{exact:true}).inputValue(),'2');
 await page.getByRole('button',{name:'Changes',exact:true}).click();await page.getByLabel('Compare from',{exact:true}).selectOption('3');await page.getByRole('button',{name:'Review restoration',exact:true}).click();await page.getByRole('heading',{name:'Restore revision 3',exact:true}).waitFor();await page.getByText('Restored 3D scene',{exact:true}).click();await page.screenshot({path:path.join(qa,'desktop-restoration-review.png')});
 await page.getByRole('button',{name:'Restore as new revision',exact:true}).click();await page.getByText('Saved · revision 6',{exact:true}).waitFor();await page.getByRole('button',{name:'3D Studio',exact:true}).click();await page.getByText('Add an object to start your scene.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Changes',exact:true}).click();await page.getByLabel('Compare from',{exact:true}).selectOption('5');await page.getByRole('button',{name:'Review restoration',exact:true}).click();await page.getByRole('heading',{name:'Restore revision 5',exact:true}).waitFor();await page.getByRole('button',{name:'Restore as new revision',exact:true}).click();await page.getByText('Saved · revision 7',{exact:true}).waitFor();await page.getByRole('button',{name:'3D Studio',exact:true}).click();await page.getByRole('button',{name:/Mesh 1/}).click();await page.getByText('16 vertices · 14 faces',{exact:true}).waitFor();assert.ok(Number(await page.getByLabel('position Y',{exact:true}).inputValue())>.5);
 await page.getByRole('button',{name:'Connections',exact:true}).click();await page.getByRole('heading',{name:'Google Drive',exact:true}).waitFor();await page.getByRole('button',{name:'Create pairing code',exact:true}).click();await page.locator('.companion-command').waitFor();assert.match(await page.locator('.companion-command').innerText(),/node scripts\/companion.mjs/);
 const mobile=await browser.newContext({viewport:{width:390,height:844},storageState:await context.storageState(),isMobile:true,hasTouch:true}),phone=await mobile.newPage();phone.on('pageerror',e=>errors.push(e.message));await phone.goto(base+'/workspace');await phone.getByRole('navigation',{name:'Projects',exact:true}).getByRole('button',{name:'Browser acceptance',exact:true}).click();assert.equal(await phone.getByRole('button',{name:'Projects',exact:true}).isVisible(),true);await phone.getByRole('button',{name:'Project brain',exact:true}).click();await phone.locator('#knowledge-note').waitFor();assert.match(await phone.locator('#knowledge-note').inputValue(),/editable meshes/);assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await phone.screenshot({path:path.join(qa,'mobile-knowledge.png')});
 const source={provider:'github',repository:'https://github.com/example/demo',requestedRef:'main',commit:'a'.repeat(40),archiveSha256:'b'.repeat(64)};
 const githubDocument={name:'Browser GitHub import',files:[{path:'index.html',content:'<h1>Browser GitHub source fixture</h1>'},{path:'SEBBY-GITHUB-SOURCE.json',content:JSON.stringify(source,null,2)}],scene:{objects:[]}};
 await page.route('**/api/projects/import-github/review',async route=>{const request=route.request().postDataJSON();assert.equal(request.url,'https://github.com/example/demo');assert.equal(request.ref,'main');await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({document:githubDocument,source,archiveSha256:source.archiveSha256,sourceRoot:'demo-main/',totalBytes:400,skipped:[],warnings:['Browser fixture: network review is mocked; project creation uses the real server.']})});});
 await page.getByRole('button',{name:'Import GitHub repository',exact:true}).click();await page.getByLabel('GitHub repository URL',{exact:true}).fill(source.repository);await page.getByLabel('Branch, tag or commit (optional)',{exact:true}).fill('main');await page.getByLabel('Project name',{exact:true}).fill(githubDocument.name);await page.getByRole('button',{name:'Inspect GitHub repository',exact:true}).click();await page.getByRole('heading',{name:'Snapshot origin',exact:true}).waitFor();await page.getByText(source.commit,{exact:true}).waitFor();await page.screenshot({path:path.join(qa,'desktop-github-import.png')});
 await page.getByRole('button',{name:'Create project from reviewed files',exact:true}).click();await page.getByRole('textbox',{name:'Edit index.html',exact:true}).fill('<h1>Edited imported source</h1>');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved · revision 2',{exact:true}).waitFor();await page.reload();await page.getByRole('navigation',{name:'Projects',exact:true}).getByRole('button',{name:githubDocument.name,exact:true}).click();assert.match(await page.getByRole('textbox',{name:'Edit index.html',exact:true}).inputValue(),/Edited imported source/);
 await page.getByRole('button',{name:'Changes',exact:true}).click();await page.getByLabel('Compare from',{exact:true}).selectOption('1');await page.getByRole('button',{name:'Review restoration',exact:true}).click();await page.getByRole('heading',{name:'Restore revision 1',exact:true}).waitFor();await page.getByRole('button',{name:'Restore as new revision',exact:true}).click();await page.getByText('Saved · revision 3',{exact:true}).waitFor();await page.getByRole('button',{name:'Coding',exact:true}).click();assert.match(await page.getByRole('textbox',{name:'Edit index.html',exact:true}).inputValue(),/Browser GitHub source fixture/);
 // Source file-picker, agent review/apply and retained compiled preview use the real server.
 await page.getByRole('button',{name:'Import source ZIP',exact:true}).click();
 await page.getByLabel('Source ZIP (up to 4 MB)',{exact:true}).setInputFiles({name:'browser-source.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({'fixture/index.html':strToU8('<h1>ZIP browser fixture</h1>'),'fixture/.env':strToU8('EXCLUDED=fixture')}))});
 await page.getByLabel('Project name',{exact:true}).fill('Browser reviewed project');await page.getByRole('button',{name:'Inspect ZIP',exact:true}).click();await page.getByRole('button',{name:'Create project from reviewed files',exact:true}).click();
 await page.getByRole('textbox',{name:'Edit index.html',exact:true}).waitFor();
 const projectsResponse=await context.request.get(base+'/api/projects'),reviewedProject=(await projectsResponse.json()).projects.find(p=>p.name==='Browser reviewed project');assert.ok(reviewedProject);
 fixtures=await browserFixtures(root);
 await page.getByRole('button',{name:'Agents',exact:true}).click();await page.getByLabel('Project agent',{exact:true}).selectOption(fixtures.botId);await page.getByRole('button',{name:'Assign to this project',exact:true}).click();await page.getByRole('button',{name:'Unassign',exact:true}).waitFor();
 await fixtures.modelProposal(reviewedProject.id);assert.equal(fixtures.project(reviewedProject.id).scene.objects.length,0);
 await page.getByRole('button',{name:'Refresh proposals',exact:true}).click();await page.getByRole('button',{name:/Make an editable prop/}).click();await page.getByRole('heading',{name:'Proposed scene',exact:true}).waitFor();await page.screenshot({path:path.join(qa,'desktop-agent-scene-review.png')});
 await page.getByRole('button',{name:'Apply reviewed changes',exact:true}).click();await page.getByText('Saved · revision 2',{exact:true}).waitFor();
 await page.getByRole('button',{name:'3D Studio',exact:true}).click();await page.getByRole('button',{name:/Agent prop/}).click();await page.getByText('16 vertices · 14 faces',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Agents',exact:true}).click();await fixtures.modelProposal(reviewedProject.id,'Reject this extra prop');await page.getByRole('button',{name:'Refresh proposals',exact:true}).click();await page.getByRole('button',{name:/Reject this extra prop/}).click();await page.getByRole('button',{name:'Reject proposal',exact:true}).click();await page.getByText(/saved revision 2 · rejected/).waitFor();assert.equal(fixtures.project(reviewedProject.id).revision,2);
 await fixtures.modelProposal(reviewedProject.id,'Stale prop proposal');await page.getByRole('button',{name:'Coding',exact:true}).click();await page.getByRole('textbox',{name:'Edit index.html',exact:true}).fill('<h1>Manual edit after proposal</h1>');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved · revision 3',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Agents',exact:true}).click();await page.getByRole('button',{name:/Stale prop proposal/}).click();await page.getByText('This proposal cannot be applied. Ask the agent for a new proposal against the latest revision.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Apply reviewed changes',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Unassign',exact:true}).click();await page.getByRole('button',{name:'Assign to this project',exact:true}).waitFor();
 const built=await fixtures.buildFixture(reviewedProject.id);
 await page.getByRole('button',{name:'Runs',exact:true}).click();await page.getByRole('link',{name:'Download build ZIP',exact:true}).waitFor();await page.getByRole('button',{name:'Preview saved build',exact:true}).click();
 const frame=page.frameLocator('iframe[title="Saved build preview"]');await frame.getByRole('button',{name:'Compiled clicks: 0',exact:true}).click();await frame.getByRole('button',{name:'Compiled clicks: 1',exact:true}).waitFor();
 assert.equal(await page.locator('iframe[title="Saved build preview"]').getAttribute('sandbox'),'allow-scripts');await page.screenshot({path:path.join(qa,'desktop-compiled-preview.png')});
 const zipDownload=page.waitForEvent('download');await page.getByRole('link',{name:'Download build ZIP',exact:true}).click();const zipFile=await zipDownload,zipPath=path.join(qa,'browser-build.zip');await zipFile.saveAs(zipPath);assert.deepEqual(Object.keys(unzipSync(await readFile(zipPath))).sort(),built.files.sort());
 await phone.reload();await phone.getByRole('navigation',{name:'Projects',exact:true}).getByRole('button',{name:'Browser reviewed project',exact:true}).click();await phone.getByRole('button',{name:'Runs',exact:true}).click();await phone.getByRole('button',{name:'Preview saved build',exact:true}).click();await phone.frameLocator('iframe[title="Saved build preview"]').getByRole('button',{name:'Compiled clicks: 0',exact:true}).click();await phone.frameLocator('iframe[title="Saved build preview"]').getByRole('button',{name:'Compiled clicks: 1',exact:true}).waitFor();assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await phone.screenshot({path:path.join(qa,'mobile-build-preview.png')});
 const voiceContext=await browser.newContext({storageState:await context.storageState()});
 const voicePage=await voiceContext.newPage();voicePage.on('pageerror',error=>errors.push(error.message));
 await voicePage.addInitScript(()=>{
   navigator.mediaDevices.getUserMedia=async()=>{
     const audio=new AudioContext(),destination=audio.createMediaStreamDestination();
     const track=destination.stream.getAudioTracks()[0];
     const stop=track.stop.bind(track);
     track.stop=()=>{stop();void audio.close();};
     return destination.stream;
   };
 });
 let voicePreviews=0;
 await voicePage.route('**/api/local-voice/preview',route=>{
   assert.deepEqual(route.request().postDataJSON(),{voice:'rex',speed:1.15});
   voicePreviews++;
   return route.fulfill({contentType:'audio/pcm;rate=24000',body:Buffer.alloc(144000)});
 });
 await voicePage.route('**/api/local-voice/session',route=>{
   const {voice,speed}=route.request().postDataJSON();
   assert.deepEqual({voice,speed},{voice:'rex',speed:1.15});
   return route.fulfill({json:{
     callId:'local-voice-fixture',clientSecret:'fixture',sampleRate:24000,instructions:'Fixture voice instructions',
     websocketUrl:base.replace('http:','ws:')+'/fixture-voice',
     session:{instructions:'Fixture voice instructions',tools:[],turn_detection:{type:'server_vad'},voice,audio:{output:{speed}}},
   }});
 });
 let microphoneFrame=false, interrupted=false, closed=false;
 const voiceInstructions=[];
 await voicePage.routeWebSocket('**/fixture-voice',socket=>{
   socket.onClose(()=>{closed=true;});
   socket.onMessage(message=>{
     const event=JSON.parse(String(message));
     const send=(data)=>socket.send(JSON.stringify(data));
     if(event.type==='session.update'){
       assert.deepEqual(event.session.tools,[]);
       assert.equal(event.session.voice,'rex');assert.equal(event.session.audio.output.speed,1.15);
       voiceInstructions.push(event.session.instructions);
       send({type:'session.updated'});
     }
     if(event.type==='response.create'){
       send({type:'response.created',response:{id:'fixture-reply'}});
       send({type:'response.output_audio_transcript.delta',item_id:'reply',delta:'Hello from Sebby'});
       send({type:'response.output_audio.delta',response_id:'fixture-reply',delta:Buffer.alloc(48000).toString('base64')});
     }
     if(event.type==='input_audio_buffer.append'&&!microphoneFrame){
       microphoneFrame=true;
       send({type:'input_audio_buffer.speech_started'});
     }
     if(event.type==='response.cancel'){
       interrupted=true;
       send({type:'input_audio_buffer.speech_stopped'});
       send({type:'conversation.item.input_audio_transcription.completed',item_id:'user',transcript:'Tell me about my idea'});
       send({type:'response.done',response:{output:[]}});
     }
   });
 });
 await voicePage.goto(base+'/workspace');
 const voiceSettingsButton=voicePage.getByRole('button',{name:'Voice settings',exact:true});
 const voiceSettings=voicePage.getByRole('dialog',{name:'Voice settings',exact:true});
 await voiceSettingsButton.click();
 await voiceSettings.getByText('Add a key to use live Grok voice.',{exact:true}).waitFor();
 const keyField=voiceSettings.getByLabel('xAI API key',{exact:true});
 await keyField.fill('sebby-browser-voice-fixture');
 await voiceSettings.getByRole('button',{name:'Save key',exact:true}).click();
 await voiceSettings.getByText('Key saved on this computer.',{exact:true}).waitFor();
 assert.equal(await keyField.inputValue(),'');
 await voiceSettings.getByLabel('Voice',{exact:true}).selectOption('rex');
 await voiceSettings.getByLabel('Speaking speed',{exact:true}).selectOption('1.15');
 const previewResponse=voicePage.waitForResponse(response=>response.url().endsWith('/api/local-voice/preview'));
 await voiceSettings.getByRole('button',{name:'Preview voice',exact:true}).click();
 await previewResponse;
 await voiceSettings.getByRole('button',{name:'Stop preview',exact:true}).waitFor();
 assert.equal(voicePreviews,1);
 await voicePage.screenshot({path:path.join(qa,'desktop-workspace-voice-settings.png')});
 await voiceSettings.getByRole('button',{name:'Stop preview',exact:true}).click();
 await voiceSettings.getByRole('button',{name:'Preview voice',exact:true}).waitFor();
 await voiceSettings.getByRole('button',{name:'Save voice settings',exact:true}).click();
 await voicePage.reload();
 await voiceSettingsButton.click();
 await voiceSettings.getByText('Key saved on this computer.',{exact:true}).waitFor();
 assert.equal(await keyField.inputValue(),'');
 assert.equal(await voiceSettings.getByLabel('Voice',{exact:true}).inputValue(),'rex');
 assert.equal(await voiceSettings.getByLabel('Speaking speed',{exact:true}).inputValue(),'1.15');
 await voiceSettings.getByLabel('Voice',{exact:true}).selectOption('eve');
 await voiceSettings.getByRole('button',{name:'Cancel',exact:true}).click();

 await voicePage.getByRole('navigation',{name:'Projects',exact:true}).getByRole('button',{name:'Browser acceptance',exact:true}).click();
 await voicePage.getByRole('button',{name:'Start live voice',exact:true}).click();
 const call=voicePage.getByRole('region',{name:'Voice call with Sebby',exact:true});
 await call.getByText('Tell me about my idea',{exact:true}).waitFor();
 assert.equal(microphoneFrame,true);assert.equal(interrupted,true);
 assert.deepEqual(voiceInstructions,['Fixture voice instructions']);
 await voicePage.screenshot({path:path.join(qa,'desktop-local-voice.png')});
 await call.getByRole('button',{name:'End call',exact:true}).click();
 await call.waitFor({state:'hidden'});
 for(let attempt=0;attempt<30&&!closed;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(closed,true);
 await voicePage.getByText('Last voice transcript',{exact:true}).click();
 const transcript=voicePage.getByLabel('Voice transcript text',{exact:true});
 assert.match(await transcript.innerText(),/Sebby \(partial\): Hello from Sebby/);
 assert.match(await transcript.innerText(),/You: Tell me about my idea/);
 const downloadEvent=voicePage.waitForEvent('download');
 await voicePage.getByRole('button',{name:'Download transcript',exact:true}).click();
 const transcriptDownload=await downloadEvent;
 assert.match(transcriptDownload.suggestedFilename(),/^sebby-call-.*[.]txt$/);
 assert.match(await readFile(await transcriptDownload.path(),'utf8'),/You: Tell me about my idea/);
 await voicePage.getByLabel('New project',{exact:true}).fill('Voice transcript fixture');
 await voicePage.getByRole('button',{name:'Create project',exact:true}).click();
 await voicePage.getByRole('button',{name:'Add transcript to project',exact:true}).click();
 await voicePage.getByText('Unsaved changes',{exact:true}).waitFor();
 await voicePage.getByRole('button',{name:'Save',exact:true}).click();
 await voicePage.getByText('Saved · revision 2',{exact:true}).waitFor();
 await voicePage.getByRole('button',{name:'Clear transcript',exact:true}).click();
 await voicePage.getByText('Last voice transcript',{exact:true}).waitFor({state:'hidden'});
 const savedProjects=await (await voiceContext.request.get(base+'/api/projects')).json();
 const savedVoiceProject=savedProjects.projects.find(project=>project.name==='Voice transcript fixture');
 const savedVoiceDocument=await (await voiceContext.request.get(base+'/api/projects/'+savedVoiceProject.id)).json();
 assert.match(savedVoiceDocument.project.files.find(file=>file.path===transcriptDownload.suggestedFilename()).content,/You: Tell me about my idea/);
 await voicePage.getByRole('navigation',{name:'Projects',exact:true}).getByRole('button',{name:'Browser acceptance',exact:true}).click();
 const talk=voicePage.getByRole('button',{name:'Talk about this project',exact:true});
 await talk.click();
 const briefDialog=voicePage.getByRole('dialog',{name:'Talk about Browser acceptance'});
 const brief=briefDialog.getByRole('textbox',{name:'Project brief to share',exact:true});
 assert.match(await brief.inputValue(),/Browseracceptance requires editable meshes/);
 await briefDialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await briefDialog.waitFor({state:'hidden'});
 assert.equal(voiceInstructions.length,1);
 await talk.click();
 await brief.fill('Discuss silhouettes for the scene.');
 await voicePage.screenshot({path:path.join(qa,'desktop-voice-brief.png')});
 await briefDialog.getByRole('button',{name:'Share brief and start',exact:true}).click();
 await call.getByText('Hello from Sebby',{exact:true}).waitFor();
 assert.match(voiceInstructions[1],/"projectName":"Browser acceptance","brief":"Discuss silhouettes for the scene\."/);
 assert.doesNotMatch(voiceInstructions[1],/requires editable meshes|Persistent source/);
 await call.getByRole('button',{name:'End call',exact:true}).click();
 await call.waitFor({state:'hidden'});
 await voiceSettingsButton.click();
 await voiceSettings.getByRole('button',{name:'Remove saved key',exact:true}).click();
 await voiceSettings.getByText('Saved key removed.',{exact:true}).waitFor();
 await voiceSettings.getByText('Add a key to use live Grok voice.',{exact:true}).waitFor();
 await voiceContext.close();
 assert.deepEqual(errors,[]);await writeFile(path.join(qa,'checks.json'),JSON.stringify({page:base+'/workspace',title:'Sebby',desktop:[1440,1000],mobile:[390,844],checks:['login','create/edit/save','knowledge persistence/search','mesh extrude/inset','gizmo drag','undo/redo','GLB header/download','reload/reopen','connection controls','mobile no horizontal page overflow','GitHub source review/create/edit/reopen (network fixture)','reviewed source restoration','reviewed mesh restoration and reversal','source ZIP file-picker/import','real modeling tool candidate with browser apply/reject/stale checks','trusted Vite/React retained preview and click interaction (seeded run)','build ZIP download','mobile build preview overflow','local voice handshake, audio, interruption, captions, hang-up, transcript download and draft attachment, explicit brief sharing and persistent voice settings (simulated xAI)'],consoleErrors:errors},null,2));console.log('Browser acceptance passed; evidence:',qa);
}catch(error){try{await browser?.contexts()[0]?.pages()[0]?.screenshot({path:path.join(qa,'failure.png')});}catch{}throw error;}finally{fixtures?.close();clearTimeout(timer);await browser?.close();child.kill('SIGTERM');const force=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(force);await rm(root,{recursive:true,force:true});}

// 실제 내보낸 GLB의 움직임을 three.js로 재평가한다. 이미지 해독만 생략한다.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, LoopOnce, Vector3 } from '../../frontend/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../frontend/node_modules/three/examples/jsm/loaders/GLTFLoader.js';

const asset=new URL('../../frontend/public/interview/duck/interviewer.glb',import.meta.url);
const binary=readFileSync(asset),jsonSize=binary.readUInt32LE(12),gltf=JSON.parse(binary.subarray(20,20+jsonSize));
assert.equal(gltf.asset.version,'2.0');assert.equal(gltf.meshes.length,15);assert.equal(gltf.images.length,6);
const required=['Duck_Folded_Idle','Duck_Nod_Double','Duck_Talk','Duck_Surprise','Duck_Blink'];
assert.deepEqual(gltf.animations.map(a=>a.name).sort(),required.toSorted());
for(const mesh of gltf.meshes.filter(m=>m.extras?.targetNames))assert.deepEqual(mesh.extras.targetNames,['Smile','Angry','Blink']);
const doc=structuredClone(gltf);
delete doc.images;delete doc.textures;
for(const m of doc.materials)delete m.pbrMetallicRoughness?.baseColorTexture;
const encoded=Buffer.from(JSON.stringify(doc)),padding=(4-encoded.length%4)%4;
const chunk=Buffer.concat([encoded,Buffer.alloc(padding,32)]),tail=binary.subarray(20+jsonSize);
const stripped=Buffer.alloc(20+chunk.length+tail.length);
stripped.write('glTF');stripped.writeUInt32LE(2,4);stripped.writeUInt32LE(stripped.length,8);stripped.writeUInt32LE(chunk.length,12);stripped.writeUInt32LE(0x4e4f534a,16);chunk.copy(stripped,20);tail.copy(stripped,20+chunk.length);
const loaded=await new GLTFLoader().parseAsync(stripped.buffer.slice(stripped.byteOffset,stripped.byteOffset+stripped.byteLength),'');
const scene=loaded.scene,rest=[];scene.traverse(o=>rest.push([o,o.position.clone(),o.quaternion.clone(),o.scale.clone()]));
const restore=()=>{for(const [o,p,q,s] of rest){o.position.copy(p);o.quaternion.copy(q);o.scale.copy(s);o.morphTargetInfluences?.fill(0);}scene.updateMatrixWorld(true);};
const feet=['Leg_L','Leg_R'].map(n=>scene.getObjectByName(n));assert(feet.every(Boolean));
const footRest=feet.map(o=>o.getWorldPosition(new Vector3()));const report=[];
for(const clip of loaded.animations){
 restore();const mixer=new AnimationMixer(scene);const action=mixer.clipAction(clip);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
 let maxFootDrift=0,bodyMoves=false,headMoves=false,jawMoves=false,eyeClosed=false,wingsMove=false;
 const body=scene.getObjectByName('Duck_Body'),head=scene.getObjectByName('Duck_Head'),jaw=scene.getObjectByName('Duck_Beak_Lower'),wing=scene.getObjectByName('Duck_Wing_R_Upper');
 const base={body:body.position.clone(),head:head.quaternion.clone(),jaw:jaw.quaternion.clone(),wing:wing.quaternion.clone()};
 for(let i=0;i<=60;i++){
  mixer.setTime(clip.duration*i/60);scene.updateMatrixWorld(true);
  maxFootDrift=Math.max(maxFootDrift,...feet.map((o,j)=>o.getWorldPosition(new Vector3()).distanceTo(footRest[j])));
  bodyMoves ||= body.position.distanceTo(base.body)>.001;
  headMoves ||= head.quaternion.angleTo(base.head)>.005;
  jawMoves ||= jaw.quaternion.angleTo(base.jaw)>.02;
  wingsMove ||= wing.quaternion.angleTo(base.wing)>.2;
  scene.traverse(o=>{const index=o.morphTargetDictionary?.Blink;if(index!==undefined&&o.morphTargetInfluences[index]>.8)eyeClosed=true;});
 }
 assert(maxFootDrift<1e-6,`${clip.name}: 발 이동 ${maxFootDrift}`);
 if(clip.name==='Duck_Talk')assert(bodyMoves&&headMoves&&jawMoves&&eyeClosed,'말하기 채널 누락');
 if(clip.name==='Duck_Nod_Double')assert(headMoves&&!bodyMoves&&!wingsMove,'끄덕임 채널 오염');
 if(clip.name==='Duck_Surprise')assert(headMoves&&jawMoves&&wingsMove&&!bodyMoves,'놀람 채널 누락/오염');
 if(clip.name==='Duck_Blink')assert(eyeClosed&&!bodyMoves&&!headMoves&&!jawMoves,'깜빡임 채널 오염');
 report.push({clip:clip.name,duration:clip.duration,maxFootDrift,bodyMoves,headMoves,jawMoves,wingsMove,eyeClosed});
 mixer.stopAllAction();mixer.uncacheRoot(scene);
}
const result={bytes:binary.length,meshCount:15,images:6,clips:report,passed:true};
writeFileSync(new URL('../../frontend/public/interview/duck/validation.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));

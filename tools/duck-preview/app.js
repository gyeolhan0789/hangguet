// 기준: 승인된 penguin_talking.blend(2026-11-04), three.js 0.186.1의
// GLTFLoader / AnimationMixer / OrbitControls 공식 문서. 실제 FE GLB를 사용한다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (q) => document.querySelector(q);
const state = { face:'neutral', motion:'talk', playing:true, speed:1, loop:true };
const names = { idle:'Duck_Folded_Idle', nod:'Duck_Nod_Double', talk:'Duck_Talk', surprise:'Duck_Surprise' };
const labels = { idle:'기본 자세', nod:'끄덕끄덕', talk:'말하기', surprise:'놀람' };
let renderer, mixer, action, root, controls, camera, scene, resizeObserver, timer;
let clips = new Map(), rest = [], eyes = [], blinkStart = -Infinity, ready = false;
const animatedBlink = new Map(), motionBounds = new Map();

function updateMixer(delta) {
  // Restore the last mixer result before applying display-only face overrides.
  // AnimationMixer skips writing identical samples, including paused/held frames.
  for (const eye of eyes) {
    const d=eye.morphTargetDictionary,w=eye.morphTargetInfluences;
    w[d.Smile]=0;w[d.Angry]=0;w[d.Blink]=animatedBlink.get(eye)??0;
  }
  mixer.update(delta);
  for (const eye of eyes) animatedBlink.set(eye,eye.morphTargetInfluences[eye.morphTargetDictionary.Blink]);
}
function fitMotion() {
  const box=motionBounds.get(names[state.motion]);if(!box)return;
  const target=controls.target,direction=camera.position.clone().sub(target).normalize();
  const right=new THREE.Vector3().crossVectors(camera.up,direction).normalize();
  const up=new THREE.Vector3().crossVectors(direction,right).normalize();
  const tanV=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tanH=tanV*camera.aspect;
  let distance=.6;
  for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) {
    const p=new THREE.Vector3(x,y,z).sub(target);
    distance=Math.max(distance,p.dot(direction)+Math.max(Math.abs(p.dot(right))/tanH,Math.abs(p.dot(up))/tanV));
  }
  camera.position.copy(target).addScaledVector(direction,distance*1.14);controls.update();
}

function selectFace(face) {
  state.face = face;
  document.querySelectorAll('[data-face]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.face === face)));
  $('#blink').disabled = face !== 'neutral';
  $('#blink').title = face !== 'neutral' ? '기본 표정에서 눈을 깜빡일 수 있습니다.' : '';
  applyFace(0);
}
function applyFace(now) {
  const elapsed = (now - blinkStart) / 1000;
  let pulse = 0;
  if (elapsed >= 0 && elapsed < .067) pulse = elapsed / .067;
  else if (elapsed < .1 && elapsed >= .067) pulse = 1;
  else if (elapsed >= .1 && elapsed < .267) pulse = 1 - (elapsed - .1) / .167;
  for (const mesh of eyes) {
    const d = mesh.morphTargetDictionary, w = mesh.morphTargetInfluences;
    if (d.Smile !== undefined) w[d.Smile] = state.face === 'smile' ? 1 : 0;
    if (d.Angry !== undefined) w[d.Angry] = state.face === 'angry' ? 1 : 0;
    if (d.Blink !== undefined) w[d.Blink] = state.face === 'neutral' ? Math.max(animatedBlink.get(mesh)??0, pulse) : 0;
  }
}
function selectMotion(motion) {
  mixer.stopAllAction();
  for (const pose of rest) {
    pose.object.position.copy(pose.position);pose.object.quaternion.copy(pose.quaternion);pose.object.scale.copy(pose.scale);
    if (pose.object.morphTargetInfluences) pose.object.morphTargetInfluences.fill(0);
  }
  animatedBlink.clear();
  state.motion=motion;state.playing=true;
  action=mixer.clipAction(clips.get(names[motion]));
  action.reset().setLoop(state.loop ? THREE.LoopRepeat : THREE.LoopOnce,state.loop ? Infinity : 1);
  action.clampWhenFinished=!state.loop;action.play();updateMixer(0);fitMotion();
  document.querySelectorAll('[data-motion]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.motion===motion)));
  $('#status').textContent=`${labels[motion]} 재생 중`;
  syncPlay();applyFace(performance.now());
}
function syncPlay() {
  $('#play').textContent=state.playing?'Ⅱ':'▶';
  $('#play').setAttribute('aria-label',state.playing?'일시정지':'재생');
  if (action) {
    if(state.playing && action.time>=action.getClip().duration) action.reset().play();
    action.paused=!state.playing;
  }
  $('#status').textContent=`${labels[state.motion]} ${state.playing?'재생 중':'일시정지'}`;
}
function setView(view) {
  const target=new THREE.Vector3(0,.29,0);
  const directions={front:[0,.07,1],side:[1,.07,.02],back:[0,.07,-1],diagonal:[.75,.12,1]};
  const direction=new THREE.Vector3(...directions[view]).normalize();
  controls.target.copy(target);camera.position.copy(target).addScaledVector(direction,1.53);controls.update();fitMotion();
}
async function init() {
  renderer=new THREE.WebGLRenderer({canvas:$('#canvas'),antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(32,1,.005,20);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;
  controls.minDistance=.55;controls.maxDistance=3.5;controls.maxPolarAngle=Math.PI*.9;
  setView('front');
  scene.add(new THREE.HemisphereLight(0xfff9eb,0xb3baa6,1.45));
  const key=new THREE.DirectionalLight(0xfff3df,3.2);key.position.set(-1.3,2,2);key.castShadow=true;
  key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-.7;key.shadow.camera.right=.7;key.shadow.camera.top=.85;key.shadow.camera.bottom=-.25;
  key.shadow.camera.near=.1;key.shadow.camera.far=5;key.shadow.normalBias=.0007;key.shadow.bias=-.0001;key.shadow.radius=3;
  key.target.position.set(0,.25,0);scene.add(key,key.target);
  const fill=new THREE.DirectionalLight(0xe8f0ff,1);fill.position.set(1.3,1,1.2);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xf7ffe9,1.2);rim.position.set(.6,1.2,-1.3);scene.add(rim);
  const gltf=await new GLTFLoader().loadAsync('/interview/duck/interviewer.glb',event=>{
    if(event.total) $('#load-text').textContent=`오리를 데려오는 중 ${Math.round(100*event.loaded/event.total)}%`;
  });
  root=gltf.scene;scene.add(root);root.updateMatrixWorld(true);
  let triangles=0,meshes=0;
  root.traverse(object=>{
    rest.push({object,position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone()});
    if(!object.isMesh)return;
    meshes++;triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3;
    object.castShadow=true;object.receiveShadow=true;
    for(const m of Array.isArray(object.material)?object.material:[object.material]){
      if(m.map)m.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    }
    if(object.morphTargetDictionary)eyes.push(object);
  });
  clips=new Map(gltf.animations.map(c=>[c.name,c]));
  for(const name of [...Object.values(names),'Duck_Blink'])if(!clips.has(name))throw new Error(`동작을 불러오지 못했습니다: ${name}`);
  if(eyes.length!==4)throw new Error('눈 표정 데이터를 확인할 수 없습니다.');
  mixer=new THREE.AnimationMixer(root);
  // Fit the entire selected clip, including fully spread wings, in narrow views.
  for (const clip of gltf.animations) {
    const sample=mixer.clipAction(clip);sample.setLoop(THREE.LoopOnce,1);sample.clampWhenFinished=true;sample.play();
    const box=new THREE.Box3();
    for (let i=0;i<=30;i++){mixer.setTime(clip.duration*i/30);root.updateMatrixWorld(true);box.union(new THREE.Box3().setFromObject(root));}
    motionBounds.set(clip.name,box);mixer.stopAllAction();
    for(const pose of rest){pose.object.position.copy(pose.position);pose.object.quaternion.copy(pose.quaternion);pose.object.scale.copy(pose.scale);pose.object.morphTargetInfluences?.fill(0);}
  }
  mixer.addEventListener('finished',()=>{state.playing=false;syncPlay();});
  const bottom=new THREE.Box3().setFromObject(root).min.y;
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({color:0x344333,opacity:.21}));
  floor.rotation.x=-Math.PI/2;floor.position.y=bottom-.0003;floor.receiveShadow=true;scene.add(floor);
  const resize=()=>{const {width,height}=$('#stage').getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();fitMotion();};
  resizeObserver=new ResizeObserver(resize);resizeObserver.observe($('#stage'));resize();
  $('#loading').hidden=true;ready=true;
  document.querySelectorAll('[data-face],[data-motion],#play,#replay,#timeline,#blink').forEach(b=>b.disabled=false);
  $('#detail').textContent=`모델 준비됨 · ${gltf.animations.length}개 동작 · ${Math.round(triangles).toLocaleString()} 폴리곤`;
  selectMotion('talk');
  timer=new THREE.Timer();timer.connect(document);timer.reset();let lastText=0;
  renderer.setAnimationLoop(now=>{
    timer.update(now);const delta=timer.getDelta();
    updateMixer(delta*state.speed);applyFace(now);controls.update(delta);
    renderer.render(scene,camera);
    if(now-lastText>80){
      const duration=action.getClip().duration;
      $('#timeline').value=String(Math.round(action.time/duration*1000));
      $('#time').textContent=`${action.time.toFixed(2)} / ${duration.toFixed(2)}`;lastText=now;
    }
  });
}
document.querySelectorAll('[data-face]').forEach(b=>b.addEventListener('click',()=>selectFace(b.dataset.face)));
document.querySelectorAll('[data-motion]').forEach(b=>b.addEventListener('click',()=>selectMotion(b.dataset.motion)));
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>ready&&setView(b.dataset.view)));
$('#play').addEventListener('click',()=>{state.playing=!state.playing;syncPlay();});
$('#replay').addEventListener('click',()=>selectMotion(state.motion));
$('#speed').addEventListener('change',e=>state.speed=Number(e.target.value));
$('#loop').addEventListener('change',e=>{state.loop=e.target.checked;if(action){action.setLoop(state.loop?THREE.LoopRepeat:THREE.LoopOnce,state.loop?Infinity:1);action.clampWhenFinished=!state.loop;}});
$('#blink').addEventListener('click',()=>{blinkStart=performance.now();});
$('#timeline').addEventListener('input',e=>{action.time=Number(e.target.value)/1000*action.getClip().duration;updateMixer(0);applyFace(performance.now());$('#time').textContent=`${action.time.toFixed(2)} / ${action.getClip().duration.toFixed(2)}`;});
$('#retry').addEventListener('click',()=>location.reload());
document.addEventListener('keydown',e=>{if(e.code==='Space'&&ready&&!['INPUT','SELECT','BUTTON'].includes(document.activeElement.tagName)){e.preventDefault();state.playing=!state.playing;syncPlay();}});
window.addEventListener('pagehide',()=>{
  renderer?.setAnimationLoop(null);timer?.dispose();resizeObserver?.disconnect();controls?.dispose();mixer?.stopAllAction();
  const resources=new Set();scene?.traverse(o=>{if(!o.isMesh)return;resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){resources.add(m);for(const v of Object.values(m))if(v?.isTexture)resources.add(v);}});
  resources.forEach(r=>r.dispose());renderer?.dispose();
});
init().catch(error=>{console.error(error);$('#loading').classList.add('error');$('#load-text').textContent='모델을 불러오지 못했습니다.';$('#retry').hidden=false;$('#status').textContent='불러오기 실패';});

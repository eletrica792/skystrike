/* ============================================
   SKY STRIKE v2 — Combate Aéreo 3D
   Mira assistida · Mísseis · Visual moderno
   ============================================ */
'use strict';

function $(id){ return document.getElementById(id); }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function lerp(a,b,t){ return a+(b-a)*t; }
function wrapPi(a){ return Math.atan2(Math.sin(a),Math.cos(a)); }
function bind(id,fn){ const e=$(id); if(e) e.onclick=fn; else console.warn('faltando:',id); }

// ─── STATE ──────────────────────────────────
let renderer, scene, camera, clock, sun;
let cockpitGroup=null, cockpitMFDLeft=null, cockpitMFDRight=null, cockpitRadar=null;
let cockpitStickGroup=null, cockpitStickSteer=0, cockpitStickPitch=0;
let gameState='loading';
let player=null;
let enemies=[], bullets=[], missiles=[], parts=[], flashes=[], floaters=[], debris=[];
let score=0, wave=0, kills=0, waveTimer=0, waitingWave=false;

// ─── CAMPANHA V5.0 ──────────────────────────
const MISSION_WAVES=8;

// total = quantidade total daquela onda
// maxActive = máximo simultâneo no céu
// elites = quantidade de Elite naquela onda
// skill = pequeno aumento progressivo da competência da IA
const WAVE_CONFIGS={
  1:{total:3,maxActive:3,elites:0,skill:0.00,label:'INTRODUÇÃO'},
  2:{total:4,maxActive:4,elites:0,skill:0.08,label:'CONTATO'},
  3:{total:5,maxActive:4,elites:0,skill:0.16,label:'PRESSÃO'},
  4:{total:6,maxActive:4,elites:1,skill:0.25,label:'ELITE DETECTADO'},
  5:{total:7,maxActive:5,elites:1,skill:0.36,label:'COMBATE INTENSO'},
  6:{total:7,maxActive:5,elites:1,skill:0.48,label:'ALTA PRESSÃO'},
  7:{total:8,maxActive:5,elites:2,skill:0.61,label:'ESQUADRÃO AVANÇADO'},
  8:{total:8,maxActive:5,elites:2,skill:0.74,label:'ONDA FINAL'}
};

let survivalMode=false;
let missionWon=false;
let waveCfg=null;
let waveSpawnPlan=[];
let waveSpawnIndex=0;
let waveRemainingToSpawn=0;
let waveMaxActive=0;
let waveSkill=0;
let reinforcementTimer=0;
let reinforcementAnnounced=false;

// ─── V5.1: ÁREA, TEMPO E RETORNO AO PORTA-AVIÕES ─────────────
const COMBAT_LIMIT=3400;
const WORLD_SIZE=7600;

const CARRIER_X=-2850;
const CARRIER_Z=-1000;
const CARRIER_GROUP_Y=-0.4;
const CARRIER_DECK_TOP=6.6;
const CARRIER_PLANE_Y=CARRIER_DECK_TOP+4.5;
const CARRIER_LANDING_X=CARRIER_X-7;

let carrierGroup=null;
let carrierCrew=[];
let captainFigure=null;
let pilotFigure=null;

let missionTime=0;
let finalMissionTime=0;

let returnPhase='none';
let returnTimer=0;
let returnLanded=false;
let returnCaptionShown=false;

let camMode=0, camShake=0, hitT=0, regenT=0;
let lockTarget=null, lockTime=0, missileCd=0;
const keys={};
let msgTimer=null;
let waterMesh=null, waterBase=null, gTime=0;
let muzzleLight=null, boomLights=[];
let speedStreaks=[];
let envTex=null, sunWorld=null;
const jetMatsAll=[];

const ctrl={
  steerAxis:0, pitchAxis:1, fireBtn:0,
  invX:false, invY:false, dz:0.08, sens:1.0, lin:1.0,
  cX:0, cY:0, mnX:-1, mxX:1, mnY:-1, mxY:1, gpIdx:null,

  // Sentido semântico do eixo vertical.
  // Depois da calibração, PUXAR PARA TRÁS sempre produz pitch positivo.
  pitchPullSign:1,
  configVersion:481
};
let audioCtx=null, engOsc=null, engGain=null, noiseBuf=null;

let fxRadialTex=null, fxSmokeTex=null, fxStreakTex=null;

function makeRadialFxTex(){
  if(fxRadialTex) return fxRadialTex;
  const cv=document.createElement('canvas');
  cv.width=128; cv.height=128;
  const x=cv.getContext('2d');
  const g=x.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0.00,'rgba(255,255,255,1)');
  g.addColorStop(0.16,'rgba(255,255,255,.98)');
  g.addColorStop(0.42,'rgba(255,255,255,.62)');
  g.addColorStop(0.72,'rgba(255,255,255,.18)');
  g.addColorStop(1.00,'rgba(255,255,255,0)');
  x.fillStyle=g;
  x.fillRect(0,0,128,128);
  fxRadialTex=new THREE.CanvasTexture(cv);
  fxRadialTex.minFilter=THREE.LinearFilter;
  fxRadialTex.magFilter=THREE.LinearFilter;
  return fxRadialTex;
}

function makeSmokeFxTex(){
  if(fxSmokeTex) return fxSmokeTex;
  const cv=document.createElement('canvas');
  cv.width=128; cv.height=128;
  const x=cv.getContext('2d');

  // Multiple overlapping radial puffs make the edge irregular,
  // while remaining fully transparent at the canvas border.
  x.clearRect(0,0,128,128);
  const puffs=[
    [62,64,49,.56],[47,58,32,.34],[78,55,31,.31],
    [53,78,31,.29],[79,77,29,.26],[65,42,25,.22]
  ];
  for(const [cx,cy,r,a] of puffs){
    const g=x.createRadialGradient(cx,cy,0,cx,cy,r);
    g.addColorStop(0,'rgba(255,255,255,'+a+')');
    g.addColorStop(.48,'rgba(255,255,255,'+(a*.62)+')');
    g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g;
    x.fillRect(cx-r,cy-r,r*2,r*2);
  }
  fxSmokeTex=new THREE.CanvasTexture(cv);
  fxSmokeTex.minFilter=THREE.LinearFilter;
  fxSmokeTex.magFilter=THREE.LinearFilter;
  return fxSmokeTex;
}

function makeStreakFxTex(){
  if(fxStreakTex) return fxStreakTex;
  const cv=document.createElement('canvas');
  cv.width=32; cv.height=256;
  const x=cv.getContext('2d');

  // Soft vertical streak: transparent on every edge.
  const gx=x.createLinearGradient(0,0,0,256);
  gx.addColorStop(0,'rgba(255,255,255,0)');
  gx.addColorStop(.18,'rgba(255,255,255,.22)');
  gx.addColorStop(.50,'rgba(255,255,255,.82)');
  gx.addColorStop(.82,'rgba(255,255,255,.22)');
  gx.addColorStop(1,'rgba(255,255,255,0)');

  const gy=x.createLinearGradient(0,0,32,0);
  gy.addColorStop(0,'rgba(255,255,255,0)');
  gy.addColorStop(.35,'rgba(255,255,255,.75)');
  gy.addColorStop(.50,'rgba(255,255,255,1)');
  gy.addColorStop(.65,'rgba(255,255,255,.75)');
  gy.addColorStop(1,'rgba(255,255,255,0)');

  x.fillStyle=gx;
  x.fillRect(0,0,32,256);
  x.globalCompositeOperation='destination-in';
  x.fillStyle=gy;
  x.fillRect(0,0,32,256);
  x.globalCompositeOperation='source-over';

  fxStreakTex=new THREE.CanvasTexture(cv);
  fxStreakTex.minFilter=THREE.LinearFilter;
  fxStreakTex.magFilter=THREE.LinearFilter;
  return fxStreakTex;
}

// ─── TERRAIN HEIGHT ─────────────────────────
function terrH(x,z){
  return Math.max(-8,
    Math.sin(x*0.004)*Math.cos(z*0.003)*22 +
    Math.sin(x*0.010+2.1)*Math.sin(z*0.008+1.3)*9 +
    Math.sin(x*0.021)*Math.cos(z*0.024)*3.5 - 6
  );
}

// ─── SCENE ──────────────────────────────────
function initScene(){
  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setSize(window.innerWidth,window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputEncoding=THREE.sRGBEncoding;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.28;
  renderer.physicallyCorrectLights=true;
  $('game-container').appendChild(renderer.domElement);

  scene=new THREE.Scene();
  scene.fog=new THREE.Fog(0xa5b3bf, 820, 5200);

  camera=new THREE.PerspectiveCamera(66,window.innerWidth/window.innerHeight,0.35,9000);
  camera.position.set(0,90,40);
  scene.add(camera);
  clock=new THREE.Clock();

  // Lights
  scene.add(new THREE.AmbientLight(0x7289a2,0.42));
  scene.add(new THREE.HemisphereLight(0xd6e5f4,0x4d4738,0.62));
  sun=new THREE.DirectionalLight(0xffd7a1,1.85);
  sun.position.set(500,700,300);
  sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.camera.near=50; sun.shadow.camera.far=1800;
  sun.shadow.camera.left=-420; sun.shadow.camera.right=420;
  sun.shadow.camera.top=420; sun.shadow.camera.bottom=-420;
  sun.shadow.bias=-0.0006;
  scene.add(sun); scene.add(sun.target);

  buildSky();
  buildTerrain();
  buildWater();
  buildClouds();
  buildAirbase();
  buildAircraftCarrier();
  buildPlayer();

  // Capture environment cubemap once → glossy reflections on all jets
  try{
    const cubeRT=new THREE.WebGLCubeRenderTarget(128,{generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter});
    const cubeCam=new THREE.CubeCamera(1,5000,cubeRT);
    cubeCam.position.set(0,140,0);
    scene.add(cubeCam);
    cubeCam.update(renderer,scene);
    scene.remove(cubeCam);
    envTex=cubeRT.texture;
    for(const m of jetMatsAll){ m.envMap=envTex; m.envMapIntensity=0.75; m.needsUpdate=true; }
  }catch(e){ console.warn('envmap',e); }

  buildCockpit();

  // Reusable lights
  muzzleLight=new THREE.PointLight(0xffcc66,0,60);
  scene.add(muzzleLight);
  for(let i=0;i<3;i++){
    const l=new THREE.PointLight(0xff7733,0,140);
    scene.add(l);
    boomLights.push({l,t:0});
  }

  window.addEventListener('resize',()=>{
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
    sizeHudCanvas();
  });
  window.addEventListener('keydown',e=>{
    keys[e.code]=true;
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    onKey(e);
  });
  window.addEventListener('keyup',e=>{ keys[e.code]=false; });
  window.addEventListener('gamepadconnected',e=>{ if(ctrl.gpIdx===null) ctrl.gpIdx=e.gamepad.index; });
  window.addEventListener('gamepaddisconnected',e=>{ if(ctrl.gpIdx===e.gamepad.index) ctrl.gpIdx=null; });
  sizeHudCanvas();
}

// ─── SKY (gradient shader + sun disc) ───────
function buildSky(){
  const skyMat=new THREE.ShaderMaterial({
    uniforms:{
      cTop:{value:new THREE.Color(0x1e4e86)},
      cMid:{value:new THREE.Color(0x6fa8cf)},
      cBot:{value:new THREE.Color(0xf1cfa6)}
    },
    vertexShader:'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader:
      'varying vec3 vP; uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot;'+
      'void main(){ float h=normalize(vP).y;'+
      ' vec3 c = h>0.12 ? mix(cMid,cTop,smoothstep(0.12,0.55,h)) : mix(cBot,cMid,smoothstep(-0.04,0.12,h));'+
      ' gl_FragColor=vec4(c,1.0); }',
    side:THREE.BackSide, depthWrite:false, fog:false
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(5200,32,16),skyMat));

  // Sun disc + halo (additive sprites)
  const sunDir=new THREE.Vector3(500,700,300).normalize();
  sunWorld=sunDir.clone().multiplyScalar(2900);
  const sunGlowTex=makeRadialFxTex();
  const mkGlow=(size,op,col)=>{
    const s=new THREE.Sprite(new THREE.SpriteMaterial({
      map:sunGlowTex,
      color:col,
      transparent:true,
      opacity:op,
      blending:THREE.AdditiveBlending,
      depthWrite:false,
      depthTest:false,
      fog:false
    }));
    s.position.copy(sunDir).multiplyScalar(2900);
    s.scale.set(size,size,1);
    scene.add(s);
  };
  mkGlow(300,0.98,0xfff5dc);
  mkGlow(1050,0.34,0xffc878);
  mkGlow(2300,0.12,0xffa85f);
}

// ─── TERRAIN v2 (height + slope coloring, rocks) ───
function buildTerrain(){
  const SIZE=WORLD_SIZE, SEG=170;
  const geo=new THREE.PlaneGeometry(SIZE,SIZE,SEG,SEG);
  geo.rotateX(-Math.PI/2);
  const pos=geo.attributes.position;
  for(let i=0;i<pos.count;i++){
    pos.setY(i,terrH(pos.getX(i),pos.getZ(i)));
  }
  geo.computeVertexNormals();
  const nrm=geo.attributes.normal;

  const colors=[];
  const cSand=new THREE.Color(0xc5ad83);
  const cGrass=new THREE.Color(0x52763d);
  const cGrass2=new THREE.Color(0x315f35);
  const cDirt=new THREE.Color(0x78624b);
  const cRock=new THREE.Color(0x777d82);

  for(let i=0;i<pos.count;i++){
    const h=pos.getY(i);
    const slope=1-nrm.getY(i); // 0 flat, ->1 steep
    let c;
    if(h<0.8) c=cSand.clone();
    else{
      const g=cGrass.clone().lerp(cGrass2,(Math.sin(pos.getX(i)*0.05)+Math.cos(pos.getZ(i)*0.06))*0.25+0.5);
      c=g.lerp(cDirt,clamp((h-8)/16,0,1));
      c.lerp(cRock,clamp(slope*2.6,0,1));
    }
    colors.push(Math.min(1,c.r*1.06),Math.min(1,c.g*1.06),Math.min(1,c.b*1.06));
  }
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));

  const detail=makeDetailTex();
  detail.anisotropy=renderer.capabilities.getMaxAnisotropy();
  const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.95,metalness:0,map:detail}));
  mesh.receiveShadow=true;
  scene.add(mesh);

  // Trees
  const trunkM=new THREE.MeshStandardMaterial({color:0x4a4035,roughness:0.95});
  const leafM=new THREE.MeshStandardMaterial({color:0x394c2f,roughness:0.92});
  const leafM2=new THREE.MeshStandardMaterial({color:0x455c35,roughness:0.92});
  let placed=0,tries=0;
  while(placed<180&&tries<1300){
    tries++;
    const x=(Math.random()-0.5)*6200,z=(Math.random()-0.5)*6200;
    const h=terrH(x,z);
    if(h<2||h>15) continue;
    const th=4+Math.random()*5;
    const g=new THREE.Group();
    const tr=new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.5,th,5),trunkM);
    tr.position.y=th/2; tr.castShadow=true; g.add(tr);
    const cn=new THREE.Mesh(new THREE.ConeGeometry(2.2+Math.random()*1.8,th*1.15,7),Math.random()>0.5?leafM:leafM2);
    cn.position.y=th+th*0.42; cn.castShadow=true; g.add(cn);
    g.position.set(x,h,z);
    scene.add(g);
    placed++;
  }

  // Rocks on high ground
  const rockM=new THREE.MeshStandardMaterial({color:0x6e716d,roughness:0.95,flatShading:true});
  for(let i=0;i<60;i++){
    const x=(Math.random()-0.5)*6200,z=(Math.random()-0.5)*6200;
    const h=terrH(x,z);
    if(h<10) continue;
    const r=new THREE.Mesh(new THREE.DodecahedronGeometry(1.5+Math.random()*3,0),rockM);
    r.position.set(x,h+0.5,z);
    r.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);
    r.castShadow=true;
    scene.add(r);
  }
}

// ─── WATER (animated, specular) ─────────────
function buildWater(){
  const SIZE=WORLD_SIZE, SEG=64;
  const geo=new THREE.PlaneGeometry(SIZE,SIZE,SEG,SEG);
  geo.rotateX(-Math.PI/2);
  waterBase=Float32Array.from(geo.attributes.position.array);
  const wn=makeWaterNormalTex();
  const mat=new THREE.MeshPhongMaterial({
    color:0x155a75, specular:0xd0efff, shininess:185,
    transparent:true, opacity:0.94,
    normalMap:wn, normalScale:new THREE.Vector2(0.60,0.60)
  });
  waterMesh=new THREE.Mesh(geo,mat);
  waterMesh.position.y=-0.4;
  scene.add(waterMesh);
}

function updateWater(dt){
  if(!waterMesh) return;
  gTime+=dt;
  const p=waterMesh.geometry.attributes.position;
  const arr=p.array;
  for(let i=0;i<arr.length;i+=3){
    const x=waterBase[i], z=waterBase[i+2];
    arr[i+1]=Math.sin(x*0.018+gTime*1.4)*0.55+Math.cos(z*0.015+gTime*1.1)*0.5;
  }
  p.needsUpdate=true;
  waterMesh.geometry.computeVertexNormals();
  const nm=waterMesh.material.normalMap;
  if(nm){ nm.offset.x=gTime*0.016; nm.offset.y=gTime*0.011; }
}

// ─── CLOUDS (soft billboards, gradiente radial) ──
function buildClouds(){
  const tex=makeCloudTex();
  for(let i=0;i<58;i++){
    const big=i<6;
    const s=new THREE.Sprite(new THREE.SpriteMaterial({
      map:tex, transparent:true, depthWrite:false,
      opacity:big?0.24:0.34+Math.random()*0.22
    }));
    const w=big?620+Math.random()*340:180+Math.random()*240;
    s.scale.set(w,w*0.5,1);
    s.position.set(
      (Math.random()-0.5)*6800,
      big?260+Math.random()*90:150+Math.random()*160,
      (Math.random()-0.5)*6800
    );
    scene.add(s);
  }
}


// ─── COCKPIT MILITAR 3D ────────────────────
function makeCockpitScreen(label,color){
  const cv=document.createElement('canvas');
  cv.width=512;cv.height=384;
  const x=cv.getContext('2d');
  x.fillStyle='#07110c';x.fillRect(0,0,cv.width,cv.height);
  x.strokeStyle='rgba(95,255,150,.35)';x.lineWidth=2;
  for(let i=0;i<10;i++){
    x.beginPath();x.moveTo(0,i*42);x.lineTo(cv.width,i*42);x.stroke();
  }
  for(let i=0;i<13;i++){
    x.beginPath();x.moveTo(i*42,0);x.lineTo(i*42,cv.height);x.stroke();
  }
  x.strokeStyle=color||'#66ff9a';
  x.lineWidth=3;
  x.strokeRect(14,14,cv.width-28,cv.height-28);
  x.font='700 38px Rajdhani,Segoe UI,sans-serif';
  x.fillStyle=color||'#66ff9a';
  x.fillText(label,28,58);
  x.font='600 23px Rajdhani,Segoe UI,sans-serif';
  x.fillText('SYS   NAV   WPN',28,95);

  if(label==='RADAR'){
    x.strokeStyle='rgba(95,255,150,.8)';
    x.beginPath();x.arc(256,220,115,0,Math.PI*2);x.stroke();
    x.beginPath();x.arc(256,220,70,0,Math.PI*2);x.stroke();
    x.beginPath();x.moveTo(141,220);x.lineTo(371,220);x.moveTo(256,105);x.lineTo(256,335);x.stroke();
    for(let i=0;i<7;i++){
      const a=i*1.77+0.4,r=35+(i%3)*28;
      x.fillRect(252+Math.cos(a)*r,216+Math.sin(a)*r,7,7);
    }
  }else{
    x.fillStyle='rgba(95,255,150,.8)';
    x.font='700 24px Consolas,monospace';
    x.fillText('ENG  94%',40,145);
    x.fillText('FUEL 72%',40,185);
    x.fillText('HYD  NORM',40,225);
    x.fillText('WPN  ARM',40,265);
    x.fillText('FLR  12',40,305);
  }
  const tex=new THREE.CanvasTexture(cv);
  tex.minFilter=THREE.LinearFilter;
  tex.magFilter=THREE.LinearFilter;
  tex.needsUpdate=true;
  return tex;
}

function cockpitBox(w,h,d,pos,mat,rot){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.position.set(pos[0],pos[1],pos[2]);
  if(rot)m.rotation.set(rot[0],rot[1],rot[2]);
  cockpitGroup.add(m);
  return m;
}

function buildCockpit(){
  cockpitGroup=new THREE.Group();
  cockpitGroup.visible=false;
  camera.add(cockpitGroup);

  const panelM=new THREE.MeshStandardMaterial({color:0x232a27,roughness:0.94,metalness:0.16});
  const rubberM=new THREE.MeshStandardMaterial({color:0x0b0e0d,roughness:0.98,metalness:0.03});
  const glassM=new THREE.MeshBasicMaterial({color:0x8dffd0,transparent:true,opacity:0.035,depthWrite:false,side:THREE.DoubleSide});

  // Painel principal mais fino e baixo para abrir visão.
  cockpitBox(4.20,0.46,0.56,[0,-1.20,-2.16],panelM,[-0.10,0,0]);
  cockpitBox(4.45,0.12,0.52,[0,-0.90,-2.10],rubberM,[-0.06,0,0]);

  // Consoles laterais menos altos e menos quadradões.
  cockpitBox(0.86,0.24,2.20,[-1.78,-1.30,-1.32],panelM,[0,0,0.06]);
  cockpitBox(0.86,0.24,2.20,[ 1.78,-1.30,-1.32],panelM,[0,0,-0.06]);

  // V5.1.1 — canopy aberto na visão interna.
  // Removidas as antigas colunas laterais e a barra superior que ficavam
  // presas à câmera e reduziam artificialmente o campo de visão.
  // O canopy do MODELO EXTERNO continua existindo normalmente.
  // Na visão do piloto permanecem apenas painel, consoles, manche e HUD.

  // Vidro HUD menor e mais elegante.
  const hudGlass=new THREE.Mesh(new THREE.PlaneGeometry(1.22,0.88),glassM);
  hudGlass.position.set(0,0.18,-2.05);
  hudGlass.rotation.x=-0.02;
  cockpitGroup.add(hudGlass);

  // MFD bezels para fugir do aspecto muito chapado.
  function addMFDBezel(x){
    const bezel=new THREE.Mesh(
      new THREE.BoxGeometry(1.08,0.82,0.09),
      new THREE.MeshStandardMaterial({color:0x111615,roughness:0.88,metalness:0.18})
    );
    bezel.position.set(x,-1.02,-1.94);
    bezel.rotation.x=-0.12;
    cockpitGroup.add(bezel);
    return bezel;
  }

  addMFDBezel(-0.92);
  addMFDBezel(0.92);

  const mfdL=new THREE.MeshBasicMaterial({map:makeCockpitScreen('STATUS','#6dffa8')});
  const mfdR=new THREE.MeshBasicMaterial({map:makeCockpitScreen('RADAR','#6dffa8')});

  cockpitMFDLeft=new THREE.Mesh(new THREE.PlaneGeometry(0.90,0.68),mfdL);
  cockpitMFDRight=new THREE.Mesh(new THREE.PlaneGeometry(0.90,0.68),mfdR);

  cockpitMFDLeft.position.set(-0.92,-1.02,-1.89);
  cockpitMFDRight.position.set(0.92,-1.02,-1.89);
  cockpitMFDLeft.rotation.x=-0.12;
  cockpitMFDRight.rotation.x=-0.12;
  cockpitGroup.add(cockpitMFDLeft,cockpitMFDRight);

  // Display central retangular e compacto, substituindo o círculo carregado.
  const centerBezel=new THREE.Mesh(
    new THREE.BoxGeometry(0.84,0.60,0.09),
    new THREE.MeshStandardMaterial({color:0x101514,roughness:0.90,metalness:0.15})
  );
  centerBezel.position.set(0,-1.00,-1.95);
  centerBezel.rotation.x=-0.12;
  cockpitGroup.add(centerBezel);

  cockpitRadar=new THREE.Mesh(
    new THREE.PlaneGeometry(0.70,0.48),
    new THREE.MeshBasicMaterial({map:makeCockpitScreen('TAC','#75ffad')})
  );
  cockpitRadar.position.set(0,-1.00,-1.89);
  cockpitRadar.rotation.x=-0.12;
  cockpitGroup.add(cockpitRadar);

  // Poucas luzes de aviso, mais discretas.
  const lampData=[
    [-0.36,0xffcf54],[-0.16,0x49ff82],[0.04,0xff6b57],[0.24,0x49ff82]
  ];
  for(const [dx,col] of lampData){
    const l=new THREE.Mesh(
      new THREE.BoxGeometry(0.10,0.04,0.03),
      new THREE.MeshBasicMaterial({color:col})
    );
    l.position.set(dx,-0.68,-1.86);
    cockpitGroup.add(l);
  }

  // Manche animado: o pivô fica na base para a haste inclinar como um controle real.
  cockpitStickGroup=new THREE.Group();
  cockpitStickGroup.position.set(0,-1.55,-1.16);
  cockpitGroup.add(cockpitStickGroup);

  const stickMat=new THREE.MeshStandardMaterial({
    color:0x101514,roughness:0.92,metalness:0.18
  });
  const gripMat=new THREE.MeshStandardMaterial({
    color:0x0a0d0c,roughness:0.97,metalness:0.08
  });

  const stickBoot=new THREE.Mesh(
    new THREE.CylinderGeometry(0.15,0.19,0.12,14),
    new THREE.MeshStandardMaterial({color:0x090c0b,roughness:0.98,metalness:0.04})
  );
  stickBoot.position.set(0,0.06,0);
  cockpitStickGroup.add(stickBoot);

  const stick=new THREE.Mesh(
    new THREE.CylinderGeometry(0.075,0.10,0.72,12),
    stickMat
  );
  stick.position.set(0,0.42,0);
  cockpitStickGroup.add(stick);

  // Grip levemente alongado, preso ao mesmo pivô do manche.
  const grip=new THREE.Mesh(
    new THREE.SphereGeometry(0.13,14,10),
    gripMat
  );
  grip.scale.set(0.86,1.18,0.92);
  grip.position.set(0,0.82,-0.035);
  cockpitStickGroup.add(grip);

  // Pequeno botão vermelho no topo para dar leitura visual ao movimento.
  const stickBtn=new THREE.Mesh(
    new THREE.SphereGeometry(0.035,10,8),
    new THREE.MeshBasicMaterial({color:0xff493d})
  );
  stickBtn.position.set(0.055,0.92,-0.045);
  cockpitStickGroup.add(stickBtn);
}


// Anima o manche com o mesmo comando usado para pilotar a aeronave.
function updateCockpitStick(dt,steer,pitch){
  if(!cockpitStickGroup) return;

  // Suavização para filtrar pequenas oscilações do joystick analógico.
  const k=1-Math.pow(0.0008,dt);
  cockpitStickSteer=lerp(
    cockpitStickSteer,
    clamp(steer,-1,1),
    k
  );
  cockpitStickPitch=lerp(
    cockpitStickPitch,
    clamp(pitch,-1,1),
    k
  );

  // Esquerda/direita
  const targetZ=-cockpitStickSteer*0.23;

  // Movimento longitudinal do manche:
  // pitch positivo = comando de SUBIR = manche puxado para trás.
  const targetX=cockpitStickPitch*0.20;

  cockpitStickGroup.rotation.z=targetZ;
  cockpitStickGroup.rotation.x=targetX;
}

// Cockpit-only symbology: artificial horizon, tapes and weapon cues.
function drawCockpitHUD(c,W,H,cx,cy){
  const green='rgba(105,235,255,.92)';
  const greenDim='rgba(105,235,255,.34)';

  c.save();
  c.strokeStyle=green;
  c.fillStyle=green;
  c.lineWidth=1.3;
  c.font='600 13px Rajdhani,Consolas,monospace';

  const hw=Math.min(W*0.18,220);
  const hh=Math.min(H*0.20,145);

  // Flight path marker
  c.beginPath();
  c.arc(cx,cy+16,10,0,Math.PI*2);
  c.moveTo(cx-22,cy+16); c.lineTo(cx-10,cy+16);
  c.moveTo(cx+10,cy+16); c.lineTo(cx+22,cy+16);
  c.moveTo(cx,cy+6); c.lineTo(cx,cy-2);
  c.stroke();

  // Artificial horizon and compact pitch ladder
  c.save();
  c.translate(cx,cy);
  // Horizonte artificial preparado para pitch alem de +/-90 graus.
  // Quando o aviao fica invertido, o horizonte gira 180 graus em vez de sumir da tela.
  const hudPitch=Math.asin(clamp(Math.sin(player.pitch),-1,1));
  const hudInverted=Math.cos(player.pitch)<0;
  c.rotate(-player.roll*0.72+(hudInverted?Math.PI:0));
  const pitchPx=hudPitch*112;
  c.translate(0,pitchPx);

  for(let deg=-20;deg<=20;deg+=10){
    if(deg===0) continue;
    const y=-deg*4.9;
    const len=deg%20===0?54:36;
    c.strokeStyle=greenDim;
    c.beginPath();
    c.moveTo(-len,y); c.lineTo(-10,y);
    c.moveTo(10,y); c.lineTo(len,y);
    c.stroke();
    c.fillStyle=greenDim;
    c.fillText(String(Math.abs(deg)),-len-18,y+4);
    c.fillText(String(Math.abs(deg)),len+6,y+4);
  }

  c.strokeStyle=green;
  c.beginPath();
  c.moveTo(-74,0); c.lineTo(-14,0);
  c.moveTo(14,0); c.lineTo(74,0);
  c.stroke();
  c.restore();

  // Compact aiming brackets
  c.strokeStyle=greenDim;
  c.beginPath();
  c.moveTo(cx-90,cy); c.lineTo(cx-65,cy);
  c.moveTo(cx+65,cy); c.lineTo(cx+90,cy);
  c.moveTo(cx,cy-62); c.lineTo(cx,cy-42);
  c.stroke();

  // Speed / altitude compact tapes
  const speed=Math.round(player.speed*9.4);
  const alt=Math.max(0,Math.round(player.pos.y));

  c.textAlign='right';
  c.fillStyle=green;
  c.font='700 18px Rajdhani,Consolas,monospace';
  c.fillText(String(speed),cx-146,cy+5);
  c.font='600 10px Rajdhani,Consolas,monospace';
  c.fillText('SPD',cx-146,cy+20);

  c.strokeStyle=greenDim;
  c.beginPath();
  c.moveTo(cx-132,cy-58); c.lineTo(cx-132,cy+58);
  c.stroke();

  c.textAlign='left';
  c.font='700 18px Rajdhani,Consolas,monospace';
  c.fillStyle=green;
  c.fillText(String(alt),cx+146,cy+5);
  c.font='600 10px Rajdhani,Consolas,monospace';
  c.fillText('ALT',cx+146,cy+20);

  c.strokeStyle=greenDim;
  c.beginPath();
  c.moveTo(cx+132,cy-58); c.lineTo(cx+132,cy+58);
  c.stroke();

  // Weapon status simplified
  c.textAlign='left';
  c.font='700 12px Rajdhani,Consolas,monospace';
  c.fillStyle=green;
  c.fillText('GUN ARM',cx-hw+8,cy+hh-8);

  c.textAlign='right';
  c.fillText(missileCd>0?'MSL STBY':'MSL RDY',cx+hw-8,cy+hh-8);

  if(lockTarget){
    c.textAlign='center';
    c.fillStyle=lockTime>=1 ? 'rgba(255,96,60,.98)' : green;
    c.fillText(lockTime>=1?'LOCK':'ACQ',cx,cy-hh+8);
  }

  c.restore();
}



// Textura radial suave para o brilho do afterburner.
// Evita o plano quadrado de um THREE.Sprite sem textura alpha.
let afterburnerGlowTex=null;
function getAfterburnerGlowTexture(){
  if(afterburnerGlowTex) return afterburnerGlowTex;
  const cv=document.createElement('canvas');
  cv.width=128;cv.height=128;
  const x=cv.getContext('2d');
  const gr=x.createRadialGradient(64,64,0,64,64,64);
  gr.addColorStop(0.00,'rgba(255,255,255,1.00)');
  gr.addColorStop(0.12,'rgba(205,235,255,0.95)');
  gr.addColorStop(0.34,'rgba(105,185,255,0.62)');
  gr.addColorStop(0.62,'rgba(55,120,255,0.24)');
  gr.addColorStop(1.00,'rgba(0,0,0,0.00)');
  x.fillStyle=gr;
  x.fillRect(0,0,128,128);
  afterburnerGlowTex=new THREE.CanvasTexture(cv);
  afterburnerGlowTex.minFilter=THREE.LinearFilter;
  afterburnerGlowTex.magFilter=THREE.LinearFilter;
  afterburnerGlowTex.needsUpdate=true;
  return afterburnerGlowTex;
}

// ─── JET MODEL v2 ───────────────────────────
function makeJet(mainColor,accentColor,elite){
  const g=new THREE.Group();

  const bodyM=new THREE.MeshStandardMaterial({
    color:mainColor, roughness:0.42, metalness:0.58
  });
  const accM=new THREE.MeshStandardMaterial({
    color:accentColor, roughness:0.50, metalness:0.48
  });
  const darkM=new THREE.MeshStandardMaterial({
    color:0x171c20, roughness:0.58, metalness:0.42
  });
  const radomeM=new THREE.MeshStandardMaterial({
    color:0x2d3336, roughness:0.72, metalness:0.20
  });
  const glassM=new THREE.MeshPhysicalMaterial({
    color:0x768d94, roughness:0.055, metalness:0.18,
    transparent:true, opacity:0.43, clearcoat:1,
    clearcoatRoughness:0.045, reflectivity:0.95
  });
  const intakeM=new THREE.MeshStandardMaterial({
    color:0x111518, roughness:0.68, metalness:0.34
  });

  // Fuselagem longa e estreita, inspirada nas proporções de um caça leve monomotor.
  // V4.7: fuselagem orientada no mesmo sentido do restante do caça.
  // A seção frontal começa exatamente onde termina a base do radome,
  // eliminando o espaço visual que fazia o bico parecer desconectado.
  const prof=[
    new THREE.Vector2(0.42,-6.05),
    new THREE.Vector2(0.48,-5.25),
    new THREE.Vector2(0.62,-3.85),
    new THREE.Vector2(0.82,-2.10),
    new THREE.Vector2(0.94,-0.30),
    new THREE.Vector2(0.92,1.30),
    new THREE.Vector2(0.78,2.85),
    new THREE.Vector2(0.61,4.05),
    new THREE.Vector2(0.51,4.72)
  ];
  const fusGeo=new THREE.LatheGeometry(prof,24);
  fusGeo.rotateX(Math.PI/2);
  const fus=new THREE.Mesh(fusGeo,bodyM);
  fus.castShadow=true;
  g.add(fus);

  // Radome frontal: base alinhada à primeira seção da fuselagem.
  // Cone: altura 1.55; com centro em -6.825, a base fica em z=-6.05.
  const radome=new THREE.Mesh(new THREE.ConeGeometry(0.42,1.55,20),radomeM);
  radome.rotation.x=-Math.PI/2;
  radome.position.z=-6.825;
  radome.castShadow=true;
  g.add(radome);

  // Canopy em bolha para um único piloto.
  const canopy=new THREE.Mesh(new THREE.SphereGeometry(0.86,22,14),glassM);
  canopy.scale.set(0.74,0.62,2.05);
  canopy.position.set(0,0.87,-2.55);
  canopy.castShadow=true;
  g.add(canopy);

  const canopyBase=new THREE.Mesh(new THREE.BoxGeometry(1.32,0.12,2.65),darkM);
  canopyBase.position.set(0,0.47,-2.42);
  canopyBase.rotation.x=-0.035;
  g.add(canopyBase);

  const bow=new THREE.Mesh(new THREE.TorusGeometry(0.59,0.045,8,24,Math.PI),darkM);
  bow.rotation.x=Math.PI/2;
  bow.rotation.z=Math.PI;
  bow.scale.set(1.0,1.42,1);
  bow.position.set(0,0.58,-1.63);
  g.add(bow);

  // Entrada de ar ventral.
  const intakeOuter=new THREE.Mesh(new THREE.BoxGeometry(1.46,0.66,2.18),accM);
  intakeOuter.position.set(0,-0.72,-1.15);
  intakeOuter.rotation.x=-0.075;
  g.add(intakeOuter);

  const intakeInner=new THREE.Mesh(new THREE.BoxGeometry(1.05,0.42,1.72),intakeM);
  intakeInner.position.set(0,-0.80,-1.42);
  intakeInner.rotation.x=-0.075;
  g.add(intakeInner);

  const intakeLip=new THREE.Mesh(new THREE.BoxGeometry(1.55,0.12,0.16),radomeM);
  intakeLip.position.set(0,-0.67,-2.23);
  g.add(intakeLip);

  // Spine dorsal.
  const spine=new THREE.Mesh(new THREE.BoxGeometry(0.55,0.32,3.55),accM);
  spine.position.set(0,0.63,0.22);
  spine.rotation.x=0.02;
  g.add(spine);

  // Asa trapezoidal fina.
  const wingShape=new THREE.Shape();
  wingShape.moveTo(0,-1.55);
  wingShape.lineTo(5.35,-0.05);
  wingShape.lineTo(5.15,1.45);
  wingShape.lineTo(1.15,2.50);
  wingShape.lineTo(0,2.20);
  wingShape.closePath();

  const wingGeo=new THREE.ExtrudeGeometry(wingShape,{
    depth:0.14, bevelEnabled:true, bevelThickness:0.035,
    bevelSize:0.035, bevelSegments:1
  });

  const wingL=new THREE.Mesh(wingGeo,bodyM);
  wingL.rotation.x=Math.PI/2;
  wingL.position.set(0.30,0.02,-0.05);
  wingL.castShadow=true;
  g.add(wingL);

  const wingR=wingL.clone();
  wingR.scale.x=-1;
  wingR.position.x=-0.30;
  g.add(wingR);

  // LERX / extensões de raiz da asa.
  const lerxShape=new THREE.Shape();
  lerxShape.moveTo(0,-2.85);
  lerxShape.lineTo(1.70,-1.15);
  lerxShape.lineTo(1.28,0.30);
  lerxShape.lineTo(0,0.70);
  lerxShape.closePath();

  const lerxGeo=new THREE.ExtrudeGeometry(lerxShape,{depth:0.10,bevelEnabled:false});
  const lerxL=new THREE.Mesh(lerxGeo,accM);
  lerxL.rotation.x=Math.PI/2;
  lerxL.position.set(0.18,0.16,0);
  g.add(lerxL);

  const lerxR=lerxL.clone();
  lerxR.scale.x=-1;
  lerxR.position.x=-0.18;
  g.add(lerxR);

  // Deriva vertical única.
  const finShape=new THREE.Shape();
  finShape.moveTo(0,0);
  finShape.lineTo(0.58,3.15);
  finShape.lineTo(1.28,3.60);
  finShape.lineTo(2.05,0.12);
  finShape.closePath();

  const finGeo=new THREE.ExtrudeGeometry(finShape,{
    depth:0.16, bevelEnabled:true, bevelThickness:0.025,
    bevelSize:0.025, bevelSegments:1
  });

  const fin=new THREE.Mesh(finGeo,accM);
  fin.rotation.y=Math.PI/2;
  fin.position.set(-0.08,0.46,2.58);
  fin.castShadow=true;
  g.add(fin);

  // Estabilizadores horizontais independentes.
  const stabShape=new THREE.Shape();
  stabShape.moveTo(0,-0.72);
  stabShape.lineTo(2.72,-0.20);
  stabShape.lineTo(2.55,0.72);
  stabShape.lineTo(0.35,1.18);
  stabShape.closePath();

  const stabGeo=new THREE.ExtrudeGeometry(stabShape,{depth:0.10,bevelEnabled:false});
  const stabL=new THREE.Mesh(stabGeo,accM);
  stabL.rotation.x=Math.PI/2;
  stabL.position.set(0.28,0.06,3.25);
  g.add(stabL);

  const stabR=stabL.clone();
  stabR.scale.x=-1;
  stabR.position.x=-0.28;
  g.add(stabR);

  // Pequenas ventral fins traseiras.
  for(const side of[-1,1]){
    const vf=new THREE.Mesh(new THREE.BoxGeometry(0.10,0.72,1.15),darkM);
    vf.position.set(side*0.48,-0.50,3.38);
    vf.rotation.z=side*0.22;
    g.add(vf);
  }

  // Tanque central externo — construído só com geometrias compatíveis com Three.js r128.
  const tankGroup=new THREE.Group();

  const tankBody=new THREE.Mesh(
    new THREE.CylinderGeometry(0.30,0.30,2.35,16,1,false),
    accM
  );
  tankBody.rotation.x=Math.PI/2;
  tankGroup.add(tankBody);

  const tankNose=new THREE.Mesh(
    new THREE.SphereGeometry(0.30,16,10),
    accM
  );
  tankNose.scale.z=1.55;
  tankNose.position.z=-1.18;
  tankGroup.add(tankNose);

  const tankRear=new THREE.Mesh(
    new THREE.SphereGeometry(0.30,16,10),
    accM
  );
  tankRear.scale.z=1.25;
  tankRear.position.z=1.18;
  tankGroup.add(tankRear);

  tankGroup.position.set(0,-0.64,1.20);
  g.add(tankGroup);

  const tankPylon=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.34,1.1),darkM);
  tankPylon.position.set(0,-0.34,0.85);
  g.add(tankPylon);

  // Mísseis mais detalhados.
  const missileM=new THREE.MeshStandardMaterial({
    color:0xd7d8d5,roughness:0.38,metalness:0.42
  });

  function addMissile(x,y,z,scale){
    const mg=new THREE.Group();

    const body=new THREE.Mesh(
      new THREE.CylinderGeometry(0.095*scale,0.095*scale,2.15*scale,10),
      missileM
    );
    body.rotation.x=Math.PI/2;
    mg.add(body);

    const nose=new THREE.Mesh(
      new THREE.ConeGeometry(0.095*scale,0.42*scale,10),
      radomeM
    );
    nose.rotation.x=-Math.PI/2;
    nose.position.z=-1.28*scale;
    mg.add(nose);

    for(const sx of[-1,1]){
      const finlet=new THREE.Mesh(
        new THREE.BoxGeometry(0.38*scale,0.028*scale,0.38*scale),
        darkM
      );
      finlet.position.set(sx*0.20*scale,0,0.63*scale);
      mg.add(finlet);
    }

    mg.position.set(x,y,z);
    g.add(mg);
    return mg;
  }

  // Wingtip + dois pilones sob as asas.
  addMissile(-5.23,-0.02,0.72,1.0);
  addMissile( 5.23,-0.02,0.72,1.0);

  for(const side of[-1,1]){
    const pylon=new THREE.Mesh(
      new THREE.BoxGeometry(0.16,0.34,1.35),
      darkM
    );
    pylon.position.set(side*3.15,-0.28,0.90);
    g.add(pylon);
    addMissile(side*3.15,-0.56,0.90,0.93);
  }

  // Luzes de navegação.
  const navRed=new THREE.MeshBasicMaterial({color:0xff2d24});
  const navGreen=new THREE.MeshBasicMaterial({color:0x40ff75});

  const leftNav=new THREE.Mesh(new THREE.SphereGeometry(0.085,10,8),navRed);
  leftNav.position.set(-5.30,0.08,0.82);
  g.add(leftNav);

  const rightNav=new THREE.Mesh(new THREE.SphereGeometry(0.085,10,8),navGreen);
  rightNav.position.set(5.30,0.08,0.82);
  g.add(rightNav);

  // Canhão visual na raiz esquerda.
  const cannon=new THREE.Mesh(
    new THREE.CylinderGeometry(0.065,0.065,1.05,10),
    darkM
  );
  cannon.rotation.x=Math.PI/2;
  cannon.position.set(-0.78,0.02,-4.72);
  g.add(cannon);

  // Bocal único do motor.
  const nozzleOuter=new THREE.Mesh(
    new THREE.CylinderGeometry(0.57,0.66,0.78,20,1,false),
    darkM
  );
  nozzleOuter.rotation.x=Math.PI/2;
  nozzleOuter.position.z=4.94;
  g.add(nozzleOuter);

  const nozzleInner=new THREE.Mesh(
    new THREE.CylinderGeometry(0.37,0.45,0.42,18,1,true),
    intakeM
  );
  nozzleInner.rotation.x=Math.PI/2;
  nozzleInner.position.z=5.20;
  g.add(nozzleInner);

  // Afterburner com núcleo branco e envelope azul.
  const flameM=new THREE.MeshBasicMaterial({
    color:elite?0xff5a26:0x58b8ff,
    transparent:true,opacity:0.82,
    blending:THREE.AdditiveBlending,depthWrite:false
  });

  const flame=new THREE.Mesh(new THREE.ConeGeometry(0.39,2.65,14),flameM);
  flame.rotation.x=-Math.PI/2;
  flame.position.z=6.55;
  g.add(flame);

  const coreM=new THREE.MeshBasicMaterial({
    color:0xe8f8ff,transparent:true,opacity:0.78,
    blending:THREE.AdditiveBlending,depthWrite:false
  });

  const core=new THREE.Mesh(new THREE.ConeGeometry(0.17,1.55,12),coreM);
  core.rotation.x=-Math.PI/2;
  core.position.z=6.02;
  g.add(core);

  const flameGlow=new THREE.Sprite(new THREE.SpriteMaterial({
    map:getAfterburnerGlowTexture(),
    color:elite?0xff8a52:0x8acbff,
    transparent:true,
    opacity:0.58,
    blending:THREE.AdditiveBlending,
    depthWrite:false,
    depthTest:true
  }));
  flameGlow.scale.set(1.58,1.58,1);
  flameGlow.position.z=5.62;
  g.add(flameGlow);

  // Pequena antena dorsal.
  const antenna=new THREE.Mesh(
    new THREE.BoxGeometry(0.08,0.42,0.10),
    darkM
  );
  antenna.position.set(0,0.88,2.18);
  antenna.rotation.z=0.08;
  g.add(antenna);

  g.rotation.order='YXZ';
  g.userData.flame=flame;
  g.userData.flameCore=core;
  g.userData.mats=[bodyM,accM];

  jetMatsAll.push(bodyM,accM);

  if(envTex){
    bodyM.envMap=envTex;
    accM.envMap=envTex;
    bodyM.envMapIntensity=0.92;
    accM.envMapIntensity=0.82;
  }

  return g;
}

function buildPlayer(){
  const g=makeJet(0x536f88,0x223d55,false);
  scene.add(g);
  player={
    group:g,
    pos:new THREE.Vector3(0,90,0),
    yaw:0,pitch:0,roll:0,
    speed:75,health:100,fireCd:0,
    trailT:0
  };
  g.position.copy(player.pos);
}

function resetPlayer(){
  player.pos.set(0,90,0);
  player.yaw=0;player.pitch=0;player.roll=0;
  player.speed=75;player.health=100;player.fireCd=0;
  player.group.position.copy(player.pos);
  player.group.visible=(camMode!==2);
  cockpitStickSteer=0; cockpitStickPitch=0;
  if(cockpitStickGroup) cockpitStickGroup.rotation.set(0,0,0);
  lockTarget=null;lockTime=0;missileCd=0;regenT=0;
}

// ─── INPUT ──────────────────────────────────
function getGP(){
  const gps=navigator.getGamepads?navigator.getGamepads():[];
  return (ctrl.gpIdx!==null&&gps[ctrl.gpIdx])?gps[ctrl.gpIdx]:null;
}
function procAxis(raw,inv,center,mn,mx){
  // Normaliza primeiro usando os limites numéricos reais.
  // A inversão é aplicada somente no final.
  const lo=Math.min(mn,mx);
  const hi=Math.max(mn,mx);
  let v=raw-center;

  if(v>0) v/=((hi-center)||1);
  else if(v<0) v/=((center-lo)||1);

  if(Math.abs(v)<ctrl.dz) return 0;

  const sg=Math.sign(v);
  v=(Math.abs(v)-ctrl.dz)/(1-ctrl.dz);
  v=Math.pow(Math.max(0,v),ctrl.lin)*ctrl.sens;
  v=clamp(sg*v,-1,1);

  return inv?-v:v;
}
function getInput(){
  let steer=0,pitch=0,fire=false;
  if(keys.KeyA||keys.ArrowLeft) steer-=1;
  if(keys.KeyD||keys.ArrowRight) steer+=1;
  // Teclado imitando o movimento físico de um manche:
  // S / seta para baixo = PUXAR para trás = nariz sobe.
  // W / seta para cima   = EMPURRAR para frente = nariz desce.
  if(keys.KeyS||keys.ArrowDown) pitch+=1;
  if(keys.KeyW||keys.ArrowUp) pitch-=1;
  if(keys.Space) fire=true;
  const gp=getGP();
  if(gp){
    const px=procAxis(gp.axes[ctrl.steerAxis]||0,ctrl.invX,ctrl.cX,ctrl.mnX,ctrl.mxX);

    // Eixo vertical:
    // 1) normaliza sem inverter;
    // 2) aplica o sentido detectado na calibração;
    // 3) mantém "Inverter Y" apenas como ajuste manual opcional.
    let py=procAxis(gp.axes[ctrl.pitchAxis]||0,false,ctrl.cY,ctrl.mnY,ctrl.mxY);
    py*=ctrl.pitchPullSign||1;
    if(ctrl.invY) py=-py;

    if(Math.abs(px)>0.01) steer=px;
    if(Math.abs(py)>0.01) pitch=py;
    const b=gp.buttons[ctrl.fireBtn];
    if(b&&b.pressed) fire=true;
  }
  return{steer:clamp(steer,-1,1),pitch:clamp(pitch,-1,1),fire};
}

// ─── FLIGHT ─────────────────────────────────
function fwdVec(yaw,pitch){
  const cp=Math.cos(pitch);
  return new THREE.Vector3(-Math.sin(yaw)*cp,Math.sin(pitch),-Math.cos(yaw)*cp);
}

function updatePlayer(dt){
  const inp=getInput();

  // O manche do cockpit reproduz exatamente o comando aplicado pelo piloto.
  updateCockpitStick(dt,inp.steer,inp.pitch);

  const targetRoll=-inp.steer*0.95;
  player.roll+=(targetRoll-player.roll)*Math.min(1,dt*6);
  player.yaw+=player.roll*1.35*dt;

  // V4.8: pitch aerobatico sem limite de +/-60 graus.
  // Mantendo o manche puxado, o aviao percorre 0 -> 90 -> 180 -> 270 -> 360 graus.
  // O angulo e normalizado apenas para evitar crescimento numerico indefinido.
  player.pitch=wrapPi(player.pitch+inp.pitch*1.25*dt);

  // V4.9 SIMCADE LEVE:
  // O controle continua totalmente responsivo. Apenas a velocidade ganha
  // inércia: subir perde energia, mergulhar recupera e curvas fortes custam
  // um pouco de velocidade. Não há estol brusco nem perda de controle.
  const f=fwdVec(player.yaw,player.pitch);
  const climb=Math.max(0,f.y);
  const dive=Math.max(0,-f.y);
  const turnDrag=Math.abs(player.roll)*4.0;
  const targetSpeed=clamp(82-climb*25+dive*31-turnDrag,55,118);
  player.speed+=(targetSpeed-player.speed)*Math.min(1,dt*1.65);

  player.pos.addScaledVector(f,player.speed*dt);

  // Terrain contact → damage + bounce
  const gh=terrH(player.pos.x,player.pos.z)+4.5;
  if(player.pos.y<gh){
    player.pos.y=gh;
    // Usa a direcao vertical real, e nao o valor bruto de pitch,
    // para continuar correto durante loops e voo invertido.
    if(f.y<0.05){ player.pitch=0.25; damagePlayer(20); camShake=0.9; }
  }
  // Teto mais alto para dar espaco a manobras aerobaticas.
  // Ao tocar o teto, a atitude nao e forcosamente alterada: o loop pode continuar.
  if(player.pos.y>650){ player.pos.y=650; }

  player.pos.x=clamp(player.pos.x,-COMBAT_LIMIT,COMBAT_LIMIT);
  player.pos.z=clamp(player.pos.z,-COMBAT_LIMIT,COMBAT_LIMIT);

  player.group.position.copy(player.pos);
  player.group.rotation.y=player.yaw;
  player.group.rotation.x=player.pitch;
  player.group.rotation.z=player.roll;

  // Afterburner flicker
  const fl=player.group.userData.flame;
  if(fl){ const sc=0.9+Math.random()*0.35+(player.speed-50)/122; fl.scale.set(1,sc,1); const fc=player.group.userData.flameCore; if(fc)fc.scale.set(1,0.92+Math.random()*0.22,1); }

  // Wingtip vortices when banking hard
  player.trailT-=dt;
  if(Math.abs(player.roll)>0.55&&player.trailT<=0){
    player.trailT=0.03;
    const right=new THREE.Vector3(-Math.cos(player.yaw),0,Math.sin(player.yaw));
    for(const s of[-1,1]){
      const p=player.pos.clone().addScaledVector(right,s*5.6).addScaledVector(f,0.5);
      p.y+=Math.sin(player.roll)*-s*1.2;
      spawnTrail(p);
    }
  }

  // Health regen (after 5s without damage)
  regenT+=dt;
  if(regenT>5&&player.health<100) player.health=Math.min(100,player.health+3*dt);

  // Gun
  player.fireCd-=dt;
  if(inp.fire&&player.fireCd<=0){
    player.fireCd=0.085;
    fireGun();
  }

  // Missile lock + fire
  updateLock(dt);
  missileCd-=dt;
  if(keys.KeyX&&lockTarget&&lockTime>=1&&missileCd<=0){
    missileCd=2.6;
    fireMissile(lockTarget);
  }
}

// ─── TARGETING / AIM ASSIST ─────────────────
function acquireTarget(maxAngle,maxDist){
  const f=fwdVec(player.yaw,player.pitch);
  let best=null,bestA=maxAngle;
  for(const en of enemies){
    const d=en.pos.clone().sub(player.pos);
    const dist=d.length();
    if(dist>maxDist) continue;
    const a=Math.acos(clamp(f.dot(d.normalize()),-1,1));
    if(a<bestA){ bestA=a; best=en; }
  }
  return best;
}

function interceptPoint(shooterPos,projSpeed,target){
  // simple iterative lead prediction
  const tv=fwdVec(target.yaw,target.pitch).multiplyScalar(target.speed);
  let t=shooterPos.distanceTo(target.pos)/projSpeed;
  for(let i=0;i<3;i++){
    const fut=target.pos.clone().addScaledVector(tv,t);
    t=shooterPos.distanceTo(fut)/projSpeed;
  }
  return target.pos.clone().addScaledVector(tv,t);
}

function updateLock(dt){
  const t=acquireTarget(0.30,1100);
  if(t&&t===lockTarget){ lockTime=Math.min(1,lockTime+dt/1.1); }
  else{ lockTarget=t; lockTime=0; }
}

function fireGun(){
  const f=fwdVec(player.yaw,player.pitch);
  const BSPD=650;
  let dir=f.clone();

  const t=acquireTarget(0.24,950);
  if(t){
    const ip=interceptPoint(player.pos,BSPD,t);
    const toT=ip.sub(player.pos).normalize();
    dir.lerp(toT,0.88).normalize();
  }

  const right=new THREE.Vector3(-Math.cos(player.yaw),0,Math.sin(player.yaw));
  const start=player.pos.clone()
    .addScaledVector(f,6.65)
    .addScaledVector(right,-0.78);

  start.y-=0.02;

  const shotDir=dir.clone();
  shotDir.x+=(Math.random()-0.5)*0.0022;
  shotDir.y+=(Math.random()-0.5)*0.0022;
  shotDir.z+=(Math.random()-0.5)*0.0022;
  shotDir.normalize();

  spawnBullet(start,shotDir,BSPD+player.speed,'p');

  if(typeof spawnMuzzleBurst==='function'){
    spawnMuzzleBurst(start,shotDir,0xffe5a3,1.05);
  }

  muzzleLight.position.copy(start).addScaledVector(shotDir,0.8);
  muzzleLight.intensity=5.2;
  camShake=Math.max(camShake,0.075);
  sfx('shot');
}

// ─── BULLETS / MISSILES ─────────────────────
let bulletCoreGeo=null,bulletGlowGeo=null,bulletMatP=null,bulletMatE=null,bulletGlowMatP=null,bulletGlowMatE=null;

function spawnBullet(pos,dir,spd,from){
  if(!bulletCoreGeo){
    bulletCoreGeo=new THREE.CylinderGeometry(0.05,0.05,3.6,8,1,false);
    bulletCoreGeo.rotateX(Math.PI/2);
    bulletGlowGeo=new THREE.CylinderGeometry(0.12,0.12,6.4,8,1,true);
    bulletGlowGeo.rotateX(Math.PI/2);
    bulletMatP=new THREE.MeshBasicMaterial({color:0xfff3cc,blending:THREE.AdditiveBlending,transparent:true,opacity:1.0,depthWrite:false});
    bulletMatE=new THREE.MeshBasicMaterial({color:0xffc3b2,blending:THREE.AdditiveBlending,transparent:true,opacity:1.0,depthWrite:false});
    bulletGlowMatP=new THREE.MeshBasicMaterial({color:0x62d7ff,blending:THREE.AdditiveBlending,transparent:true,opacity:0.58,depthWrite:false});
    bulletGlowMatE=new THREE.MeshBasicMaterial({color:0xff6a44,blending:THREE.AdditiveBlending,transparent:true,opacity:0.50,depthWrite:false});
  }
  const g=new THREE.Group();
  const glow=new THREE.Mesh(bulletGlowGeo,from==='p'?bulletGlowMatP:bulletGlowMatE);
  const core=new THREE.Mesh(bulletCoreGeo,from==='p'?bulletMatP:bulletMatE);
  g.add(glow); g.add(core);
  g.position.copy(pos);
  g.lookAt(pos.clone().add(dir));
  scene.add(g);
  bullets.push({g,vel:dir.clone().multiplyScalar(spd),life:1.8,from,trailT:0,prev:pos.clone()});
}

function updateBullets(dt){
  for(let i=bullets.length-1;i>=0;i--){
    const b=bullets[i];
    b.life-=dt;
    b.prev.copy(b.g.position);
    b.g.position.addScaledVector(b.vel,dt);
    b.g.lookAt(b.g.position.clone().add(b.vel));
    b.trailT-=dt;
    if(b.trailT<=0){
      b.trailT=b.from==='p'?0.012:0.018;
      spawnTracer(b.g.position.clone(),b.from==='p'?0x8be8ff:0xff8a66,b.from==='p'?0.78:0.62);
    }
    let dead=b.life<=0;

    if(!dead&&b.g.position.y<terrH(b.g.position.x,b.g.position.z)+0.5){
      spawnImpact(b.g.position,0.6,b.from==='p'?0xffde8f:0xff8c5a);
      dead=true;
    }
    if(!dead&&b.from==='p'){
      for(let e=enemies.length-1;e>=0;e--){
        const en=enemies[e];
        if(b.g.position.distanceToSquared(en.pos)<64){ // r=8 generous
          en.hp--;
          flashEnemy(en);
          spawnImpact(b.g.position,0.95,0xffffff);
          hitT=0.14;
          sfx('hit');
          if(en.hp<=0) destroyEnemy(e);
          dead=true;break;
        }
      }
    }else if(!dead&&b.from==='e'&&gameState==='play'){
      if(b.g.position.distanceToSquared(player.pos)<22){
        damagePlayer(6);
        spawnImpact(b.g.position,0.72,0xff8c5a);
        dead=true;
      }
    }
    if(dead){ scene.remove(b.g); bullets.splice(i,1); }
  }
}

function fireMissile(target){
  const f=fwdVec(player.yaw,player.pitch);
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.14,2.2,8),
    new THREE.MeshStandardMaterial({color:0xe8e8e8,roughness:0.35,metalness:0.5}));
  body.rotation.x=Math.PI/2; g.add(body);
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:makeRadialFxTex(),color:0xffaa44,transparent:true,opacity:0.82,blending:THREE.AdditiveBlending,depthWrite:false}));
  glow.scale.set(1.6,1.6,1); glow.position.z=1.4; g.add(glow);
  g.position.copy(player.pos).addScaledVector(f,4);
  g.position.y-=1;
  scene.add(g);
  missiles.push({g,vel:f.clone().multiplyScalar(player.speed+90),target,life:6,trailT:0});
  sfx('msl');
}

function updateMissiles(dt){
  for(let i=missiles.length-1;i>=0;i--){
    const ms=missiles[i];
    ms.life-=dt;
    let dead=ms.life<=0;

    // steer toward target
    if(ms.target&&enemies.includes(ms.target)){
      const ip=interceptPoint(ms.g.position,ms.vel.length(),ms.target);
      const want=ip.sub(ms.g.position).normalize().multiplyScalar(ms.vel.length()+80*dt);
      ms.vel.lerp(want,Math.min(1,dt*3.2));
    }
    ms.vel.multiplyScalar(1+dt*0.35); // accelerate
    if(ms.vel.length()>340) ms.vel.setLength(340);

    ms.g.position.addScaledVector(ms.vel,dt);
    ms.g.lookAt(ms.g.position.clone().add(ms.vel));

    // smoke trail
    ms.trailT-=dt;
    if(ms.trailT<=0){ ms.trailT=0.018; spawnSmoke(ms.g.position.clone(),0xd8d8d8,0.85,1.8); }

    // proximity fuse
    if(ms.target&&enemies.includes(ms.target)){
      if(ms.g.position.distanceToSquared(ms.target.pos)<120){
        const idx=enemies.indexOf(ms.target);
        spawnExplosion(ms.target.pos,2.4);
        if(idx>=0) destroyEnemy(idx);
        dead=true;
      }
    }
    if(!dead&&ms.g.position.y<terrH(ms.g.position.x,ms.g.position.z)+1){
      spawnExplosion(ms.g.position,1.6);
      dead=true;
    }
    if(dead){ scene.remove(ms.g); missiles.splice(i,1); }
  }
}

// ─── ENEMIES v2 ─────────────────────────────
function getWaveConfig(n){
  if(n<=MISSION_WAVES) return {...WAVE_CONFIGS[n]};

  // Modo sobrevivência: progressão lenta e limitada.
  const k=n-(MISSION_WAVES+1);
  return {
    total:Math.min(12,8+Math.floor(k/2)),
    maxActive:Math.min(6,5+Math.floor(k/4)),
    elites:Math.min(3,2+Math.floor(k/5)),
    skill:Math.min(1.0,0.78+k*0.035),
    label:'SOBREVIVÊNCIA'
  };
}

function buildWaveSpawnPlan(total,eliteCount){
  const plan=new Array(total).fill(false);
  if(eliteCount<=0) return plan;

  // Espalha os Elite pela onda para evitar dois Elite entrando
  // necessariamente juntos logo no começo.
  for(let e=0;e<eliteCount;e++){
    let idx=Math.round(((e+1)/(eliteCount+1))*(total-1));
    while(plan[idx]&&idx<total-1)idx++;
    while(plan[idx]&&idx>0)idx--;
    plan[idx]=true;
  }
  return plan;
}

function spawnEnemyForCurrentWave(){
  if(waveRemainingToSpawn<=0) return false;

  const elite=!!waveSpawnPlan[waveSpawnIndex];
  const skill=waveSkill;

  const g=elite?makeJet(0x30343c,0x8a1f1f,true):makeJet(0x9a3030,0x611c1c,false);
  g.scale.setScalar(1.15);
  scene.add(g);

  const ang=Math.random()*Math.PI*2;
  const dist=390+Math.random()*300;
  const pos=new THREE.Vector3(
    player.pos.x+Math.cos(ang)*dist,
    72+Math.random()*105,
    player.pos.z+Math.sin(ang)*dist
  );

  // O aumento por onda é moderado: melhora a competência,
  // não transforma o inimigo em "míssil".
  const cruiseSpeed=(elite?84:76)+skill*5+Math.random()*6;

  enemies.push({
    group:g,pos,
    yaw:Math.random()*Math.PI*2,pitch:0,roll:0,
    speed:cruiseSpeed,
    cruiseSpeed,
    minCombatSpeed:elite?56:59,
    maxSpeed:(elite?112:105)+skill*3,
    hp:elite?4:2,maxHp:elite?4:2,
    fireCd:0.95+Math.random()*1.05,

    mode:'intercept',modeT:2.7+Math.random()*1.7,
    attackShots:0,
    breakDir:Math.random()<0.5?-1:1,
    breakYaw:0,
    recoverYaw:0,

    // Competência específica desta onda.
    skill,
    trailT:0,elite,
    evadeDir:1
  });

  g.position.copy(pos);

  waveSpawnIndex++;
  waveRemainingToSpawn--;
  return true;
}

function spawnWave(n){
  waveCfg=getWaveConfig(n);
  waveSkill=waveCfg.skill;
  waveMaxActive=waveCfg.maxActive;
  waveSpawnPlan=buildWaveSpawnPlan(waveCfg.total,waveCfg.elites);
  waveSpawnIndex=0;
  waveRemainingToSpawn=waveCfg.total;
  reinforcementTimer=0;
  reinforcementAnnounced=false;

  // Entra somente o máximo simultâneo previsto.
  const initial=Math.min(waveMaxActive,waveRemainingToSpawn);
  for(let i=0;i<initial;i++) spawnEnemyForCurrentWave();

  let msg='ONDA '+n+' — '+waveCfg.label;
  if(waveCfg.elites>0) msg+=' · '+waveCfg.elites+' ELITE'+(waveCfg.elites>1?'S':'');
  showMsg(msg);
}

function updateWaveReinforcements(dt){
  if(gameState!=='play'||waveRemainingToSpawn<=0) return;

  reinforcementTimer-=dt;
  if(enemies.length>=waveMaxActive||reinforcementTimer>0) return;

  // Um reforço por vez para não aparecerem vários caças de uma só vez.
  if(spawnEnemyForCurrentWave()){
    reinforcementTimer=0.75;
    if(!reinforcementAnnounced){
      reinforcementAnnounced=true;
      showMsg('REFORÇO INIMIGO');
    }
  }
}


function clearCombatProjectiles(){
  for(const b of bullets)scene.remove(b.g);
  bullets=[];
  for(const ms of missiles)scene.remove(ms.g);
  missiles=[];
  lockTarget=null;
  lockTime=0;
}

function autopilotToward(target,targetSpeed,dt,turnRate,pitchRate){
  const to=target.clone().sub(player.pos);
  const dist=Math.max(0.001,to.length());

  const desYaw=Math.atan2(-to.x,-to.z);
  const horiz=Math.max(0.001,Math.hypot(to.x,to.z));
  const desPitch=Math.atan2(to.y,horiz);

  const dy=wrapPi(desYaw-player.yaw);
  const dp=wrapPi(desPitch-player.pitch);

  player.yaw+=clamp(dy,-turnRate*dt,turnRate*dt);
  player.pitch+=clamp(dp,-pitchRate*dt,pitchRate*dt);

  const targetRoll=clamp(-dy*0.82,-0.72,0.72);
  player.roll+=(targetRoll-player.roll)*Math.min(1,dt*3.8);
  player.speed+=(targetSpeed-player.speed)*Math.min(1,dt*1.35);

  const f=fwdVec(player.yaw,player.pitch);
  player.pos.addScaledVector(f,player.speed*dt);

  player.group.position.copy(player.pos);
  player.group.rotation.y=player.yaw;
  player.group.rotation.x=player.pitch;
  player.group.rotation.z=player.roll;

  const fl=player.group.userData.flame;
  if(fl){
    const sc=0.80+Math.random()*0.22+(player.speed/180)*0.35;
    fl.scale.set(1,sc,1);
  }

  return dist;
}

function beginReturnToCarrier(){
  missionWon=true;
  gameState='returning';
  waitingWave=false;
  returnPhase='rendezvous';
  returnTimer=0;
  returnLanded=false;
  returnCaptionShown=false;
  camMode=0;

  clearCombatProjectiles();
  hideCarrierPeople();

  if(cockpitGroup)cockpitGroup.visible=false;
  player.group.visible=true;

  showMsg('MISSÃO CUMPRIDA — RETORNANDO AO PORTA-AVIÕES');
}

function completeCarrierLanding(){
  returnLanded=true;
  finalMissionTime=missionTime;
  returnPhase='celebration';
  returnTimer=0;

  player.speed=0;
  player.pitch=0;
  player.roll=0;
  player.yaw=0;
  player.pos.set(CARRIER_LANDING_X,CARRIER_PLANE_Y,CARRIER_Z-48);
  player.group.position.copy(player.pos);
  player.group.rotation.set(0,0,0);

  $('hud').classList.add('hidden');
  setCinematicCaption(
    'POUSO CONFIRMADO',
    'Equipe de convés: Bem-vindo de volta!'
  );
}

function updateReturnSequence(dt){
  returnTimer+=dt;

  if(returnPhase==='rendezvous'){
    const target=carrierWorldPoint(-7,155,820);
    const dist=autopilotToward(target,165,dt,1.15,0.68);
    if(dist<115){
      returnPhase='approach';
      returnTimer=0;
      showMsg('ALINHANDO PARA POUSO');
    }
  }

  else if(returnPhase==='approach'){
    const target=carrierWorldPoint(-7,82,330);
    const dist=autopilotToward(target,112,dt,0.95,0.58);
    if(dist<75){
      returnPhase='final';
      returnTimer=0;
      for(const c of carrierCrew)c.visible=true;
      showMsg('APROXIMAÇÃO FINAL');
    }
  }

  else if(returnPhase==='final'){
    const target=carrierWorldPoint(-7,28,175);
    const dist=autopilotToward(target,78,dt,0.75,0.46);
    animateCarrierCrew(returnTimer*0.35);
    if(dist<42){
      returnPhase='touchdown';
      returnTimer=0;
    }
  }

  else if(returnPhase==='touchdown'){
    const target=carrierWorldPoint(-7,CARRIER_PLANE_Y,82);
    const dist=autopilotToward(target,58,dt,0.46,0.34);
    animateCarrierCrew(returnTimer*0.5);

    if(dist<13 || returnTimer>7){
      // Garante contato correto com o convés.
      player.pos.x=CARRIER_LANDING_X;
      player.pos.y=CARRIER_PLANE_Y;
      player.pos.z=CARRIER_Z+82;
      player.yaw=0;
      player.pitch=0;
      player.roll=0;
      player.speed=54;
      returnPhase='rollout';
      returnTimer=0;
      showMsg('TOQUE NO CONVÉS');
    }
  }

  else if(returnPhase==='rollout'){
    animateCarrierCrew(returnTimer);

    player.pitch=lerp(player.pitch,0,Math.min(1,dt*6));
    player.roll=lerp(player.roll,0,Math.min(1,dt*6));
    player.yaw=lerp(player.yaw,0,Math.min(1,dt*6));
    player.pos.x=lerp(player.pos.x,CARRIER_LANDING_X,Math.min(1,dt*5));
    player.pos.y=CARRIER_PLANE_Y;

    player.speed=Math.max(0,player.speed-dt*18);
    player.pos.z-=Math.max(10,player.speed)*dt;

    player.group.position.copy(player.pos);
    player.group.rotation.y=player.yaw;
    player.group.rotation.x=player.pitch;
    player.group.rotation.z=player.roll;

    if(player.pos.z<=CARRIER_Z-48 || player.speed<=3 || returnTimer>7){
      completeCarrierLanding();
    }
  }

  else if(returnPhase==='celebration'){
    animateCarrierCrew(returnTimer);
    updateVictoryCamera(dt,'crew');

    if(returnTimer>4.8){
      returnPhase='captain';
      returnTimer=0;

      if(captainFigure&&pilotFigure){
        captainFigure.visible=true;
        pilotFigure.visible=true;
      }

      setCinematicCaption(
        'CAPITÃO',
        'Excelente trabalho, piloto. Missão cumprida. Bem-vindo a bordo.'
      );
    }
  }

  else if(returnPhase==='captain'){
    animateCarrierCrew(returnTimer+5);
    animateCaptainGreeting(returnTimer);
    updateVictoryCamera(dt,'captain');

    if(returnTimer>5.2){
      showMissionDebrief();
    }
  }
}

function updateVictoryCamera(dt,mode){
  if(!carrierGroup)return;
  carrierGroup.updateMatrixWorld(true);

  let tp,tl;

  if(mode==='captain'&&captainFigure&&pilotFigure){
    const cp=new THREE.Vector3();
    const pp=new THREE.Vector3();
    captainFigure.getWorldPosition(cp);
    pilotFigure.getWorldPosition(pp);
    const mid=cp.clone().add(pp).multiplyScalar(0.5);

    tp=mid.clone().add(new THREE.Vector3(11,5.0,12));
    tl=mid.clone().add(new THREE.Vector3(0,2.0,0));
  }else{
    const jet=player.pos.clone();
    tp=jet.clone().add(new THREE.Vector3(40,17,46));
    tl=jet.clone().add(new THREE.Vector3(0,3,-8));
  }

  const k=1-Math.pow(0.01,dt);
  camera.position.lerp(tp,k);
  camera.up.lerp(new THREE.Vector3(0,1,0),Math.min(1,dt*4)).normalize();

  if(!camS.l)camS.l=tl.clone();
  camS.l.lerp(tl,k);
  camera.lookAt(camS.l);

  camera.fov=lerp(camera.fov,58,Math.min(1,dt*2.5));
  camera.updateProjectionMatrix();

  if(cockpitGroup)cockpitGroup.visible=false;
  player.group.visible=true;
}

function showMissionDebrief(){
  gameState='over';
  returnPhase='done';
  setCinematicCaption(null);

  const best=parseInt(localStorage.getItem('skyBest')||'0');
  const isRec=score>best;
  if(isRec)localStorage.setItem('skyBest',String(score));

  $('over-title').textContent='MISSÃO CUMPRIDA';
  $('over-stats').innerHTML=
    '<span style="color:#dce8ef">CAPITÃO: “Excelente trabalho, piloto.”</span><br><br>'+
    'Campanha: <b>8/8 ondas</b><br>'+
    'Pontuação: <b>'+score+'</b><br>'+
    'Abates: <b>'+kills+'</b><br>'+
    'Tempo total: <b>'+formatMissionTime(finalMissionTime||missionTime)+'</b><br>'+
    (isRec?'<b style="color:#39d353">NOVO RECORDE!</b><br>':'')+
    '<br><span style="color:#38e1ff">Deseja voltar ao jogo?</span>';

  const surv=$('btn-survival');
  if(surv){
    surv.textContent='Continuar — Modo Sobrevivência';
    surv.classList.remove('hidden');
  }

  $('btn-retry').textContent='Voltar ao jogo — Nova Missão';
  $('btn-over-menu').textContent='Menu Principal';

  $('over-screen').classList.remove('hidden');
  $('hud').classList.add('hidden');
}

function finishWave(){
  score+=250;

  // A 8ª onda encerra a campanha normal.
  if(wave===MISSION_WAVES&&!survivalMode){
    missionComplete();
    return;
  }

  waitingWave=true;
  waveTimer=2.8;
  showMsg('ONDA COMPLETA  +250');
}

function missionComplete(){
  beginReturnToCarrier();
}

function startSurvival(){
  survivalMode=true;
  missionWon=false;
  waitingWave=false;
  waveTimer=0;
  returnPhase='none';
  returnTimer=0;
  returnLanded=false;

  setCinematicCaption(null);
  hideCarrierPeople();

  const surv=$('btn-survival');
  if(surv)surv.classList.add('hidden');

  $('over-screen').classList.add('hidden');
  $('hud').classList.remove('hidden');

  // O porta-aviões reabastece e relança o caça para o modo sobrevivência.
  resetPlayer();
  player.pos.set(CARRIER_X,125,CARRIER_Z+470);
  player.yaw=0;
  player.pitch=0;
  player.roll=0;
  player.speed=88;
  player.health=100;
  player.group.position.copy(player.pos);
  player.group.visible=true;

  if(cockpitGroup)cockpitGroup.visible=(camMode===2);

  gameState='play';
  wave=MISSION_WAVES+1;
  spawnWave(wave);
  showMsg('MODO SOBREVIVÊNCIA — DECOLAGEM AUTORIZADA');
}


function setEnemyMode(en,mode,time){
  en.mode=mode;
  en.modeT=time;

  if(mode==='attack'){
    en.attackShots=0;
  }

  if(mode==='break'){
    en.breakDir=Math.random()<0.5?-1:1;
    // Quebra de aproximadamente 80–110 graus, sem virar instantaneamente.
    const ang=(en.elite?1.35:1.60)+(Math.random()-0.5)*0.35;
    en.breakYaw=wrapPi(en.yaw+en.breakDir*ang);
  }

  if(mode==='recover'){
    // Mantém uma trajetória fora da linha de tiro antes de voltar.
    const ang=(en.elite?0.75:1.00)+(Math.random()-0.5)*0.45;
    en.recoverYaw=wrapPi(en.yaw+en.breakDir*ang);
  }
}

function flashEnemy(en){
  for(const m of en.group.userData.mats){
    m.emissive=new THREE.Color(0xffffff);
    m.emissiveIntensity=0.9;
  }
  flashes.push({mats:en.group.userData.mats,t:0.07});
  // Ao ser atingido, há chance de quebrar a linha de tiro.
  if(Math.random()<0.42){
    setEnemyMode(en,'break',en.elite?1.45:1.8);
  }
}

function updateFlashes(dt){
  for(let i=flashes.length-1;i>=0;i--){
    const f=flashes[i];
    f.t-=dt;
    if(f.t<=0){
      for(const m of f.mats) m.emissiveIntensity=0;
      flashes.splice(i,1);
    }
  }
}

function updateEnemies(dt){
  for(const en of enemies){
    if(!Number.isFinite(en.modeT)) en.modeT=2.5;
    if(!Number.isFinite(en.fireCd)) en.fireCd=0.8;
    if(!Number.isFinite(en.speed)) en.speed=en.cruiseSpeed||76;

    en.modeT-=dt;
    en.fireCd-=dt;

    // V5.0.1:
    // "skill" precisa existir durante TODO o ciclo de atualização do inimigo,
    // inclusive nos estados break e recover. Na V5.0 ela existia apenas
    // dentro de alguns blocos e podia causar ReferenceError durante o combate.
    const skill=Number.isFinite(en.skill)?en.skill:0;

    const toPlayer=player.pos.clone().sub(en.pos);
    const dist=Math.max(1,toPlayer.length());
    const dirToPlayer=toPlayer.clone().multiplyScalar(1/dist);
    const fNow=fwdVec(en.yaw,en.pitch);
    const alignNow=fNow.dot(dirToPlayer);

    let desYaw=en.yaw;
    let desPitch=0;

    // ------------------------------------------------------------
    // 1) INTERCEPTAÇÃO
    // Aproxima, mas ainda não atira.
    // ------------------------------------------------------------
    if(en.mode==='intercept'){
      desYaw=Math.atan2(-toPlayer.x,-toPlayer.z);
      desPitch=clamp(Math.asin(clamp(toPlayer.y/dist,-1,1)),-0.52,0.52);

      // Só entra em ataque quando existe geometria e energia razoáveis.
      if(dist<(500+skill*25) && alignNow>(0.94-skill*0.012) && en.speed>en.minCombatSpeed){
        setEnemyMode(en,'attack',(en.elite?1.8:1.45)+skill*0.18);
      }else if(en.modeT<=0){
        // Continua interceptando, sem trocar aleatoriamente para uma torre no céu.
        en.modeT=2.5+Math.random()*1.8;
      }
    }

    // ------------------------------------------------------------
    // 2) PASSAGEM DE ATAQUE
    // Rajada curta. Depois precisa passar e se afastar.
    // ------------------------------------------------------------
    else if(en.mode==='attack'){
      const ip=interceptPoint(
        en.pos,
        en.speed+230,
        {pos:player.pos,yaw:player.yaw,pitch:player.pitch,speed:player.speed}
      );
      const lead=ip.clone().sub(en.pos);
      const leadDist=Math.max(1,lead.length());
      desYaw=Math.atan2(-lead.x,-lead.z);
      desPitch=clamp(Math.asin(clamp(lead.y/leadDist,-1,1)),-0.58,0.58);

      const f=fwdVec(en.yaw,en.pitch);
      const align=f.dot(dirToPlayer);
      const maxShots=en.elite?(5+(skill>0.55?1:0)):(3+(skill>0.40?1:0));

      // Disparo exige:
      // - velocidade mínima;
      // - cone de mira estreito;
      // - distância de combate;
      // - rajada limitada.
      const canFire=
        en.speed>en.minCombatSpeed &&
        dist>95 && dist<(455+skill*55) &&
        align>((en.elite?0.989:0.993)-skill*0.0035) &&
        en.attackShots<maxShots;

      if(canFire && en.fireCd<=0){
        en.fireCd=Math.max(
          en.elite?0.25:0.35,
          (en.elite?0.30:0.43)-skill*0.07+
          Math.random()*(en.elite?0.18:0.24)
        );

        const dir=lead.normalize();
        dir.x+=(Math.random()-0.5)*(en.elite?0.018:0.040);
        dir.y+=(Math.random()-0.5)*(en.elite?0.018:0.040);
        dir.z+=(Math.random()-0.5)*(en.elite?0.018:0.040);

        spawnBullet(
          en.pos.clone().addScaledVector(f,6),
          dir.normalize(),
          en.speed+230,
          'e'
        );
        en.attackShots++;
      }

      // Encerra a passagem se:
      // - já passou muito perto;
      // - alvo ficou para trás;
      // - acabou a janela de ataque;
      // - completou a rajada.
      if(
        dist<105 ||
        align<0.05 ||
        en.modeT<=0 ||
        en.attackShots>=maxShots
      ){
        setEnemyMode(en,'break',(en.elite?1.55:2.05)-skill*0.24);
      }
    }

    // ------------------------------------------------------------
    // 3) BREAK
    // Sai da linha de tiro e NÃO pode disparar.
    // ------------------------------------------------------------
    else if(en.mode==='break'){
      desYaw=en.breakYaw;
      // Leve descida/nível favorece recuperação de energia.
      desPitch=en.pos.y>120 ? -0.12 : 0.02;

      if(en.modeT<=0){
        setEnemyMode(en,'recover',(en.elite?1.55:2.25)-skill*0.30);
      }
    }

    // ------------------------------------------------------------
    // 4) RECUPERAÇÃO / REPOSICIONAMENTO
    // Ganha velocidade antes de voltar a perseguir.
    // ------------------------------------------------------------
    else if(en.mode==='recover'){
      desYaw=en.recoverYaw;

      // Se estiver lento, baixa suavemente o nariz para recuperar energia.
      if(en.speed<en.cruiseSpeed*0.94 && en.pos.y>70) desPitch=-0.22;
      else desPitch=0.02;

      if(en.modeT<=0 && en.speed>en.minCombatSpeed){
        setEnemyMode(en,'intercept',2.5+Math.random()*1.5);
      }else if(en.modeT<=0){
        // Ainda sem energia: continua recuperando.
        en.modeT=0.8;
      }
    }

    // Compatibilidade com estados antigos eventualmente persistentes.
    else{
      setEnemyMode(en,'intercept',2.5);
    }

    // ------------------------------------------------------------
    // PROTEÇÕES DE VOO
    // ------------------------------------------------------------
    const gh=terrH(en.pos.x,en.pos.z);

    // Anti-"pairar": se está lento em altitude, o nariz precisa baixar.
    // Em solo baixo, a proteção de terreno tem prioridade.
    if(en.speed<en.minCombatSpeed){
      if(en.pos.y>gh+55) desPitch=Math.min(desPitch,-0.24);
    }

    // Proteção de terreno suave.
    if(en.pos.y<gh+32) desPitch=Math.max(desPitch,0.48);

    // Evita que o inimigo fique indefinidamente no teto.
    if(en.pos.y>370) desPitch=Math.min(desPitch,-0.24);

    // ------------------------------------------------------------
    // ATITUDE / CURVA
    // ------------------------------------------------------------
    let dy=desYaw-en.yaw;
    while(dy>Math.PI) dy-=Math.PI*2;
    while(dy<-Math.PI) dy+=Math.PI*2;

    // Elite gira um pouco melhor, mas nenhum inimigo vira instantaneamente.
    const yawRate=(en.elite?1.05:0.88)+(en.skill||0)*0.10;
    en.yaw+=clamp(dy,-yawRate*dt,yawRate*dt);

    const rollTarget=clamp(-dy*0.82,-0.82,0.82);
    en.roll+=(rollTarget-en.roll)*Math.min(1,dt*(en.elite?4.4:3.7));

    const pitchRate=(en.elite?0.72:0.62)+(en.skill||0)*0.06;
    en.pitch+=clamp(desPitch-en.pitch,-pitchRate*dt,pitchRate*dt);
    en.pitch=clamp(en.pitch,-0.68,0.68);

    // ------------------------------------------------------------
    // ENERGIA SIMCADE DO INIMIGO
    // Mesma ideia do jogador, porém com consequência maior.
    // ------------------------------------------------------------
    const f=fwdVec(en.yaw,en.pitch);
    const climb=Math.max(0,f.y);
    const dive=Math.max(0,-f.y);
    const bankLoss=Math.abs(en.roll)*(en.elite?4.5:6.0);

    let targetSpeed=
      en.cruiseSpeed
      -climb*(en.elite?19:23)
      +dive*(en.elite?24:28)
      -bankLoss;

    if(en.mode==='break' || en.mode==='recover') targetSpeed+=4;

    targetSpeed=clamp(
      targetSpeed,
      en.elite?46:43,
      en.maxSpeed
    );

    en.speed+=(targetSpeed-en.speed)*Math.min(1,dt*(en.elite?1.25:1.05));
    en.speed=clamp(en.speed,en.elite?42:39,en.maxSpeed);

    // Movimento
    en.pos.addScaledVector(f,en.speed*dt);

    const minY=terrH(en.pos.x,en.pos.z)+6;
    if(en.pos.y<minY) en.pos.y=minY;

    // Limites do mapa: retorna à interceptação.
    if(Math.abs(en.pos.x)>COMBAT_LIMIT||Math.abs(en.pos.z)>COMBAT_LIMIT){
      setEnemyMode(en,'intercept',3);
    }

    // Modelo
    en.group.position.copy(en.pos);
    en.group.rotation.y=en.yaw;
    en.group.rotation.x=en.pitch;
    en.group.rotation.z=en.roll;

    // Afterburner varia com energia.
    const fl=en.group.userData.flame;
    if(fl){
      const energy=(en.speed-40)/70;
      const sc=0.72+clamp(energy,0,1)*0.45+Math.random()*0.18;
      fl.scale.set(1,sc,1);
      const fc=en.group.userData.flameCore;
      if(fc) fc.scale.set(1,0.82+clamp(energy,0,1)*0.28+Math.random()*0.12,1);
    }

    // Fumaça de dano
    if(en.hp<en.maxHp&&en.hp<=Math.ceil(en.maxHp/2)){
      en.trailT-=dt;
      if(en.trailT<=0){
        en.trailT=0.05;
        spawnSmoke(en.pos.clone(),0x2a2a2a,0.9,2.2);
      }
    }

    // Colisão
    if(gameState==='play'&&en.pos.distanceToSquared(player.pos)<70){
      damagePlayer(30);
      camShake=1.2;
      const idx=enemies.indexOf(en);
      if(idx>=0) destroyEnemy(idx);
    }
  }
}

function destroyEnemy(idx){
  const en=enemies[idx];
  spawnExplosion(en.pos,2.4);
  spawnDebris(en.pos,6);
  sfx('boom');
  addFloater(en.pos.clone(),'+100');
  scene.remove(en.group);
  enemies.splice(idx,1);
  if(lockTarget===en){ lockTarget=null; lockTime=0; }
  kills++;score+=100;

  if(gameState==='play'){
    // Se ainda há inimigos programados para esta onda,
    // abre espaço para o próximo reforço.
    if(waveRemainingToSpawn>0){
      reinforcementTimer=Math.min(reinforcementTimer,0.45);
    }

    // Só encerra a onda quando TODOS os inimigos previstos
    // já entraram e foram abatidos.
    if(enemies.length===0&&waveRemainingToSpawn===0){
      finishWave();
    }
  }
}

function damagePlayer(amt){
  if(gameState!=='play') return;
  player.health-=amt;
  regenT=0;
  camShake=Math.max(camShake,0.5);
  sfx('hurt');
  const df=$('dmg-flash');
  df.style.opacity='1';
  setTimeout(()=>{df.style.opacity='0';},120);
  if(player.health<=0){ player.health=0; playerDown(); }
}

function playerDown(){
  missionWon=false;
  const surv=$('btn-survival');
  if(surv)surv.classList.add('hidden');
  $('over-title').textContent='ABATIDO';
  $('btn-retry').textContent='Nova Missão';

  spawnExplosion(player.pos,3.2);
  spawnDebris(player.pos,10);
  sfx('boom');
  player.group.visible=false;
  gameState='over';
  if(engGain) engGain.gain.value=0;
  const best=parseInt(localStorage.getItem('skyBest')||'0');
  const isRec=score>best;
  if(isRec) localStorage.setItem('skyBest',String(score));
  $('over-stats').innerHTML=
    'Pontuação: <b>'+score+'</b><br>Abates: <b>'+kills+'</b><br>'+
    'Tempo: <b>'+formatMissionTime(missionTime)+'</b><br>'+
    (survivalMode?'Sobrevivência — onda: <b>'+wave+'</b>':'Onda alcançada: <b>'+wave+'</b>')+
    (isRec?'<br><b style="color:#39d353">NOVO RECORDE!</b>':'');
  $('over-screen').classList.remove('hidden');
  $('hud').classList.add('hidden');
}

// ─── EFFECTS ────────────────────────────────
function boomLight(pos,intensity){
  let slot=boomLights[0];
  for(const b of boomLights) if(b.t<=slot.t) slot=b;
  slot.l.position.copy(pos);
  slot.l.intensity=intensity;
  slot.t=0.4;
}

function updateBoomLights(dt){
  muzzleLight.intensity*=Math.pow(0.001,dt);
  for(const b of boomLights){
    if(b.t>0){ b.t-=dt; b.l.intensity*=Math.pow(0.008,dt); }
    else b.l.intensity=0;
  }
}

function spawnExplosion(pos,scale){
  // flash
  const fl=new THREE.Sprite(new THREE.SpriteMaterial({map:makeRadialFxTex(),color:0xffffee,transparent:true,opacity:1,blending:THREE.AdditiveBlending,depthWrite:false}));
  fl.position.copy(pos); fl.scale.set(6*scale,6*scale,1);
  scene.add(fl);
  parts.push({s:fl,life:0.12,ml:0.12,vel:new THREE.Vector3(),grow:30*scale,fade:1});
  // fireballs
  for(let i=0;i<11;i++){
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:makeRadialFxTex(),color:i<5?0xff8833:0xff5511,transparent:true,opacity:0.92,blending:THREE.AdditiveBlending,depthWrite:false}));
    s.position.copy(pos);
    const sz=(1+Math.random()*1.6)*scale;
    s.scale.set(sz,sz,1);
    scene.add(s);
    parts.push({s,life:0.4+Math.random()*0.3,ml:0.7,
      vel:new THREE.Vector3((Math.random()-0.5)*26,(Math.random()-0.2)*24,(Math.random()-0.5)*26),
      grow:3.5*scale,fade:1});
  }
  // smoke
  for(let i=0;i<8;i++){
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:makeSmokeFxTex(),color:0x2c2c2c,transparent:true,opacity:0.58,depthWrite:false}));
    s.position.copy(pos);
    s.scale.set(1.4*scale,1.4*scale,1);
    scene.add(s);
    parts.push({s,life:1.2+Math.random()*0.6,ml:1.8,
      vel:new THREE.Vector3((Math.random()-0.5)*10,4+Math.random()*6,(Math.random()-0.5)*10),
      grow:4*scale,fade:0.6});
  }
  // shockwave ring
  const ring=new THREE.Mesh(
    new THREE.RingGeometry(0.8,1.1,26),
    new THREE.MeshBasicMaterial({color:0xffddaa,transparent:true,opacity:0.8,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false})
  );
  ring.position.copy(pos);
  ring.lookAt(camera.position);
  scene.add(ring);
  parts.push({s:ring,life:0.35,ml:0.35,vel:new THREE.Vector3(),grow:38*scale,fade:1,isRing:true});

  boomLight(pos,8.5*scale);
}

function spawnDebris(pos,n){
  const m=new THREE.MeshStandardMaterial({color:0x3a3f46,roughness:0.7,metalness:0.4});
  for(let i=0;i<n;i++){
    const d=new THREE.Mesh(new THREE.BoxGeometry(0.3+Math.random()*0.5,0.15,0.5+Math.random()*0.7),m);
    d.position.copy(pos);
    scene.add(d);
    debris.push({m:d,
      vel:new THREE.Vector3((Math.random()-0.5)*36,Math.random()*22,(Math.random()-0.5)*36),
      rot:new THREE.Vector3(Math.random()*8,Math.random()*8,Math.random()*8),
      life:2.2});
  }
}

function updateDebris(dt){
  for(let i=debris.length-1;i>=0;i--){
    const d=debris[i];
    d.life-=dt;
    d.vel.y-=28*dt;
    d.m.position.addScaledVector(d.vel,dt);
    d.m.rotation.x+=d.rot.x*dt;
    d.m.rotation.y+=d.rot.y*dt;
    d.m.rotation.z+=d.rot.z*dt;
    const gh=terrH(d.m.position.x,d.m.position.z);
    if(d.m.position.y<gh+0.2||d.life<=0){
      scene.remove(d.m);
      debris.splice(i,1);
    }
  }
}

function spawnMuzzleBurst(pos,dir,color,scale){
  const flash=new THREE.Sprite(new THREE.SpriteMaterial({map:makeRadialFxTex(),color,transparent:true,opacity:0.92,blending:THREE.AdditiveBlending,depthWrite:false}));
  flash.position.copy(pos).addScaledVector(dir,0.5);
  flash.scale.set(1.3*scale,1.3*scale,1);
  scene.add(flash);
  parts.push({s:flash,life:0.08,ml:0.08,vel:dir.clone().multiplyScalar(14),grow:4.5*scale,fade:1});
}

function spawnTracer(pos,color,scale){
  const tr=new THREE.Sprite(new THREE.SpriteMaterial({map:makeRadialFxTex(),color,transparent:true,opacity:0.34,blending:THREE.AdditiveBlending,depthWrite:false}));
  tr.position.copy(pos);
  tr.scale.set(scale,scale,1);
  scene.add(tr);
  parts.push({s:tr,life:0.15,ml:0.15,vel:new THREE.Vector3(),grow:2.6*scale,fade:0.45});
}

function spawnImpact(pos,scale,color){
  const col=color||0xffcc66;
  const flash=new THREE.Sprite(new THREE.SpriteMaterial({map:makeRadialFxTex(),color:0xffffff,transparent:true,opacity:1,blending:THREE.AdditiveBlending,depthWrite:false}));
  flash.position.copy(pos);
  flash.scale.set(0.9*scale,0.9*scale,1);
  scene.add(flash);
  parts.push({s:flash,life:0.06,ml:0.06,vel:new THREE.Vector3(),grow:5*scale,fade:1});

  for(let i=0;i<7;i++){
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:makeRadialFxTex(),color:col,transparent:true,opacity:0.88,blending:THREE.AdditiveBlending,depthWrite:false}));
    s.position.copy(pos);
    s.scale.set(0.42*scale,0.42*scale,1);
    scene.add(s);
    parts.push({s,life:0.20+Math.random()*0.05,ml:0.25,
      vel:new THREE.Vector3((Math.random()-0.5)*18,(Math.random()-0.5)*18,(Math.random()-0.5)*18),
      grow:2.4,fade:1});
  }
}

function spawnSmoke(pos,color,life,grow){
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:makeSmokeFxTex(),color,transparent:true,opacity:0.42,depthWrite:false}));
  s.position.copy(pos);
  s.scale.set(1,1,1);
  scene.add(s);
  parts.push({s,life,ml:life,vel:new THREE.Vector3(0,1.5,0),grow:grow||2.5,fade:0.6});
}

function spawnTrail(pos){
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:makeSmokeFxTex(),color:0xffffff,transparent:true,opacity:0.26,blending:THREE.AdditiveBlending,depthWrite:false}));
  s.position.copy(pos);
  s.scale.set(0.5,0.5,1);
  scene.add(s);
  parts.push({s,life:0.5,ml:0.5,vel:new THREE.Vector3(0,0,0),grow:1.2,fade:0.5});
}

function updateParts(dt){
  for(let i=parts.length-1;i>=0;i--){
    const p=parts[i];
    p.life-=dt;
    if(p.life<=0){
      scene.remove(p.s);
      if(p.s.material) p.s.material.dispose();
      if(p.isRing&&p.s.geometry) p.s.geometry.dispose();
      parts.splice(i,1);continue;
    }
    const t=1-p.life/p.ml;
    p.s.position.addScaledVector(p.vel,dt);
    p.vel.multiplyScalar(1-dt*1.5);
    if(p.isRing){
      const sc=1+p.grow*t;
      p.s.scale.set(sc,sc,sc);
      p.s.lookAt(camera.position);
      p.s.material.opacity=(1-t)*0.8;
    }else{
      const sc=p.s.scale.x+p.grow*dt;
      p.s.scale.set(sc,sc,1);
      p.s.material.opacity=(1-t)*(p.fade!==undefined?p.fade:0.85);
    }
  }
}

function addFloater(worldPos,txt){
  floaters.push({p:worldPos,txt,life:1.1,ml:1.1});
}


function updateSpeedStreaks(dt){
  // Lightweight cinematic speed lines: only active at high speed.
  if(gameState!=='play' || player.speed<88) {
    for(let i=speedStreaks.length-1;i>=0;i--){
      const st=speedStreaks[i];
      st.life-=dt*3;
      st.s.material.opacity=Math.max(0,st.life)*0.25;
      if(st.life<=0){ scene.remove(st.s); speedStreaks.splice(i,1); }
    }
    return;
  }

  if(speedStreaks.length<18 && Math.random()<dt*32){
    const f=fwdVec(player.yaw,player.pitch);
    const right=new THREE.Vector3(-Math.cos(player.yaw),0,Math.sin(player.yaw));
    const up=new THREE.Vector3().crossVectors(right,f).normalize();
    const st=new THREE.Sprite(new THREE.SpriteMaterial({
      map:makeStreakFxTex(),
      color:0xd9f3ff,
      transparent:true,
      opacity:0.18,
      blending:THREE.AdditiveBlending,
      depthWrite:false
    }));
    const side=(Math.random()-.5)*55;
    const vert=(Math.random()-.5)*28;
    st.position.copy(player.pos)
      .addScaledVector(f, 18+Math.random()*55)
      .addScaledVector(right,side)
      .addScaledVector(up,vert);
    st.scale.set(0.28,6+Math.random()*9,1);
    scene.add(st);
    speedStreaks.push({s:st,life:0.65+Math.random()*0.35});
  }

  const f=fwdVec(player.yaw,player.pitch);
  for(let i=speedStreaks.length-1;i>=0;i--){
    const st=speedStreaks[i];
    st.life-=dt;
    st.s.position.addScaledVector(f,-160*dt);
    st.s.material.opacity=Math.max(0,st.life)*0.28;
    if(st.life<=0){ scene.remove(st.s); speedStreaks.splice(i,1); }
  }
}

// ─── CAMERA v2 (fov kick + shake) ───────────
const camS={p:null,l:null};

function updateCamera(dt){
  if(!camS.p){ camS.p=new THREE.Vector3().copy(camera.position); camS.l=new THREE.Vector3().copy(player.pos); }
  const f=fwdVec(player.yaw,player.pitch);
  // Vetor 'cima' local do aviao. Ele acompanha pitch e roll, inclusive quando invertido.
  const planeUp=new THREE.Vector3(0,1,0).applyQuaternion(player.group.quaternion).normalize();
  let tp,tl,inst=false;

  if(cockpitGroup) cockpitGroup.visible=(camMode===2);

  // Evita o modelo externo atravessando o cockpit em primeira pessoa.
  if(player.group && gameState!=='over'){
    player.group.visible=(camMode!==2);
  }

  if(camMode===0){
    tp=player.pos.clone().addScaledVector(f,-22).addScaledVector(planeUp,7);
    tl=player.pos.clone().addScaledVector(f,45).addScaledVector(planeUp,1.4);
  }else if(camMode===1){
    tp=player.pos.clone().addScaledVector(f,-40).addScaledVector(planeUp,14);
    tl=player.pos.clone().addScaledVector(f,32).addScaledVector(planeUp,2.0);
  }else{
    tp=player.pos.clone().addScaledVector(f,1.65).addScaledVector(planeUp,1.12);
    tl=player.pos.clone().addScaledVector(f,180);
    inst=true;
  }

  if(inst){
    camS.p.copy(tp);camS.l.copy(tl);
    camera.up.copy(planeUp);
  }else{
    const k=1-Math.pow(0.0004,dt);
    camS.p.lerp(tp,k);camS.l.lerp(tl,k);
    // A camera externa tambem acompanha a inversao do aviao durante o loop.
    camera.up.lerp(planeUp,Math.min(1,dt*5)).normalize();
  }

  camera.position.copy(camS.p);
  if(camShake>0){
    camShake=Math.max(0,camShake-dt*2.4);
    camera.position.x+=(Math.random()-0.5)*camShake*1.6;
    camera.position.y+=(Math.random()-0.5)*camShake*1.6;
    camera.position.z+=(Math.random()-0.5)*camShake*1.6;
  }
  camera.lookAt(camS.l);

  // FOV kick with speed
  const targetFov=camMode===2 ? 72 : 65+((player.speed-50)/72)*17;
  camera.fov=lerp(camera.fov,targetFov,Math.min(1,dt*3));
  camera.updateProjectionMatrix();
}

// ─── HUD CANVAS (target boxes, lock, compass) ───
let hudCv=null,hudCx=null;

function sizeHudCanvas(){
  hudCv=$('hud-canvas'); if(!hudCv) return;
  hudCv.width=window.innerWidth;
  hudCv.height=window.innerHeight;
  hudCx=hudCv.getContext('2d');
}

function w2s(v){
  const p=v.clone().project(camera);
  return{
    x:(p.x*0.5+0.5)*hudCv.width,
    y:(-p.y*0.5+0.5)*hudCv.height,
    front:p.z<1
  };
}

function drawHudCanvas(dt){
  if(!hudCx) return;
  const c=hudCx,W=hudCv.width,H=hudCv.height;
  c.clearRect(0,0,W,H);
  c.font='600 13px Rajdhani, sans-serif';

  const cx=W/2,cy=H/2;

  // crosshair
  c.strokeStyle='rgba(56,225,255,.9)';
  c.lineWidth=1.6;
  c.beginPath();
  c.moveTo(cx-22,cy);c.lineTo(cx-8,cy);
  c.moveTo(cx+8,cy);c.lineTo(cx+22,cy);
  c.moveTo(cx,cy-22);c.lineTo(cx,cy-8);
  c.moveTo(cx,cy+8);c.lineTo(cx,cy+22);
  c.stroke();
  c.fillStyle='rgba(56,225,255,.9)';
  c.fillRect(cx-1.5,cy-1.5,3,3);

  // hit marker
  if(hitT>0){
    hitT-=dt;
    c.strokeStyle='rgba(255,255,255,'+(hitT/0.14)+')';
    c.lineWidth=2.2;
    c.beginPath();
    for(const[a,b]of[[-1,-1],[1,-1],[-1,1],[1,1]]){
      c.moveTo(cx+a*9,cy+b*9);c.lineTo(cx+a*17,cy+b*17);
    }
    c.stroke();
  }

  // compass ribbon
  c.save();
  const compY=26;
  c.strokeStyle='rgba(238,244,248,.5)';
  c.fillStyle='rgba(238,244,248,.75)';
  c.textAlign='center';
  const hdg=((-player.yaw*180/Math.PI)%360+360)%360;
  for(let d=-60;d<=60;d+=5){
    let a=Math.round((hdg+d)/5)*5;
    const off=(a-hdg);
    const x=cx+off*4.4;
    if(x<cx-270||x>cx+270) continue;
    a=((a%360)+360)%360;
    const major=a%15===0;
    c.lineWidth=1;
    c.beginPath();c.moveTo(x,compY);c.lineTo(x,compY+(major?9:5));c.stroke();
    if(major){
      let lbl=String(a);
      if(a===0)lbl='N';else if(a===90)lbl='E';else if(a===180)lbl='S';else if(a===270)lbl='O';
      c.fillText(lbl,x,compY+22);
    }
  }
  c.strokeStyle='rgba(56,225,255,.95)';
  c.lineWidth=2;
  c.beginPath();c.moveTo(cx,compY-4);c.lineTo(cx-5,compY-11);c.lineTo(cx+5,compY-11);c.closePath();c.stroke();
  c.restore();

  // enemy boxes + offscreen arrows
  for(const en of enemies){
    const s=w2s(en.pos);
    const dist=Math.round(player.pos.distanceTo(en.pos));
    const onScreen=s.front&&s.x>0&&s.x<W&&s.y>0&&s.y<H;

    if(onScreen){
      const locked=(en===lockTarget&&lockTime>=1);
      const locking=(en===lockTarget&&lockTime<1);
      const col=locked?'rgba(240,68,56,.95)':(en.elite?'rgba(255,170,40,.9)':'rgba(56,225,255,.85)');
      const sz=locked?26:20;
      c.strokeStyle=col;
      c.lineWidth=locked?2.2:1.5;
      // corner box
      c.beginPath();
      const k=7;
      c.moveTo(s.x-sz,s.y-sz+k);c.lineTo(s.x-sz,s.y-sz);c.lineTo(s.x-sz+k,s.y-sz);
      c.moveTo(s.x+sz-k,s.y-sz);c.lineTo(s.x+sz,s.y-sz);c.lineTo(s.x+sz,s.y-sz+k);
      c.moveTo(s.x+sz,s.y+sz-k);c.lineTo(s.x+sz,s.y+sz);c.lineTo(s.x+sz-k,s.y+sz);
      c.moveTo(s.x-sz+k,s.y+sz);c.lineTo(s.x-sz,s.y+sz);c.lineTo(s.x-sz,s.y+sz-k);
      c.stroke();
      c.fillStyle=col;
      c.textAlign='left';
      c.fillText(dist+'m',s.x+sz+6,s.y+4);
      if(en.elite){ c.fillText('ELITE',s.x-sz,s.y-sz-6); }

      // lock progress arc
      if(locking&&lockTime>0.05){
        c.beginPath();
        c.arc(s.x,s.y,sz+8,-Math.PI/2,-Math.PI/2+lockTime*Math.PI*2);
        c.stroke();
      }
      if(locked){
        c.textAlign='center';
        c.fillText('TRAVADO',s.x,s.y+sz+16);
      }
    }else{
      // edge arrow
      const dx=s.front?s.x-cx:cx-s.x;
      const dy=s.front?s.y-cy:cy-s.y;
      const ang=Math.atan2(dy,dx);
      const R=Math.min(W,H)*0.42;
      const ax=cx+Math.cos(ang)*R;
      const ay=cy+Math.sin(ang)*R;
      c.save();
      c.translate(ax,ay);c.rotate(ang);
      c.fillStyle=en.elite?'rgba(255,170,40,.8)':'rgba(56,225,255,.7)';
      c.beginPath();c.moveTo(10,0);c.lineTo(-5,-6);c.lineTo(-5,6);c.closePath();c.fill();
      c.restore();
    }
  }

  // gun lead pip (where bullets will converge)
  const t=acquireTarget(0.22,900);
  if(t){
    const ip=interceptPoint(player.pos,650,t);
    const s=w2s(ip);
    if(s.front){
      c.strokeStyle='rgba(57,211,83,.95)';
      c.lineWidth=1.8;
      c.beginPath();c.arc(s.x,s.y,7,0,Math.PI*2);c.stroke();
      c.beginPath();c.moveTo(s.x-11,s.y);c.lineTo(s.x-7,s.y);c.moveTo(s.x+7,s.y);c.lineTo(s.x+11,s.y);c.stroke();
    }
  }

  // lens flare (sol na tela)
  if(sunWorld){
    const ss=w2s(sunWorld);
    if(ss.front&&ss.x>-140&&ss.x<W+140&&ss.y>-140&&ss.y<H+140){
      c.save();
      c.globalCompositeOperation='lighter';
      const core=c.createRadialGradient(ss.x,ss.y,0,ss.x,ss.y,110);
      core.addColorStop(0,'rgba(255,244,220,0.4)');
      core.addColorStop(0.4,'rgba(255,230,180,0.12)');
      core.addColorStop(1,'rgba(255,230,180,0)');
      c.fillStyle=core;
      c.fillRect(ss.x-110,ss.y-110,220,220);
      const vx=cx-ss.x, vy=cy-ss.y;
      const ghosts=[[0.35,16,'rgba(56,225,255,0.10)'],[0.62,30,'rgba(255,215,150,0.09)'],[0.95,12,'rgba(255,160,120,0.10)'],[1.35,44,'rgba(56,225,255,0.06)']];
      for(const[t,r,col]of ghosts){
        c.fillStyle=col;
        c.beginPath();
        c.arc(ss.x+vx*t,ss.y+vy*t,r,0,Math.PI*2);
        c.fill();
      }
      c.restore();
    }
  }

  if(camMode===2) drawCockpitHUD(c,W,H,cx,cy);

  // floaters (+100)
  c.textAlign='center';
  c.font='700 17px Rajdhani, sans-serif';
  for(let i=floaters.length-1;i>=0;i--){
    const fl=floaters[i];
    fl.life-=dt;
    if(fl.life<=0){floaters.splice(i,1);continue;}
    fl.p.y+=dt*9;
    const s=w2s(fl.p);
    if(s.front){
      c.fillStyle='rgba(57,211,83,'+(fl.life/fl.ml)+')';
      c.fillText(fl.txt,s.x,s.y);
    }
  }
}

// ─── RADAR ──────────────────────────────────
function updateRadar(){
  const cv=$('radar'); if(!cv) return;
  const c=cv.getContext('2d');
  const W=cv.width,H=cv.height,cx=W/2,cy=H/2;
  c.clearRect(0,0,W,H);
  c.strokeStyle='rgba(56,225,255,.22)';
  c.lineWidth=1;
  for(const r of[24,48,70]){c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.stroke();}
  c.beginPath();c.moveTo(cx,4);c.lineTo(cx,H-4);c.moveTo(4,cy);c.lineTo(W-4,cy);c.stroke();

  // sweep
  const sw=(gTime*1.6)%(Math.PI*2);
  const grad=c.createConicGradient?null:null;
  c.save();
  c.translate(cx,cy);c.rotate(sw);
  c.fillStyle='rgba(56,225,255,.07)';
  c.beginPath();c.moveTo(0,0);c.arc(0,0,70,0,0.7);c.closePath();c.fill();
  c.restore();

  const RANGE=1200;
  const cos=Math.cos(player.yaw),sin=Math.sin(player.yaw);
  for(const en of enemies){
    const dx=en.pos.x-player.pos.x;
    const dz=en.pos.z-player.pos.z;
    const rx=dx*cos-dz*sin;
    const rz=dx*sin+dz*cos;
    const px=cx+(rx/RANGE)*70;
    const py=cy+(rz/RANGE)*70;
    if(px<5||px>W-5||py<5||py>H-5) continue;
    c.fillStyle=en.elite?'#ffaa28':(en.mode==='attack'?'#f04438':(en.mode==='break'?'#ff9f43':'#38e1ff'));
    c.beginPath();c.arc(px,py,3,0,Math.PI*2);c.fill();
  }
  c.fillStyle='#39d353';
  c.beginPath();c.moveTo(cx,cy-6);c.lineTo(cx-4,cy+4);c.lineTo(cx+4,cy+4);c.closePath();c.fill();
}

// ─── DOM HUD ────────────────────────────────
function updateHUD(){
  $('h-score').textContent=score;
  $('h-wave').textContent=wave;
  const threats=enemies.length+waveRemainingToSpawn;
  $('h-enem').textContent=waveRemainingToSpawn>0
    ? enemies.length+'/'+threats
    : enemies.length;
  $('h-speed').textContent=Math.round(player.speed*6.5);
  $('h-alt').textContent=Math.round(Math.max(0,player.pos.y-terrH(player.pos.x,player.pos.z)));
  const ht=$('h-time');
  if(ht)ht.textContent=formatMissionTime(missionTime);
  const hp=$('h-hp');
  hp.style.width=player.health+'%';
  hp.style.background=player.health>50?'#39d353':(player.health>25?'#ffaa28':'#f04438');

  const msl=$('h-msl');
  if(missileCd>0){ msl.style.display=''; msl.textContent='MÍSSIL: RECARREGANDO'; msl.className='msl'; }
  else if(lockTarget&&lockTime>=1){ msl.style.display=''; msl.textContent='MÍSSIL PRONTO — APERTE X'; msl.className='msl ready'; }
  else if(lockTarget){ msl.style.display=''; msl.textContent='TRAVANDO ALVO...'; msl.className='msl'; }
  else{ msl.style.display='none'; }
}

function showMsg(txt){
  const m=$('h-msg');
  m.textContent=txt;
  m.classList.add('show');
  if(msgTimer) clearTimeout(msgTimer);
  msgTimer=setTimeout(()=>m.classList.remove('show'),2000);
}

// ─── AUDIO v2 (noise-based) ─────────────────
function initAudio(){
  try{
    audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    // engine
    engOsc=audioCtx.createOscillator();
    engOsc.type='sawtooth';engOsc.frequency.value=60;
    const lp=audioCtx.createBiquadFilter();
    lp.type='lowpass';lp.frequency.value=340;
    engGain=audioCtx.createGain();engGain.gain.value=0;
    engOsc.connect(lp);lp.connect(engGain);engGain.connect(audioCtx.destination);
    engOsc.start();
    // noise buffer for gun/explosions
    const len=audioCtx.sampleRate*0.5;
    noiseBuf=audioCtx.createBuffer(1,len,audioCtx.sampleRate);
    const d=noiseBuf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
  }catch(e){console.warn('audio',e);}
}

function updateAudio(){
  if(!audioCtx||!engOsc) return;
  if(gameState==='play'||gameState==='returning'){
    engOsc.frequency.value=48+player.speed*0.6;
    engGain.gain.value=0.04;
  }else engGain.gain.value=0;
}

function playNoise(dur,freq,vol){
  if(!audioCtx||!noiseBuf) return;
  const t=audioCtx.currentTime;
  const src=audioCtx.createBufferSource();
  src.buffer=noiseBuf;
  const f=audioCtx.createBiquadFilter();
  f.type='bandpass';f.frequency.value=freq;f.Q.value=0.8;
  const g=audioCtx.createGain();
  g.gain.setValueAtTime(vol,t);
  g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  src.connect(f);f.connect(g);g.connect(audioCtx.destination);
  src.start(t);src.stop(t+dur);
}

function sfx(type){
  if(!audioCtx) return;
  try{
    const t=audioCtx.currentTime;
    if(type==='shot'){ playNoise(0.07,1800,0.05); playNoise(0.05,500,0.04); return; }
    if(type==='boom'){
      playNoise(0.6,220,0.22); playNoise(0.4,90,0.2);
      const o=audioCtx.createOscillator();const g=audioCtx.createGain();
      o.type='sine';o.frequency.setValueAtTime(120,t);
      o.frequency.exponentialRampToValueAtTime(28,t+0.55);
      g.gain.setValueAtTime(0.16,t);
      g.gain.exponentialRampToValueAtTime(0.001,t+0.6);
      o.connect(g);g.connect(audioCtx.destination);o.start(t);o.stop(t+0.65);
      return;
    }
    if(type==='hit'){ playNoise(0.08,2600,0.06); return; }
    if(type==='hurt'){
      const o=audioCtx.createOscillator();const g=audioCtx.createGain();
      o.type='square';o.frequency.setValueAtTime(130,t);
      g.gain.setValueAtTime(0.06,t);
      g.gain.exponentialRampToValueAtTime(0.001,t+0.18);
      o.connect(g);g.connect(audioCtx.destination);o.start(t);o.stop(t+0.2);
      return;
    }
    if(type==='msl'){
      playNoise(0.5,700,0.1);
      const o=audioCtx.createOscillator();const g=audioCtx.createGain();
      o.type='sawtooth';o.frequency.setValueAtTime(300,t);
      o.frequency.exponentialRampToValueAtTime(900,t+0.4);
      g.gain.setValueAtTime(0.05,t);
      g.gain.exponentialRampToValueAtTime(0.001,t+0.45);
      o.connect(g);g.connect(audioCtx.destination);o.start(t);o.stop(t+0.5);
      return;
    }
  }catch(e){}
}

// ─── CONTROLLER CONFIG (mantido do v1) ──────
function showCtrl(){showScr('ctrl');updateCtrlUI();}

function updateCtrlUI(){
  const el=$('ctrl-body');if(!el)return;
  const gp=getGP();
  let h='';
  h+='<div class="crow"><label>Gamepad:</label><select id="c-gp"><option value="-1">Nenhum</option>';
  const gps=navigator.getGamepads?navigator.getGamepads():[];
  for(let i=0;i<gps.length;i++){
    if(gps[i]) h+='<option value="'+i+'"'+(ctrl.gpIdx===i?' selected':'')+'>'+gps[i].id.substring(0,36)+'</option>';
  }
  h+='</select></div>';
  if(gp){
    h+='<div class="csec"><h3>Mapeamento</h3>';
    h+=selRow('Eixo Virar','c-sa',gp.axes.length,ctrl.steerAxis,'Eixo');
    h+=selRow('Eixo Subir/Descer','c-pa',gp.axes.length,ctrl.pitchAxis,'Eixo');
    h+=selRow('Botão Disparo','c-fb',gp.buttons.length,ctrl.fireBtn,'Botão');
    h+='</div><div class="csec"><h3>Ajustes</h3>';
    h+=sldRow('Deadzone','c-dz',ctrl.dz,0,0.3,0.01);
    h+=sldRow('Sensibilidade','c-sn',ctrl.sens,0.3,2,0.05);
    h+=sldRow('Linearidade','c-ln',ctrl.lin,0.5,3,0.1);
    h+='<div class="crow"><label>Inverter X:</label><input type="checkbox" id="c-ix"'+(ctrl.invX?' checked':'')+'></div>';
    h+='<div class="crow"><label>Inverter Y (ajuste manual):</label><input type="checkbox" id="c-iy"'+(ctrl.invY?' checked':'')+'></div></div>';
    const rx=gp.axes[ctrl.steerAxis]||0;
    const px=procAxis(rx,ctrl.invX,ctrl.cX,ctrl.mnX,ctrl.mxX);
    h+='<div class="csec"><h3>Virar</h3>'+barRow('Bruto',rx,'x')+barRow('Processado',px,'x')+'</div>';
    const ry=gp.axes[ctrl.pitchAxis]||0;
    let py=procAxis(ry,false,ctrl.cY,ctrl.mnY,ctrl.mxY);
    py*=ctrl.pitchPullSign||1;
    if(ctrl.invY) py=-py;
    h+='<div class="csec"><h3>Manche vertical</h3>'
      +'<div style="color:var(--dim);font-size:12px;margin:0 0 8px">PUXAR PARA TRÁS = SUBIR • EMPURRAR PARA FRENTE = DESCER</div>'
      +barRow('Bruto',ry,'x')+barRow('Subir',py>0?py:0,'u')+barRow('Descer',py<0?-py:0,'d')+'</div>';
    h+='<div class="csec"><h3>Botões</h3><div class="bind-row">';
    for(let b=0;b<gp.buttons.length;b++) h+='<div class="bind'+(gp.buttons[b].pressed?' on':'')+'">B'+b+'</div>';
    h+='</div></div>';
  }else{
    h+='<p style="color:var(--dim);margin:14px 0">Nenhum gamepad detectado. Conecte o Arduino e pressione o botão.</p>';
  }
  el.innerHTML=h;
  const gsel=$('c-gp');
  if(gsel) gsel.onchange=()=>{const v=parseInt(gsel.value);ctrl.gpIdx=v>=0?v:null;};
  wSel('c-sa',v=>ctrl.steerAxis=+v);
  wSel('c-pa',v=>ctrl.pitchAxis=+v);
  wSel('c-fb',v=>ctrl.fireBtn=+v);
  wSld('c-dz',v=>ctrl.dz=v);
  wSld('c-sn',v=>ctrl.sens=v);
  wSld('c-ln',v=>ctrl.lin=v);
  const ix=$('c-ix');if(ix)ix.onchange=()=>ctrl.invX=ix.checked;
  const iy=$('c-iy');if(iy)iy.onchange=()=>ctrl.invY=iy.checked;
}

function selRow(lb,id,n,cur,pre){
  let h='<div class="crow"><label>'+lb+':</label><select id="'+id+'">';
  for(let i=0;i<n;i++) h+='<option value="'+i+'"'+(cur===i?' selected':'')+'>'+pre+' '+i+'</option>';
  return h+'</select></div>';
}
function sldRow(lb,id,v,mn,mx,st){
  return '<div class="crow"><label>'+lb+':</label><input type="range" id="'+id+'" min="'+mn+'" max="'+mx+'" step="'+st+'" value="'+v+'"><span class="rv" id="'+id+'v">'+v.toFixed(2)+'</span></div>';
}
function barRow(lb,v,cls){
  const pct=Math.abs(v)*50;
  const left=v<0?50-pct:50;
  return '<div class="brow"><span class="lbl">'+lb+'</span><div class="btrk"><div class="bfill '+cls+'" style="width:'+pct+'%;margin-left:'+left+'%"></div></div><span class="val">'+v.toFixed(3)+'</span></div>';
}
function wSel(id,cb){const e=$(id);if(e)e.onchange=()=>cb(e.value);}
function wSld(id,cb){const e=$(id);if(e)e.oninput=()=>{const v=parseFloat(e.value);cb(v);const ve=$(id+'v');if(ve)ve.textContent=v.toFixed(2);};}

// ─── CALIBRATION ────────────────────────────
let calStep=0,calD={};
function startCal(){calStep=0;calD={};showScr('cal');updCal();}
function updCal(){
  const steps=[
    'Passo 1/7\nSolte o joystick e deixe no CENTRO.\nClique "Próximo".',
    'Passo 2/7\nMova totalmente para a ESQUERDA.\nSegure e clique "Próximo".',
    'Passo 3/7\nMova totalmente para a DIREITA.\nSegure e clique "Próximo".',
    'Passo 4/7\nEMPURRE o manche totalmente PARA FRENTE.\nO nariz deverá DESCER.\nSegure e clique "Próximo".',
    'Passo 5/7\nPUXE o manche totalmente PARA TRÁS.\nO nariz deverá SUBIR.\nSegure e clique "Próximo".',
    'Passo 6/7\nPressione o BOTÃO de disparo.\nClique "Próximo".',
    'Passo 7/7\nCalibração pronta!\nClique "Salvar".'
  ];
  const tx=$('cal-text');if(tx)tx.textContent=steps[Math.min(calStep,6)];
  const nb=$('btn-cal-next');if(nb)nb.textContent=calStep>=6?'Salvar':'Próximo';
  const gp=getGP();
  const vz=$('cal-viz');
  if(vz&&gp){
    const rx=gp.axes[ctrl.steerAxis]||0,ry=gp.axes[ctrl.pitchAxis]||0;
    let btn='—';
    for(let b=0;b<gp.buttons.length;b++) if(gp.buttons[b].pressed){btn='B'+b;break;}
    vz.textContent='X: '+rx.toFixed(3)+'   Y: '+ry.toFixed(3)+'   Botão: '+btn;
  }else if(vz) vz.textContent='Aguardando gamepad...';
}
function nextCal(){
  const gp=getGP();
  if(!gp&&calStep<6) return;
  const rx=gp?(gp.axes[ctrl.steerAxis]||0):0;
  const ry=gp?(gp.axes[ctrl.pitchAxis]||0):0;
  switch(calStep){
    case 0:calD.cX=rx;calD.cY=ry;break;
    case 1:calD.mnX=rx;break;
    case 2:calD.mxX=rx;break;
    case 3:calD.forwardY=ry;break;
    case 4:calD.backY=ry;break;
    case 5:
      if(gp) for(let b=0;b<gp.buttons.length;b++) if(gp.buttons[b].pressed){ctrl.fireBtn=b;break;}
      break;
    case 6:
      ctrl.cX=calD.cX??0;ctrl.cY=calD.cY??0;
      ctrl.mnX=Math.min(calD.mnX??-1,calD.mxX??1);
      ctrl.mxX=Math.max(calD.mnX??-1,calD.mxX??1);

      const forwardY=calD.forwardY??-1;
      const backY=calD.backY??1;

      ctrl.mnY=Math.min(forwardY,backY);
      ctrl.mxY=Math.max(forwardY,backY);

      // Detecta qual polaridade elétrica corresponde a puxar o manche.
      // Depois desta linha, puxar para trás SEMPRE será pitch positivo.
      ctrl.pitchPullSign=(backY-ctrl.cY)>=0?1:-1;

      // A calibração já resolveu a polaridade.
      ctrl.invY=false;
      ctrl.configVersion=481;

      saveCtrl();showCtrl();return;
  }
  calStep++;updCal();
}
function saveCtrl(){try{localStorage.setItem('skyCtrl_v481',JSON.stringify(ctrl));}catch(e){}}
function loadCtrl(){
  // Não reutiliza a configuração antiga "skyCtrl":
  // ela podia carregar um "Inverter Y" salvo e desfazer a correção.
  try{
    const s=localStorage.getItem('skyCtrl_v481');
    if(s) Object.assign(ctrl,JSON.parse(s));
  }catch(e){}
  ctrl.gpIdx=null;
  ctrl.configVersion=481;
}


function formatMissionTime(sec){
  sec=Math.max(0,Math.floor(sec||0));
  const h=Math.floor(sec/3600);
  const m=Math.floor((sec%3600)/60);
  const s=sec%60;
  const mm=String(m).padStart(2,'0');
  const ss=String(s).padStart(2,'0');
  return h>0 ? String(h).padStart(2,'0')+':'+mm+':'+ss : mm+':'+ss;
}

function setCinematicCaption(title,sub){
  const el=$('cinematic-caption');
  if(!el)return;
  if(!title){
    el.classList.add('hidden');
    return;
  }
  el.innerHTML='<strong>'+title+'</strong>'+(sub?'<span>'+sub+'</span>':'');
  el.classList.remove('hidden');
}

// ─── SCREENS / FLOW ─────────────────────────
const SCREENS=['main-menu','ctrl-screen','cal-screen','howto-screen','pause-screen','over-screen'];
function showScr(s){
  for(const id of SCREENS){const e=$(id);if(e)e.classList.add('hidden');}
  const map={menu:'main-menu',ctrl:'ctrl-screen',cal:'cal-screen',howto:'howto-screen',pause:'pause-screen',over:'over-screen'};
  if(map[s]){const e=$(map[s]);if(e)e.classList.remove('hidden');}
  if(s==='menu'){
    gameState='menu';
    $('hud').classList.add('hidden');
    const best=localStorage.getItem('skyBest');
    if(best)$('menu-record').textContent='RECORDE: '+best+' PONTOS';
  }
}

function startGame(){
  for(const en of enemies)scene.remove(en.group);
  enemies=[];
  for(const b of bullets)scene.remove(b.g);
  bullets=[];
  for(const ms of missiles)scene.remove(ms.g);
  missiles=[];
  for(const p of parts){scene.remove(p.s);if(p.s.material)p.s.material.dispose();}
  parts=[];
  for(const d of debris)scene.remove(d.m);
  debris=[];
  floaters=[];flashes=[];

  resetPlayer();
  score=0;wave=1;kills=0;waitingWave=false;waveTimer=0;camShake=0;hitT=0;
  survivalMode=false;missionWon=false;
  waveCfg=null;waveSpawnPlan=[];waveSpawnIndex=0;
  waveRemainingToSpawn=0;waveMaxActive=0;waveSkill=0;
  reinforcementTimer=0;reinforcementAnnounced=false;

  missionTime=0;finalMissionTime=0;
  returnPhase='none';returnTimer=0;returnLanded=false;returnCaptionShown=false;
  hideCarrierPeople();
  setCinematicCaption(null);

  const surv=$('btn-survival');
  if(surv)surv.classList.add('hidden');
  $('over-title').textContent='ABATIDO';
  $('btn-retry').textContent='Nova Missão';

  showScr('none');
  $('hud').classList.remove('hidden');
  gameState='play';
  spawnWave(wave);
  if(audioCtx&&audioCtx.state==='suspended')audioCtx.resume();
}

function onKey(e){
  if(e.code==='KeyC'&&gameState==='play')camMode=(camMode+1)%3;
  if(e.code==='KeyP'){
    if(gameState==='play'){gameState='paused';showScr('pause');}
    else if(gameState==='paused'){gameState='play';showScr('none');$('hud').classList.remove('hidden');}
  }
  if(e.code==='Escape'&&gameState==='play'){gameState='paused';showScr('pause');}
  if(e.code==='KeyF')toggleFS();
}
function toggleFS(){
  if(!document.fullscreenElement)document.documentElement.requestFullscreen().catch(function(){});
  else document.exitFullscreen();
}

function initMenus(){
  bind('btn-play',startGame);
  bind('btn-controls',showCtrl);
  bind('btn-howto',()=>showScr('howto'));
  bind('btn-fs',toggleFS);
  bind('btn-ctrl-back',()=>{saveCtrl();showScr('menu');});
  bind('btn-cal',startCal);
  bind('btn-cal-next',nextCal);
  bind('btn-cal-cancel',showCtrl);
  bind('btn-howto-back',()=>showScr('menu'));
  bind('btn-resume',()=>{gameState='play';showScr('none');$('hud').classList.remove('hidden');});
  bind('btn-quit',()=>showScr('menu'));
  bind('btn-retry',startGame);
  bind('btn-survival',startSurvival);
  bind('btn-over-menu',()=>showScr('menu'));
}

// ─── MAIN LOOP ──────────────────────────────
function loop(){
  requestAnimationFrame(loop);
  if(!renderer||!scene||!camera)return;
  const dt=Math.min(clock.getDelta(),0.05);
  gTime+=dt*0; // gTime advanced in updateWater

  if(gameState==='play'){
    missionTime+=dt;
    updatePlayer(dt);
    updateEnemies(dt);
    updateBullets(dt);
    updateMissiles(dt);
    updateParts(dt);
    updateDebris(dt);
    updateFlashes(dt);
    updateBoomLights(dt);
    updateWater(dt);
    updateSpeedStreaks(dt);
    updateCamera(dt);
    updateHUD();
    updateRadar();
    drawHudCanvas(dt);

    // sun shadow follows player
    sun.position.set(player.pos.x+500,700,player.pos.z+300);
    sun.target.position.copy(player.pos);
    sun.target.updateMatrixWorld();

    updateWaveReinforcements(dt);

    if(waitingWave){
      waveTimer-=dt;
      if(waveTimer<=0){
        waitingWave=false;
        wave++;
        spawnWave(wave);
      }
    }
  }else if(gameState==='returning'){
    if(!returnLanded)missionTime+=dt;

    updateReturnSequence(dt);
    updateParts(dt);
    updateDebris(dt);
    updateFlashes(dt);
    updateBoomLights(dt);
    updateWater(dt);
    updateSpeedStreaks(dt);

    if(returnPhase!=='celebration'&&returnPhase!=='captain'&&returnPhase!=='done'){
      updateCamera(dt);
      updateHUD();
      updateRadar();
      drawHudCanvas(dt);
    }

    // Sol acompanha o retorno até o porta-aviões.
    sun.position.set(player.pos.x+500,700,player.pos.z+300);
    sun.target.position.copy(player.pos);
    sun.target.updateMatrixWorld();

  }else if(gameState==='over'){
    updateParts(dt);
    updateDebris(dt);
    updateBoomLights(dt);
    updateWater(dt);
    updateSpeedStreaks(dt);
    if(returnPhase!=='done')updateCamera(dt);
  }else{
    updateWater(dt);
    updateSpeedStreaks(dt);
  }

  updateAudio();

  const cs=$('ctrl-screen'),cl=$('cal-screen');
  if(cs&&!cs.classList.contains('hidden'))updateCtrlUI();
  if(cl&&!cl.classList.contains('hidden'))updCal();

  renderer.render(scene,camera);
}

// ─── INIT ───────────────────────────────────
function init(){
  const lb=$('load-bar'),lt=$('load-text');
  if(typeof THREE==='undefined'){
    if(lt)lt.textContent='ERRO: Three.js não carregou. Verifique a internet.';
    if(lb)lb.style.background='#f04438';
    return;
  }
  let prog=0;
  const iv=setInterval(()=>{
    prog+=6+Math.random()*12;
    if(prog>100)prog=100;
    if(lb)lb.style.width=prog+'%';
    if(lt){
      if(prog<30)lt.textContent='Gerando terreno...';
      else if(prog<60)lt.textContent='Montando esquadrão...';
      else if(prog<90)lt.textContent='Armando sistemas...';
      else lt.textContent='Pronto!';
    }
    if(prog>=100){
      clearInterval(iv);
      setTimeout(()=>{$('loading-screen').classList.add('hidden');showScr('menu');},350);
    }
  },70);

  let sceneOk=true;
  try{initScene();}catch(e){
    sceneOk=false;
    console.error('initScene:',e);
    if(lt)lt.textContent='Erro 3D: '+e.message;
    if(lb)lb.style.background='#f04438';
  }
  try{initMenus();}catch(e){console.error('initMenus:',e);}

  if(!sceneOk){
    clearInterval(iv);
    if(lb)lb.style.width='100%';
    return;
  }
  loadCtrl();

  document.addEventListener('click',()=>{
    if(!audioCtx)initAudio();
    else if(audioCtx.state==='suspended')audioCtx.resume();
  });

  if(clock)clock.start();
  requestAnimationFrame(loop);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init();

// ─── PROCEDURAL TEXTURES ────────────────────
function makeDetailTex(){
  const s=256;
  const cv=document.createElement('canvas'); cv.width=cv.height=s;
  const x=cv.getContext('2d');
  x.fillStyle='#b6b6b6'; x.fillRect(0,0,s,s);
  for(let i=0;i<220;i++){
    const g=140+Math.random()*70;
    x.fillStyle='rgba('+g+','+g+','+g+',0.14)';
    x.beginPath();
    x.arc(Math.random()*s,Math.random()*s,6+Math.random()*12,0,7);
    x.fill();
  }
  for(let i=0;i<1700;i++){
    const g=110+Math.random()*110;
    x.fillStyle='rgba('+g+','+g+','+g+',0.32)';
    x.beginPath();
    x.arc(Math.random()*s,Math.random()*s,0.8+Math.random()*2.4,0,7);
    x.fill();
  }
  const t=new THREE.CanvasTexture(cv);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(64,64);
  return t;
}

function makeWaterNormalTex(){
  const s=128;
  const cv=document.createElement('canvas'); cv.width=cv.height=s;
  const x=cv.getContext('2d');
  const img=x.createImageData(s,s);
  const H=(px,py)=>{
    const fx=((px%s)+s)%s*Math.PI*2/s, fy=((py%s)+s)%s*Math.PI*2/s;
    return Math.sin(fx*3)*Math.cos(fy*2)
         + Math.sin(fx*7+1.7)*Math.cos(fy*5)*0.5
         + Math.sin((fx+fy)*4+0.6)*0.35;
  };
  for(let py=0;py<s;py++)for(let px=0;px<s;px++){
    const dx=H(px+1,py)-H(px-1,py);
    const dy=H(px,py+1)-H(px,py-1);
    let nx=-dx*1.5, ny=-dy*1.5, nz=1;
    const l=Math.sqrt(nx*nx+ny*ny+nz*nz); nx/=l; ny/=l; nz/=l;
    const i=(py*s+px)*4;
    img.data[i]=(nx*0.5+0.5)*255;
    img.data[i+1]=(ny*0.5+0.5)*255;
    img.data[i+2]=(nz*0.5+0.5)*255;
    img.data[i+3]=255;
  }
  x.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(cv);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(26,26);
  return t;
}

function makeCloudTex(){
  const s=256;
  const cv=document.createElement('canvas'); cv.width=cv.height=s;
  const x=cv.getContext('2d');
  for(let i=0;i<13;i++){
    const px=s*0.2+Math.random()*s*0.6;
    const py=s*0.3+Math.random()*s*0.4;
    const r=34+Math.random()*58;
    const g=x.createRadialGradient(px,py,0,px,py,r);
    g.addColorStop(0,'rgba(255,255,255,0.75)');
    g.addColorStop(0.6,'rgba(255,255,255,0.28)');
    g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g;
    x.fillRect(0,0,s,s);
  }
  return new THREE.CanvasTexture(cv);
}


// ─── PORTA-AVIÕES V5.1 ──────────────────────
function makeHumanFigure(bodyColor,capColor){
  const g=new THREE.Group();

  const uniform=new THREE.MeshStandardMaterial({color:bodyColor,roughness:0.85});
  const dark=new THREE.MeshStandardMaterial({color:0x20252b,roughness:0.9});
  const skin=new THREE.MeshStandardMaterial({color:0xc98f68,roughness:0.9});
  const capM=new THREE.MeshStandardMaterial({color:capColor||0x26384a,roughness:0.8});

  const legL=new THREE.Mesh(new THREE.BoxGeometry(0.38,1.5,0.42),dark);
  const legR=legL.clone();
  legL.position.set(-0.27,0.75,0);
  legR.position.set(0.27,0.75,0);
  g.add(legL,legR);

  const torso=new THREE.Mesh(new THREE.BoxGeometry(1.18,1.7,0.66),uniform);
  torso.position.y=2.25;
  g.add(torso);

  const head=new THREE.Mesh(new THREE.SphereGeometry(0.42,10,8),skin);
  head.position.y=3.55;
  g.add(head);

  const cap=new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.45,0.20,10),capM);
  cap.position.y=3.90;
  g.add(cap);

  const mkArm=(side)=>{
    const pivot=new THREE.Group();
    pivot.position.set(side*0.72,2.90,0);
    const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.18,1.45,7),uniform);
    arm.position.y=-0.72;
    pivot.add(arm);
    g.add(pivot);
    return pivot;
  };
  const armL=mkArm(-1);
  const armR=mkArm(1);

  g.userData.armL=armL;
  g.userData.armR=armR;
  g.userData.phase=Math.random()*Math.PI*2;
  g.scale.setScalar(1.15);
  return g;
}

function buildAircraftCarrier(){
  carrierGroup=new THREE.Group();
  carrierGroup.position.set(CARRIER_X,CARRIER_GROUP_Y,CARRIER_Z);

  const hullM=new THREE.MeshStandardMaterial({color:0x4d5962,roughness:0.70,metalness:0.42});
  const hullDark=new THREE.MeshStandardMaterial({color:0x28333d,roughness:0.78,metalness:0.30});
  const deckM=new THREE.MeshStandardMaterial({color:0x4b5054,roughness:0.84,metalness:0.18});

  // Casco principal
  const hull=new THREE.Mesh(new THREE.BoxGeometry(40,8.5,275),hullM);
  hull.position.y=1.6;
  hull.castShadow=true;
  hull.receiveShadow=true;
  carrierGroup.add(hull);

  // Proa ligeiramente afunilada
  const bow=new THREE.Mesh(new THREE.ConeGeometry(22,56,4),hullM);
  bow.rotation.x=Math.PI/2;
  bow.rotation.z=Math.PI/4;
  bow.position.set(0,2.0,-158);
  bow.scale.x=0.92;
  carrierGroup.add(bow);

  // Convés
  const deck=new THREE.Mesh(new THREE.BoxGeometry(54,2.2,318),deckM);
  deck.position.y=5.9;
  deck.receiveShadow=true;
  carrierGroup.add(deck);

  // Convés de voo com marcações
  const cv=document.createElement('canvas');
  cv.width=256; cv.height=1024;
  const x=cv.getContext('2d');
  x.fillStyle='#454b4e';x.fillRect(0,0,256,1024);
  x.strokeStyle='#e5e5d9';x.lineWidth=5;
  x.strokeRect(18,12,220,1000);
  x.setLineDash([32,28]);
  x.beginPath();x.moveTo(108,15);x.lineTo(108,1010);x.stroke();
  x.setLineDash([]);
  x.strokeStyle='#e6c84f';x.lineWidth=5;
  x.beginPath();x.moveTo(72,65);x.lineTo(72,960);x.stroke();
  x.fillStyle='#e5e5d9';
  x.font='700 70px Arial';
  x.fillText('71',150,150);
  const deckTex=new THREE.CanvasTexture(cv);

  const flightDeck=new THREE.Mesh(
    new THREE.PlaneGeometry(48,304),
    new THREE.MeshStandardMaterial({map:deckTex,roughness:0.88})
  );
  flightDeck.rotation.x=-Math.PI/2;
  flightDeck.position.set(-5,7.02,0);
  carrierGroup.add(flightDeck);

  // Ilha
  const island=new THREE.Mesh(new THREE.BoxGeometry(13,18,42),hullDark);
  island.position.set(18,15,-30);
  island.castShadow=true;
  carrierGroup.add(island);

  const bridge=new THREE.Mesh(
    new THREE.BoxGeometry(16,5.5,20),
    new THREE.MeshStandardMaterial({color:0x57636b,roughness:0.48,metalness:0.38})
  );
  bridge.position.set(18,25,-28);
  bridge.castShadow=true;
  carrierGroup.add(bridge);

  const glass=new THREE.Mesh(
    new THREE.BoxGeometry(16.3,2.0,20.3),
    new THREE.MeshPhysicalMaterial({
      color:0x7da5b8,transparent:true,opacity:0.70,
      roughness:0.12,metalness:0.16
    })
  );
  glass.position.set(18,26,-28);
  carrierGroup.add(glass);

  const mast=new THREE.Mesh(new THREE.CylinderGeometry(0.7,1.0,18,8),hullDark);
  mast.position.set(18,36,-28);
  carrierGroup.add(mast);

  // Jatos estacionados
  for(let i=0;i<2;i++){
    const pj=makeJet(0x66717a,0x35424d,false);
    pj.scale.setScalar(0.82);
    pj.position.set(13,10.7,65-i*58);
    pj.rotation.y=Math.PI;
    if(pj.userData.flame)pj.userData.flame.visible=false;
    if(pj.userData.flameCore)pj.userData.flameCore.visible=false;
    carrierGroup.add(pj);
  }

  // Equipe de convés — escondida até o retorno final.
  const crewColors=[0xe6c52e,0x3c9c56,0xd84e42,0xe6c52e,0x4d8fc8,0x3c9c56,0xe6c52e,0xd84e42,0x4d8fc8,0xe6c52e,0x3c9c56,0xe6c52e];
  const crewPos=[
    [-21,48],[-18,28],[-21,7],[-18,-14],[-21,-38],[-18,-62],
    [14,78],[12,54],[13,25],[12,3],[12,-55],[11,-82]
  ];
  carrierCrew=[];
  for(let i=0;i<crewPos.length;i++){
    const person=makeHumanFigure(crewColors[i],0xf3f0d0);
    person.position.set(crewPos[i][0],7.05,crewPos[i][1]);
    person.rotation.y=(i<6)?-Math.PI/2:Math.PI/2;
    person.visible=false;
    person.userData.baseY=person.position.y;
    carrierGroup.add(person);
    carrierCrew.push(person);
  }

  // Capitão e piloto para a cena de cumprimento.
  captainFigure=makeHumanFigure(0x203853,0xffffff);
  captainFigure.position.set(-13,7.05,-28);
  captainFigure.rotation.y=Math.PI/2;
  captainFigure.visible=false;
  carrierGroup.add(captainFigure);

  pilotFigure=makeHumanFigure(0x4f6546,0x354735);
  pilotFigure.position.set(-7,7.05,-28);
  pilotFigure.rotation.y=-Math.PI/2;
  pilotFigure.visible=false;
  carrierGroup.add(pilotFigure);

  scene.add(carrierGroup);
}

function hideCarrierPeople(){
  for(const c of carrierCrew)c.visible=false;
  if(captainFigure)captainFigure.visible=false;
  if(pilotFigure)pilotFigure.visible=false;
}

function animateCarrierCrew(t){
  for(const c of carrierCrew){
    c.visible=true;
    const p=c.userData.phase||0;
    c.position.y=c.userData.baseY+Math.abs(Math.sin(t*4.8+p))*0.22;
    if(c.userData.armL)c.userData.armL.rotation.z=2.45+Math.sin(t*6.2+p)*0.36;
    if(c.userData.armR)c.userData.armR.rotation.z=-2.45-Math.sin(t*5.7+p)*0.36;
  }
}

function animateCaptainGreeting(t){
  if(!captainFigure||!pilotFigure)return;
  captainFigure.visible=true;
  pilotFigure.visible=true;

  // Braços de cumprimento se aproximam como um aperto de mão.
  if(captainFigure.userData.armR){
    captainFigure.userData.armR.rotation.z=-1.28+Math.sin(t*2.1)*0.05;
    captainFigure.userData.armR.rotation.x=-0.15;
  }
  if(pilotFigure.userData.armL){
    pilotFigure.userData.armL.rotation.z=1.28-Math.sin(t*2.1)*0.05;
    pilotFigure.userData.armL.rotation.x=-0.15;
  }
}

function carrierWorldPoint(localX,y,localZ){
  return new THREE.Vector3(
    CARRIER_X+localX,
    y,
    CARRIER_Z+localZ
  );
}

// ─── AIRBASE (cenário) ──────────────────────
function buildAirbase(){
  const bx=-70, bz=-380;
  const by=terrH(bx,bz);
  const base=new THREE.Group();
  base.position.set(bx,by,bz);

  // Plataforma de concreto
  const conc=new THREE.MeshStandardMaterial({color:0x8f9296,roughness:0.85});
  const plat=new THREE.Mesh(new THREE.BoxGeometry(320,2,110),conc);
  plat.position.y=1;
  plat.receiveShadow=true;
  base.add(plat);

  // Pista com textura (faixa central tracejada + cabeceiras)
  const rc=document.createElement('canvas'); rc.width=128; rc.height=512;
  const rx=rc.getContext('2d');
  rx.fillStyle='#33363a'; rx.fillRect(0,0,128,512);
  rx.fillStyle='#d8d8d8';
  for(let y=20;y<492;y+=44) rx.fillRect(60,y,8,26);       // tracejado central
  for(let i=0;i<6;i++){ rx.fillRect(12+i*10,4,6,26); rx.fillRect(12+i*10,482,6,26); } // cabeceiras
  rx.fillRect(2,0,4,512); rx.fillRect(122,0,4,512);        // bordas
  const rTex=new THREE.CanvasTexture(rc);
  const runway=new THREE.Mesh(
    new THREE.PlaneGeometry(34,280),
    new THREE.MeshStandardMaterial({map:rTex,roughness:0.9})
  );
  runway.rotation.x=-Math.PI/2;
  runway.rotation.z=Math.PI/2;
  runway.position.y=2.06;
  runway.receiveShadow=true;
  base.add(runway);

  // Hangares em arco
  const hangM=new THREE.MeshStandardMaterial({color:0x6d7278,roughness:0.5,metalness:0.35});
  for(const hx of[-90,-30]){
    const arch=new THREE.Mesh(new THREE.CylinderGeometry(13,13,30,14,1,false,0,Math.PI),hangM);
    arch.rotation.z=Math.PI/2;
    arch.rotation.y=Math.PI/2;
    arch.position.set(hx,2,38);
    arch.castShadow=true;
    base.add(arch);
    const back=new THREE.Mesh(new THREE.CircleGeometry(13,14,0,Math.PI),hangM);
    back.position.set(hx-15,2,38);
    back.rotation.y=-Math.PI/2;
    base.add(back);
  }

  // Torre de controle
  const tower=new THREE.Mesh(new THREE.CylinderGeometry(3,3.6,24,10),conc);
  tower.position.set(120,14,40);
  tower.castShadow=true;
  base.add(tower);
  const cab=new THREE.Mesh(new THREE.BoxGeometry(11,5,11),
    new THREE.MeshStandardMaterial({color:0x3a4048,roughness:0.4,metalness:0.4}));
  cab.position.set(120,28.5,40);
  cab.castShadow=true;
  base.add(cab);
  const cabGlass=new THREE.Mesh(new THREE.BoxGeometry(11.2,2.2,11.2),
    new THREE.MeshPhysicalMaterial({color:0x7fd0f0,roughness:0.08,metalness:0.2,transparent:true,opacity:0.7}));
  cabGlass.position.set(120,29,40);
  base.add(cabGlass);

  // Jatos estacionados
  for(let i=0;i<3;i++){
    const pj=makeJet(0x71767d,0x4c5158,false);
    pj.scale.setScalar(0.95);
    pj.position.set(-100+i*38,3.2,-32);
    pj.rotation.y=0.35+i*0.12;
    if(pj.userData.flame) pj.userData.flame.visible=false;
    base.add(pj);
  }

  scene.add(base);
}

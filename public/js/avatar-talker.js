/**
 * Avatar Talker — WebGL talking avatar with x.ai lip-sync
 *
 * Flow:
 *  1. User holds 🎤 → MediaRecorder captures audio
 *  2. Audio blob → /wp-admin/admin-ajax.php?action=at_stt → transcript
 *  3. Transcript → at_chat → Grok reply text
 *  4. Reply text → at_tts → MP3 base64
 *  5. MP3 decoded by Web Audio API → AnalyserNode drives amplitude
 *  6. Amplitude mapped to ARKit viseme morphs on GLB meshes in real-time
 *     (jawOpen + phoneme estimation from amplitude envelope)
 *  7. Auto-blink, idle breathing, eye movement run independently
 */
(function () {
'use strict';

/* ══════════════════════════════════════════════════
   VISEME MAP  (ARKit names that exist in the GLB)
   We drive these morphs from audio amplitude + phoneme estimation
══════════════════════════════════════════════════ */

// These all exist on Head_Mesh, Teeth_Mesh, Tongue_Mesh
const VISEME_MORPHS = [
  'viseme_sil',   // silence / mouth closed
  'viseme_PP',    // p, b, m
  'viseme_FF',    // f, v
  'viseme_TH',    // th
  'viseme_DD',    // d, t, n
  'viseme_kk',    // k, g
  'viseme_CH',    // ch, sh, j
  'viseme_SS',    // s, z
  'viseme_nn',    // n (nasal)
  'viseme_RR',    // r
  'viseme_aa',    // "ah" — widest open
  'viseme_E',     // "eh"
  'viseme_I',     // "ih"
  'viseme_O',     // "oh"
  'viseme_U',     // "oo"
];

// Phoneme-to-viseme map for text-based fallback animation
const PHONEME_VISEME = {
  ' ':  'viseme_sil',
  '.':  'viseme_sil', ',': 'viseme_sil', '!': 'viseme_sil', '?': 'viseme_sil',
  'p':  'viseme_PP', 'b': 'viseme_PP', 'm': 'viseme_PP',
  'f':  'viseme_FF', 'v': 'viseme_FF',
  'θ':  'viseme_TH', 'ð': 'viseme_TH',
  'd':  'viseme_DD', 't': 'viseme_DD', 'n': 'viseme_DD',
  'k':  'viseme_kk', 'g': 'viseme_kk',
  'ʃ':  'viseme_CH', 'ʒ': 'viseme_CH', 'tʃ': 'viseme_CH',
  's':  'viseme_SS', 'z': 'viseme_SS',
  'r':  'viseme_RR',
  'a':  'viseme_aa', 'æ': 'viseme_aa',
  'e':  'viseme_E',
  'i':  'viseme_I',
  'o':  'viseme_O',
  'u':  'viseme_U',
};

// Letter → rough phoneme (English approximation for text-driven anim)
const LETTER_PHONEME = {
  a:'a', e:'e', i:'i', o:'o', u:'u',
  b:'b', c:'k', d:'d', f:'f', g:'g', h:' ', j:'ʃ', k:'k',
  l:'d', m:'m', n:'n', p:'p', q:'k', r:'r', s:'s', t:'t',
  v:'v', w:'u', x:'k', y:'i', z:'z',
};

/* ══════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════ */
const CFG = typeof AT_CFG !== 'undefined' ? AT_CFG : {};

const S = {
  // conversation
  history:       [],   // [{role,content}]
  isRecording:   false,
  isProcessing:  false,
  isSpeaking:    false,
  avatarName:    CFG.avatar_name || 'Aria',
  language:      CFG.language    || 'en',

  // 3D
  idleTime:      0,
  blinkTimer:    2.5,
  blinkPhase:    'open',
  blinkVal:      0,

  // viseme animation
  currentViseme: 'viseme_sil',
  visemeTarget:  {},
  visemeSmooth:  {},   // smoothed current values for lerping
  amplitude:     0,    // 0..1 from audio analyser
  amplitudeSmooth: 0,
  speakTime:     0,
  textQueue:     [],   // characters for text-driven fallback
  textTimer:     0,
};

// Init viseme smooth values
VISEME_MORPHS.forEach(v => { S.visemeSmooth[v] = 0; S.visemeTarget[v] = 0; });

/* ══════════════════════════════════════════════════
   THREE.JS ENGINE
══════════════════════════════════════════════════ */
let scene, camera, renderer, controls, clock;
let gltfScene   = null;
let meshMap     = {};
let matMap      = {};
let boneMap     = {};
let mixer       = null; 

// Web Audio
let audioCtx    = null;
let analyser    = null;
let analyserBuf = null;
let audioSource = null;

function initScene(container) {
  clock = new THREE.Clock();

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputEncoding    = THREE.sRGBEncoding;
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.physicallyCorrectLights = true;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c14);
  scene.fog = new THREE.FogExp2(0x0a0c14, 0.06);

  camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.01, 20);
  camera.position.set(0, 1.65, 0.72);  // face close-up default

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.62, 0);
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.08;
  controls.minDistance     = 0.3;
  controls.maxDistance     = 3.5;
  controls.maxPolarAngle   = Math.PI * 0.85;
  controls.update();


  /* Lighting — soft portrait / studio style */
  // INCREASED: Boost base ambient light to softly illuminate shadow areas everywhere
  scene.add(new THREE.AmbientLight(0xfff4e0, 0.65));

  // MODIFIED: Lowered intensity, adjusted angle slightly closer to camera axis to minimize deep side shadows
  const key = new THREE.DirectionalLight(0xfff8f0, 1.4);
  key.position.set(0.5, 2.0, 1.8); 
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near  = 0.5; key.shadow.camera.far = 8;
  key.shadow.camera.left  = key.shadow.camera.bottom = -1;
  key.shadow.camera.right = key.shadow.camera.top    =  1;
  
  // ADJUSTED: Increase shadow bias slightly to prevent artifacting, and soften shadow maps if needed
  key.shadow.bias = -0.0005; 
  scene.add(key);

  // INCREASED: Stronger fill light from the opposite side to actively eliminate dark face shadows
  const fill = new THREE.DirectionalLight(0xb0ccff, 0.95);
  fill.position.set(-1.5, 1.2, 0.8);
  scene.add(fill);

  // OPTIONAL: Slightly boosted rim/bounce lights to separate the avatar cleanly from the dark background
  const rim = new THREE.DirectionalLight(0xffffff, 0.45);
  rim.position.set(0, 2, -2);
  scene.add(rim);

  const bounce = new THREE.PointLight(0xffe8cc, 0.45, 3);
  bounce.position.set(0, 0.2, 0.9);
  scene.add(bounce);

  const hairRim = new THREE.PointLight(0xd8c0ff, 0.45, 4);
  hairRim.position.set(0, 2.6, -1.2);
  scene.add(hairRim);

  /* Floor */
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2, 48),
    new THREE.MeshStandardMaterial({ color: 0x131520, roughness: 0.95, metalness: 0.02 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  loadAvatar();
  animate();
}

/* ── Avatar GLB ── */
function loadAvatar() {
  const url = CFG.avatar_url;
  if (!url) { console.error('AT: No avatar URL'); return; }

  const loader = new THREE.GLTFLoader();
  const draco  = new THREE.DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  loader.setDRACOLoader(draco);

  loader.load(url,
    gltf => {
      gltfScene = gltf.scene;
      gltfScene.traverse(obj => {
      	
        // ── AVATURN DIRECT X-AXIS DOWN FIX (OPTIMIZED) ──
      /*const leftArm  = boneMap['LeftArm'];
      const rightArm = boneMap['RightArm'];

      if (leftArm) {
          // Clear any accidental Z/Y twists
          leftArm.rotation.set(0, 0, 0); 
          
          // The perfect vertical angle
          leftArm.rotation.x = 1.55; 
          
          // Reduced from 0.15 to 0.05 to bring the arm closer to the body
          leftArm.rotation.y = 0.05; 
      }
      
      if (rightArm) {
          rightArm.rotation.set(0, 0, 0);
          
          // Mirror the down rotation on the right side
          rightArm.rotation.x = 1.55; 
          
          // Reduced from -0.15 to -0.05 to bring the arm closer to the body
          rightArm.rotation.y = -0.05;
      }*/
      
        obj.castShadow = obj.receiveShadow = true;
        if (obj.isMesh || obj.isSkinnedMesh) {
          obj.frustumCulled = false;  // prevent disappearing when camera zooms close
          obj.material = Array.isArray(obj.material)
            ? obj.material.map(m => { const c = m.clone(); c.vertexColors = false; return c; })
            : (() => { const c = obj.material.clone(); c.vertexColors = false; return c; })();
          meshMap[obj.name] = obj;
          matMap[obj.name]  = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        }
        if (obj.isBone) boneMap[obj.name] = obj;
      });

      scene.add(gltfScene);

// Start the mixer ONLY if there are animations, but strip all morph tracks
// so blink and viseme morphs are never overwritten
if (gltf.animations && gltf.animations.length > 0) {
  mixer = new THREE.AnimationMixer(gltfScene);

  // Clone first animation, remove any morph influence tracks
  const clip = gltf.animations[0].clone();
  clip.tracks = clip.tracks.filter(track => {
    // Skip tracks that drive .morphTargetInfluences
    return !track.name.includes('.morphTargetInfluences');
  });

  if (clip.tracks.length > 0) {
    const action = mixer.clipAction(clip);
    action.play();
  }
}

      // Zero all morphs (clear any baked-in values)
      Object.values(meshMap).forEach(mesh => {
        if (mesh.morphTargetInfluences) {
          for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
            mesh.morphTargetInfluences[i] = 0;
          }
        }
      });

      // Hide loader
      document.getElementById('at-loader')?.remove();
      document.getElementById('at-ui')?.classList.remove('at-hidden');
    },
    xhr => {
      const el = document.getElementById('at-loader-pct');
      if (el && xhr.total) el.textContent = Math.round(xhr.loaded / xhr.total * 100) + '%';
    },
    err => { console.error('AT: GLB load failed', err); }
  );
}

/* ══════════════════════════════════════════════════
   MORPH / VISEME ENGINE
══════════════════════════════════════════════════ */

function setMorphOnAllMeshes(name, val) {
  Object.values(meshMap).forEach(mesh => {
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    const idx = mesh.morphTargetDictionary[name];
    if (idx !== undefined) mesh.morphTargetInfluences[idx] = val;
  });
}

// Set a target viseme — smooth lerping happens in the animate loop
function setVisemeTarget(visemeName, strength) {
  VISEME_MORPHS.forEach(v => { S.visemeTarget[v] = 0; });
  if (visemeName && S.visemeTarget[visemeName] !== undefined) {
    S.visemeTarget[visemeName] = strength;
  }
  // Always set jaw open proportional to amplitude
  S.visemeTarget['jawOpen'] = S.amplitude * 0.7;
  S.visemeTarget['mouthOpen'] = S.amplitude * 0.5;
}

// Called every frame — lerp viseme smooth values toward targets
function updateVisemes(delta) {
  const lerpSpeed = 18;   // how fast morphs track target
  const lerpD     = 1 - Math.exp(-lerpSpeed * delta);

  VISEME_MORPHS.forEach(v => {
    S.visemeSmooth[v] = S.visemeSmooth[v] + (S.visemeTarget[v] - S.visemeSmooth[v]) * lerpD;
    setMorphOnAllMeshes(v, S.visemeSmooth[v]);
  });

  // jaw + mouth driven directly by amplitude (faster response)
  const jawLerp = 1 - Math.exp(-24 * delta);
  const jawSmooth = (S.visemeSmooth['jawOpen'] || 0) + ((S.amplitude * 0.75) - (S.visemeSmooth['jawOpen'] || 0)) * jawLerp;
  setMorphOnAllMeshes('jawOpen',   jawSmooth);
  setMorphOnAllMeshes('mouthOpen', S.amplitude * 0.5);
}

/* ══════════════════════════════════════════════════
   AUDIO ANALYSER — amplitude → viseme
══════════════════════════════════════════════════ */

function initAudioContext() {
  if (audioCtx) return;
  audioCtx    = new (window.AudioContext || window.webkitAudioContext)();
  analyser    = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyserBuf = new Uint8Array(analyser.frequencyBinCount);
}

function readAmplitude() {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(analyserBuf);
  let sum = 0;
  for (let i = 0; i < analyserBuf.length; i++) {
    const v = (analyserBuf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / analyserBuf.length);
}

// Play TTS audio and drive visemes from amplitude
async function playTTSAudio(base64mp3, replyText) {
  initAudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  // Decode MP3
  const bytes   = Uint8Array.from(atob(base64mp3), c => c.charCodeAt(0));
  const decoded = await audioCtx.decodeAudioData(bytes.buffer);

  if (audioSource) {
    try { audioSource.stop(); } catch(e) {}
    audioSource = null;
  }

  audioSource = audioCtx.createBufferSource();
  audioSource.buffer = decoded;
  audioSource.connect(analyser);
  analyser.connect(audioCtx.destination);
  audioSource.start(0);

  S.isSpeaking  = true;
  S.speakTime   = 0;
  S.textQueue   = replyText.toLowerCase().split('');
  S.textTimer   = 0;

  audioSource.onended = () => {
    S.isSpeaking   = false;
    S.amplitude    = 0;
    setVisemeTarget('viseme_sil', 1);
    updateUI('idle');
  };
}

/* ══════════════════════════════════════════════════
   BLINK SYSTEM
══════════════════════════════════════════════════ */
function updateBlink(delta) {
  S.blinkTimer -= delta;
  if      (S.blinkPhase === 'open'    && S.blinkTimer <= 0) {
    S.blinkPhase = 'closing'; S.blinkTimer = 0.06; S.blinkVal = 0;
  }
  else if (S.blinkPhase === 'closing') {
    S.blinkVal = 1 - S.blinkTimer / 0.06;
    if (S.blinkTimer <= 0) { S.blinkPhase = 'opening'; S.blinkTimer = 0.10; S.blinkVal = 1; }
  }
  else if (S.blinkPhase === 'opening') {
    S.blinkVal = S.blinkTimer / 0.10;
    if (S.blinkTimer <= 0) { S.blinkPhase = 'open'; S.blinkTimer = 2.0 + Math.random() * 3.5; S.blinkVal = 0; }
  }
  const bv = Math.max(0, Math.min(1, S.blinkVal));
  ['eyeBlinkLeft','eyeBlinkRight','eyesClosed'].forEach((m, i) => {
    setMorphOnAllMeshes(m, i < 2 ? bv : bv * 0.5);
  });
}

/* ══════════════════════════════════════════════════
   ANIMATE LOOP
══════════════════════════════════════════════════ */
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  S.idleTime += delta;

  controls.autoRotate = false;
  controls.update();
  if (mixer) mixer.update(delta); 
  updateBlink(delta);

  /* ── Audio amplitude → viseme ── */
  if (S.isSpeaking && analyser) {
    S.speakTime += delta;
    
    // Get the raw, boosted amplitude
    const rawAmplitude = Math.min(1.4, readAmplitude() * 10); 
    
    // CHANGE: Filter out high-frequency jitters (lower factor = smoother, slower)
    const filterSpeed = 10; // Adjust between 8 (slower/smoother) and 15 (faster)
    S.amplitudeSmooth += (rawAmplitude - S.amplitudeSmooth) * (1 - Math.exp(-filterSpeed * delta));
    
    // Assign it back to S.amplitude so the rest of your logic uses the stable value
    S.amplitude = S.amplitudeSmooth;
    
    //S.amplitude  = Math.min(1, readAmplitude() * 10);  // scale 0..1

    // Text-driven phoneme viseme (runs alongside amplitude)
    S.textTimer -= delta;
    if (S.textTimer <= 0 && S.textQueue.length > 0) {
      const ch     = S.textQueue.shift();
      const phon   = LETTER_PHONEME[ch] || ' ';
      const vis    = PHONEME_VISEME[phon] || 'viseme_aa';
      const str    = S.amplitude > 0.05 ? Math.min(1, S.amplitude * 2.5) : 0;
      setVisemeTarget(vis, str);
      // speaking rate: ~12 chars/sec at normal pace
      S.textTimer = 0.072 + Math.random() * 0.02;
    } else if (S.textQueue.length === 0) {
      // Pure amplitude-driven when text queue empty
      const vis = S.amplitude > 0.15 ? 'viseme_aa'
                : S.amplitude > 0.08 ? 'viseme_E'
                : 'viseme_sil';
      setVisemeTarget(vis, Math.min(1, S.amplitude * 2));
    }
  } else {
    // Idle: slowly close mouth to silence
    S.amplitude = Math.max(0, S.amplitude - delta * 4);
    setVisemeTarget('viseme_sil', 1 - S.amplitude);
  }

  updateVisemes(delta);

  /* ── Idle bone animation ── */
  if (gltfScene) {
    const t = S.idleTime;
    // Breathing
    if (boneMap['Spine2']) {
      boneMap['Spine2'].rotation.z = Math.sin(t * 0.9) * 0.005;
      boneMap['Spine2'].rotation.x = Math.sin(t * 0.8) * 0.003;
    }
    // Head micro-movement (look slightly alive)
    if (boneMap['Neck']) {
      boneMap['Neck'].rotation.y = Math.sin(t * 0.32) * 0.018;
      boneMap['Neck'].rotation.z = Math.cos(t * 0.48) * 0.008;
    }
    // Subtle eye look-around (using eye bones)
    const eyeX = Math.sin(t * 0.28) * 0.04;
    const eyeY = Math.cos(t * 0.21) * 0.02;
    if (boneMap['LeftEye'])  { boneMap['LeftEye'].rotation.x  = eyeY; boneMap['LeftEye'].rotation.y  = eyeX; }
    if (boneMap['RightEye']) { boneMap['RightEye'].rotation.x = eyeY; boneMap['RightEye'].rotation.y = eyeX; }
    // Slight head tilt when speaking
    if (S.isSpeaking && boneMap['Head']) {
      boneMap['Head'].rotation.z = Math.sin(S.speakTime * 1.2) * 0.015;
    }
  }

  renderer.render(scene, camera);
}

/* ══════════════════════════════════════════════════
   CONVERSATION ENGINE
══════════════════════════════════════════════════ */

let mediaRecorder  = null;
let audioChunks    = [];
let micStream      = null;

async function startRecording() {
  if (S.isRecording || S.isProcessing || S.isSpeaking) return;

  // Stop any playing TTS
  if (audioSource) { try { audioSource.stop(); } catch(e) {} audioSource = null; }
  S.isSpeaking = false;
  S.amplitude  = 0;

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch(e) {
    showError('Microphone access denied. Please allow mic access and try again.');
    return;
  }

  initAudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  
  try { analyser.disconnect(audioCtx.destination); } catch(e) {}

  // Connect mic to analyser for visual feedback while recording
  const micSource = audioCtx.createMediaStreamSource(micStream);
  micSource.connect(analyser);

  audioChunks = [];
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  mediaRecorder = new MediaRecorder(micStream, { mimeType });
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    micSource.disconnect();
    micStream.getTracks().forEach(t => t.stop());
    processAudio(new Blob(audioChunks, { type: mimeType }));
  };

  mediaRecorder.start(100);
  S.isRecording = true;
  updateUI('recording');
}

function stopRecording() {
  if (!S.isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  S.isRecording = false;
  updateUI('processing');
}

async function processAudio(blob) {
  S.isProcessing = true;

  // Show partial transcript placeholder
  addBubble('user', '…');

  // 1. STT
  const sttResult = await ajaxSTT(blob);
  if (!sttResult.ok) {
    removePendingBubble();
    showError('Could not transcribe audio: ' + sttResult.error);
    S.isProcessing = false;
    updateUI('idle');
    return;
  }
  const transcript = sttResult.transcript;
  updatePendingBubble(transcript);

  // 2. Chat
  updateUI('thinking');
  S.history.push({ role: 'user', content: transcript });

  const chatResult = await ajaxChat(transcript, S.history.slice(0,-1));
  if (!chatResult.ok) {
    showError('Chat error: ' + chatResult.error);
    S.isProcessing = false;
    updateUI('idle');
    return;
  }
  const reply = chatResult.reply;
  S.history.push({ role: 'assistant', content: reply });
  addBubble('assistant', reply);

  // 3. TTS
  updateUI('speaking');
  const ttsResult = await ajaxTTS(reply);
  if (!ttsResult.ok) {
    // Still show the text even if TTS fails
    showError('TTS error: ' + ttsResult.error);
    S.isProcessing = false;
    updateUI('idle');
    return;
  }

  S.isProcessing = false;
  await playTTSAudio(ttsResult.audio, reply);
}

/* ── AJAX helpers ── */
async function ajaxSTT(blob) {
  const fd = new FormData();
  fd.append('action', 'at_stt');
  fd.append('nonce',  CFG.nonce || '');
  fd.append('audio',  blob, 'recording.webm');
  try {
    const r = await fetch(CFG.ajax, { method:'POST', body: fd });
    const d = await r.json();
    return d.success ? { ok:true, transcript: d.data.transcript } : { ok:false, error: d.data };
  } catch(e) { return { ok:false, error: e.message }; }
}

async function ajaxChat(message, history) {
  const fd = new FormData();
  fd.append('action',  'at_chat');
  fd.append('nonce',   CFG.nonce || '');
  fd.append('message', message);
  fd.append('history', JSON.stringify(history));
  try {
    const r = await fetch(CFG.ajax, { method:'POST', body: fd });
    const d = await r.json();
    return d.success ? { ok:true, reply: d.data.reply } : { ok:false, error: d.data };
  } catch(e) { return { ok:false, error: e.message }; }
}

async function ajaxTTS(text) {
  const fd = new FormData();
  fd.append('action', 'at_tts');
  fd.append('nonce',  CFG.nonce || '');
  fd.append('text',   text);
  try {
    const r = await fetch(CFG.ajax, { method:'POST', body: fd });
    const d = await r.json();
    return d.success ? { ok:true, audio: d.data.audio } : { ok:false, error: d.data };
  } catch(e) { return { ok:false, error: e.message }; }
}

/* ══════════════════════════════════════════════════
   UI
══════════════════════════════════════════════════ */
function buildUI(root) {
  const name = CFG.avatar_name || 'Aria';
  root.innerHTML = `
    <div class="at-wrap">

      <!-- 3D Viewport -->
      <div class="at-viewport" id="at-vp">
        <div class="at-loader" id="at-loader">
          <div class="at-spinner"></div>
          <div class="at-loader-label">Loading <span id="at-loader-pct"></span></div>
        </div>

        <!-- Status badge -->
        <div class="at-status" id="at-status">
          <span class="at-status-dot" id="at-dot"></span>
          <span id="at-status-text">Ready</span>
        </div>

        <!-- Camera controls -->
        <div class="at-cambtns">
          <button class="at-cambtn" data-cam="face"  title="Face">👤</button>
          <button class="at-cambtn" data-cam="bust"  title="Bust">🧑</button>
          <button class="at-cambtn" data-cam="full"  title="Full body">🧍</button>
        </div>
      </div>

      <!-- Chat panel -->
      <div class="at-panel">

        <!-- Header -->
        <div class="at-header">
          <div class="at-avatar-info">
            <div class="at-avatar-dot"></div>
            <div>
              <div class="at-avatar-name">${esc(name)}</div>
              <div class="at-avatar-sub">AI Avatar · Powered by Grok</div>
            </div>
          </div>
          <button class="at-clear-btn" id="at-clear" title="Clear conversation">🗑</button>
        </div>

        <!-- Chat messages -->
        <div class="at-messages" id="at-messages">
          <div class="at-bubble at-bubble-assistant at-greeting">
            <div class="at-bubble-text">
              👋 Hi! I'm ${esc(name)}. Hold the microphone button and speak to me, or type your message below.
            </div>
          </div>
        </div>

        <!-- Input area -->
        <div class="at-input-area">
          <div class="at-text-row">
            <input class="at-text-input" id="at-text-input"
              placeholder="Or type a message…" type="text" autocomplete="off">
            <button class="at-send-btn" id="at-send" title="Send">➤</button>
          </div>
          <div class="at-mic-row">
            <button class="at-mic-btn" id="at-mic">
              <span class="at-mic-icon">🎤</span>
              <span class="at-mic-label">Hold to speak</span>
            </button>
            <div class="at-wave" id="at-wave">
              ${Array.from({length:20}, (_,i) => `<div class="at-bar" style="animation-delay:${i*0.05}s"></div>`).join('')}
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- Hidden until loaded -->
    <div class="at-hidden" id="at-ui"></div>
  `;

  // Init 3D scene
  initScene(root.querySelector('#at-vp'));
  bindEvents(root);
}

function bindEvents(root) {
  // Mic button — hold to record
  const micBtn = root.querySelector('#at-mic');
  const startRec = async () => { await startRecording(); };
  const stopRec  = () => { stopRecording(); };
  micBtn.addEventListener('mousedown',  startRec);
  micBtn.addEventListener('touchstart', e => { e.preventDefault(); startRec(); }, { passive:false });
  micBtn.addEventListener('mouseup',    stopRec);
  micBtn.addEventListener('mouseleave', () => { if (S.isRecording) stopRec(); });
  micBtn.addEventListener('touchend',   stopRec);
  micBtn.addEventListener('touchcancel',stopRec);

  // Text send
  const textInput = root.querySelector('#at-text-input');
  const sendBtn   = root.querySelector('#at-send');
  const sendText  = async () => {
    const text = textInput.value.trim();
    if (!text || S.isProcessing || S.isSpeaking) return;
    textInput.value = '';
    addBubble('user', text);
    S.history.push({ role:'user', content: text });
    updateUI('thinking');
    S.isProcessing = true;
    const chatResult = await ajaxChat(text, S.history.slice(0,-1));
    if (!chatResult.ok) { showError('Error: ' + chatResult.error); S.isProcessing = false; updateUI('idle'); return; }
    const reply = chatResult.reply;
    S.history.push({ role:'assistant', content: reply });
    addBubble('assistant', reply);
    updateUI('speaking');
    const ttsResult = await ajaxTTS(reply);
    S.isProcessing = false;
    if (ttsResult.ok) await playTTSAudio(ttsResult.audio, reply);
    else { showError('TTS error: ' + ttsResult.error); updateUI('idle'); }
  };
  sendBtn.addEventListener('click', sendText);
  textInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });

  // Clear
  root.querySelector('#at-clear').addEventListener('click', () => {
    S.history = [];
    const msgs = root.querySelector('#at-messages');
    msgs.innerHTML = `<div class="at-bubble at-bubble-assistant at-greeting">
      <div class="at-bubble-text">Conversation cleared. What would you like to talk about?</div>
    </div>`;
  });

  // Camera presets
  root.querySelector('.at-cambtns').addEventListener('click', e => {
    const btn = e.target.closest('[data-cam]');
    if (!btn) return;
    switch(btn.dataset.cam) {
      case 'face': camera.position.set(0,1.65,0.72); controls.target.set(0,1.62,0); break;
      case 'bust': camera.position.set(0,1.35,1.10); controls.target.set(0,1.20,0); break;
      case 'full': camera.position.set(0,0.95,2.50); controls.target.set(0,0.85,0); break;
    }
  });
}

let pendingBubbleEl = null;

function addBubble(role, text) {
  const msgs = document.getElementById('at-messages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = `at-bubble at-bubble-${role}`;
  div.innerHTML = `<div class="at-bubble-text">${esc(text)}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  if (role === 'user') pendingBubbleEl = div;
  return div;
}

function updatePendingBubble(text) {
  if (pendingBubbleEl) {
    pendingBubbleEl.querySelector('.at-bubble-text').textContent = text;
    pendingBubbleEl = null;
  }
}

function removePendingBubble() {
  if (pendingBubbleEl) { pendingBubbleEl.remove(); pendingBubbleEl = null; }
}

const STATUS = {
  idle:       { text:'Ready',       dot:'at-dot-idle' },
  recording:  { text:'Listening…',  dot:'at-dot-rec' },
  processing: { text:'Transcribing…',dot:'at-dot-proc' },
  thinking:   { text:'Thinking…',   dot:'at-dot-think' },
  speaking:   { text:'Speaking…',   dot:'at-dot-speak' },
};

function updateUI(state) {
  const s = STATUS[state] || STATUS.idle;
  const dotEl  = document.getElementById('at-dot');
  const txtEl  = document.getElementById('at-status-text');
  const micBtn = document.getElementById('at-mic');
  const wave   = document.getElementById('at-wave');

  if (dotEl)  { dotEl.className  = 'at-status-dot ' + s.dot; }
  if (txtEl)  { txtEl.textContent = s.text; }

  const isRec = state === 'recording';
  if (micBtn) micBtn.classList.toggle('at-mic-active', isRec);
  if (wave)   wave.classList.toggle('at-wave-active',  isRec || state === 'speaking');
}

function showError(msg) {
  const msgs = document.getElementById('at-messages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'at-error-msg';
  div.textContent = '⚠️ ' + msg;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  setTimeout(() => div.remove(), 6000);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ── Boot ── */
(function boot() {
  const root = document.getElementById('at-root');
  if (!root) return;
  let tries = 0;
  const poll = setInterval(() => {
    const ok = typeof THREE !== 'undefined'
      && THREE.OrbitControls && THREE.GLTFLoader && THREE.DRACOLoader;
    if (ok) { clearInterval(poll); buildUI(root); }
    else if (++tries > 80) {
      clearInterval(poll);
      root.innerHTML = '<p style="color:#f88;padding:20px">Three.js failed to load.</p>';
    }
  }, 100);
})();

})();
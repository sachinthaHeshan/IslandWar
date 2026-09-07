import * as THREE from 'three';

function noise2D(x, y, seed = 0) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
  return n - Math.floor(n);
}

function fbm(x, y, octaves = 4, seed = 0) {
  let v = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise2D(x * freq, y * freq, seed + i * 17.3);
    amp *= 0.5;
    freq *= 2;
  }
  return v;
}

function makeCanvasTexture(draw, size = 256, repeat = 4) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGrassTexture() {
  return makeCanvasTexture((ctx, size) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.04, y * 0.04, 5, 42);
        const blade = fbm(x * 0.2, y * 0.2, 3, 99);
        const r = Math.floor(80 + n * 40 + blade * 20);
        const g = Math.floor(120 + n * 50 + blade * 30);
        const b = Math.floor(50 + n * 25);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    for (let i = 0; i < 800; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.strokeStyle = `rgba(${40 + Math.random() * 30},${90 + Math.random() * 40},${30 + Math.random() * 20},${0.3 + Math.random() * 0.3})`;
      ctx.lineWidth = 0.5 + Math.random();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 2 - Math.random() * 4);
      ctx.stroke();
    }
  });
}

export function createSandTexture() {
  return makeCanvasTexture((ctx, size) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.08, y * 0.08, 4, 7);
        const grain = noise2D(x * 0.5, y * 0.5, 3);
        const r = Math.floor(210 + n * 30 + grain * 15);
        const g = Math.floor(185 + n * 25 + grain * 10);
        const b = Math.floor(130 + n * 20);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

export function createRockTexture() {
  return makeCanvasTexture((ctx, size) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.06, y * 0.06, 5, 55);
        const crack = Math.abs(Math.sin(x * 0.15 + n * 6)) < 0.05 ? 0.85 : 1;
        const v = Math.floor((140 + n * 50) * crack);
        ctx.fillStyle = `rgb(${v},${Math.floor(v * 0.95)},${Math.floor(v * 0.85)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }, 256, 2);
}

export function createWoodTexture() {
  return makeCanvasTexture((ctx, size) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const ring = Math.sin(y * 0.08 + fbm(x * 0.02, y * 0.02, 3, 11) * 3) * 0.5 + 0.5;
        const r = Math.floor(110 + ring * 30);
        const g = Math.floor(85 + ring * 25);
        const b = Math.floor(55 + ring * 15);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }, 256, 2);
}

export function createMetalTexture() {
  return makeCanvasTexture((ctx, size) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.1, y * 0.1, 3, 23);
        const v = Math.floor(70 + n * 40);
        ctx.fillStyle = `rgb(${v},${v + 5},${v + 10})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * size / 6);
      ctx.lineTo(size, i * size / 6 + size * 0.02);
      ctx.stroke();
    }
  }, 256, 2);
}

export function createTerrainMaterial(grassTex, sandTex, radius, centerZ) {
  return new THREE.ShaderMaterial({
    uniforms: {
      grassMap: { value: grassTex },
      sandMap: { value: sandTex },
      repeat: { value: 8 },
      islandRadius: { value: radius },
      centerZ: { value: centerZ },
      beachInner: { value: radius * 0.78 },
      beachOuter: { value: radius * 0.94 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D grassMap;
      uniform sampler2D sandMap;
      uniform float repeat;
      uniform float islandRadius;
      uniform float centerZ;
      uniform float beachInner;
      uniform float beachOuter;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        float dist = length(vWorldPos.xz - vec2(0.0, centerZ));
        float beach = smoothstep(beachInner, beachOuter, dist);
        vec2 texCoord = vWorldPos.xz * repeat / islandRadius;
        vec3 grass = texture2D(grassMap, texCoord).rgb;
        vec3 sand = texture2D(sandMap, texCoord * 1.3).rgb;
        vec3 col = mix(grass, sand, beach);
        float shade = 0.75 + 0.25 * dot(vNormal, normalize(vec3(0.3, 1.0, 0.2)));
        col *= shade;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export function texturedMaterial(map, opts = {}) {
  return new THREE.MeshStandardMaterial({
    map,
    roughness: opts.roughness ?? 0.88,
    metalness: opts.metalness ?? 0,
    color: opts.color ?? 0xffffff,
  });
}

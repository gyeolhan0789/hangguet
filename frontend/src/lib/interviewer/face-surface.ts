import { BufferAttribute, type BufferGeometry, type Mesh } from "three";

// 얼굴 메시의 법선을 최종 표정 모양에서 다시 구한다.
// 기준: 면접관 3D 모델 웹 미리보기(office_animation/web face-surface.js) · WEB_FACE_RESTORE_REPORT.json(법선 오차 0)
// 보정용 셰이프 키는 위치는 서로 상쇄하지만 따로 정규화된 법선 변화는 상쇄되지 않아, 섞인 최종 모양으로 법선을 계산한다.
// 같은 위치 · 같은 원래 법선의 정점은 한 묶음으로 더해 모서리는 살리고 UV · 재질 경계의 이음매는 없앤다.

interface Part {
  mesh: Mesh;
  geometry: BufferGeometry;
  base: Float32Array;
  fallback: Float32Array;
  group: Uint32Array;
  positions: Float32Array;
  output: BufferAttribute;
  last: number[] | null;
}

/**
 * 모델에 들어 있던 원래 법선. 법선 자리는 계산한 값으로 바꿔 끼우므로, 같은 모델로 장면을 다시 만들 때(Activity로 돌아오기 등)
 * 바뀐 법선이 아니라 원래 법선을 기준으로 삼게 처음 것을 기억해 둔다.
 */
const originalNormals = new WeakMap<BufferGeometry, BufferAttribute>();

/** 얼굴 메시 묶음(같은 머리를 이루는 메시들)의 법선 갱신 함수를 만든다. 표정이 바뀐 프레임에만 다시 계산한다. */
export function createFaceSurface(meshes: Mesh[]): () => void {
  const groups = new Map<string, number>();
  const parts: Part[] = [];

  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const normal = originalNormals.get(geometry) ?? (geometry.attributes.normal as BufferAttribute);
    originalNormals.set(geometry, normal);
    const base = new Float32Array(position.count * 3);
    const fallback = new Float32Array(position.count * 3);
    const group = new Uint32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const nx = normal.getX(i);
      const ny = normal.getY(i);
      const nz = normal.getZ(i);
      base.set([x, y, z], i * 3);
      fallback.set([nx, ny, nz], i * 3);
      const key = [
        ...[x, y, z].map((v) => Math.round(v * 1e6)),
        ...[nx, ny, nz].map((v) => Math.round(v * 1e4)),
      ].join(",");
      if (!groups.has(key)) groups.set(key, groups.size);
      group[i] = groups.get(key)!;
    }
    const output = new BufferAttribute(new Float32Array(position.count * 3), 3);
    geometry.setAttribute("normal", output);
    parts.push({
      mesh,
      geometry,
      base,
      fallback,
      group,
      positions: new Float32Array(base.length),
      output,
      last: null,
    });
  }

  const sums = new Float64Array(groups.size * 3);
  const unchanged = (part: Part) => {
    const now = part.mesh.morphTargetInfluences ?? [];
    return (
      part.last !== null &&
      part.last.length === now.length &&
      part.last.every((value, i) => Math.abs(value - now[i]) < 1e-8)
    );
  };

  return function updateSurface() {
    if (parts.every(unchanged)) return;
    sums.fill(0);
    for (const part of parts) {
      const influences = part.mesh.morphTargetInfluences ?? [];
      blendPositions(part, influences);
      addFaceNormals(part, sums);
      part.last = influences.slice();
    }
    for (const part of parts) writeNormals(part, sums);
  };
}

/** 표정(모프 가중치)을 섞은 최종 위치를 part.positions에 쓴다 */
function blendPositions(part: Part, influences: readonly number[]) {
  const { geometry, base, positions } = part;
  positions.set(base);
  // 상대 모프(morphTargetsRelative)는 바뀐 양을 담고, 절대 모프는 바뀐 뒤 위치를 담아 원래 위치를 빼야 한다
  const absolute = geometry.morphTargetsRelative ? 0 : 1;
  for (let j = 0; j < influences.length; j++) {
    const w = influences[j];
    const target = geometry.morphAttributes.position?.[j];
    if (!w || !target) continue;
    for (let i = 0; i < target.count; i++) {
      const at = i * 3;
      positions[at] += w * (target.getX(i) - absolute * base[at]);
      positions[at + 1] += w * (target.getY(i) - absolute * base[at + 1]);
      positions[at + 2] += w * (target.getZ(i) - absolute * base[at + 2]);
    }
  }
}

/** 삼각형마다 면 법선(넓이만큼 큰 외적)을 구해 세 꼭짓점이 속한 묶음의 합(sums)에 더한다 */
function addFaceNormals(part: Part, sums: Float64Array) {
  const { geometry, positions, group } = part;
  const index = geometry.index;
  const count = index ? index.count : positions.length / 3;
  const vertex = (corner: number) => (index ? index.getX(corner) : corner);
  for (let t = 0; t < count; t += 3) {
    const a = vertex(t);
    const b = vertex(t + 1);
    const c = vertex(t + 2);
    const ai = a * 3;
    const bi = b * 3;
    const ci = c * 3;
    const abx = positions[bi] - positions[ai];
    const aby = positions[bi + 1] - positions[ai + 1];
    const abz = positions[bi + 2] - positions[ai + 2];
    const acx = positions[ci] - positions[ai];
    const acy = positions[ci + 1] - positions[ai + 1];
    const acz = positions[ci + 2] - positions[ai + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const v of [a, b, c]) {
      const at = group[v] * 3;
      sums[at] += nx;
      sums[at + 1] += ny;
      sums[at + 2] += nz;
    }
  }
}

/** 묶음 합을 정규화해 법선 자리에 쓴다. 합이 0에 가까우면(면이 겹쳐 없어짐) 원래 법선을 쓴다 */
function writeNormals(part: Part, sums: Float64Array) {
  const out = part.output.array as Float32Array;
  for (let i = 0; i < part.group.length; i++) {
    const at = part.group[i] * 3;
    const nx = sums[at];
    const ny = sums[at + 1];
    const nz = sums[at + 2];
    const length = Math.hypot(nx, ny, nz);
    if (length > 1e-20) {
      out[i * 3] = nx / length;
      out[i * 3 + 1] = ny / length;
      out[i * 3 + 2] = nz / length;
    } else {
      out.set(part.fallback.subarray(i * 3, i * 3 + 3), i * 3);
    }
  }
  part.output.needsUpdate = true;
}

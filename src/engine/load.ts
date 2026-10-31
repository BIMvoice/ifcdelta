import { GeometryProcessor, type MeshData } from '@ifc-lite/geometry';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

/** Everything a compare needs from one IFC file. */
export interface LoadedModel {
  fileName: string;
  store: IfcDataStore;
  hashes: Map<number, bigint>;
  /** Absolute world boxes (renderer Y-up), comparable across revisions. */
  worldBoxes: Map<number, Box>;
  volumes: Map<number, number>;
  /** Boxes in scene coordinates, used to frame the camera on an element. */
  sceneBoxes: Map<number, Box>;
  rtcOffset?: { x: number; y: number; z: number };
  meshCount: number;
}

export type LoadPhase = 'read' | 'parse' | 'geometry';
export type LoadProgress = (phase: LoadPhase, fraction: number) => void;

export interface LoadOptions {
  processor: GeometryProcessor;
  /** Keep both versions in one coordinate frame so unchanged elements line up exactly. */
  sharedRtcOffset?: { x: number; y: number; z: number };
  onProgress?: LoadProgress;
  onMeshes: (meshes: MeshData[]) => void;
}

function growBox(boxes: Map<number, Box>, mesh: MeshData) {
  const positions = mesh.positions;
  if (!positions.length) return;
  const [ox, oy, oz] = mesh.origin ?? [0, 0, 0];
  let box = boxes.get(mesh.expressId);
  if (!box) {
    box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    boxes.set(mesh.expressId, box);
  }
  const { min, max } = box;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] + ox;
    const y = positions[i + 1] + oy;
    const z = positions[i + 2] + oz;
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
}

export async function loadModel(file: File, options: LoadOptions): Promise<LoadedModel> {
  const { processor, onProgress, onMeshes, sharedRtcOffset } = options;
  onProgress?.('read', 0);
  const bytes = await file.arrayBuffer();

  onProgress?.('parse', 0);
  const store = await new IfcParser().parseColumnar(bytes, {
    onProgress: ({ percent }) => onProgress?.('parse', percent / 100),
  });

  const model: LoadedModel = {
    fileName: file.name,
    store,
    hashes: new Map(),
    worldBoxes: new Map(),
    volumes: new Map(),
    sceneBoxes: new Map(),
    meshCount: 0,
  };

  processor.enableGeometryHashes();
  onProgress?.('geometry', 0);
  let estimate = 0;
  for await (const event of processor.processStreaming(new Uint8Array(bytes), undefined, undefined, sharedRtcOffset)) {
    if (event.type === 'start') estimate = event.totalEstimate;
    if (event.type !== 'batch') continue;
    if (event.coordinateInfo?.originShift) model.rtcOffset = rtcInIfcAxes(event.coordinateInfo.originShift);
    for (const mesh of event.meshes) {
      if (mesh.geometryHash !== undefined && !model.hashes.has(mesh.expressId)) model.hashes.set(mesh.expressId, mesh.geometryHash);
      if (mesh.geometryAabb) model.worldBoxes.set(mesh.expressId, { min: [...mesh.geometryAabb.min], max: [...mesh.geometryAabb.max] });
      if (mesh.geometryVolume !== undefined) model.volumes.set(mesh.expressId, mesh.geometryVolume);
      growBox(model.sceneBoxes, mesh);
    }
    model.meshCount += event.meshes.length;
    onMeshes(event.meshes);
    if (estimate > 0) onProgress?.('geometry', Math.min(0.99, event.totalSoFar / estimate));
  }
  onProgress?.('geometry', 1);
  return model;
}

/** The processor reports its shift Y-up; `sharedRtcOffset` takes IFC Z-up coordinates. */
function rtcInIfcAxes(shift: { x: number; y: number; z: number }) {
  return { x: shift.x, y: -shift.z, z: shift.y };
}

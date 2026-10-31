import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './style.css';
import { GeometryProcessor, type MeshData } from '@ifc-lite/geometry';
import { compareFingerprints, computePropertyChanges, fingerprintModel } from './engine/compare';
import { loadModel, type LoadPhase, type LoadedModel } from './engine/load';
import { h } from './ui/dom';
import { createLanding, createProgress } from './ui/landing';
import { createWorkspace } from './ui/workspace';
import { DeltaViewer } from './viewer/delta-viewer';
import { COLOURS, tintMeshes } from './viewer/overlay';

const app = document.getElementById('app')!;

const PHASE_LABEL: Record<LoadPhase, string> = { read: 'Reading', parse: 'Parsing', geometry: 'Building geometry for' };
/** Shares of the progress bar: the old file, the new file, then the comparison. */
const SHARE = { model: 0.44, compare: 0.12 };

function showLanding(message?: string) {
  document.title = 'ifcdelta';
  app.replaceChildren(createLanding({ onCompare: (oldFile, newFile) => void runComparison(oldFile, newFile) }, message));
}

/** A fresh page is the honest way to free two models' GPU and WASM memory. */
function startOver() {
  location.reload();
}

async function runComparison(oldFile: File, newFile: File) {
  const progress = createProgress(oldFile.name, newFile.name);
  const baseCanvas = h('canvas', { class: 'stage-canvas base-canvas', hidden: true });
  const canvas = h('canvas', { class: 'stage-canvas' });
  const stage = h('div', { class: 'stage', 'data-view': 'model' }, canvas, baseCanvas);
  app.replaceChildren(stage, progress.root);

  try {
    const processor = new GeometryProcessor();
    await processor.init();

    // The data comparison does not need a GPU, so a missing one only costs the 3D view.
    let viewer: DeltaViewer | null = null;
    try {
      viewer = await DeltaViewer.create(stage, canvas, baseCanvas);
    } catch (error) {
      console.warn('3D view unavailable', error);
    }

    const stepper = (name: string, offset: number) => (phase: LoadPhase, fraction: number) => {
      const within = phase === 'read' ? 0 : phase === 'parse' ? 0.1 + fraction * 0.3 : 0.4 + fraction * 0.6;
      progress.update(`${PHASE_LABEL[phase]} ${name}`, offset + within * SHARE.model);
    };

    const baseMeshes: MeshData[] = [];
    const baseModel: LoadedModel = await loadModel(oldFile, {
      processor,
      onProgress: stepper(oldFile.name, 0),
      onMeshes: (meshes) => baseMeshes.push(...meshes),
    });

    let firstBatch = true;
    const headModel: LoadedModel = await loadModel(newFile, {
      processor,
      sharedRtcOffset: baseModel.rtcOffset,
      onProgress: stepper(newFile.name, SHARE.model),
      onMeshes: (meshes) => {
        viewer?.addHeadMeshes(tintMeshes(meshes));
        if (firstBatch) viewer?.fit();
        firstBatch = false;
      },
    });

    const compareStart = SHARE.model * 2;
    progress.update('Comparing elements', compareStart);
    const baseFingerprints = await fingerprintModel(baseModel, (f) => progress.update('Comparing the old version', compareStart + f * SHARE.compare * 0.35));
    const headFingerprints = await fingerprintModel(headModel, (f) => progress.update('Comparing the new version', compareStart + SHARE.compare * 0.35 + f * SHARE.compare * 0.35));
    const comparison = compareFingerprints(baseModel, headModel, baseFingerprints, headFingerprints);
    await computePropertyChanges(comparison.changes, baseModel, headModel, (f) => progress.update('Reading changed properties', compareStart + SHARE.compare * (0.7 + f * 0.3)));

    // The new scene also holds old copies of what was deleted or reshaped, under ids that cannot clash.
    let maxHeadId = 0;
    for (const id of headModel.sceneBoxes.keys()) if (id > maxHeadId) maxHeadId = id;
    const baseOffset = maxHeadId + 1;
    const oldCopies = new Set<number>();
    for (const change of comparison.changes) {
      if (change.base && (change.kind === 'deleted' || (change.kind === 'modified' && change.geometry))) oldCopies.add(change.base.expressId);
    }
    const extras = tintMeshes(
      baseMeshes.filter((mesh) => oldCopies.has(mesh.expressId)).map((mesh) => ({ ...mesh, expressId: mesh.expressId + baseOffset })),
      COLOURS.oldPosition,
    );
    baseMeshes.length = 0;
    if (extras.length) viewer?.addHeadMeshes(extras);
    viewer?.finishLoading();

    const workspace = createWorkspace({
      comparison,
      baseModel,
      headModel,
      viewer,
      stage,
      baseOffset,
      onChangeFiles: startOver,
      loadBaseScene: async (add) => {
        const bytes = new Uint8Array(await oldFile.arrayBuffer());
        for await (const event of processor.processStreaming(bytes, undefined, undefined, baseModel.rtcOffset)) {
          if (event.type !== 'batch') continue;
          add(tintMeshes(event.meshes));
        }
      },
    });
    document.title = `${oldFile.name} → ${newFile.name} · ifcdelta`;
    progress.root.remove();
    app.append(workspace.root);
    workspace.mounted();
    // Test hook for scripts/check-browser.mjs, and handy in dev tools.
    Object.assign(window, { ifcdelta: { comparison, baseModel, headModel, viewer } });
  } catch (error) {
    console.error(error);
    showLanding(`Could not compare these files: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

showLanding();

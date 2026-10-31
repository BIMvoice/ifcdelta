// Writes fixtures/tower-v1.ifc and tower-v2.ifc: a small IFC4 pair where every difference is known,
// so the tests can assert exact results. Usage: node scripts/make-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

/** Fixed 22-character GlobalIds, so the output is byte-stable. */
const guid = (n) => `3Delta${String(n).padStart(16, '0')}`;

function buildIfc(name, elements) {
  const lines = [];
  let id = 0;
  const add = (text) => {
    id += 1;
    lines.push(`#${id}=${text};`);
    return `#${id}`;
  };
  let root = 900;
  const rootId = () => `'${guid(root++)}'`;
  const origin = add('IFCCARTESIANPOINT((0.,0.,0.))');
  const zAxis = add('IFCDIRECTION((0.,0.,1.))');
  const xAxis = add('IFCDIRECTION((1.,0.,0.))');
  const world = add(`IFCAXIS2PLACEMENT3D(${origin},${zAxis},${xAxis})`);
  const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,${world},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${context},$,.MODEL_VIEW.,$)`);
  const units = add(
    `IFCUNITASSIGNMENT((${[
      add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)'),
      add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)'),
      add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)'),
    ].join(',')}))`,
  );
  const project = add(`IFCPROJECT(${rootId()},$,'Fixture project',$,$,$,$,(${context}),${units})`);
  const place = (parent, x, y, z) => {
    const point = add(`IFCCARTESIANPOINT((${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}))`);
    const axis = add(`IFCAXIS2PLACEMENT3D(${point},${zAxis},${xAxis})`);
    return add(`IFCLOCALPLACEMENT(${parent},${axis})`);
  };
  const sitePlace = place('$', 0, 0, 0);
  const site = add(`IFCSITE(${rootId()},$,'Site',$,$,${sitePlace},$,$,.ELEMENT.,$,$,$,$,$)`);
  const buildingPlace = place(sitePlace, 0, 0, 0);
  const building = add(`IFCBUILDING(${rootId()},$,'Tower',$,$,${buildingPlace},$,$,.ELEMENT.,$,$,$)`);
  const storeyPlace = place(buildingPlace, 0, 0, 0);
  const storey = add(`IFCBUILDINGSTOREY(${rootId()},$,'Level 1',$,$,${storeyPlace},$,$,.ELEMENT.,0.)`);
  add(`IFCRELAGGREGATES(${rootId()},$,$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES(${rootId()},$,$,$,${site},(${building}))`);
  add(`IFCRELAGGREGATES(${rootId()},$,$,$,${building},(${storey}))`);

  const contained = [];
  for (const element of elements) {
    const [sx, sy, sz] = element.size;
    const profilePoint = add(`IFCCARTESIANPOINT((${(sx / 2).toFixed(3)},${(sy / 2).toFixed(3)}))`);
    const profilePlace = add(`IFCAXIS2PLACEMENT2D(${profilePoint},$)`);
    const profile = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${profilePlace},${sx.toFixed(3)},${sy.toFixed(3)})`);
    const solid = add(`IFCEXTRUDEDAREASOLID(${profile},${world},${zAxis},${sz.toFixed(3)})`);
    const shape = add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${solid}))`);
    const definition = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shape}))`);
    const placement = place(storeyPlace, ...element.at);
    const attributes = `'${guid(element.id)}',$,'${element.name}',$,$,${placement},${definition},$`;
    const product = add(element.type === 'column' ? `IFCCOLUMN(${attributes},.COLUMN.)` : element.type === 'slab' ? `IFCSLAB(${attributes},.FLOOR.)` : `IFCWALL(${attributes},.SOLIDWALL.)`);
    contained.push(product);
    if (element.fireRating) {
      const value = add(`IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('${element.fireRating}'),$)`);
      const pset = add(`IFCPROPERTYSET(${rootId()},$,'Pset_WallCommon',$,(${value}))`);
      add(`IFCRELDEFINESBYPROPERTIES(${rootId()},$,$,$,(${product}),${pset})`);
    }
    if (element.material) {
      const material = add(`IFCMATERIAL('${element.material}',$,$)`);
      add(`IFCRELASSOCIATESMATERIAL(${rootId()},$,$,$,(${product}),${material})`);
    }
  }
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${rootId()},$,$,$,(${contained.join(',')}),${storey})`);

  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    `FILE_NAME('${name}','2026-01-01T00:00:00',(''),(''),'ifcdelta fixtures','ifcdelta fixtures','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

const wall = (id, name, x, y, extra = {}) => ({ id, name, type: 'wall', at: [x, y, 0], size: [4, 0.2, 3], ...extra });
const column = (id, name, x, y, extra = {}) => ({ id, name, type: 'column', at: [x, y, 0], size: [0.4, 0.4, 3], ...extra });

const unchanged = [
  wall(1, 'Unchanged wall A', 0, 12),
  wall(2, 'Unchanged wall B', 5, 12),
  column(3, 'Unchanged column A', 0, 8),
  column(4, 'Unchanged column B', 8, 8),
];

const oldVersion = [
  ...unchanged,
  wall(10, 'Moved wall', 1, 0),
  wall(11, 'Rated wall', 6, 0, { fireRating: 'REI 60' }),
  wall(12, 'Moved rated wall', 11, 0, { fireRating: 'REI 60' }),
  { id: 13, name: 'Extended slab', type: 'slab', at: [0, 0, -0.3], size: [16, 14, 0.3] },
  column(14, 'Removed column', 4, 4),
  column(15, 'Regraded column', 12, 4, { material: 'C30/37' }),
  wall(16, 'Reissued wall', 10, 12),
  wall(17, 'Reissued and moved wall', 10, 8),
];

const newVersion = [
  ...unchanged,
  wall(10, 'Moved wall', 1.45, 0),
  wall(11, 'Rated wall', 6, 0, { fireRating: 'REI 90' }),
  wall(12, 'Moved rated wall', 11, 0.5, { fireRating: 'REI 120' }),
  { id: 13, name: 'Extended slab', type: 'slab', at: [0, 0, -0.3], size: [16, 15.2, 0.3] },
  wall(20, 'New wall', 2, 4),
  column(15, 'Regraded column', 12, 4, { material: 'C35/45' }),
  // New GlobalIds: one identical, one moved, as a re-export or re-author produces.
  wall(30, 'Reissued wall', 10, 12),
  wall(31, 'Reissued and moved wall', 10, 9),
];

mkdirSync('fixtures', { recursive: true });
writeFileSync('fixtures/tower-v1.ifc', buildIfc('tower-v1.ifc', oldVersion));
writeFileSync('fixtures/tower-v2.ifc', buildIfc('tower-v2.ifc', newVersion));
console.log('Wrote fixtures/tower-v1.ifc and fixtures/tower-v2.ifc');

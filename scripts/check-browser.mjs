// Drives the production build in headless Chromium with the fixture pair, where every difference is
// known. Run `npm run build` first. Set SCREENSHOTS=<folder> to also save what each step looks like.
// Usage: npm run check:browser
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const OLD = 'fixtures/tower-v1.ifc';
const NEW = 'fixtures/tower-v2.ifc';
const shots = process.env.SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });

let failures = 0;
function check(name, passed, detail = '') {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}${passed || !detail ? '' : `: ${detail}`}`);
  if (!passed) failures++;
}
const equal = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid);
  } catch {
    // Already gone.
  }
};
process.on('exit', stopServer);
for (let i = 0; i < 50; i++) {
  if (await fetch(URL).then(() => true, () => false)) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const pageErrors = [];
async function newPage(options = { viewport: { width: 1440, height: 900 } }) {
  const page = await browser.newPage(options);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return page;
}
const shot = async (page, name) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};

async function compare(page, oldFile = OLD, newFile = NEW) {
  await page.goto(URL);
  await page.setInputFiles('input[data-slot=old]', oldFile);
  await page.setInputFiles('input[data-slot=new]', newFile);
  await page.click('.compare-btn');
  await page.waitForSelector('.workspace', { timeout: 120000 });
  await page.waitForTimeout(800);
}
const rowTitles = (page) => page.$$eval('.change-row .change-title', (rows) => rows.map((row) => row.textContent));
const inspectorProps = (page) => page.$$eval('.prop', (props) => props.map((p) => [p.querySelector('.prop-name').textContent, ...[...p.querySelectorAll('.value-box')].map((v) => v.textContent)]));
const pickRow = async (page, title) => {
  await page.click(`.change-row:has(.change-title:text-is("${title}"))`);
  await page.waitForTimeout(700);
};

try {
  // ── Landing ────────────────────────────────────────────────────────────────
  let page = await newPage();
  await page.goto(URL);
  await page.waitForSelector('.landing');
  check('compare is disabled until both files are chosen', await page.isDisabled('.compare-btn'));
  await page.setInputFiles('input[data-slot=old]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  check('a file that is not IFC is refused with a reason', (await page.textContent('.landing-note')).includes('not an .ifc file'));
  await page.setInputFiles('input[data-slot=old]', OLD);
  await page.setInputFiles('input[data-slot=new]', NEW);
  await page.click('.swap-btn');
  equal('swap exchanges the two files', await page.$$eval('.slot-title', (t) => t.map((e) => e.textContent)), ['tower-v2.ifc', 'tower-v1.ifc']);
  await shot(page, '01-landing');
  await page.close();

  // ── The comparison itself ──────────────────────────────────────────────────
  page = await newPage();
  await compare(page);
  await shot(page, '02-overlay');
  const summary = await page.evaluate(() => window.ifcdelta.comparison.summary);
  equal('counts match the known differences', { added: summary.added, modified: summary.modified, deleted: summary.deleted, reidentified: summary.reidentified }, { added: 1, modified: 6, deleted: 1, reidentified: 1 });
  check('geometry was compared', summary.geometryCompared);
  const titles = await rowTitles(page);
  check('identical re-issued wall is not listed as a change', !titles.includes('Reissued wall'), titles.join(', '));
  check('unchanged elements are not listed', !titles.some((t) => t.startsWith('Unchanged')));

  // ── Geometry: values and axes ──────────────────────────────────────────────
  await pickRow(page, 'Moved wall');
  equal('a 450 mm move in X reads as exactly that, on the right axis', await inspectorProps(page), [['Position X', '3 m', '3.45 m']]);
  await pickRow(page, 'Extended slab');
  const slab = await inspectorProps(page);
  check('a slab extended in Y moves its centre in Y only', slab.some((r) => r[0] === 'Position Y') && !slab.some((r) => r[0] === 'Position X' || r[0] === 'Position Z'), JSON.stringify(slab));
  check('and grows 1.2 m in Y', slab.some((r) => r[0] === 'Size Y' && r[1] === '14 m' && r[2] === '15.2 m'), JSON.stringify(slab));
  await pickRow(page, 'Reissued and moved wall');
  check('an element with a new GlobalId is paired by content', (await page.textContent('.inspector')).includes('paired by matching content'));
  equal('and its move is still measured', await inspectorProps(page), [['Position Y', '8.1 m', '9.1 m']]);

  // ── Data ───────────────────────────────────────────────────────────────────
  await pickRow(page, 'Rated wall');
  equal('a property change shows old and new', await inspectorProps(page), [['FireRating', 'REI 60', 'REI 90']]);
  await pickRow(page, 'Moved rated wall');
  const both = await inspectorProps(page);
  check('geometry and data changes show together', both.some((r) => r[0] === 'Position Y') && both.some((r) => r[0] === 'FireRating' && r[2] === 'REI 120'), JSON.stringify(both));
  await pickRow(page, 'Regraded column');
  equal('a material change shows old and new', await inspectorProps(page), [['Materials', 'C30/37', 'C35/45']]);
  await pickRow(page, 'Removed column');
  check('a deleted element lists what it had', (await page.textContent('.all-props')).includes('Removed column'));
  await pickRow(page, 'New wall');
  check('an added element lists what it has', (await page.textContent('.all-props')).includes('New wall'));
  await shot(page, '03-added-selected');

  // ── Filters ────────────────────────────────────────────────────────────────
  await page.click('.chip-row.four .chip.deleted');
  equal('filtering by deleted', await rowTitles(page), ['Removed column']);
  await page.click('.chip-row.four .chip.all');
  await page.click('.chip-row.three .chip:has-text("Data")');
  check('the data filter leaves out geometry-only changes', !(await rowTitles(page)).includes('Moved wall'));
  await page.click('.chip-row.three .chip:has-text("Geometry")');
  check('the geometry filter leaves out data-only changes', !(await rowTitles(page)).includes('Rated wall'));
  await page.click('.chip-row.three .chip:has-text("Everything")');
  await page.fill('.changes-panel input[type=search]', 'FireRating');
  equal('search reaches property names', (await rowTitles(page)).sort(), ['Moved rated wall', 'New wall', 'Rated wall'].filter((t) => t !== 'New wall').sort());
  await page.fill('.changes-panel input[type=search]', 'nothing matches this');
  check('an empty search says so', await page.isVisible('.changes-panel .empty'));
  await page.fill('.changes-panel input[type=search]', '');
  await page.locator('.changes-panel input[type=search]').blur();

  // ── 3D: each version really draws differently, and clicks select ───────────
  const stageShot = () => page.locator('.stage').screenshot();
  const pixels = {};
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await page.waitForTimeout(600);
  for (const mode of ['Overlay', 'Old', 'New']) {
    await page.click(`.version-bar button:text-is("${mode}")`);
    await page.waitForTimeout(500);
    pixels[mode] = (await stageShot()).toString('base64');
    await shot(page, `04-version-${mode.toLowerCase()}`);
  }
  check('old and new draw differently', pixels.Old !== pixels.New);
  check('overlay differs from both', pixels.Overlay !== pixels.Old && pixels.Overlay !== pixels.New);
  await page.click('.version-bar button:text-is("Overlay")');

  await pickRow(page, 'Extended slab');
  await page.keyboard.press('f');
  await pickRow(page, 'Moved wall');
  await page.waitForTimeout(600);
  const box = await page.locator('.stage').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  check('clicking the framed element in 3D selects it', (await page.textContent('.inspector h2')) === 'Moved wall', await page.textContent('.inspector h2'));

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  check('arrow keys step through changes', (await page.textContent('.inspector h2')) !== 'Moved wall');
  await page.keyboard.press('Escape');
  check('escape clears the selection', (await page.textContent('.inspector h2')).includes('changes'));

  // ── Resizable panels ──────────────────────────────────────────────────────
  const widthOf = (selector) => page.locator(selector).evaluate((el) => el.getBoundingClientRect().width);
  const dragHandle = async (selector, dx) => {
    const handle = await page.locator(selector).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + dx, handle.y + handle.height / 2, { steps: 4 });
    await page.mouse.up();
  };
  await dragHandle('.handle-left.handle-model', 60);
  equal('dragging widens the left panel', await widthOf('.changes-panel'), 400);
  await dragHandle('.handle-right.handle-model', -40);
  equal('dragging the other way widens the right panel', await widthOf('.side-panel'), 420);
  await dragHandle('.handle-left.handle-model', -900);
  equal('a panel stops at its minimum', await widthOf('.changes-panel'), 280);
  await dragHandle('.handle-right.handle-model', -900);
  equal('and at its maximum', await widthOf('.side-panel'), 600);
  await dragHandle('.handle-left.handle-model', 900);
  check('it leaves the model room between the panels', 1440 - (await widthOf('.changes-panel')) - (await widthOf('.side-panel')) >= 300);
  equal('the width is remembered', await page.evaluate(() => localStorage.getItem('ifcdelta.side')), '600');
  await page.dblclick('.handle-right.handle-model');
  equal('double-click resets it', await widthOf('.side-panel'), 380);
  await page.dblclick('.handle-left.handle-model');
  await page.focus('.handle-left.handle-model');
  await page.keyboard.press('ArrowRight');
  equal('arrow keys resize it too', await widthOf('.changes-panel'), 356);
  await page.keyboard.press('ArrowLeft');
  await page.locator('.handle-left.handle-model').blur();

  // ── Wipe ───────────────────────────────────────────────────────────────────
  await page.click('.version-bar button:text-is("Wipe")');
  await page.waitForSelector('.seam:not([hidden])', { timeout: 60000 });
  await page.waitForTimeout(800);
  await shot(page, '05-wipe');
  check('wipe shows the old version on a second canvas', await page.isVisible('.base-canvas'));
  await page.focus('.seam');
  const before = await page.getAttribute('.seam', 'aria-valuenow');
  await page.keyboard.press('ArrowRight');
  check('the seam moves from the keyboard', (await page.getAttribute('.seam', 'aria-valuenow')) !== before);
  await page.click('.version-bar button:text-is("Overlay")');
  check('leaving wipe hides the second canvas', !(await page.isVisible('.base-canvas')));

  // ── Data table ─────────────────────────────────────────────────────────────
  await page.click('.tabs button:has-text("Data table")');
  await page.waitForTimeout(400);
  await shot(page, '06-data');
  check('the table is showing', await page.isVisible('.table-panel'));
  check('the 3D view docks beside it', await page.locator('.stage').evaluate((el) => el.getBoundingClientRect().width < 500));
  const dock = await page.locator('.stage').boundingBox();
  const topElement = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.stage') !== null, { x: dock.x + dock.width / 2, y: dock.y + dock.height / 3 });
  check('and is not covered by a panel', topElement);
  const tableText = await page.textContent('.table-scroll');
  check('table rows carry old and new values', tableText.includes('REI 60') && tableText.includes('REI 90') && tableText.includes('3.45 m'));
  check('the table has a GlobalId column', (await page.$$eval('.table-header span', (h) => h.map((e) => e.textContent))).includes('GlobalId'));
  check('rows show the element GlobalId', tableText.includes('3Delta0000000000000011'), tableText.slice(0, 200));

  const exported = async (button) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(`.export-btn:has-text("${button}")`)]);
    return { name: download.suggestedFilename(), text: readFileSync(await download.path(), 'utf8') };
  };
  const rowsOf = (csv) => csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
  let file = await exported('Export elements');
  equal('the elements file is named after both versions', file.name, 'tower-v1_to_tower-v2_elements.csv');
  check('it opens correctly in Excel, with a byte order mark', file.text.charCodeAt(0) === 0xfeff);
  equal('it has one row per changed element, plus a header', rowsOf(file.text).length, 9);
  check('with GlobalIds', rowsOf(file.text)[0].includes('GlobalId') && file.text.includes('3Delta0000000000000020'));
  check('and the old GlobalId of an element paired by content', file.text.includes('3Delta0000000000000031') && file.text.includes('3Delta0000000000000017'));
  file = await exported('Export properties');
  check('the properties file carries old and new values', file.text.includes('REI 60') && file.text.includes('REI 120') && file.text.includes('3.45 m'));
  await page.click('.tally-item.deleted');
  file = await exported('Export elements');
  equal('export follows the filters on screen', rowsOf(file.text).length, 2);
  check('and it is the deleted column', rowsOf(file.text)[1].startsWith('Deleted') && file.text.includes('Removed column'));
  await page.click('.tally-item.all');
  await page.fill('.table-tools input', 'nothing matches this');
  check('export is disabled when nothing is shown', await page.isDisabled('.export-btn:has-text("Export elements")'));
  await page.fill('.table-tools input', '');

  await page.fill('.table-tools input', 'FireRating');
  const filteredRows = await page.$$eval('.table-scroll .table-row:not(.table-header)', (rows) => rows.length);
  equal('table search narrows to property rows', filteredRows, 2);
  await page.fill('.table-tools input', '');
  await page.click('.class-row:has-text("IfcColumn")');
  const columnRows = await page.$$eval('.table-scroll .table-row:not(.table-header) .cell.strong', (cells) => cells.map((c) => c.textContent).filter(Boolean));
  check('the class list filters the table', columnRows.length > 0 && columnRows.every((name) => name.includes('olumn')), columnRows.join(', '));
  await dragHandle('.handle-dock', -80);
  equal('in the data view, the 3D and details column resizes together', [await widthOf('.stage'), await widthOf('.side-panel')].map(Math.round), [500, 500]);
  await page.dblclick('.handle-dock');
  await page.close();

  // ── Same file twice ────────────────────────────────────────────────────────
  page = await newPage();
  await compare(page, OLD, OLD);
  equal('a file against itself has no changes', await page.evaluate(() => window.ifcdelta.comparison.changes.length), 0);
  check('and says so', (await page.textContent('.changes-panel')).includes('identical'));
  await page.close();

  // ── Without WebGPU the data comparison still works ─────────────────────────
  page = await newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { get: () => undefined }));
  await compare(page);
  equal('without WebGPU the comparison still completes', await page.evaluate(() => window.ifcdelta.comparison.summary.modified), 6);
  check('and explains the missing 3D view', (await page.textContent('.stage-message')).includes('WebGPU'));
  await page.close();

  // ── Narrow window ──────────────────────────────────────────────────────────
  page = await newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(URL);
  await shot(page, '07-phone-landing');
  check('the landing fits a phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await compare(page);
  await shot(page, '08-phone-model');
  check('the workspace fits a phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check('the 3D view stays visible on a phone', await page.evaluate(() => document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.3)?.closest('.stage, .center') !== null));
  await page.close();

  equal('no uncaught errors in any page', pageErrors, []);
} catch (error) {
  console.error(error);
  failures++;
} finally {
  await browser.close();
  stopServer();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);

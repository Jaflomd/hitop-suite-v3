const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadHitopCore(){
  const htmlPath = path.join(__dirname, "..", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match, "index.html must contain one inline script");
  const core = match[1].split("/* ===================== Boot ===================== */")[0];
  const exports = `
    globalThis.__hitop = {
      PATIENTS,
      SCALES,
      computeASRS6,
      computeASRS18,
      computeAQ10,
      computeSWLS,
      computeWSAS,
      computeACES,
      computeEQ5D,
      computeDERS16,
      computeAAQII,
      computeUPPSP,
      computePTQ,
      computeDJG6,
      computeEFECO21,
      attachScaleDimensions,
      exportSubjectId
    };
  `;
  const context = {
    console,
    Math,
    Date,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    RegExp,
    encodeURIComponent,
    decodeURIComponent
  };
  vm.createContext(context);
  vm.runInContext(core + exports, context, {filename: "index.html"});
  return context.__hitop;
}

const h = loadHitopCore();

test("starts with a single pseudonymous blank patient", () => {
  assert.equal(h.PATIENTS.length, 1);
  assert.equal(h.PATIENTS[0].code, "Paciente nuevo");
  assert.equal(Object.keys(h.PATIENTS[0].bhitop).length, 0);
  assert.equal(Object.keys(h.PATIENTS[0].neuro).length, 0);
  assert.equal(h.exportSubjectId({code: "Juan Perez 1990"}, 0), "SUBJ-001");
  assert.equal(h.exportSubjectId({subjectId: "SUBJ-123", code: "Paciente"}, 0), "SUBJ-123");
});

test("ASRS-18 and AQ-10 scoring", () => {
  const asrs = h.computeASRS18(Array(18).fill(4));
  assert.equal(asrs.pct, 100);
  assert.equal(asrs.dimensions.length, 2);
  assert.equal(asrs.dimensions.map(d => d.total).join(","), "36,36");

  const aq = h.computeAQ10([2,0,0,0,0,0,2,2,0,2]);
  assert.equal(aq.count, 10);
  assert.equal(aq.positive, true);
  assert.equal(aq.pct, 100);
});

test("transdiagnostic scoring totals and dimensions", () => {
  const efeco = h.computeEFECO21(Array(21).fill(3));
  assert.equal(efeco.total, 63);
  assert.equal(efeco.max, 63);
  assert.equal(efeco.pct, 100);
  assert.equal(efeco.dimensions.length, 7);
  assert.equal(efeco.dimensions.find(d => d.name === "Inhibicion").total, 9);

  const upps = h.computeUPPSP(Array(20).fill(1));
  assert.equal(upps.total, 33);
  assert.equal(upps.max, 60);
  assert.equal(upps.dimensions.find(d => d.name === "Urgencia negativa").total, 8);

  const djg = h.computeDJG6([2,2,2,2,2,2]);
  assert.equal(djg.total, 3);
  assert.equal(djg.max, 6);
  assert.equal(djg.dimensions.map(d => d.total).join(","), "3,0");

  const eq5d = h.computeEQ5D([0,1,2,3,4]);
  assert.equal(eq5d.total, 15);
  assert.equal(eq5d.max, 25);
  assert.equal(eq5d.profile, "12345");
});

test("functioning and wellbeing scoring", () => {
  const swls = h.computeSWLS([7,7,7,7,7]);
  assert.equal(swls.total, 35);
  assert.equal(swls.max, 35);
  assert.equal(swls.label, "Muy satisfecho");

  const whodas = h.computeWSAS(Array(12).fill(1));
  assert.equal(whodas.total, 12);
  assert.equal(whodas.max, 60);
  assert.equal(whodas.pct, 0);
  assert.equal(whodas.dimensions.length, 6);
});

test("diagnostic and substance scale scoring", () => {
  const phq = h.SCALES["PHQ-9"].score(Array(9).fill(3));
  assert.equal(phq.raw, 27);
  assert.equal(phq.max, 27);
  assert.equal(phq.pct, 100);
  assert.equal(phq.label, "Grave");

  const audit = h.SCALES.AUDIT.score([4,4,4,4,4,4,4,4,2,2]);
  assert.equal(audit.raw, 40);
  assert.equal(audit.max, 40);
  assert.equal(audit.pct, 100);

  const dudit = h.SCALES.DUDIT.score([4,4,4,4,4,4,4,4,4,2,2]);
  assert.equal(dudit.raw, 44);
  assert.equal(dudit.max, 44);
  assert.equal(dudit.pct, 100);

  const ftnd = h.SCALES.FTND.score([3,1,0,3,1,1]);
  assert.equal(ftnd.raw, 10);
  assert.equal(ftnd.max, 10);
  assert.equal(ftnd.pct, 100);
});

test("dimension attachment uses transformed item scoring", () => {
  const phqAnswers = Array(9).fill(1);
  const phq = h.attachScaleDimensions("PHQ-9", h.SCALES["PHQ-9"].score(phqAnswers), phqAnswers);
  assert.equal(phq.dimensions.length, 2);
  assert.equal(phq.dimensions.find(d => d.name === "Cognitivo-afectivo").total, 5);
  assert.equal(phq.dimensions.find(d => d.name === "Somatico").total, 4);

  const ftndAnswers = [3,1,0,3,1,1];
  const ftnd = h.attachScaleDimensions("FTND", h.SCALES.FTND.score(ftndAnswers), ftndAnswers);
  assert.equal(ftnd.dimensions.find(d => d.name === "Dependencia matutina").total, 5);
  assert.equal(ftnd.dimensions.find(d => d.name === "Dependencia diurna").total, 5);
});

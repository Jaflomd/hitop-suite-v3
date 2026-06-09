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
  assert.equal(core.includes("</script>"), false, "inline script strings must escape closing script tags");
  const exports = `
    globalThis.__hitop = {
      PATIENTS,
      BHITOP_ITEMS,
      BHITOP_SCALES,
      PID5_ITEMS,
      PID5_FACETS,
      IDAS99,
      IDAS_SCALES,
      HQ25_ITEMS,
      HQ25_DIMS,
      PSS14_ITEMS,
      SCALES,
      SYMPTOMS,
      DX_SCALES,
      GUIDED_PLAN,
      buildDemoPatient,
      computeBHitop,
      computeBHitopScale,
      computePID5Facet,
      completedScaleItemCount,
      isScaleCompleted,
      completionSpec,
      familyActionType,
      hydrateTransdiagnosticDimensions,
      computeIDAS,
      collectIDASAnswerById,
      recomputeIDASFromResponses,
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
      computeHQ25,
      scoreHQ25Dimension,
      computePSS14,
      computeDJG6,
      computeEFECO21,
      attachScaleDimensions,
      adminInstructionHTML,
      getSymBank,
      dashboardAllNavigationKeys,
      dashboardExportFilename,
      patientBackupFilename,
      patientBackupPayload,
      validatePatientsBackup,
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

test("patient-facing wording avoids flagged confusing phrases", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  [
    "me la tiene jurada",
    "Me encallo",
    "siempre reciba",
    "ponga de los nervios",
    "insisto lograr",
    "manosear cosas sucias",
    "hipocondriaco",
    "Quiero quedar",
    "Me embarco",
    "mas broncas",
    "mas farmacos",
    "desvelado temprano",
    "perdido los nervios",
    "cabeza iba a mil"
  ].forEach(phrase => assert.equal(html.includes(phrase), false, phrase));
});

test("administration modal emphasizes period and instruction prompt", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(html.includes(".admin-instr"));
  assert.ok(html.includes("Periodo / consigna"));
  assert.ok(html.includes("${adminInstructionHTML(A.instr)}"));

  assert.match(h.adminInstructionHTML("Ultimos 30 dias · frecuencia."), /admin-instr/);
  assert.match(h.adminInstructionHTML("Ultimos 30 dias · frecuencia."), /Periodo \/ consigna/);
  assert.match(h.adminInstructionHTML(""), /Responde cada item segun la consigna de la escala/);

  const idasBank = h.getSymBank({name: "Depresion general", idas: "gendep"});
  assert.match(idasBank.instr, /Ultimas 2 semanas/);
  assert.equal(idasBank.instr.includes("Subescala anexada"), false);
});

test("UX guardrail keeps app navigation accessible without changing items or scoring", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert.equal(h.BHITOP_ITEMS.length, 45);
  assert.equal(h.PID5_ITEMS.length, 100);
  assert.equal(h.IDAS99.length, 99);
  assert.equal(h.PSS14_ITEMS.length, 14);
  assert.equal(h.SCALES["PHQ-9"].items.length, 9);
  assert.equal(h.SCALES["GAD-7"].items.length, 7);
  assert.equal(h.SCALES["PCL-5"].items.length, 20);

  assert.ok(html.includes('class="toolbar patient-toolbar"'));
  assert.ok(html.includes('class="toolbar export-toolbar"'));
  assert.ok(html.includes('aria-label="Nuevo paciente"'));
  assert.ok(html.includes('aria-label="Exportar dashboard clinico"'));
  assert.ok(html.includes('<main class="wrap"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes('role="progressbar"'));
  assert.ok(html.includes('aria-pressed'));
  assert.ok(html.includes("Math.round(done/total*100)"));
  assert.equal(html.includes("Math.round(i/total*100)"), false);
  assert.ok(html.includes('role="button"'));
  assert.ok(html.includes('tabindex="0"'));
  assert.ok(html.includes("handleChipKey"));
  assert.ok(html.includes(".side-panel"));
  assert.ok(html.includes("position:sticky"));
});

test("UX phase 2 adds map filters, modal shortcuts, score help, export summary, and smart empty states", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert.equal(h.BHITOP_ITEMS.length, 45);
  assert.equal(h.PID5_ITEMS.length, 100);
  assert.equal(h.IDAS99.length, 99);

  assert.ok(html.includes("mapFilter"));
  assert.ok(html.includes("map-filters"));
  assert.ok(html.includes("applyMapFilter"));
  assert.ok(html.includes('data-map-filter="elevated"'));
  assert.ok(html.includes("handleAdminKey"));
  assert.ok(html.includes("ArrowLeft"));
  assert.ok(html.includes("ArrowRight"));
  assert.ok(html.includes("Escape"));
  assert.ok(html.includes("data-shortcut"));
  assert.ok(html.includes("score-help"));
  assert.ok(html.includes("La barra usa % crudo"));
  assert.ok(html.includes("dashboardSummaryHTML"));
  assert.ok(html.includes("snapshot-summary"));
  assert.ok(html.includes("Resumen clinico"));
  assert.ok(html.includes("smartEmptyHTML"));
  assert.ok(html.includes("Pendiente"));
  assert.ok(html.includes("Completar"));
});

test("patient database can be backed up and restored as portable JSON", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert.ok(html.includes('id="jsonBackupBtn"'));
  assert.ok(html.includes('id="jsonImportBtn"'));
  assert.ok(html.includes("showSaveFilePicker"));
  assert.ok(html.includes("showOpenFilePicker"));
  assert.equal(h.patientBackupFilename("2026-06-07"), "hitop-patients-backup-2026-06-07.json");

  const payload = h.patientBackupPayload([{code: "SUBJ demo", responses: {}}]);
  assert.equal(payload.schema, "hitop-patients-v3");
  assert.equal(payload.version, 1);
  assert.equal(payload.patients.length, 1);
  assert.equal(h.validatePatientsBackup(payload)[0].code, "SUBJ demo");
  assert.equal(h.validatePatientsBackup([{code: "Array directo"}])[0].code, "Array directo");
  assert.throws(() => h.validatePatientsBackup({patients: {}}), /lista de pacientes/);
});

test("Yachay theme is available without changing scoring surfaces", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert.equal(h.BHITOP_ITEMS.length, 45);
  assert.equal(h.PID5_ITEMS.length, 100);
  assert.equal(h.IDAS99.length, 99);
  assert.ok(html.includes('data-theme="yachay"'));
  assert.ok(html.includes('data-theme="claro"'));
  assert.ok(html.includes('data-theme="oscuro"'));
  assert.ok(html.includes('data-theme="negro"'));
  assert.ok(html.includes("YACHAY"));
  assert.ok(html.includes("#FDEBD0"));
  assert.ok(html.includes("#2B5282"));
  assert.ok(html.includes("#C28B77"));
  assert.ok(html.includes("#EEF4FF"));
  assert.ok(html.includes('[data-theme="yachay"] header{background:#2B5282'));
  assert.ok(html.includes("border-bottom:3px solid #D4AF37"));
  assert.ok(html.includes("YACHAY <small>PRO</small>"));
  assert.ok(html.includes("Cinzel"));
  assert.ok(html.includes("Montserrat"));
});

test("HQ-25 hikikomori dimensions are detachment symptoms with reversed scoring", () => {
  const hqSymptoms = h.SYMPTOMS.filter(s => s.src === "HQ-25");
  assert.equal(JSON.stringify(hqSymptoms.map(s => s.name)), JSON.stringify([
    "HQ-25 · Socialización",
    "HQ-25 · Aislamiento",
    "HQ-25 · Soporte emocional"
  ]));
  assert.ok(hqSymptoms.every(s => s.spectrum === "detachment" && s.sub === "detachment"));
  assert.equal(h.HQ25_ITEMS.length, 25);
  assert.equal(h.HQ25_DIMS.map(d => d.items.length).join(","), "11,8,6");
  assert.equal(h.SCALES["HQ-25"].items.length, 25);
  assert.ok(h.GUIDED_PLAN.find(section => section.key === "sintomas").scales.some(s => s.type === "HQ-25"));
  assert.match(h.SCALES["HQ-25"].instr, /forma habitual de relacionarte/);
  assert.equal(h.SCALES["HQ-25"].instr.includes("puntaje crudo, no diagnóstico"), false);

  const allAgree = h.computeHQ25(Array(25).fill(4));
  assert.equal(allAgree.raw, 72);
  assert.equal(allAgree.max, 100);
  assert.equal(allAgree.pct, 72);
  assert.equal(allAgree.details["HQ-25 · Socialización"].raw, 32);
  assert.equal(allAgree.details["HQ-25 · Aislamiento"].raw, 28);
  assert.equal(allAgree.details["HQ-25 · Soporte emocional"].raw, 12);

  const socialBank = h.getSymBank(hqSymptoms[0]);
  assert.equal(socialBank.items.length, 11);
  assert.match(socialBank.instr, /forma habitual de relacionarte/);
  assert.equal(socialBank.instr.includes("puntaje crudo, no diagnóstico"), false);
  assert.equal(h.scoreHQ25Dimension("HQ-25 · Socialización", Array(11).fill(4)).raw, 32);
});

test("starts with a single pseudonymous blank patient", () => {
  assert.equal(h.PATIENTS.length, 1);
  assert.equal(h.PATIENTS[0].code, "Paciente nuevo");
  assert.equal(Object.keys(h.PATIENTS[0].bhitop).length, 0);
  assert.equal(Object.keys(h.PATIENTS[0].neuro).length, 0);
  assert.equal(h.exportSubjectId({code: "Juan Perez 1990"}, 0), "SUBJ-001");
  assert.equal(h.exportSubjectId({subjectId: "SUBJ-123", code: "Paciente"}, 0), "SUBJ-123");
  assert.equal(h.dashboardExportFilename({subjectId: "SUBJ/123", code: "Paciente"}, 0, "2026-06-07"), "hitop-dashboard-SUBJ-123-2026-06-07.html");
  const dashKeys = h.dashboardAllNavigationKeys();
  assert.ok(dashKeys.includes("pss14"));
  assert.ok(dashKeys.includes("adhd"));
  assert.ok(dashKeys.some(k => k.startsWith("facet:")));
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

test("demo profile represents ADHD, complex PTSD, and internalizing comorbidity", () => {
  const demo = h.buildDemoPatient();

  assert.equal(demo.dni, "123456789");
  assert.equal(demo.subjectId, "DNI-123456789");
  assert.equal(demo.demo, true);
  assert.ok(demo.neuro.asrs18.pct >= 80);
  assert.equal(demo.scales.ITQ.label, "Cumple TEPT complejo");
  assert.ok(demo.scales["PCL-5"].raw >= 33);
  assert.ok(demo.scales["PHQ-9"].raw >= 15);
  assert.ok(demo.scales["GAD-7"].raw >= 15);
  assert.ok(demo.bhitop.internalizing);
  assert.ok(demo.idas.gendep.has);
  assert.ok(demo.pid5.Distraccion.pct >= 90);
});

test("B-HiTOP displays raw percent while preserving norm percentile", () => {
  const antagonistic = h.BHITOP_SCALES.find(s => s.key === "antagonistic");
  const byCode = {};
  antagonistic.codes.forEach((code, i) => {
    byCode[code] = i === 0 ? 1 : 2;
  });
  const score = h.computeBHitop(byCode).antagonistic;

  assert.equal(score.raw, 8);
  assert.equal(score.max, 27);
  assert.equal(score.pct, 30);
  assert.equal(score.percentile, 85);
});

test("PID-5 facets display raw percent while preserving norm percentile", () => {
  const facet = h.PID5_FACETS.find(f => f.name === "Busqueda de Atencion");
  const score = h.computePID5Facet(facet, facet.items.map(id => ({id, value: 2})));

  assert.equal(score.raw, 8);
  assert.equal(score.max, 12);
  assert.equal(score.pct, 67);
  assert.equal(score.percentile, 92);
});

test("partial family measurements do not complete full guided scales", () => {
  const p = h.PATIENTS[0];
  const saved = {bhitop: p.bhitop, pid5: p.pid5, idas: p.idas};
  p.bhitop = {};
  p.pid5 = {};
  p.idas = {};

  try {
    const antagonistic = h.BHITOP_SCALES.find(s => s.key === "antagonistic");
    const byCode = {};
    antagonistic.codes.forEach(code => { byCode[code] = 2; });
    p.bhitop.antagonistic = h.computeBHitop(byCode).antagonistic;
    assert.equal(h.completedScaleItemCount("bhitop"), antagonistic.codes.length);
    assert.equal(h.isScaleCompleted("bhitop"), false);

    const facet = h.PID5_FACETS.find(f => f.name === "Busqueda de Atencion");
    p.pid5[facet.name] = h.computePID5Facet(facet, facet.items.map(id => ({id, value: 2})));
    assert.equal(h.completedScaleItemCount("pid5"), facet.items.length);
    assert.equal(h.isScaleCompleted("pid5"), false);

    const idasScale = h.IDAS_SCALES[0];
    p.idas[idasScale.id] = {has: true};
    assert.equal(h.completedScaleItemCount("idas"), new Set(idasScale.items).size);
    assert.equal(h.isScaleCompleted("idas"), false);
  } finally {
    p.bhitop = saved.bhitop;
    p.pid5 = saved.pid5;
    p.idas = saved.idas;
  }
});

test("completion flow opens only missing family items", () => {
  const p = h.PATIENTS[0];
  const saved = {bhitop: p.bhitop, pid5: p.pid5, idas: p.idas};
  p.bhitop = {};
  p.pid5 = {};
  p.idas = {};

  try {
    h.PID5_FACETS.slice(0, 19).forEach(f => {
      p.pid5[f.name] = h.computePID5Facet(f, f.items.map(id => ({id, value: 1})));
    });
    assert.equal(h.completedScaleItemCount("pid5"), 76);
    assert.equal(h.completionSpec("complete:pid5").items.length, 24);

    const antagonistic = h.BHITOP_SCALES.find(s => s.key === "antagonistic");
    const byCode = {};
    antagonistic.codes.forEach(code => { byCode[code] = 2; });
    p.bhitop.antagonistic = h.computeBHitop(byCode).antagonistic;
    assert.equal(h.completionSpec("complete:bhitop").items.length, 45 - antagonistic.codes.length);

    const idasScale = h.IDAS_SCALES[0];
    p.idas[idasScale.id] = {has: true};
    assert.equal(h.completionSpec("complete:idas").items.length, 99 - new Set(idasScale.items).size);
    assert.equal(h.familyActionType("idas"), "complete:idas");
  } finally {
    p.bhitop = saved.bhitop;
    p.pid5 = saved.pid5;
    p.idas = saved.idas;
  }
});

test("S-EDE-Q administration always names the 0 to 6 range", () => {
  const sedeq = h.SCALES["S-EDE-Q"];
  assert.match(sedeq.label, /0 a 6/);
  assert.match(sedeq.instr, /escala 0 a 6/);
  assert.match(sedeq.opts[0], /^0 /);
  assert.match(sedeq.opts[6], /^6 /);
});

test("IDAS-II wellbeing is displayed and scored as absence of wellbeing", () => {
  const wellbeing = h.IDAS_SCALES.find(s => s.id === "bienestar");
  assert.equal(wellbeing.name, "Ausencia de bienestar");

  const highWellbeingAnswers = Array(99).fill(undefined);
  wellbeing.items.forEach(item => { highWellbeingAnswers[item - 1] = 5; });
  assert.equal(h.computeIDAS(highWellbeingAnswers).bienestar.pct, 0);

  const lowWellbeingAnswers = Array(99).fill(undefined);
  wellbeing.items.forEach(item => { lowWellbeingAnswers[item - 1] = 1; });
  assert.equal(h.computeIDAS(lowWellbeingAnswers).bienestar.pct, 100);
});

test("IDAS-II general depression recomputes from answered subscales", () => {
  const p = h.PATIENTS[0];
  const saved = {idas: p.idas, responses: p.responses};
  p.idas = {};
  p.responses = {};

  try {
    ["disforia", "fatiga", "insomnio", "suicidio", "apebaja", "bienestar"].forEach(id => {
      const scale = h.IDAS_SCALES.find(s => s.id === id);
      const key = id === "bienestar" ? "Bienestar" : scale.name;
      p.responses[key] = {
        fecha: "2026-06-07T00:00:00.000Z",
        items: scale.items.map(item => ({
          text: `Item ${item}`,
          answerIndex: 2,
          answerText: "Moderadamente"
        }))
      };
    });

    const gendep = h.IDAS_SCALES.find(s => s.id === "gendep");
    const answered = h.collectIDASAnswerById(p);
    assert.ok(gendep.items.every(item => answered.has(item)));
    assert.equal(h.recomputeIDASFromResponses(p), true);
    assert.equal(p.idas.gendep.has, true);
    assert.equal(p.idas.gendep.raw, 60);
    assert.equal(p.idas.gendep.pct, 50);
  } finally {
    p.idas = saved.idas;
    p.responses = saved.responses;
  }
});

test("PHQ-15 is categorized as disorder scale, not symptom scale", () => {
  const symptomPlan = h.GUIDED_PLAN.find(section => section.key === "sintomas");
  const diagnosticPlan = h.GUIDED_PLAN.find(section => section.key === "categorial");

  assert.equal(h.SYMPTOMS.some(s => s.name === "PHQ-15"), false);
  assert.equal(h.DX_SCALES.some(s => s.src === "PHQ-15"), true);
  assert.equal(symptomPlan.scales.some(s => s.type === "PHQ-15"), false);
  assert.equal(diagnosticPlan.scales.some(s => s.type === "PHQ-15"), true);
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

  const pssMaxPattern = [4,4,4,0,0,0,0,4,0,0,4,4,0,4];
  const pss = h.computePSS14(pssMaxPattern);
  assert.equal(pss.total, 56);
  assert.equal(pss.max, 56);
  assert.equal(pss.pct, 100);
  assert.equal(pss.itemScores[3], 4);
  assert.equal(pss.dimensions.length, 2);
  assert.equal(pss.dimensions.find(d => d.name === "Indefension / estres percibido").total, 28);
  assert.equal(pss.dimensions.find(d => d.name === "Baja autoeficacia / control percibido").total, 28);
  assert.equal(h.GUIDED_PLAN.find(s => s.key === "trans").scales.some(s => s.type === "pss14"), true);
});

test("PSS-14 legacy records hydrate dimensions from item scores", () => {
  const p = h.PATIENTS[0];
  const saved = {context: p.context, responses: p.responses};
  const pss = h.computePSS14([4,4,4,0,0,0,0,4,0,0,4,4,0,4]);
  p.context = {pss14: {total: pss.total, max: pss.max, pct: pss.pct, level: pss.level, label: pss.label, itemScores: pss.itemScores}};
  p.responses = {};

  try {
    assert.equal(p.context.pss14.dimensions, undefined);
    assert.equal(h.hydrateTransdiagnosticDimensions(p, "pss14"), true);
    assert.equal(p.context.pss14.dimensions.length, 2);
    assert.equal(p.context.pss14.dimensions[0].total, 28);
    assert.equal(p.context.pss14.dimensions[1].total, 28);
  } finally {
    p.context = saved.context;
    p.responses = saved.responses;
  }
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

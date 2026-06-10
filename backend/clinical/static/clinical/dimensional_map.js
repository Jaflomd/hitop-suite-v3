(function(){
  var TRANSDIAGNOSTIC = new Set(["DERS-16","AAQ-II","S-UPPS-P","PTQ-15","DJG-6","WHODAS-12","SWLS","ACEs","EQ-5D-5L","EFECO-21"]);
  var NEURODEV = new Set(["ASRS-18","AQ-10"]);

  // Severity glyph map (colorblind-safe)
  var SEVERITY_GLYPH = {high:"▲", mid:"◆", low:"●", empty:""};
  var SEVERITY_CLASS = {high:"sev-high", mid:"sev-mid", low:"sev-low", empty:"sev-empty"};

  // Spectrum → scale ID mapping (matches mapHtml aggregateNode calls)
  var SPECTRUM_SCALES = {
    "Somatoform":       ["PHQ-15"],
    "Internalizing":    ["GAD-7","PHQ-9","PCL-5","SWLS"],
    "Thought Disorder": ["CAPE-POS","CAPE-NEG"],
    "Detachment":       ["AQ-10"],
    "Disinhibited":     ["S-UPPS-P","ASRS-18","AUDIT","DUDIT"],
    "Antagonistic":     ["PID5-ANT"]
  };
  var SPECTRUM_ORDER = ["Somatoform","Internalizing","Thought Disorder","Detachment","Disinhibited","Antagonistic"];

  function esc(value){
    return String(value == null ? "" : value).replace(/[&<>"']/g, function(ch){
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch];
    });
  }

  function catalog(scaleId){
    return (window.HITOP_SCALE_CATALOG || {})[scaleId] || null;
  }

  function scaleLabel(scale){
    var found = catalog(scale.scale_id || scale.id);
    return scale.scale_label || scale.label || (found && found.label) || scale.scale_id || scale.id || "s/d";
  }

  function assignmentScales(assignment){
    if(!assignment || !Array.isArray(assignment.scales)) return [];
    return assignment.scales.map(function(scale){
      return {
        scale_id: scale.scale_id,
        scale_label: scale.scale_label || (catalog(scale.scale_id) || {}).label || scale.scale_id,
        order: scale.order || 0,
        required: scale.required !== false
      };
    }).sort(function(a,b){ return (a.order || 0) - (b.order || 0); });
  }

  function latestResults(results){
    var map = {};
    (results || []).forEach(function(result){
      if(!map[result.scale_id]) map[result.scale_id] = result;
    });
    return map;
  }

  function itemsFor(scaleId){
    var found = catalog(scaleId);
    return found && Array.isArray(found.items) ? found.items.length : 0;
  }

  function progressStats(assignment, results){
    var scales = assignmentScales(assignment);
    var resultByScale = latestResults(results);
    var required = scales.filter(function(scale){ return scale.required; });
    var doneScaleIds = new Set(Object.keys(resultByScale));
    var doneScales = required.filter(function(scale){ return doneScaleIds.has(scale.scale_id); }).length;
    var totalScales = required.length;
    var totalItems = required.reduce(function(sum, scale){ return sum + itemsFor(scale.scale_id); }, 0);
    var doneItems = required.reduce(function(sum, scale){
      return sum + (doneScaleIds.has(scale.scale_id) ? itemsFor(scale.scale_id) : 0);
    }, 0);
    var percent = totalScales ? Math.round(doneScales / totalScales * 100) : 0;
    return {doneScales:doneScales,totalScales:totalScales,doneItems:doneItems,totalItems:totalItems,percent:percent};
  }

  function scalePct(result){
    if(!result) return 0;
    if(typeof result.percentile === "number") return result.percentile;
    var raw = Number(result.raw_value);
    var max = Number(result.max_value);
    return max ? Math.round(raw / max * 100) : 100;
  }

  function levelFor(result){
    if(!result) return "empty";
    if(result.severity === "high") return "high";
    if(result.severity === "mid" || result.severity === "medium") return "mid";
    return "low";
  }

  function glyphFor(level){
    return SEVERITY_GLYPH[level] || "";
  }

  function statusLabel(result, assigned){
    if(result) return result.raw_value + "/" + result.max_value;
    return assigned ? "s/d" : "";
  }

  function firstMatchingScale(scales, ids){
    for(var i=0;i<scales.length;i++){
      if(ids.indexOf(scales[i].scale_id) >= 0) return scales[i];
    }
    return null;
  }

  function aggregateNode(label, scaleIds, ctx){
    var scale = firstMatchingScale(ctx.scales, scaleIds);
    var assigned = !!scale;
    var result = scale ? ctx.resultByScale[scale.scale_id] : null;
    var pct = result ? scalePct(result) : (assigned ? 0 : 0);
    var state = result ? "done" : (assigned ? "assigned" : "empty");
    var selected = scale && scale.scale_id === ctx.selectedScaleId;
    return node({
      label: label,
      sublabel: scale ? scaleLabel(scale) : "",
      value: statusLabel(result, assigned),
      pct: pct,
      level: levelFor(result),
      state: state,
      selected: selected,
      scaleId: scale ? scale.scale_id : ""
    });
  }

  function scaleNode(scale, ctx, labelOverride){
    var result = ctx.resultByScale[scale.scale_id];
    return node({
      label: labelOverride || scaleLabel(scale),
      sublabel: "",
      value: statusLabel(result, true),
      pct: result ? scalePct(result) : 0,
      level: levelFor(result),
      state: result ? "done" : "assigned",
      selected: scale.scale_id === ctx.selectedScaleId,
      scaleId: scale.scale_id
    });
  }

  function node(opts){
    var cls = ["map-node", "status-" + (opts.state || "empty"), "level-" + (opts.level || "empty")];
    if(opts.selected) cls.push("selected");
    var scaleAttr = opts.scaleId ? ' data-scale="' + esc(opts.scaleId) + '"' : "";
    var level = opts.level || "empty";
    var glyph = opts.state === "done" ? glyphFor(level) : "";
    var glyphHtml = glyph ? '<span class="node-glyph ' + SEVERITY_CLASS[level] + '" aria-label="' + esc(level) + '">' + glyph + '</span>' : '';
    return '<button class="' + cls.join(" ") + '"' + scaleAttr + ' type="button">' +
      '<span class="node-top"><span><i class="node-dot"></i>' + esc(opts.label) + '</span>' +
      '<span class="node-top-right">' + glyphHtml + '<strong>' + esc(opts.value || "") + '</strong></span></span>' +
      (opts.sublabel ? '<span class="node-sub">' + esc(opts.sublabel) + '</span>' : '') +
      '<span class="node-track"><i style="width:' + Math.max(0, Math.min(100, opts.pct || 0)) + '%"></i></span>' +
      '</button>';
  }

  function row(label, html, extraClass){
    return '<div class="map-row ' + esc(extraClass || "") + '"><div class="map-row-label">' + esc(label) + '</div><div class="map-row-body">' + html + '</div></div>';
  }

  function fakeTraitCluster(title, labels){
    return '<div class="map-cluster"><div class="cluster-kicker">Rasgos · PID-5</div>' +
      labels.map(function(label){
        return '<div class="trait-line"><span><i class="node-dot"></i>' + esc(label) + '</span><b></b></div>';
      }).join("") +
      '</div>';
  }

  function transdiagnosticRow(ctx){
    var transScales = ctx.scales.filter(function(scale){ return TRANSDIAGNOSTIC.has(scale.scale_id); });
    if(!transScales.length){
      transScales = ["DERS-16","AAQ-II","S-UPPS-P","PTQ-15","DJG-6","SWLS","WHODAS-12","ACEs","EQ-5D-5L","EFECO-21"].map(function(id){
        return {scale_id:id, scale_label:(catalog(id) || {}).label || id, required:true};
      });
    }
    return transScales.map(function(scale){ return scaleNode(scale, ctx); }).join("");
  }

  function neurodevNodes(ctx){
    var asrs = firstMatchingScale(ctx.scales, ["ASRS-18"]);
    var aq = firstMatchingScale(ctx.scales, ["AQ-10"]);
    return [
      aq ? scaleNode(aq, ctx, "TEA") : node({label:"TEA", state:"empty", level:"empty", pct:0, value:"s/d"}),
      asrs ? scaleNode(asrs, ctx, "TDAH") : node({label:"TDAH", state:"empty", level:"empty", pct:0, value:"s/d"})
    ].join("");
  }

  function mapHtml(ctx){
    var stats = ctx.stats;
    var factor = node({
      label: "Factor P (general)",
      value: stats.totalScales ? stats.doneScales + "/" + stats.totalScales : "s/d",
      pct: stats.percent,
      level: stats.percent >= 80 ? "low" : stats.percent > 0 ? "mid" : "empty",
      state: stats.totalScales ? "assigned" : "empty",
      selected: !ctx.selectedScaleId
    });
    var spectrum = [
      aggregateNode("Somatoform", ["PHQ-15"], ctx),
      aggregateNode("Internalizing", ["GAD-7","PHQ-9","PCL-5","SWLS"], ctx),
      aggregateNode("Thought Disorder", ["CAPE-POS","CAPE-NEG"], ctx),
      aggregateNode("Detachment", ["AQ-10"], ctx),
      aggregateNode("Disinhibited Ext.", ["S-UPPS-P","ASRS-18","AUDIT","DUDIT"], ctx),
      aggregateNode("Antagonistic Ext.", ["PID5-ANT"], ctx)
    ].join("");
    var subfactors = [
      node({label:"Sexual Problems", state:"empty", level:"empty", pct:0, value:"s/d"}),
      node({label:"Eating Pathology", state:"empty", level:"empty", pct:0, value:"s/d"}),
      aggregateNode("Fear", ["GAD-7"], ctx),
      aggregateNode("Distress", ["PHQ-9","PCL-5"], ctx),
      node({label:"Mania", state:"empty", level:"empty", pct:0, value:"s/d"})
    ].join("");
    var traits = [
      fakeTraitCluster("Internalizing", ["Ansiedad","Labilidad emocional","Hostilidad","Perseveracion","Anhedonia","Sumision"]),
      fakeTraitCluster("Thought", ["Excentricidad","Disfuncion perceptiva","Creencias inusuales"]),
      fakeTraitCluster("Detachment", ["Anhedonia","Depresividad","Evitacion social","Suspicasia","Retraimiento"]),
      fakeTraitCluster("Disinhibited", ["Distractibilidad","Impulsividad","Irresponsabilidad","Toma de riesgos"]),
      fakeTraitCluster("Antagonistic", ["Busqueda atencion","Insensibilidad","Engano","Grandiosidad","Manipulacion"])
    ].join("");
    var symptoms = [
      aggregateNode("Depresion", ["PHQ-9"], ctx),
      aggregateNode("Ansiedad", ["GAD-7"], ctx),
      aggregateNode("TEPT", ["PCL-5"], ctx),
      aggregateNode("Sustancias", ["AUDIT","DUDIT","FTND"], ctx),
      aggregateNode("Psicosis +", ["CAPE-POS"], ctx),
      aggregateNode("Psicosis -", ["CAPE-NEG"], ctx)
    ].join("");
    var disorders = [
      aggregateNode("TAG", ["GAD-7"], ctx),
      aggregateNode("TDM", ["PHQ-9"], ctx),
      aggregateNode("TEPT", ["PCL-5"], ctx),
      aggregateNode("AUDIT", ["AUDIT"], ctx),
      neurodevNodes(ctx)
    ].join("");
    return row("SUPERESPECTRO", factor, "super") +
      row("ESPECTROS", spectrum, "spectra") +
      row("SUBFACTORES", subfactors, "subfactors") +
      row("RASGOS / TRAITS", traits, "traits") +
      row("SINTOMAS", symptoms, "symptoms") +
      row("TRASTORNOS", disorders, "disorders") +
      row("TRANSDIAGNOSTICO", transdiagnosticRow(ctx), "transdiagnostic");
  }

  function selectedScale(ctx){
    if(ctx.selectedScaleId){
      var scale = ctx.scales.find(function(item){ return item.scale_id === ctx.selectedScaleId; });
      if(scale) return scale;
    }
    var pending = ctx.scales.find(function(scale){ return !ctx.resultByScale[scale.scale_id]; });
    return pending || ctx.scales[0] || null;
  }

  function resultValue(result){
    if(!result) return "sin evaluar";
    return result.raw_value + "/" + result.max_value + " · " + (result.percentile == null ? "s/d" : result.percentile + "/100");
  }

  function dimensionRows(scale, result){
    if(!scale) return '<p class="muted">Sin escala seleccionada.</p>';
    var found = catalog(scale.scale_id);
    var dimensions = result && result.payload && Array.isArray(result.payload.dimensions) ? result.payload.dimensions : null;
    if(dimensions && dimensions.length){
      return dimensions.map(function(dim){
        var value = dim.total != null && dim.max != null ? dim.total + "/" + dim.max : (dim.pct != null ? dim.pct + "/100" : "s/d");
        return '<div class="dim-line"><strong>' + esc(dim.name) + '</strong><span>' + esc(value) + '</span><i style="width:' + Math.max(0, Math.min(100, dim.pct || 0)) + '%"></i></div>';
      }).join("");
    }
    if(result && result.payload && Array.isArray(result.payload.answers) && (scale.scale_id === "SWLS" || scale.scale_id === "EQ-5D-5L")){
      return result.payload.answers.map(function(answer, index){
        var label = found && found.items ? found.items[index] : "Item " + (index + 1);
        var max = found && found.opts ? found.opts.length : 0;
        return '<div class="dim-line"><strong>' + esc(label) + '</strong><span>' + esc(Number(answer) + 1) + (max ? "/" + max : "") + '</span><i style="width:' + (max ? Math.round((Number(answer) + 1) / max * 100) : 0) + '%"></i></div>';
      }).join("");
    }
    if(found && Array.isArray(found.dimensions) && found.dimensions.length){
      return found.dimensions.map(function(dim){
        return '<div class="dim-line"><strong>' + esc(dim.name) + '</strong><span>s/d</span><i style="width:0%"></i></div>';
      }).join("");
    }
    return '<div class="dim-line"><strong>Items</strong><span>' + itemsFor(scale.scale_id) + '</span><i style="width:0%"></i></div>';
  }

  function panelHtml(ctx){
    var scale = selectedScale(ctx);
    if(!scale){
      return '<aside class="map-side-panel"><h2>Sin bateria</h2><p class="muted">No hay escalas asignadas.</p></aside>';
    }
    var found = catalog(scale.scale_id);
    var result = ctx.resultByScale[scale.scale_id];
    var title = scaleLabel(scale);
    var modeLabel = ctx.mode === "patient" ? "Paciente" : ctx.mode === "research" ? "Research" : "Clinico";
    var action = ctx.hasPrimaryAction ? '<button class="map-primary" type="button" data-primary-scale="' + esc(scale.scale_id) + '">' + (result ? "Revisar " : "Hacer ") + esc(title) + '</button>' : "";
    return '<aside class="map-side-panel">' +
      '<div class="side-head"><h2>' + esc(title) + '</h2><span>' + esc(resultValue(result)) + '</span></div>' +
      '<p class="side-sub">' + esc(modeLabel) + ' · ' + esc(found && found.items ? found.items.length : 0) + ' items</p>' +
      '<div class="side-track"><i style="width:' + (result ? scalePct(result) : 0) + '%"></i></div>' +
      action +
      '<h3>Dimensiones</h3>' +
      '<div class="dim-list">' + dimensionRows(scale, result) + '</div>' +
      '</aside>';
  }

  function render(host, opts){
    if(!host) return;
    opts = opts || {};
    var assignment = opts.assignment || null;
    var results = opts.results || [];
    var ctx = {
      assignment: assignment,
      scales: assignmentScales(assignment),
      resultByScale: latestResults(results),
      selectedScaleId: opts.selectedScaleId || "",
      stats: progressStats(assignment, results),
      mode: opts.mode || "clinician",
      hasPrimaryAction: typeof opts.onPrimaryAction === "function"
    };
    var title = assignment ? assignment.template_name : "Sin bateria";
    var progress = ctx.stats.totalItems ? ctx.stats.doneItems + "/" + ctx.stats.totalItems + " items" : ctx.stats.doneScales + "/" + ctx.stats.totalScales + " escalas";
    host.innerHTML = '<div class="dimensional-board">' +
      '<section class="map-main">' +
      '<div class="map-head"><div><h2>MAPA HITOP</h2><p>Color por percentil. Bateria actual: <strong>' + esc(title) + '</strong>.</p></div>' +
      '<div class="battery-progress"><div><span>PROGRESO DE BATERIA</span><strong>' + esc(progress) + '</strong></div><div class="progress"><i style="width:' + ctx.stats.percent + '%"></i></div><p>' + ctx.stats.doneScales + '/' + ctx.stats.totalScales + ' escalas · ' + (ctx.stats.totalItems - ctx.stats.doneItems) + ' items pendientes</p></div></div>' +
      '<div class="map-grid">' + mapHtml(ctx) + '</div>' +
      '<div class="map-legend">' +
      '<span><i></i> sin evaluar</span>' +
      '<span class="sev-low"><i></i><span class="legend-glyph">●</span> baja</span>' +
      '<span class="sev-mid"><i></i><span class="legend-glyph">◆</span> media</span>' +
      '<span class="sev-high"><i></i><span class="legend-glyph">▲</span> alta</span>' +
      '</div>' +
      '</section>' +
      panelHtml(ctx) +
      '</div>';
    host.querySelectorAll("[data-scale]").forEach(function(button){
      button.addEventListener("click", function(){
        var scaleId = button.getAttribute("data-scale");
        if(typeof opts.onSelectScale === "function") opts.onSelectScale(scaleId);
      });
    });
    var primary = host.querySelector("[data-primary-scale]");
    if(primary && typeof opts.onPrimaryAction === "function"){
      primary.addEventListener("click", function(){ opts.onPrimaryAction(primary.getAttribute("data-primary-scale")); });
    }
  }

  window.HITOP_RENDER_DIMENSIONAL_MAP = render;

  // ─── Spectrum percentile computation ──────────────────────────────────────
  // For each spectrum, take the max percentile among its associated scales
  // that have a result. Returns an array of {name, pct, level, hasData}.
  function computeSpectraPercentiles(results){
    var byScale = latestResults(results);
    return SPECTRUM_ORDER.map(function(name){
      var scaleIds = SPECTRUM_SCALES[name] || [];
      var best = null;
      scaleIds.forEach(function(id){
        var r = byScale[id];
        if(r){
          var p = scalePct(r);
          if(best === null || p > best.pct) best = {pct: p, level: levelFor(r)};
        }
      });
      if(!best) return {name: name, pct: 0, level: "empty", hasData: false};
      return {name: name, pct: best.pct, level: best.level, hasData: true};
    });
  }

  // ─── Radar / Spider chart ─────────────────────────────────────────────────
  function HITOP_RENDER_SPECTRA_RADAR(container, opts){
    if(!container) return;
    opts = opts || {};
    var results = opts.results || [];
    var spectra = computeSpectraPercentiles(results);
    var n = spectra.length; // 6
    var cx = 170, cy = 165, r = 110;
    var rings = [25, 50, 75, 100];
    var prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function pt(angle, radius){
      var rad = (angle - 90) * Math.PI / 180;
      return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
    }

    var angleStep = 360 / n;

    // Build ring paths
    var ringsSvg = rings.map(function(pct){
      var rr = r * pct / 100;
      var pts = Array.from({length: n}, function(_, i){ return pt(i * angleStep, rr); });
      var d = "M " + pts.map(function(p){ return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" L ") + " Z";
      var isMajor = pct === 50 || pct === 100;
      return '<path d="' + d + '" fill="none" stroke="#e6e4df" stroke-width="' + (isMajor ? "1.2" : "0.7") + '" />';
    }).join("");

    // Axis lines
    var axesSvg = Array.from({length: n}, function(_, i){
      var tip = pt(i * angleStep, r);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + tip[0].toFixed(1) + '" y2="' + tip[1].toFixed(1) + '" stroke="#e6e4df" stroke-width="0.8" />';
    }).join("");

    // Ring labels (25 / 50 / 75) — minimum 12px per design rules
    var ringLabelsSvg = [25, 50, 75].map(function(pct){
      var pos = pt(0, r * pct / 100);
      return '<text x="' + (pos[0] + 3).toFixed(1) + '" y="' + pos[1].toFixed(1) + '" font-size="12" fill="#aaa" dominant-baseline="middle">' + pct + '</text>';
    }).join("");

    // Polygon data path
    var polyPts = spectra.map(function(s, i){
      var rr = s.hasData ? r * s.pct / 100 : 0;
      return pt(i * angleStep, rr);
    });
    var polyD = "M " + polyPts.map(function(p){ return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" L ") + " Z";

    // Animation: if motion allowed, animate with a CSS animation on the polygon
    var animId = "radar-poly-" + Math.random().toString(36).slice(2);
    var polyStyle = prefersReduced ? "" : 'style="animation:radarFadeIn 0.55s ease forwards"';

    var polygonSvg = '<path id="' + animId + '" d="' + polyD + '" fill="rgba(35,131,226,0.18)" stroke="#2383e2" stroke-width="2" stroke-linejoin="round" ' + polyStyle + ' />';

    // Vertex dots with severity color
    var levelColor = {high:"#c43b32", mid:"#e2922e", low:"#4f9d69", empty:"#ccc"};
    var dotsSvg = spectra.map(function(s, i){
      var rr = s.hasData ? r * s.pct / 100 : 0;
      var p = pt(i * angleStep, rr);
      var col = levelColor[s.level] || "#ccc";
      var dotAnim = prefersReduced ? "" : 'style="animation:radarFadeIn 0.7s ease forwards"';
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="5" fill="' + col + '" stroke="#fff" stroke-width="1.5" ' + dotAnim + ' />';
    }).join("");

    // Labels
    var labelOffset = 20;
    var labelsSvg = spectra.map(function(s, i){
      var angle = i * angleStep;
      var p = pt(angle, r + labelOffset);
      var anchor = "middle";
      if(angle > 10 && angle < 170) anchor = "start";
      else if(angle > 190 && angle < 350) anchor = "end";
      var glyph = s.hasData ? SEVERITY_GLYPH[s.level] || "" : "";
      var glyphCol = levelColor[s.level] || "#ccc";
      var nameAtom = s.hasData ? s.name : s.name;
      var opacity = s.hasData ? "1" : "0.4";
      var pctLabel = s.hasData ? (" " + s.pct + "%") : " s/d";
      var glyphSpan = glyph ? '<tspan fill="' + glyphCol + '">' + glyph + ' </tspan>' : '';
      return '<text x="' + p[0].toFixed(1) + '" y="' + p[1].toFixed(1) + '" text-anchor="' + anchor + '" font-size="12" font-weight="700" fill="#37352f" opacity="' + opacity + '" dominant-baseline="middle">' +
        glyphSpan + esc(nameAtom) +
        '<tspan font-size="12" font-weight="400" fill="#787774">' + esc(pctLabel) + '</tspan>' +
        '</text>';
    }).join("");

    var svgStyle = prefersReduced ? "" : "<style>@keyframes radarFadeIn{from{opacity:0}to{opacity:1}}</style>";

    container.innerHTML = svgStyle +
      '<svg viewBox="-55 0 450 330" role="img" aria-label="Radar de espectros HiTOP" style="width:100%;max-width:420px;display:block;margin:0 auto;overflow:visible">' +
      ringsSvg + axesSvg + ringLabelsSvg + polygonSvg + dotsSvg + labelsSvg +
      '</svg>';
  }

  // ─── Top-5 Elevations card ────────────────────────────────────────────────
  function HITOP_RENDER_ELEVATIONS(container, opts){
    if(!container) return;
    opts = opts || {};
    var results = opts.results || [];
    var byScale = latestResults(results);
    var items = Object.keys(byScale).map(function(id){
      var r = byScale[id];
      return {id: id, label: r.scale_label || id, pct: scalePct(r), level: levelFor(r)};
    }).filter(function(it){ return it.pct > 0; });
    items.sort(function(a, b){ return b.pct - a.pct; });
    var top = items.slice(0, 5);

    if(!top.length){
      container.innerHTML = '<p class="muted elev-empty">Sin resultados disponibles aún.</p>';
      return;
    }
    var levelColor = {high:"var(--bad)", mid:"var(--warn)", low:"var(--ok)", empty:"var(--track)"};
    var rows = top.map(function(it){
      var glyph = SEVERITY_GLYPH[it.level] || "";
      var col = levelColor[it.level] || "var(--track)";
      return '<div class="elev-row">' +
        '<div class="elev-meta">' +
        '<span class="elev-glyph ' + SEVERITY_CLASS[it.level] + '" aria-label="' + esc(it.level) + '">' + glyph + '</span>' +
        '<span class="elev-label">' + esc(it.label) + '</span>' +
        '<span class="elev-pct">' + it.pct + '</span>' +
        '</div>' +
        '<div class="elev-bar-wrap"><div class="elev-bar" style="width:' + it.pct + '%;background:' + col + '"></div></div>' +
        '</div>';
    }).join("");
    container.innerHTML = rows;
  }

  window.HITOP_RENDER_DIMENSIONAL_MAP = render;
  window.HITOP_RENDER_SPECTRA_RADAR = HITOP_RENDER_SPECTRA_RADAR;
  window.HITOP_RENDER_ELEVATIONS = HITOP_RENDER_ELEVATIONS;
})();

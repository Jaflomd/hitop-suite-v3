(function(){
  var TRANSDIAGNOSTIC = new Set(["DERS-16","AAQ-II","S-UPPS-P","PTQ-15","DJG-6","WHODAS-12","SWLS","ACEs","EQ-5D-5L","EFECO-21"]);
  var NEURODEV = new Set(["ASRS-18","AQ-10"]);

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
    return '<button class="' + cls.join(" ") + '"' + scaleAttr + ' type="button">' +
      '<span class="node-top"><span><i class="node-dot"></i>' + esc(opts.label) + '</span><strong>' + esc(opts.value || "") + '</strong></span>' +
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
      '<div class="map-legend"><span><i></i> sin evaluar</span><span><i></i> baja</span><span><i></i> media</span><span><i></i> alta</span></div>' +
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
})();

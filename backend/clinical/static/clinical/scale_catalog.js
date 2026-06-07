(function(){
  function numbered(prefix, n){
    return Array.from({length:n}, function(_, i){ return prefix + " " + (i + 1); });
  }
  function scoreGeneric(scale, answers){
    var maxEach = Math.max(1, (scale.opts || []).length - 1);
    var values = answers.map(function(v){ return Number(v || 0); });
    var total = values.reduce(function(a,b){ return a + b; }, 0);
    var max = values.length * maxEach;
    var pct = max ? Math.round(total / max * 100) : 0;
    var severity = pct >= 67 ? "high" : pct >= 34 ? "mid" : "low";
    var dimensions = (scale.dimensions || []).map(function(dim){
      var dimValues = dim.items.map(function(i){ return values[i] || 0; });
      var dimTotal = dimValues.reduce(function(a,b){ return a + b; }, 0);
      var dimMax = dim.items.length * maxEach;
      var dimPct = dimMax ? Math.round(dimTotal / dimMax * 100) : 0;
      return {name:dim.name,total:dimTotal,max:dimMax,pct:dimPct,level:dimPct>=67?"high":dimPct>=34?"mid":"low"};
    });
    return {
      scale_id: scale.id,
      scale_label: scale.label,
      scoring_version: "webapp-js-v1",
      raw_value: String(total),
      max_value: String(max),
      percentile: pct,
      severity: severity,
      payload: {answers: values, itemScores: values, dimensions: dimensions, profile: scale.id === "EQ-5D-5L" ? values.map(function(v){ return v + 1; }).join("") : ""}
    };
  }
  var freq5 = ["Nunca","Rara vez","A veces","A menudo","Muy a menudo"];
  var agree4 = ["Totalmente en desacuerdo","Parcialmente en desacuerdo","Parcialmente de acuerdo","Totalmente de acuerdo"];
  var yesNo = ["No","Si"];
  var likert5 = ["Nunca","Rara vez","A veces","Frecuentemente","Casi siempre"];
  var catalog = {
    "ASRS-18": {id:"ASRS-18", label:"ASRS-18", opts:freq5, items:[
      "Dificultad para terminar detalles finales de un proyecto.",
      "Dificultad para ordenar cosas en una tarea que requiere organizacion.",
      "Problemas para recordar citas u obligaciones.",
      "Evita o demora empezar tareas que requieren mucha reflexion.",
      "Mueve manos o pies cuando debe permanecer sentado/a.",
      "Se siente demasiado activo/a, como impulsado/a por un motor.",
      "Comete errores por descuido en tareas aburridas o dificiles.",
      "Dificultad para mantener la atencion en tareas repetitivas.",
      "Dificultad para concentrarse cuando alguien le habla directamente.",
      "Pierde u olvida cosas necesarias para tareas.",
      "Se distrae por actividad o ruido alrededor.",
      "Se levanta en reuniones o situaciones donde debe permanecer sentado/a.",
      "Se siente inquieto/a o agitado/a.",
      "Dificultad para relajarse cuando tiene tiempo libre.",
      "Habla demasiado en situaciones sociales.",
      "Termina frases de otros o contesta antes de tiempo.",
      "Dificultad para esperar turno.",
      "Interrumpe a otros cuando estan ocupados."
    ], dimensions:[{name:"Inatencion",items:[0,1,2,3,6,7,8,9,10]},{name:"Hiperactividad/impulsividad",items:[4,5,11,12,13,14,15,16,17]}]},
    "AQ-10": {id:"AQ-10", label:"AQ-10", opts:agree4, items:[
      "A menudo noto sonidos pequenos que otros no perciben.",
      "Suelo concentrarme mas en el cuadro completo que en detalles pequenos.",
      "Me resulta facil hacer mas de una cosa a la vez.",
      "Si me interrumpen, puedo volver rapidamente a lo que estaba haciendo.",
      "Me resulta facil leer entre lineas cuando alguien me habla.",
      "Se darme cuenta cuando quien me escucha se esta aburriendo.",
      "Cuando leo una historia, me cuesta deducir intenciones de personajes.",
      "Me gusta coleccionar informacion sobre categorias de cosas.",
      "Me resulta facil deducir lo que alguien piensa o siente por su cara.",
      "Me cuesta deducir las intenciones de las personas."
    ], dimensions:[{name:"Comunicacion/social",items:[4,5,6,8,9]},{name:"Atencion/cambio/intereses",items:[0,1,2,3,7]}]},
    "WHODAS-12": {id:"WHODAS-12", label:"WHODAS-12", opts:["Ninguna","Leve","Moderada","Severa","Extrema"], items:[
      "Estar de pie durante periodos largos.",
      "Hacerse cargo de responsabilidades del hogar.",
      "Aprender una tarea nueva.",
      "Participar en actividades de la comunidad.",
      "Verse afectado emocionalmente por su problema de salud.",
      "Concentrarse en hacer algo durante 10 minutos.",
      "Caminar largas distancias.",
      "Lavarse todo el cuerpo.",
      "Vestirse.",
      "Tratar con personas que no conoce.",
      "Mantener una amistad.",
      "Realizar trabajo o tareas diarias."
    ], dimensions:[{name:"Cognicion",items:[2,5]},{name:"Movilidad",items:[0,6]},{name:"Autocuidado",items:[7,8]},{name:"Relacionarse",items:[9,10]},{name:"Actividades",items:[1,11]},{name:"Participacion",items:[3,4]}]},
    "SWLS": {id:"SWLS", label:"SWLS", opts:["1","2","3","4","5","6","7"], items:[
      "En la mayoria de aspectos, mi vida es como quiero que sea.",
      "Las condiciones de mi vida son excelentes.",
      "Estoy satisfecho con mi vida.",
      "Hasta ahora he conseguido las cosas importantes que quiero en la vida.",
      "Si pudiera vivir mi vida de nuevo, no cambiaria casi nada."
    ]},
    "ACEs": {id:"ACEs", label:"ACEs", opts:yesNo, items:[
      "Antes de los 18, adulto del hogar le insulto, humillo o hizo sentir miedo.",
      "Antes de los 18, adulto del hogar le golpeo o lesiono fisicamente.",
      "Antes de los 18, contacto sexual no deseado.",
      "Antes de los 18, sintio falta de amor, apoyo o cuidado emocional.",
      "Antes de los 18, falta de comida, ropa, proteccion o cuidado medico.",
      "Antes de los 18, padres/cuidadores se separaron o divorciaron.",
      "Antes de los 18, presencio violencia contra cuidador/a.",
      "Antes de los 18, convivio con consumo problematico de alcohol/drogas.",
      "Antes de los 18, convivio con enfermedad mental grave o suicidio.",
      "Antes de los 18, miembro del hogar encarcelado."
    ], dimensions:[{name:"Abuso",items:[0,1,2]},{name:"Negligencia",items:[3,4]},{name:"Disfuncion hogar",items:[5,6,7,8,9]}]},
    "EQ-5D-5L": {id:"EQ-5D-5L", label:"EQ-5D-5L", opts:["Sin problemas","Problemas leves","Problemas moderados","Problemas graves","Problemas extremos"], items:["Movilidad","Autocuidado","Actividades habituales","Dolor/malestar","Ansiedad/depresion"]},
    "BHITOP": {id:"BHITOP", label:"B-HiTOP", opts:["Para nada","Un poco","Moderadamente","Mucho"], items:numbered("B-HiTOP item",45)},
    "DERS-16": {id:"DERS-16", label:"DERS-16", opts:likert5, items:numbered("Dificultad de regulacion emocional",16), dimensions:[{name:"Claridad",items:[0,1]},{name:"Metas",items:[2,6,14]},{name:"Impulsos",items:[3,7,10]},{name:"No aceptacion",items:[8,9,12]},{name:"Estrategias",items:[4,5,11,13,15]}]},
    "AAQ-II": {id:"AAQ-II", label:"AAQ-II", opts:["1","2","3","4","5","6","7"], items:numbered("Inflexibilidad psicologica",7), dimensions:[{name:"Inflexibilidad/evitacion",items:[0,1,2,3,4,5,6]}]},
    "S-UPPS-P": {id:"S-UPPS-P", label:"S-UPPS-P", opts:["Muy de acuerdo","Algo de acuerdo","Algo en desacuerdo","Muy en desacuerdo"], items:numbered("Impulsividad rasgo",20), dimensions:[{name:"Urgencia negativa",items:[5,7,12,14]},{name:"Premeditacion",items:[3,4,10,11,18]},{name:"Perseverancia",items:[0,1,6]},{name:"Sensaciones",items:[8,13,15,17]},{name:"Urgencia positiva",items:[2,9,16,19]}]},
    "PTQ-15": {id:"PTQ-15", label:"PTQ-15", opts:likert5, items:numbered("Pensamiento repetitivo",15), dimensions:[{name:"Repeticion",items:[0,1,2,5,6,8,13]},{name:"Improductividad",items:[3,9,11]},{name:"Captura mental",items:[4,7,10,12,14]}]},
    "DJG-6": {id:"DJG-6", label:"DJG-6", opts:["No","Mas o menos","Si"], items:numbered("Soledad",6), dimensions:[{name:"Emocional",items:[0,2,4]},{name:"Social",items:[1,3,5]}]},
    "EFECO-21": {id:"EFECO-21", label:"EFECO-21", opts:["Nunca","A veces","Con frecuencia","Con mucha frecuencia"], items:numbered("Funcion ejecutiva",21), dimensions:[{name:"Monitorizacion",items:[0,1,2]},{name:"Inhibicion",items:[3,4,5]},{name:"Flexibilidad",items:[6,7,8]},{name:"Planificacion",items:[9,10,11]},{name:"Organizacion",items:[12,13,14]},{name:"Iniciativa",items:[15,16,17]},{name:"Memoria trabajo",items:[18,19,20]}]},
    "PHQ-9": {id:"PHQ-9", label:"PHQ-9", opts:["Nunca","Varios dias","Mas de la mitad","Casi todos"], items:numbered("Depresion",9)},
    "GAD-7": {id:"GAD-7", label:"GAD-7", opts:["Nunca","Varios dias","Mas de la mitad","Casi todos"], items:numbered("Ansiedad",7)},
    "PCL-5": {id:"PCL-5", label:"PCL-5", opts:["Nada","Un poco","Moderado","Bastante","Extremo"], items:numbered("TEPT",20)},
    "AUDIT": {id:"AUDIT", label:"AUDIT", opts:["0","1","2","3","4"], items:numbered("Alcohol",10)}
  };
  window.HITOP_SCALE_CATALOG = catalog;
  window.HITOP_SCORE_SCALE = scoreGeneric;
})();

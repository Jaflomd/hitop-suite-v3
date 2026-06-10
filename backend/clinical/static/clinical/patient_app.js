/* ============================================================
   Yachay Patient Portal — patient_app.js
   Vanilla JS, no dependencies.
   Requires: scale_catalog.js (HITOP_SCALE_CATALOG, HITOP_SCORE_SCALE)
   ============================================================ */
"use strict";

(function () {

  /* ── State ──────────────────────────────────────────────── */
  var S = {
    patient: null,
    assignments: [],        // all assignments for this patient
    assignment: null,       // active assignment object
    scales: [],             // chapters: [{scale_id, scale_label, done}]
    currentChapterIdx: 0,   // index into S.scales
    currentScale: null,     // {scale_id, scale_label} from next/ API
    answers: [],            // current chapter answers array (sparse, null = unanswered)
    itemIdx: 0,             // current item within chapter
    completedScales: 0,     // count of scales posted this session (for pause suggestion)
    chaptersCompletedSinceLastSuggest: 0,
    pendingQueue: [],        // [{assignmentId, scored, scaleId}] — offline queue
    urlToken: null,
    retryTimer: null
  };

  /* ── DOM refs (populated in init) ──────────────────────── */
  var D = {};

  /* ── Constants ──────────────────────────────────────────── */
  var LS_PREFIX    = "hitop_pp_";
  var LS_PENDING   = "hitop_pp_pending";
  var AUTO_ADVANCE = 280;    // ms after tap before advancing
  var RETRY_DELAY  = 15000;  // ms between offline retries

  var CHEER_MSGS = [
    "Lo estás haciendo muy bien.",
    "Gracias por tu dedicación.",
    "Cada respuesta cuenta. Sigue adelante.",
    "Excelente trabajo hasta aquí.",
    "Tu compromiso hace la diferencia.",
    "Vas muy bien. Solo un poco más."
  ];

  /* ── Helpers ────────────────────────────────────────────── */
  function csrfToken() {
    var m = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/);
    if (m) { return decodeURIComponent(m[1]); }
    var el = document.querySelector("[name=csrfmiddlewaretoken]");
    return el ? el.value : "";
  }

  function api(path, opts) {
    opts = opts || {};
    var method = opts.method || "GET";
    var headers = { "Content-Type": "application/json" };
    if (method !== "GET") { headers["X-CSRFToken"] = csrfToken(); }
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (k) { headers[k] = opts.headers[k]; });
    }
    return fetch(path, {
      credentials: "same-origin",
      method: method,
      headers: headers,
      body: opts.body || undefined
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) {
          var err = new Error(data.error || data.detail || "Error de conexión");
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function timeEstimate(nItems) {
    var secs = nItems * 5;
    var mins = Math.ceil(secs / 60);
    if (mins < 1) { return "menos de 1 min"; }
    return "unos " + mins + " min";
  }

  function lsKey(assignmentId, scaleId) {
    return LS_PREFIX + String(assignmentId) + "_" + scaleId;
  }

  /* ── LocalStorage helpers ───────────────────────────────── */
  function saveProgress(assignmentId, scaleId, answers, idx) {
    try {
      localStorage.setItem(lsKey(assignmentId, scaleId), JSON.stringify({
        answers: answers,
        idx: idx,
        ts: Date.now()
      }));
    } catch (e) { /* storage full — ignore */ }
  }

  function loadProgress(assignmentId, scaleId) {
    try {
      var raw = localStorage.getItem(lsKey(assignmentId, scaleId));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearProgress(assignmentId, scaleId) {
    try { localStorage.removeItem(lsKey(assignmentId, scaleId)); } catch (e) {}
  }

  function loadPendingQueue() {
    try {
      var raw = localStorage.getItem(LS_PENDING);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function savePendingQueue(q) {
    try { localStorage.setItem(LS_PENDING, JSON.stringify(q)); } catch (e) {}
  }

  function enqueuePending(assignmentId, scored, scaleId) {
    var q = loadPendingQueue();
    q.push({ assignmentId: assignmentId, scored: scored, scaleId: scaleId, ts: Date.now() });
    savePendingQueue(q);
    S.pendingQueue = q;
    showRetryNotice(true);
  }

  /* ── Offline retry ──────────────────────────────────────── */
  function startRetryLoop() {
    if (S.retryTimer) { return; }
    S.retryTimer = setInterval(flushPendingQueue, RETRY_DELAY);
  }

  function stopRetryLoop() {
    if (S.retryTimer) { clearInterval(S.retryTimer); S.retryTimer = null; }
  }

  function flushPendingQueue() {
    var q = loadPendingQueue();
    if (!q.length) { stopRetryLoop(); showRetryNotice(false); return; }
    var item = q[0];
    api("/api/patient/assignments/" + item.assignmentId + "/results/", {
      method: "POST",
      body: JSON.stringify(item.scored)
    }).then(function () {
      clearProgress(item.assignmentId, item.scaleId);
      q.shift();
      savePendingQueue(q);
      S.pendingQueue = q;
      if (!q.length) { stopRetryLoop(); showRetryNotice(false); }
    }).catch(function () {
      /* still offline — will retry next cycle */
    });
  }

  function showRetryNotice(visible) {
    if (!D.retryNotice) { return; }
    if (visible) {
      D.retryNotice.classList.add("visible");
      startRetryLoop();
    } else {
      D.retryNotice.classList.remove("visible");
    }
  }

  /* ── Connectivity badge ─────────────────────────────────── */
  function updateConnBadge(online) {
    if (!D.connBadge) { return; }
    if (online) {
      D.connBadge.classList.remove("offline");
      D.connBadge.querySelector(".badge-text").textContent = "Guardado";
    } else {
      D.connBadge.classList.add("offline");
      D.connBadge.querySelector(".badge-text").textContent = "Sin conexión — guardando en la tablet";
    }
  }

  /* ── Screen manager ─────────────────────────────────────── */
  var SCREENS = ["login", "map", "intro", "item", "celebrate", "done"];

  function showScreen(name) {
    SCREENS.forEach(function (s) {
      var el = D["screen_" + s];
      if (!el) { return; }
      if (s === name) {
        el.classList.add("active");
        el.removeAttribute("hidden");
      } else {
        el.classList.remove("active");
        el.setAttribute("hidden", "");
      }
    });
    /* aria-live progress update on item screen */
    if (name === "item" && D.progressAria) {
      updateAriaProgress();
    }
  }

  /* ── Error helpers ──────────────────────────────────────── */
  function showLoginError(msg) {
    if (!D.loginErr) { return; }
    D.loginErr.textContent = msg;
    D.loginErr.classList.add("visible");
  }

  function hideLoginError() {
    if (!D.loginErr) { return; }
    D.loginErr.textContent = "";
    D.loginErr.classList.remove("visible");
  }

  function friendlyError(err) {
    var msg = err.message || "";
    if (err.status === 401 || /invalid|expired|not found|no válido/i.test(msg)) {
      return "Código o DNI incorrecto. Por favor, verifica e intenta de nuevo.";
    }
    if (err.status === 403) {
      return "Acceso no autorizado. Pide al equipo un nuevo código de acceso.";
    }
    if (!navigator.onLine || /network|fetch|conexión/i.test(msg)) {
      return "Sin conexión. Verifica la red e intenta de nuevo.";
    }
    return "Ocurrió un problema. Pide ayuda al equipo.";
  }

  /* ── Login / session management ─────────────────────────── */
  function handleTokenLogin(token) {
    setLoginLoading(true);
    api("/api/patient/auth/token-login/", {
      method: "POST",
      body: JSON.stringify({ token: token })
    }).then(function (data) {
      S.patient = data.patient;
      S.assignments = [data.assignment];
      S.assignment = data.assignment;
      afterLogin();
    }).catch(function (err) {
      setLoginLoading(false);
      showScreen("login");
      showLoginError("Este código no es válido o ya venció. Pide al equipo un nuevo código.");
    });
  }

  function setLoginLoading(loading) {
    if (!D.loginSubmit) { return; }
    D.loginSubmit.disabled = loading;
    D.loginSubmit.innerHTML = loading
      ? '<span class="pp-spinner"></span>'
      : "Entrar";
  }

  function afterLogin() {
    /* remove token from URL without reload */
    if (S.urlToken) {
      var url = new URL(window.location.href);
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.toString());
    }
    api("/api/patient/assignments/").then(function (data) {
      S.assignments = data.assignments || [];
      var notDone = S.assignments.filter(function (a) {
        return a.status !== "completed";
      });
      S.assignment = notDone.length ? notDone[0] : S.assignments[0];
      renderBatterySelector();
      goToMap();
    }).catch(function () {
      /* fallback: proceed with the single assignment from login */
      renderBatterySelector();
      goToMap();
    });
  }

  /* ── Battery selector ───────────────────────────────────── */
  function renderBatterySelector() {
    if (!D.batterySelWrap || !D.batterySel) { return; }
    var notDone = S.assignments.filter(function (a) { return a.status !== "completed"; });
    if (notDone.length > 1) {
      D.batterySelWrap.classList.add("visible");
      D.batterySel.innerHTML = notDone.map(function (a) {
        return '<option value="' + a.id + '">' + escHtml(a.template_name) + ' (' +
          a.progress.done + "/" + a.progress.total + ')</option>';
      }).join("");
      if (S.assignment) { D.batterySel.value = String(S.assignment.id); }
    } else {
      D.batterySelWrap.classList.remove("visible");
    }
  }

  /* ── Journey Map ─────────────────────────────────────────── */
  function goToMap() {
    if (!S.assignment) { showScreen("done"); return; }
    var id = S.assignment.id;
    Promise.all([
      api("/api/patient/assignments/" + id + "/next/"),
      api("/api/patient/assignments/" + id + "/results/").catch(function () { return null; })
    ]).then(function (responses) {
      var data = responses[0];
      var resData = responses[1];
      if (data.assignment) { S.assignment = data.assignment; }
      if (resData && resData.results) { S.assignment.results = resData.results; }
      S.currentScale = data.next_scale;
      buildChapterList();
      renderMap();
      showScreen("map");
    }).catch(function (err) {
      if (err.status === 401 || err.status === 403) {
        showReloginOverlay();
      } else {
        buildChapterList();
        renderMap();
        showScreen("map");
      }
    });
  }

  function buildChapterList() {
    if (!S.assignment) { S.scales = []; return; }
    var raw = (S.assignment.scales || []);
    var results = (S.assignment.results || []);
    var doneIds = {};
    results.forEach(function (r) { doneIds[r.scale_id] = true; });
    /* Also check pending queue: those scales are "done" locally */
    loadPendingQueue().forEach(function (item) {
      if (String(item.assignmentId) === String(S.assignment.id)) {
        doneIds[item.scaleId] = true;
      }
    });
    S.scales = raw.map(function (s) {
      return {
        scale_id: s.scale_id,
        scale_label: s.scale_label,
        done: !!doneIds[s.scale_id]
      };
    });
    /* Determine current chapter idx */
    var nextIdx = S.scales.findIndex(function (s) { return !s.done; });
    S.currentChapterIdx = nextIdx >= 0 ? nextIdx : S.scales.length;
  }

  function renderMap() {
    if (!D.chaptersContainer) { return; }

    /* Map header stats */
    var total = S.scales.length;
    var done  = S.scales.filter(function (s) { return s.done; }).length;
    if (D.mapTitle) {
      D.mapTitle.textContent = done === 0
        ? "Tu evaluación"
        : done === total ? "Evaluación completada" : "Así vas";
    }
    if (D.mapSubtitle) {
      if (done === 0) {
        D.mapSubtitle.textContent = "Aquí verás tu progreso a través de cada sección.";
      } else if (done < total) {
        var remaining = total - done;
        D.mapSubtitle.textContent = "Completaste " + done + " de " + total +
          ". " + (remaining === 1 ? "Queda 1 sección." : "Quedan " + remaining + " secciones.");
      } else {
        D.mapSubtitle.textContent = "¡Completaste todas las secciones!";
      }
    }

    /* Battery selector visibility */
    renderBatterySelector();

    /* Chapters list */
    D.chaptersContainer.innerHTML = "";
    S.scales.forEach(function (sc, idx) {
      var catEntry = HITOP_SCALE_CATALOG[sc.scale_id] || {};
      var nItems   = catEntry.items ? catEntry.items.length : 0;
      var est      = nItems ? timeEstimate(nItems) : "";

      var status = sc.done ? "done"
                 : (idx === S.currentChapterIdx ? "active" : "pending");

      var iconContent = sc.done ? "✓"
                      : (status === "active" ? String(idx + 1) : String(idx + 1));

      var div = document.createElement("div");
      div.className = "pp-chapter chapter-" + status;
      div.setAttribute("role", "listitem");
      div.innerHTML =
        '<div class="pp-chapter-icon" aria-hidden="true">' + iconContent + '</div>' +
        '<div class="pp-chapter-info">' +
          '<div class="pp-chapter-name">' + escHtml(sc.scale_label || sc.scale_id) + '</div>' +
          '<div class="pp-chapter-meta">' +
            (nItems ? nItems + " preguntas" + (est ? " · " + est : "") : "Sección") +
          '</div>' +
        '</div>';
      D.chaptersContainer.appendChild(div);
    });

    /* CTA button */
    if (D.mapStartBtn) {
      if (done === total) {
        D.mapStartBtn.textContent = "Todo completado";
        D.mapStartBtn.disabled = true;
      } else if (done === 0) {
        D.mapStartBtn.textContent = "Comenzar";
        D.mapStartBtn.disabled = false;
      } else {
        D.mapStartBtn.textContent = "Continuar";
        D.mapStartBtn.disabled = false;
      }
    }

    /* Pause button on map */
    if (D.mapPauseBtn) {
      D.mapPauseBtn.classList.toggle("hidden", done === 0);
    }
  }

  /* ── Chapter intro ──────────────────────────────────────── */
  function showChapterIntro() {
    var sc = S.scales[S.currentChapterIdx];
    if (!sc) { showAllDone(); return; }
    var catEntry = HITOP_SCALE_CATALOG[sc.scale_id] || {};
    var nItems   = catEntry.items ? catEntry.items.length : 0;
    var est      = nItems ? timeEstimate(nItems) : "";

    if (D.introNumber) {
      D.introNumber.textContent = "Sección " + (S.currentChapterIdx + 1) + " de " + S.scales.length;
    }
    if (D.introTitle) {
      D.introTitle.textContent = sc.scale_label || sc.scale_id;
    }
    if (D.introInstr) {
      /* generic instruction if scale has none */
      D.introInstr.textContent =
        catEntry.instruction ||
        "Lee cada afirmación y elige la opción que mejor describe tu experiencia reciente.";
    }
    if (D.introMeta) {
      D.introMeta.textContent = nItems + " preguntas" + (est ? " · " + est : "");
    }

    /* Show answer options legend */
    if (D.introOptsList && catEntry.opts) {
      D.introOptsList.innerHTML = catEntry.opts.map(function (o, i) {
        return '<div class="pp-intro-opt">' +
          '<span class="pp-intro-opt-val">' + i + '</span>' +
          escHtml(o) +
          '</div>';
      }).join("");
    }

    showScreen("intro");
  }

  /* ── Item screen ─────────────────────────────────────────── */
  function startChapter() {
    var sc = S.scales[S.currentChapterIdx];
    if (!sc) { showAllDone(); return; }
    var catEntry = HITOP_SCALE_CATALOG[sc.scale_id];
    if (!catEntry) {
      /* Unknown scale — skip gracefully */
      markCurrentChapterDone();
      return;
    }

    /* Restore saved progress */
    var saved = loadProgress(S.assignment.id, sc.scale_id);
    if (saved && Array.isArray(saved.answers) && saved.answers.length === catEntry.items.length) {
      S.answers = saved.answers;
      S.itemIdx = Math.min(saved.idx || 0, catEntry.items.length - 1);
    } else {
      S.answers = new Array(catEntry.items.length).fill(null);
      S.itemIdx = 0;
    }

    renderItem(false);
    showScreen("item");
    hidePauseSuggest();
  }

  function renderItem(direction) {
    var sc = S.scales[S.currentChapterIdx];
    if (!sc) { return; }
    var catEntry = HITOP_SCALE_CATALOG[sc.scale_id];
    if (!catEntry) { return; }

    var totalItems  = catEntry.items.length;
    var totalScales = S.scales.length;
    /* Global item count for progress bar */
    var globalDoneItems = 0;
    var globalTotalItems = 0;
    S.scales.forEach(function (s, idx) {
      var cat = HITOP_SCALE_CATALOG[s.scale_id];
      var n   = cat ? cat.items.length : 0;
      globalTotalItems += n;
      if (s.done || idx < S.currentChapterIdx) {
        globalDoneItems += n;
      } else if (idx === S.currentChapterIdx) {
        globalDoneItems += S.itemIdx;
      }
    });

    /* Progress */
    var pct = globalTotalItems ? Math.round(globalDoneItems / globalTotalItems * 100) : 0;
    if (D.progressFill) { D.progressFill.style.width = pct + "%"; }
    if (D.progressCounter) {
      D.progressCounter.innerHTML =
        "Pregunta <strong>" + (S.itemIdx + 1) + "</strong> de " + totalItems;
    }
    if (D.progressChapter) {
      D.progressChapter.textContent =
        "Sección " + (S.currentChapterIdx + 1) + " de " + totalScales;
    }

    /* Question */
    var questionText = catEntry.items[S.itemIdx];
    /* Back button */
    var canGoBack = (S.itemIdx > 0 || S.currentChapterIdx > 0);
    if (D.backBtn) { D.backBtn.disabled = !canGoBack; }

    /* Animate content area */
    var content = D.itemContent;
    if (content && direction !== undefined) {
      var outClass = direction === "back" ? "pp-item-slide-back-out" : "pp-item-slide-out";
      var inClass  = direction === "back" ? "pp-item-slide-back-in"  : "pp-item-slide-in";
      content.classList.add(outClass);
      content.addEventListener("animationend", function onOut() {
        content.removeEventListener("animationend", onOut);
        content.classList.remove(outClass);
        fillItemContent(catEntry, questionText, totalItems);
        content.classList.add(inClass);
        content.addEventListener("animationend", function onIn() {
          content.removeEventListener("animationend", onIn);
          content.classList.remove(inClass);
        });
      });
    } else {
      fillItemContent(catEntry, questionText, totalItems);
    }

    updateAriaProgress();
  }

  function fillItemContent(catEntry, questionText, totalItems) {
    if (!D.itemQuestion || !D.itemOptions) { return; }
    D.itemQuestion.textContent = questionText;
    D.itemOptions.innerHTML = "";
    var currentAnswer = S.answers[S.itemIdx];
    catEntry.opts.forEach(function (optLabel, optIdx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pp-opt-btn" + (currentAnswer === optIdx ? " selected" : "");
      btn.setAttribute("aria-pressed", currentAnswer === optIdx ? "true" : "false");
      btn.setAttribute("data-value", String(optIdx));
      btn.innerHTML =
        '<span class="pp-opt-number" aria-hidden="true">' + optIdx + '</span>' +
        '<span>' + escHtml(optLabel) + '</span>';
      btn.addEventListener("click", function () { handleAnswer(optIdx); });
      D.itemOptions.appendChild(btn);
    });
  }

  function handleAnswer(value) {
    S.answers[S.itemIdx] = value;

    /* Visual feedback: mark selected */
    var btns = D.itemOptions ? D.itemOptions.querySelectorAll(".pp-opt-btn") : [];
    btns.forEach(function (b) {
      var isThis = Number(b.getAttribute("data-value")) === value;
      b.classList.toggle("selected", isThis);
      b.setAttribute("aria-pressed", isThis ? "true" : "false");
    });

    /* Persist to localStorage immediately */
    var sc = S.scales[S.currentChapterIdx];
    if (sc && S.assignment) {
      saveProgress(S.assignment.id, sc.scale_id, S.answers, S.itemIdx);
    }

    /* Auto-advance after brief pause */
    setTimeout(function () { advanceItem(); }, AUTO_ADVANCE);
  }

  function advanceItem() {
    var sc = S.scales[S.currentChapterIdx];
    if (!sc) { return; }
    var catEntry = HITOP_SCALE_CATALOG[sc.scale_id];
    if (!catEntry) { return; }

    if (S.itemIdx < catEntry.items.length - 1) {
      S.itemIdx++;
      if (S.assignment) {
        saveProgress(S.assignment.id, sc.scale_id, S.answers, S.itemIdx);
      }
      renderItem("forward");
    } else {
      /* Last item in chapter — submit */
      submitChapter();
    }
  }

  function goBack() {
    if (S.itemIdx > 0) {
      S.itemIdx--;
      renderItem("back");
    } else if (S.currentChapterIdx > 0) {
      /* Go back to map instead of into previous chapter */
      goToMap();
    }
  }

  function updateAriaProgress() {
    if (!D.progressAria) { return; }
    var sc = S.scales[S.currentChapterIdx];
    if (!sc) { return; }
    var cat = HITOP_SCALE_CATALOG[sc.scale_id];
    var total = cat ? cat.items.length : 1;
    D.progressAria.textContent =
      "Pregunta " + (S.itemIdx + 1) + " de " + total +
      ", sección " + (S.currentChapterIdx + 1) + " de " + S.scales.length;
  }

  /* ── Submit chapter ─────────────────────────────────────── */
  function submitChapter() {
    var sc = S.scales[S.currentChapterIdx];
    if (!sc) { return; }
    var catEntry = HITOP_SCALE_CATALOG[sc.scale_id];
    if (!catEntry) { markCurrentChapterDone(); return; }

    /* Ensure all answered */
    var hasNull = S.answers.some(function (a) { return a === null; });
    if (hasNull) { return; } /* shouldn't happen with auto-advance */

    var scored = HITOP_SCORE_SCALE(catEntry, S.answers);

    /* Optimistic: mark done locally and show celebration */
    sc.done = true;
    S.completedScales++;
    S.chaptersCompletedSinceLastSuggest++;
    S.currentChapterIdx++;

    showCelebration(scored);

    /* POST (or enqueue if offline) */
    postResult(S.assignment.id, scored, sc.scale_id);
  }

  function postResult(assignmentId, scored, scaleId) {
    api("/api/patient/assignments/" + assignmentId + "/results/", {
      method: "POST",
      body: JSON.stringify(scored)
    }).then(function (data) {
      clearProgress(assignmentId, scaleId);
      if (data.assignment) {
        var prevResults = (S.assignment && S.assignment.results) || [];
        if (data.result) { prevResults = prevResults.concat([data.result]); }
        S.assignment = data.assignment;
        S.assignment.results = prevResults;
      }
      /* Flush any pending items */
      flushPendingQueue();
    }).catch(function () {
      if (!navigator.onLine) {
        enqueuePending(assignmentId, scored, scaleId);
      } else {
        /* Transient error — also enqueue */
        enqueuePending(assignmentId, scored, scaleId);
      }
    });
  }

  function markCurrentChapterDone() {
    var sc = S.scales[S.currentChapterIdx];
    if (sc) { sc.done = true; }
    S.currentChapterIdx++;
    goToMap();
  }

  /* ── Celebration screen ─────────────────────────────────── */
  function showCelebration(scored) {
    var doneSoFar = S.scales.filter(function (s) { return s.done; }).length;
    var total     = S.scales.length;
    var remaining = total - doneSoFar;

    if (D.celebrateMsg) {
      D.celebrateMsg.textContent = randomFrom(CHEER_MSGS);
    }
    if (D.celebrateStat) {
      if (remaining === 0) {
        D.celebrateStat.textContent = "¡Completaste todas las secciones!";
      } else {
        var totalAnswered = 0;
        S.scales.forEach(function (s, idx) {
          if (s.done) {
            var cat = HITOP_SCALE_CATALOG[s.scale_id];
            totalAnswered += cat ? cat.items.length : 0;
          }
        });
        D.celebrateStat.textContent =
          "Llevas " + totalAnswered + " preguntas respondidas.";
      }
    }
    /* Re-trigger SVG animation by cloning */
    if (D.checkmarkSvg) {
      var fresh = D.checkmarkSvg.cloneNode(true);
      D.checkmarkSvg.parentNode.replaceChild(fresh, D.checkmarkSvg);
      D.checkmarkSvg = fresh;
    }

    /* After celebration, show map or done screen */
    var isAllDone = remaining === 0;
    if (D.celebrateNextBtn) {
      D.celebrateNextBtn.textContent = isAllDone ? "Ver resumen" : "Siguiente sección";
      D.celebrateNextBtn.onclick = function () {
        if (isAllDone) { showAllDone(); } else { goToMapOrSuggestPause(); }
      };
    }

    showScreen("celebrate");
  }

  function goToMapOrSuggestPause() {
    /* Suggest pause every 2-3 chapters */
    if (S.chaptersCompletedSinceLastSuggest >= 2 && S.scales.length > 3) {
      S.chaptersCompletedSinceLastSuggest = 0;
      showScreen("map");
      buildChapterList();
      renderMap();
      setTimeout(function () { showPauseSuggest(); }, 800);
    } else {
      goToMap();
    }
  }

  /* ── All done screen ─────────────────────────────────────── */
  function showAllDone() {
    showScreen("done");
  }

  /* ── Pause UI ────────────────────────────────────────────── */
  function showPauseOverlay() {
    if (D.pauseOverlay) { D.pauseOverlay.classList.remove("hidden"); }
    hidePauseSuggest();
  }

  function hidePauseOverlay() {
    if (D.pauseOverlay) { D.pauseOverlay.classList.add("hidden"); }
  }

  function showPauseSuggest() {
    if (D.pauseSuggest) { D.pauseSuggest.classList.remove("hidden"); }
  }

  function hidePauseSuggest() {
    if (D.pauseSuggest) { D.pauseSuggest.classList.add("hidden"); }
  }

  /* ── Re-login overlay ───────────────────────────────────── */
  function showReloginOverlay() {
    if (D.reloginOverlay) { D.reloginOverlay.classList.remove("hidden"); }
  }

  function hideReloginOverlay() {
    if (D.reloginOverlay) { D.reloginOverlay.classList.add("hidden"); }
  }

  /* ── HTML escape ─────────────────────────────────────────── */
  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ── Boot ────────────────────────────────────────────────── */
  function boot() {
    /* Gather DOM refs */
    D.root             = document.getElementById("pp-root");
    D.connBadge        = document.getElementById("pp-conn-badge");
    D.retryNotice      = document.getElementById("pp-retry-notice");
    D.pauseOverlay     = document.getElementById("pp-pause-overlay");
    D.pauseSuggest     = document.getElementById("pp-pause-suggest");
    D.reloginOverlay   = document.getElementById("pp-relogin-overlay");
    D.progressAria     = document.getElementById("pp-progress-aria");

    /* Screens */
    D.screen_login     = document.getElementById("pp-screen-login");
    D.screen_map       = document.getElementById("pp-screen-map");
    D.screen_intro     = document.getElementById("pp-screen-intro");
    D.screen_item      = document.getElementById("pp-screen-item");
    D.screen_celebrate = document.getElementById("pp-screen-celebrate");
    D.screen_done      = document.getElementById("pp-screen-done");

    /* Login */
    D.loginForm        = document.getElementById("pp-login-form");
    D.hclInput         = document.getElementById("pp-hcl");
    D.dniInput         = document.getElementById("pp-dni");
    D.eyeBtn           = document.getElementById("pp-eye-btn");
    D.loginSubmit      = document.getElementById("pp-login-submit");
    D.loginErr         = document.getElementById("pp-login-err");

    /* Map */
    D.mapTitle         = document.getElementById("pp-map-title");
    D.mapSubtitle      = document.getElementById("pp-map-subtitle");
    D.chaptersContainer= document.getElementById("pp-chapters");
    D.mapStartBtn      = document.getElementById("pp-map-start-btn");
    D.mapPauseBtn      = document.getElementById("pp-map-pause-btn");
    D.batterySelWrap   = document.getElementById("pp-battery-sel-wrap");
    D.batterySel       = document.getElementById("pp-battery-sel");

    /* Intro */
    D.introNumber      = document.getElementById("pp-intro-number");
    D.introTitle       = document.getElementById("pp-intro-title");
    D.introInstr       = document.getElementById("pp-intro-instr");
    D.introMeta        = document.getElementById("pp-intro-meta");
    D.introOptsList    = document.getElementById("pp-intro-opts");
    D.introStartBtn    = document.getElementById("pp-intro-start-btn");
    D.introBackBtn     = document.getElementById("pp-intro-back-btn");

    /* Item */
    D.progressFill     = document.getElementById("pp-progress-fill");
    D.progressCounter  = document.getElementById("pp-progress-counter");
    D.progressChapter  = document.getElementById("pp-progress-chapter");
    D.backBtn          = document.getElementById("pp-back-btn");
    D.pauseBtn         = document.getElementById("pp-pause-btn");
    D.itemContent      = document.getElementById("pp-item-content");
    D.itemQuestion     = document.getElementById("pp-item-question");
    D.itemOptions      = document.getElementById("pp-item-options");

    /* Celebrate */
    D.checkmarkSvg     = document.getElementById("pp-checkmark-svg");
    D.celebrateMsg     = document.getElementById("pp-celebrate-msg");
    D.celebrateStat    = document.getElementById("pp-celebrate-stat");
    D.celebrateNextBtn = document.getElementById("pp-celebrate-next-btn");

    /* Pause overlay buttons */
    D.pauseResumeBtn   = document.getElementById("pp-pause-resume-btn");

    /* Pause suggest buttons */
    D.suggestPauseBtn  = document.getElementById("pp-suggest-pause-btn");
    D.suggestDismissBtn= document.getElementById("pp-suggest-dismiss-btn");

    /* Re-login */
    D.reloginForm      = document.getElementById("pp-relogin-form");
    D.reloginHcl       = document.getElementById("pp-relogin-hcl");
    D.reloginDni       = document.getElementById("pp-relogin-dni");
    D.reloginEyeBtn    = document.getElementById("pp-relogin-eye-btn");
    D.reloginErr       = document.getElementById("pp-relogin-err");
    D.reloginSubmit    = document.getElementById("pp-relogin-submit");

    bindEvents();
    initConnectivity();
    restorePendingQueue();

    /* Initial auth check */
    api("/api/auth/csrf/").then(function () {
      var urlToken = new URLSearchParams(window.location.search).get("token");
      S.urlToken = urlToken;
      if (urlToken) {
        showScreen("login"); /* show branded screen briefly */
        handleTokenLogin(urlToken);
        return;
      }
      return api("/api/patient/auth/me/").then(function (me) {
        if (me.authenticated) {
          S.patient = me.patient;
          afterLogin();
        } else {
          showScreen("login");
        }
      });
    }).catch(function () {
      showScreen("login");
    });
  }

  /* ── Event binding ──────────────────────────────────────── */
  function bindEvents() {
    /* Login form */
    if (D.loginForm) {
      D.loginForm.addEventListener("submit", function (e) {
        e.preventDefault();
        hideLoginError();
        var hcl = D.hclInput ? D.hclInput.value.trim() : "";
        var dni = D.dniInput ? D.dniInput.value.trim() : "";
        if (!hcl || !dni) {
          showLoginError("Por favor ingresa tu código y DNI.");
          return;
        }
        setLoginLoading(true);
        api("/api/patient/auth/login/", {
          method: "POST",
          body: JSON.stringify({ hcl_code: hcl, dni: dni })
        }).then(function (data) {
          S.patient = data.patient;
          setLoginLoading(false);
          afterLogin();
        }).catch(function (err) {
          setLoginLoading(false);
          showLoginError(friendlyError(err));
        });
      });
    }

    /* Eye toggle for DNI */
    if (D.eyeBtn && D.dniInput) {
      D.eyeBtn.addEventListener("click", function () {
        var isText = D.dniInput.type === "text";
        D.dniInput.type = isText ? "password" : "text";
        D.eyeBtn.setAttribute("aria-label", isText ? "Mostrar DNI" : "Ocultar DNI");
        D.eyeBtn.textContent = isText ? "👁" : "🙈";
      });
    }

    /* Battery selector */
    if (D.batterySel) {
      D.batterySel.addEventListener("change", function () {
        var sel = S.assignments.find(function (a) {
          return String(a.id) === D.batterySel.value;
        });
        if (sel) {
          S.assignment = sel;
          goToMap();
        }
      });
    }

    /* Map start/continue */
    if (D.mapStartBtn) {
      D.mapStartBtn.addEventListener("click", function () {
        var sc = S.scales[S.currentChapterIdx];
        if (!sc) { return; }
        showChapterIntro();
      });
    }

    /* Map pause button */
    if (D.mapPauseBtn) {
      D.mapPauseBtn.addEventListener("click", showPauseOverlay);
    }

    /* Intro start */
    if (D.introStartBtn) {
      D.introStartBtn.addEventListener("click", startChapter);
    }

    /* Intro back */
    if (D.introBackBtn) {
      D.introBackBtn.addEventListener("click", function () {
        showScreen("map");
        buildChapterList();
        renderMap();
      });
    }

    /* Item back */
    if (D.backBtn) {
      D.backBtn.addEventListener("click", goBack);
    }

    /* Item pause */
    if (D.pauseBtn) {
      D.pauseBtn.addEventListener("click", showPauseOverlay);
    }

    /* Pause overlay resume */
    if (D.pauseResumeBtn) {
      D.pauseResumeBtn.addEventListener("click", hidePauseOverlay);
    }

    /* Pause suggest */
    if (D.suggestPauseBtn) {
      D.suggestPauseBtn.addEventListener("click", function () {
        hidePauseSuggest();
        showPauseOverlay();
      });
    }
    if (D.suggestDismissBtn) {
      D.suggestDismissBtn.addEventListener("click", hidePauseSuggest);
    }

    /* Celebrate next */
    /* celebrateNextBtn.onclick is set dynamically in showCelebration() */

    /* Re-login form */
    if (D.reloginForm) {
      D.reloginForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var hcl = D.reloginHcl ? D.reloginHcl.value.trim() : "";
        var dni = D.reloginDni ? D.reloginDni.value.trim() : "";
        if (!hcl || !dni) { return; }
        if (D.reloginSubmit) { D.reloginSubmit.disabled = true; }
        api("/api/patient/auth/login/", {
          method: "POST",
          body: JSON.stringify({ hcl_code: hcl, dni: dni })
        }).then(function (data) {
          S.patient = data.patient;
          if (D.reloginSubmit) { D.reloginSubmit.disabled = false; }
          hideReloginOverlay();
          goToMap();
        }).catch(function (err) {
          if (D.reloginSubmit) { D.reloginSubmit.disabled = false; }
          if (D.reloginErr) {
            D.reloginErr.textContent = friendlyError(err);
            D.reloginErr.classList.add("visible");
          }
        });
      });
    }

    /* Re-login eye toggle */
    if (D.reloginEyeBtn && D.reloginDni) {
      D.reloginEyeBtn.addEventListener("click", function () {
        var isText = D.reloginDni.type === "text";
        D.reloginDni.type = isText ? "password" : "text";
        D.reloginEyeBtn.setAttribute("aria-label", isText ? "Mostrar DNI" : "Ocultar DNI");
        D.reloginEyeBtn.textContent = isText ? "👁" : "🙈";
      });
    }
  }

  /* ── Connectivity ────────────────────────────────────────── */
  function initConnectivity() {
    updateConnBadge(navigator.onLine);
    window.addEventListener("online", function () {
      updateConnBadge(true);
      flushPendingQueue();
    });
    window.addEventListener("offline", function () {
      updateConnBadge(false);
    });
  }

  function restorePendingQueue() {
    S.pendingQueue = loadPendingQueue();
    if (S.pendingQueue.length) {
      showRetryNotice(true);
    }
  }

  /* ── DOMContentLoaded ────────────────────────────────────── */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})();

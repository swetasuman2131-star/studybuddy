/* StudyBuddy — app logic (vanilla JS, offline-first, localStorage) */
(function () {
  "use strict";

  /* ---------------- storage ---------------- */
  const KEY = "studybuddy.v1";
  const DEFAULT = {
    profile: { name: "", klass: "", streak: 0, lastStudyDay: null, created: null },
    tasks: [], events: [], subjects: [], notes: [], sessions: [], chat: [], cards: [],
    settings: {
      theme: "light", work: 25, short: 5, long: 15, rounds: 4,
      provider: "gemini", model: "gemini-2.5-flash", apiKey: "", useNotesContext: true, autostartBreak: true,
      sound: true, lang: "English"
    }
  };
  let S = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        return Object.assign(structuredClone(DEFAULT), d, {
          profile: Object.assign(structuredClone(DEFAULT.profile), d.profile || {}),
          settings: Object.assign(structuredClone(DEFAULT.settings), d.settings || {})
        });
      }
    } catch (e) { console.warn("load failed", e); }
    const fresh = structuredClone(DEFAULT);
    fresh.profile.created = Date.now();
    return fresh;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast("Storage full — try removing old notes."); }
  }

  /* ---------------- utils ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const todayISO = () => iso(new Date());
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const COLORS = ["#5b5bd6","#0ea5a4","#f59e0b","#ef4444","#8b5cf6","#0ea5e9","#22c55e","#ec4899","#f97316","#14b8a6"];

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }
  function fmtDate(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr + "T00:00:00");
    return d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getFullYear();
  }
  function relDay(isoStr) {
    const t = todayISO();
    if (isoStr === t) return "Today";
    const d = new Date(isoStr + "T00:00:00"), n = new Date(t + "T00:00:00");
    const diff = Math.round((d - n) / 86400000);
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    if (diff > 1 && diff < 7) return DOW[d.getDay()];
    return fmtDate(isoStr);
  }
  function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000); }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function subjectById(id) { return S.subjects.find((s) => s.id === id); }
  function subjectName(id) { const s = subjectById(id); return s ? s.name : "General"; }
  function subjectColor(id) { const s = subjectById(id); return s ? s.color : "#8a8fb0"; }
  let deferredPrompt = null;
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
  function isStandalone() { return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; }
  function canInstall() { return !isStandalone() && (!!deferredPrompt || isIOS()); }
  const LANGS = ["English", "Hindi", "Tamil", "Telugu", "Bengali", "Marathi", "Gujarati", "Kannada", "Malayalam", "Punjabi", "Odia", "Urdu"];
  function langOptions(sel) { return LANGS.map((l) => '<option' + (l === sel ? " selected" : "") + ">" + l + "</option>").join(""); }

  /* ---------------- modal ---------------- */
  function modal(title, html, onMount) {
    const ov = $("#overlay"), sheet = $("#sheet");
    sheet.innerHTML = "<h3>" + escapeHtml(title) + "</h3>" + html;
    ov.classList.add("show");
    if (onMount) onMount(sheet);
  }
  function closeModal() { $("#overlay").classList.remove("show"); $("#sheet").innerHTML = ""; }
  window.addEventListener("click", (e) => { if (e.target.id === "overlay") closeModal(); });

  /* ---------------- theme ---------------- */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", S.settings.theme);
    $("#themeBtn").textContent = S.settings.theme === "dark" ? "☀️" : "🌙";
  }

  /* ---------------- router ---------------- */
  const VIEWS = {};
  let current = "home";
  function go(view) {
    if (!VIEWS[view]) view = "home";
    current = view;
    $$("#tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    const v = $("#view");
    v.innerHTML = VIEWS[view]();
    window.scrollTo(0, 0);
    if (VIEWS[view + "_mount"]) VIEWS[view + "_mount"]();
    location.hash = view;
  }

  /* ================= HOME ================= */
  VIEWS.home = function () {
    const t = todayISO();
    const todaysTasks = S.tasks.filter((x) => x.due === t || (!x.due && !x.done));
    const doneToday = S.tasks.filter((x) => x.done && x.doneOn === t).length;
    const todayMin = S.sessions.filter((s) => s.day === t).reduce((a, b) => a + b.minutes, 0);
    const upcoming = S.events.filter((e) => e.date >= t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
    const syl = syllabusStats();
    const name = S.profile.name ? S.profile.name.split(" ")[0] : "there";
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    let h = "";
    h += '<div class="hero"><div class="row" style="justify-content:space-between;align-items:flex-start">';
    h += "<div><h1>" + greet + ", " + escapeHtml(name) + " 👋</h1>";
    h += '<div class="muted small">' + new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }) + "</div></div>";
    h += '<span class="streak">🔥 ' + S.profile.streak + " day" + (S.profile.streak === 1 ? "" : "s") + "</span></div>";
    h += '<div class="grid g3" style="margin-top:16px">';
    h += stat(todayMin + "m", "Focused today");
    h += stat(doneToday + "/" + (todaysTasks.length || 0), "Tasks done");
    h += stat(syl.pct + "%", "Syllabus");
    h += "</div></div>";

    h += '<div class="qa">';
    h += qa("focus", "⏱️", "Start focus");
    h += qa("tasks", "➕", "Add task");
    h += qa("notes", "📄", "Upload chapter");
    h += qa("doubts", "🤖", "Ask a doubt");
    h += qa("calendar", "📅", "Calendar");
    h += qa("calc", "🧮", "Calculator");
    h += qa("cards", "🃏", "Flashcards");
    h += "</div>";

    if (canInstall()) h += installCard();

    h += '<div class="section-title"><h2>Today\'s tasks</h2><button class="btn sm ghost" onclick="App.go(\'tasks\')">All</button></div>';
    if (!todaysTasks.length) h += emptyBox("🎉", "Nothing due today. Add a task to get started.");
    else h += '<div class="list">' + todaysTasks.slice(0, 5).map(taskRow).join("") + "</div>";

    h += '<div class="section-title"><h2>Coming up</h2><button class="btn sm ghost" onclick="App.go(\'calendar\')">Calendar</button></div>';
    if (!upcoming.length) h += emptyBox("📅", "No exams or deadlines added yet.");
    else h += '<div class="list">' + upcoming.map(eventRow).join("") + "</div>";

    const exams = S.events.filter((e) => e.type === "Exam" && e.date >= t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
    if (exams.length) {
      h += '<div class="section-title"><h2>Exam countdown</h2><button class="btn sm ghost" onclick="App.go(\'calendar\')">Calendar</button></div><div class="grid g2">';
      h += exams.map(examTile).join("");
      h += "</div>";
    }

    if (syl.subjects.length) {
      h += '<div class="section-title"><h2>Syllabus progress</h2><button class="btn sm ghost" onclick="App.go(\'syllabus\')">Open</button></div><div class="card">';
      h += syl.subjects.slice(0, 4).map((s) => progressLine(s.name, s.pct, subjectColor(s.id))).join("");
      h += "</div>";
    }

    if (!S.profile.name) {
      h += '<div class="card"><div class="row" style="justify-content:space-between"><div><b>Set up your profile</b><div class="muted small">Add your name and class to personalise StudyBuddy.</div></div><button class="btn primary sm" onclick="App.settings()">Set up</button></div></div>';
    }
    return h;
  };
  function stat(n, l) { return '<div class="stat"><div class="n">' + n + '</div><div class="l">' + l + "</div></div>"; }
  function qa(v, i, t) { return '<button onclick="App.go(\'' + v + '\')"><span class="i">' + i + "</span>" + t + "</button>"; }
  function emptyBox(i, t) { return '<div class="empty"><span class="big">' + i + "</span>" + t + "</div>"; }
  function installCard() {
    return '<div class="card" style="border-left:4px solid var(--primary)"><div class="row" style="justify-content:space-between"><div><b>📲 Add StudyBuddy to your home screen</b><div class="muted small">Open it like a normal app — full screen, with its own icon, and it works offline.</div></div><button class="btn primary sm" onclick="App.install()">Install</button></div></div>';
  }
  function progressLine(name, pct, color) {
    return '<div style="margin-bottom:11px"><div class="row" style="justify-content:space-between;margin-bottom:5px"><span style="font-weight:650;font-size:13.5px">' + escapeHtml(name) + '</span><span class="muted small">' + pct + '%</span></div><div class="bar"><span style="width:' + pct + "%;background:" + color + '"></span></div></div>';
  }
  function examTile(e) {
    const d = daysBetween(todayISO(), e.date);
    const tone = d <= 1 ? "var(--bad)" : d <= 7 ? "var(--warn)" : "var(--primary)";
    const num = d === 0 ? "Today!" : d;
    return '<div class="stat" style="border-left:4px solid ' + tone + '"><div class="n" style="color:' + tone + '">' + num + '</div>' +
      '<div class="l">' + (d === 0 ? "exam day" : d === 1 ? "day to go" : "days to go") + '</div>' +
      '<div style="font-weight:650;font-size:13px;margin-top:6px">' + escapeHtml(e.title) + '</div>' +
      '<div class="muted small">' + relDay(e.date) + (e.subject ? " · " + escapeHtml(subjectName(e.subject)) : "") + '</div></div>';
  }

  /* ================= TASKS ================= */
  VIEWS.tasks = function () {
    const t = todayISO();
    const groups = {
      Overdue: S.tasks.filter((x) => !x.done && x.due && x.due < t),
      Today: S.tasks.filter((x) => !x.done && (!x.due || x.due === t)),
      Upcoming: S.tasks.filter((x) => !x.done && x.due && x.due > t),
      Done: S.tasks.filter((x) => x.done)
    };
    let h = '<div class="section-title"><h2>Daily tasks</h2><span class="muted small">' + S.tasks.filter((x) => !x.done).length + " pending</span></div>";
    h += '<div class="card"><div class="field"><label>New task</label><input id="tkTitle" placeholder="e.g. Revise Chapter 4 — Motion"></div>';
    h += '<div class="inline-form"><select id="tkSubj">' + subjectOptions() + '</select><input type="date" id="tkDue" value="' + t + '"><select id="tkPrio"><option value="low">Low</option><option value="med" selected>Medium</option><option value="high">High</option></select></div>';
    h += '<div style="margin-top:12px"><button class="btn primary" onclick="App.addTask()">Add task</button></div></div>';

    ["Overdue", "Today", "Upcoming", "Done"].forEach((g) => {
      if (!groups[g].length) return;
      h += '<div class="section-title"><h2>' + g + '</h2><span class="muted small">' + groups[g].length + "</span></div>";
      h += '<div class="list">' + groups[g].map(taskRow).join("") + "</div>";
    });
    if (!S.tasks.length) h += emptyBox("📝", "No tasks yet. Add your first one above.");
    return h;
  };
  function taskRow(x) {
    const pr = { high: "b-high", med: "b-med", low: "b-low" }[x.priority] || "b-low";
    const prl = { high: "High", med: "Medium", low: "Low" }[x.priority] || "";
    let sub = [];
    if (x.subject) sub.push('<span style="color:' + subjectColor(x.subject) + '">●</span> ' + escapeHtml(subjectName(x.subject)));
    if (x.due) sub.push(relDay(x.due));
    return '<div class="item ' + (x.done ? "done" : "") + '">' +
      '<div class="check ' + (x.done ? "on" : "") + '" onclick="App.toggleTask(\'' + x.id + '\')">✓</div>' +
      '<div class="grow"><div class="t">' + escapeHtml(x.title) + '</div>' +
      '<div class="muted small">' + sub.join(" · ") + '</div></div>' +
      '<span class="badge ' + pr + '">' + prl + '</span>' +
      '<button class="iconbtn" style="width:32px;height:32px;font-size:14px" onclick="App.delTask(\'' + x.id + '\')">🗑</button></div>';
  }
  function subjectOptions(sel) {
    let o = '<option value="">General</option>';
    S.subjects.forEach((s) => { o += '<option value="' + s.id + '"' + (sel === s.id ? " selected" : "") + ">" + escapeHtml(s.name) + "</option>"; });
    return o;
  }

  /* ================= CALENDAR ================= */
  let calMonth = new Date().getMonth(), calYear = new Date().getFullYear(), calSel = todayISO();
  VIEWS.calendar = function () {
    const first = new Date(calYear, calMonth, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const ds = iso(d);
      const out = d.getMonth() !== calMonth;
      const evs = S.events.filter((e) => e.date === ds);
      const dots = evs.slice(0, 4).map((e) => '<i style="background:' + typeColor(e.type) + '"></i>').join("");
      cells += '<div class="cal-day' + (out ? " out" : "") + (ds === todayISO() ? " today" : "") + (ds === calSel ? " sel" : "") + '" onclick="App.pickDay(\'' + ds + '\')">' + d.getDate() + (dots ? '<span class="dot">' + dots + "</span>" : "") + "</div>";
    }
    let h = '<div class="section-title"><h2>Calendar</h2></div><div class="card">';
    h += '<div class="cal-head"><button class="iconbtn" onclick="App.calMove(-1)">‹</button><b>' + MONTHS[calMonth] + " " + calYear + '</b><button class="iconbtn" onclick="App.calMove(1)">›</button></div>';
    h += '<div class="cal-grid">' + DOW.map((d) => '<div class="dow">' + d + "</div>").join("") + cells + "</div></div>";

    const dayEvents = S.events.filter((e) => e.date === calSel).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    h += '<div class="section-title"><h2>' + relDay(calSel) + '</h2><button class="btn sm primary" onclick="App.addEvent()">+ Add</button></div>';
    if (!dayEvents.length) h += emptyBox("🗓️", "Nothing on this day. Tap “Add” to schedule an exam, revision or reminder.");
    else h += '<div class="list">' + dayEvents.map(eventRow).join("") + "</div>";
    return h;
  };
  function eventRow(e) {
    return '<div class="item"><div style="width:6px;align-self:stretch;border-radius:6px;background:' + typeColor(e.type) + '"></div>' +
      '<div class="grow"><div class="t">' + escapeHtml(e.title) + '</div><div class="muted small">' + relDay(e.date) + (e.time ? " · " + e.time : "") + (e.subject ? " · " + escapeHtml(subjectName(e.subject)) : "") + (e.note ? " · " + escapeHtml(e.note) : "") + "</div></div>" +
      '<span class="badge b-low">' + escapeHtml(e.type) + '</span>' +
      '<button class="iconbtn" style="width:32px;height:32px;font-size:14px" onclick="App.delEvent(\'' + e.id + '\')">🗑</button></div>';
  }
  function typeColor(t) { return { Exam: "#ef4444", Assignment: "#f59e0b", Revision: "#5b5bd6", Holiday: "#22c55e", Other: "#0ea5e9" }[t] || "#0ea5e9"; }

  /* ================= SYLLABUS ================= */
  VIEWS.syllabus = function () {
    let h = '<div class="section-title"><h2>Syllabus</h2><span class="muted small">' + syllabusStats().pct + "% complete</span></div>";
    h += '<div class="card"><div class="inline-form"><input id="syName" placeholder="Subject name (e.g. Science)"><input id="syColor" type="color" value="#5b5bd6" style="width:52px;flex:none;padding:4px"></div><div style="margin-top:12px"><button class="btn primary" onclick="App.addSubject()">Add subject</button></div></div>';
    if (!S.subjects.length) h += emptyBox("📖", "Add a subject, then list its chapters or topics and tick them off as you revise.");
    S.subjects.forEach((s) => {
      const done = s.topics.filter((t) => t.done).length;
      const pct = s.topics.length ? Math.round((done / s.topics.length) * 100) : 0;
      h += '<div class="card"><div class="row" style="justify-content:space-between"><b style="color:' + s.color + '">' + escapeHtml(s.name) + '</b><button class="iconbtn" style="width:32px;height:32px;font-size:14px" onclick="App.delSubject(\'' + s.id + '\')">🗑</button></div>';
      h += '<div class="row" style="justify-content:space-between;margin:8px 0 6px"><span class="muted small">' + done + "/" + s.topics.length + " topics</span><span class=\"muted small\">" + pct + '%</span></div>';
      h += '<div class="bar"><span style="width:' + pct + "%;background:" + s.color + '"></span></div>';
      h += '<div class="list" style="margin-top:12px">' + s.topics.map((t) => topicRow(s.id, t)).join("") + "</div>";
      h += '<div class="inline-form" style="margin-top:10px"><input placeholder="Add topic / chapter" onkeydown="if(event.key===\'Enter\')App.addTopic(\'' + s.id + '\',this)"></div>';
      h += "</div>";
    });
    return h;
  };
  function topicRow(sid, t) {
    return '<div class="item ' + (t.done ? "done" : "") + '"><div class="check ' + (t.done ? "on" : "") + '" onclick="App.toggleTopic(\'' + sid + '\',\'' + t.id + '\')">✓</div><div class="grow"><div class="t">' + escapeHtml(t.name) + '</div></div><button class="iconbtn" style="width:30px;height:30px;font-size:13px" onclick="App.delTopic(\'' + sid + '\',\'' + t.id + '\')">🗑</button></div>';
  }
  function syllabusStats() {
    let tot = 0, done = 0;
    const subs = S.subjects.map((s) => {
      const d = s.topics.filter((t) => t.done).length;
      tot += s.topics.length; done += d;
      return { id: s.id, name: s.name, pct: s.topics.length ? Math.round((d / s.topics.length) * 100) : 0 };
    });
    return { pct: tot ? Math.round((done / tot) * 100) : 0, subjects: subs.sort((a, b) => b.pct - a.pct) };
  }

  /* ================= FOCUS (Pomodoro) ================= */
  let T = { mode: "work", left: 25 * 60, running: false, id: null, round: 1, subject: "" };
  VIEWS.focus = function () {
    if (!T.running) T.left = dur(T.mode);
    let h = '<div class="section-title"><h2>Focus timer</h2></div><div class="card timer-wrap">';
    h += '<div class="pomo-tabs">' +
      tab("work", "Focus") + tab("short", "Short break") + tab("long", "Long break") + "</div>";
    h += '<div class="dial"><svg width="250" height="250"><circle cx="125" cy="125" r="112" fill="none" stroke="var(--surface-3)" stroke-width="14"/><circle id="ring" cx="125" cy="125" r="112" fill="none" stroke="url(#g)" stroke-width="14" stroke-linecap="round" stroke-dasharray="703.7" stroke-dashoffset="0"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b5bd6"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs></svg>';
    h += '<div class="mode"><div class="time" id="clock">' + mmss(T.left) + '</div><div class="m" id="modeLabel">' + modeName(T.mode) + " · round " + T.round + "</div></div></div>";
    h += '<div class="row" style="justify-content:center;gap:12px">';
    h += '<button class="btn ghost" onclick="App.tReset()">Reset</button>';
    h += '<button class="btn primary" id="startBtn" style="min-width:130px" onclick="App.tToggle()">' + (T.running ? "Pause" : "Start") + "</button>";
    h += '<button class="btn ghost" onclick="App.tSkip()">Skip</button></div>';
    h += '<div class="field" style="margin-top:16px;width:100%;max-width:320px"><label>Studying</label><select id="focusSubj" onchange="App.tSubject(this.value)">' + subjectOptions(T.subject) + "</select></div>";
    h += '<div class="muted small" id="focusHint">' + (T.running ? "Stay on task — you can do this!" : "Pick a subject and press Start. Completed focus sessions are logged automatically.") + "</div>";
    h += "</div>";
    h += '<div class="section-title"><h2>Today</h2></div><div class="grid g2">';
    const tm = S.sessions.filter((s) => s.day === todayISO());
    h += stat(tm.reduce((a, b) => a + b.minutes, 0) + "m", "Focused");
    h += stat(tm.length, "Sessions") + "</div>";
    h += '<div class="section-title"><h2>Timer settings</h2></div><div class="card"><div class="inline-form">' +
      num("Work", "cfgWork", S.settings.work) + num("Short", "cfgShort", S.settings.short) + num("Long", "cfgLong", S.settings.long) + num("Rounds", "cfgRounds", S.settings.rounds) +
      '</div><div style="margin-top:12px"><button class="btn sm primary" onclick="App.saveTimerCfg()">Save</button></div></div>';
    return h;
  };
  function num(l, id, v) { return '<label style="flex:1;min-width:70px"><span class="muted small" style="display:block;margin-bottom:4px">' + l + '</span><input type="number" min="1" id="' + id + '" value="' + v + '"></label>'; }
  function tab(m, l) { return '<button class="chip ' + (T.mode === m ? "active" : "") + '" onclick="App.tSetMode(\'' + m + '\')">' + l + "</button>"; }
  function dur(m) { return (m === "work" ? S.settings.work : m === "short" ? S.settings.short : S.settings.long) * 60; }
  function modeName(m) { return m === "work" ? "Focus" : m === "short" ? "Short break" : "Long break"; }
  function mmss(s) { return pad(Math.floor(s / 60)) + ":" + pad(s % 60); }

  VIEWS.focus_mount = function () { if (T.running) paintTimer(); };
  function paintTimer() {
    const c = $("#clock"); if (!c) return;
    c.textContent = mmss(T.left);
    const total = dur(T.mode) || 1;
    const ring = $("#ring");
    if (ring) ring.setAttribute("stroke-dashoffset", String(703.7 * (1 - T.left / total)));
    const ml = $("#modeLabel"); if (ml) ml.textContent = modeName(T.mode) + " · round " + T.round;
  }
  function tick() {
    T.left--;
    if (T.left <= 0) { finishPhase(); return; }
    paintTimer();
  }
  function finishPhase(skipped) {
    clearInterval(T.id); T.id = null; T.running = false;
    if (T.mode === "work") {
      if (!skipped) logSession(S.settings.work);
      beep();
      if (T.round % S.settings.rounds === 0) { T.mode = "long"; } else { T.mode = "short"; }
      T.round++;
      toast("Focus done! Take a " + modeName(T.mode).toLowerCase() + ".");
    } else {
      beep();
      T.mode = "work";
      toast("Break over — back to focus!");
    }
    T.left = dur(T.mode);
    if (S.settings.autostartBreak) { /* don't autostart; just ready */ }
    if (current === "focus") go("focus");
  }
  function logSession(mins) {
    S.sessions.push({ id: uid(), subject: T.subject || "", minutes: mins, day: todayISO(), at: Date.now() });
    markStudyDay();
    save();
  }
  function markStudyDay() {
    const t = todayISO();
    if (S.profile.lastStudyDay === t) return;
    if (S.profile.lastStudyDay && daysBetween(S.profile.lastStudyDay, t) === 1) S.profile.streak++;
    else S.profile.streak = 1;
    S.profile.lastStudyDay = t;
  }
  function beep() {
    if (!S.settings.sound) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18, 0.36].forEach((d) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.type = "sine";
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.16);
        o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.18);
      });
    } catch (e) {}
  }

  /* ================= NOTES ================= */
  let noteSearch = "";
  VIEWS.notes = function () {
    let h = '<div class="section-title"><h2>Notes</h2><div class="row"><button class="btn sm ghost" onclick="App.go(\'cards\')">🃏 Cards</button><button class="btn sm primary" onclick="App.newNote()">+ New</button></div></div>';
    h += '<div class="card"><div class="upload-drop" onclick="App.pickChapter()"><div style="font-size:26px">📄</div><b>Upload a chapter</b><div class="small">PDF, Word (.docx), text/markdown or a photo of a page — StudyBuddy turns it into notes.</div></div>';
    h += '<input type="file" id="chapFile" class="hidden" accept=".txt,.md,.markdown,.csv,.docx,.pdf,image/*" onchange="App.handleChapter(this.files[0]);this.value=\'\'"></div>';
    h += '<div class="card"><input id="noteSearch" placeholder="Search notes…" value="' + escapeHtml(noteSearch) + '" oninput="App.searchNotes(this.value)"></div>';
    const list = S.notes.filter((n) => !noteSearch || (n.title + " " + n.content).toLowerCase().includes(noteSearch.toLowerCase()));
    if (!list.length) h += emptyBox("📒", noteSearch ? "No notes match your search." : "No notes yet. Upload a chapter or create one.");
    else h += '<div class="list">' + list.sort((a, b) => b.created - a.created).map(noteCard).join("") + "</div>";
    return h;
  };
  function noteCard(n) {
    const snip = n.content.replace(/[#*_>`-]/g, "").replace(/\s+/g, " ").slice(0, 110);
    return '<div class="item tap" onclick="App.openNote(\'' + n.id + '\')"><div style="font-size:22px">📄</div><div class="grow"><div class="t">' + escapeHtml(n.title) + '</div><div class="muted small">' + (n.subject ? escapeHtml(subjectName(n.subject)) + " · " : "") + escapeHtml(snip) + '…</div></div><button class="iconbtn" style="width:32px;height:32px;font-size:14px" onclick="event.stopPropagation();App.delNote(\'' + n.id + '\')">🗑</button></div>';
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const name = (file.name || "").toLowerCase();
      const isImg = file.type.startsWith("image/");
      if (isImg) {
        loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/tesseract.min.js")
          .then(() => Tesseract.recognize(file, "eng", { logger: (m) => { const el = $("#ocrProg"); if (el && m.status === "recognizing text") el.textContent = "Reading image… " + Math.round(m.progress * 100) + "%"; } }))
          .then((r) => resolve(r.data.text)).catch(reject);
      } else if (name.endsWith(".docx")) {
        loadScript("https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js")
          .then(() => file.arrayBuffer())
          .then((buf) => window.mammoth.extractRawText({ arrayBuffer: buf }))
          .then((r) => resolve(r.value)).catch(reject);
      } else if (name.endsWith(".pdf")) {
        loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js")
          .then(() => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
            return file.arrayBuffer();
          })
          .then((buf) => window.pdfjsLib.getDocument({ data: buf }).promise)
          .then((pdf) => {
            const jobs = [];
            for (let i = 1; i <= pdf.numPages; i++) jobs.push(pdf.getPage(i).then((p) => p.getTextContent()).then((tc) => tc.items.map((it) => it.str).join(" ")));
            return Promise.all(jobs);
          })
          .then((pages) => resolve(pages.join("\n\n"))).catch(reject);
      } else {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsText(file);
      }
    });
  }
  const _loaded = {};
  function loadScript(url) {
    if (_loaded[url]) return _loaded[url];
    _loaded[url] = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = url; s.onload = res; s.onerror = () => rej(new Error("Could not load a reader library (check your connection)."));
      document.head.appendChild(s);
    });
    return _loaded[url];
  }

  /* ---- note generation ---- */
  const STOP = new Set("the a an and or but if then this that these those of to in on at by for with as is are was were be been being it its from into their there they we you i he she his her our your not no do does did can could should would will shall may might must about over under more most other some such than too very own same so only both each few".split(" "));
  function cleanText(t) {
    return t.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").replace(/^\s*\d+\s*$/gm, "").trim();
  }
  function sentences(text) {
    return text.replace(/([.!?])\s+/g, "$1\u0001").split(/[\u0001\n]+/).map((s) => s.trim()).filter((s) => s.length > 25 && s.length < 400);
  }
  function wordFreq(sents) {
    const f = {};
    sents.forEach((s) => s.toLowerCase().match(/[a-z]{3,}/g)?.forEach((w) => { if (!STOP.has(w)) f[w] = (f[w] || 0) + 1; }));
    return f;
  }
  function offlineNotes(text, title) {
    const sents = sentences(text);
    const freq = wordFreq(sents);
    const scored = sents.map((s, i) => {
      const ws = s.toLowerCase().match(/[a-z]{3,}/g) || [];
      let sc = ws.reduce((a, w) => a + (STOP.has(w) ? 0 : freq[w] || 0), 0) / Math.sqrt(ws.length + 1);
      sc += Math.max(0, 3 - i * 0.05);
      return { s, i, sc };
    });
    const top = scored.slice().sort((a, b) => b.sc - a.sc).slice(0, 10).sort((a, b) => a.i - b.i).map((x) => x.s);
    const summary = sents.slice(0, 3).join(" ");
    const defs = [];
    sents.forEach((s) => {
      const m = s.match(/^(.{3,60}?)\s+(?:is|are|means|refers to|is defined as|is called)\s+(.{8,})$/i);
      if (m && defs.length < 7) defs.push("- **" + m[1].trim() + "**: " + m[2].trim());
    });
    let md = "## Summary\n" + (summary || "Not enough text to summarise.") + "\n\n";
    md += "## Key points\n" + top.map((s) => "- " + s).join("\n") + "\n\n";
    if (defs.length) md += "## Important terms\n" + defs.join("\n") + "\n\n";
    md += "## Practice questions\n" + top.slice(0, 5).map((s) => {
      const k = (s.match(/[A-Z][a-zA-Z]{4,}/) || [s.split(" ")[1] || "the topic"])[0];
      return "- Explain the role of " + k + " in this chapter.";
    }).join("\n");
    return { title: title, content: md.trim(), source: "offline" };
  }
  function aiNotesPrompt(text, title) {
    return "You are a study-notes generator for an Indian school student. Convert the chapter below into clear, exam-ready study notes.\n" +
      "Output EXACTLY these sections in markdown:\n## Summary (3-4 lines)\n## Key points (8-12 concise bullets)\n## Important terms (term: one-line meaning)\n## Practice questions (5 questions)\n" +
      "Keep language simple. Chapter title: " + title + "\n\n---\n" + text.slice(0, 12000);
  }

  /* ================= FLASHCARDS ================= */
  VIEWS.cards = function () {
    let h = '<div class="section-title"><h2>Flashcards</h2><button class="btn sm ghost" onclick="App.newCard()">+ Card</button></div>';
    h += '<div class="card"><div class="row" style="justify-content:space-between"><div><b>' + S.cards.length + ' card' + (S.cards.length === 1 ? "" : "s") + '</b><div class="muted small">Make cards from a note, or add your own.</div></div>';
    if (S.cards.length) h += '<button class="btn primary sm" onclick="App.studyCards()">Study all</button>';
    h += "</div></div>";
    if (!S.cards.length) { h += emptyBox("🃏", "No flashcards yet. Open a note and tap “Make flashcards”."); return h; }
    const groups = {};
    S.cards.forEach((c) => { const k = c.subject || "_"; (groups[k] = groups[k] || []).push(c); });
    Object.keys(groups).forEach((k) => {
      h += '<div class="section-title"><h2>' + (k === "_" ? "General" : escapeHtml(subjectName(k))) + '</h2><span class="muted small">' + groups[k].length + '</span></div>';
      h += '<div class="list">' + groups[k].map(cardRow).join("") + "</div>";
    });
    return h;
  };
  function cardRow(c) {
    return '<div class="item"><div class="grow"><div class="t">' + escapeHtml(c.front) + '</div><div class="muted small">' + escapeHtml(c.back) + '</div></div><button class="iconbtn" style="width:32px;height:32px;font-size:14px" onclick="App.delCard(\'' + c.id + '\')">🗑</button></div>';
  }
  function offlineCards(text) {
    const out = [], seen = {};
    const add = (f, b) => { f = (f || "").trim(); b = (b || "").trim(); if (f.length < 3 || b.length < 2) return; const k = f.toLowerCase(); if (seen[k]) return; seen[k] = 1; out.push({ front: f, back: b }); };
    const terms = text.match(/##\s*Important terms([\s\S]*?)(\n##|$)/i);
    if (terms) terms[1].split("\n").forEach((l) => { const m = l.match(/^[\s\-*]*\*\*(.+?)\*\*\s*:?\s*(.+)$/); if (m) add(m[1], m[2]); });
    sentences(text).forEach((s) => { const m = s.match(/^(.{3,60}?)\s+(?:is|are|means|refers to|is defined as|is called)\s+(.{8,})$/i); if (m) add("What is " + m[1].trim() + "?", m[2].trim()); });
    return out.slice(0, 25);
  }
  function parseAICards(txt) {
    const out = []; let q = null;
    txt.split("\n").forEach((l) => {
      const mq = l.match(/^\s*(?:Q(?:uestion)?\s*\d*\s*[:.)]|[-*]\s*Q\s*[:.)])\s*(.+)$/i);
      const ma = l.match(/^\s*(?:A(?:nswer)?\s*\d*\s*[:.)]|[-*]\s*A\s*[:.)])\s*(.+)$/i);
      if (mq) q = mq[1].trim();
      else if (ma && q) { out.push({ front: q, back: ma[1].trim() }); q = null; }
    });
    return out;
  }
  let study = null;
  function openStudy() {
    if (!study) return;
    const c = study.deck[study.i];
    let h = '<div class="muted small" style="margin-bottom:10px">Card ' + (study.i + 1) + " of " + study.deck.length + " · " + study.known.size + " known</div>";
    h += '<div class="card tap" style="min-height:150px;display:grid;place-items:center;text-align:center;font-size:18px;font-weight:650;padding:26px" onclick="App.flip()">' + escapeHtml(study.flipped ? c.back : c.front) + "</div>";
    h += '<div class="muted small" style="text-align:center;margin-bottom:10px">' + (study.flipped ? "Tap the card to see the question again" : "Tap the card to reveal the answer") + "</div>";
    h += '<div class="actions">';
    if (study.flipped) h += '<button class="btn ghost" onclick="App.again()">Again</button><button class="btn primary" onclick="App.gotIt()">Got it</button>';
    else h += '<button class="btn ghost" onclick="App.studyNext()">Skip</button>';
    h += "</div>";
    modal("Flashcards", h);
  }

  /* ================= DOUBTS (AI bot) ================= */
  VIEWS.doubts = function () {
    const configured = !!(S.settings.apiKey && S.settings.provider !== "offline");
    let h = '<div class="section-title"><h2>Doubts bot</h2><button class="btn sm ghost" onclick="App.settings()">' + (configured ? "⚙️ " + S.settings.provider : "⚙️ Set up AI") + "</button></div>";
    if (!configured) {
      h += '<div class="card"><b>Offline mode</b><div class="muted small">I can search your own notes and give study tips. To chat online and get real answers, connect a free AI key (Google Gemini has a free tier). Your key stays on this device.</div><div style="margin-top:10px"><button class="btn primary sm" onclick="App.settings()">Connect AI</button></div></div>';
    }
    h += '<div class="field" style="margin-bottom:12px"><label>Answer language</label><select onchange="App.setLang(this.value)">' + langOptions(S.settings.lang) + '</select></div>';
    h += '<div class="card"><div class="chat" id="chat">';
    if (!S.chat.length) h += '<div class="msg bot">Hi! I\'m your study buddy. Ask me any doubt — maths, science, history, anything. ' + (configured ? "" : "(Offline for now — add a key for full answers.)") + "</div>";
    else h += S.chat.map((m) => '<div class="msg ' + (m.role === "user" ? "user" : "bot") + '">' + renderMd(m.content) + "</div>").join("");
    h += '</div><div class="chat-input"><textarea id="doubtInput" placeholder="Type your doubt…" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();App.sendDoubt()}"></textarea><button class="btn primary" id="sendBtn" onclick="App.sendDoubt()">➤</button></div>';
    h += '<div class="row" style="margin-top:8px;justify-content:space-between"><button class="btn sm ghost" onclick="App.clearChat()">Clear chat</button><span class="muted small" id="aiStatus">' + (configured ? "Using " + S.settings.provider + " · " + S.settings.model : "Offline (notes search)") + " · " + S.settings.lang + "</span></div></div>";
    return h;
  };
  VIEWS.doubts_mount = function () { const c = $("#chat"); if (c) c.scrollTop = c.scrollHeight; };

  async function askAI(messages) {
    const s = S.settings;
    if (s.provider === "offline" || !s.apiKey) return offlineAnswer(messages);
    if (s.provider === "gemini") return askGemini(messages, s);
    let url, headers, body, model;
    if (s.provider === "openai") {
      url = "https://api.openai.com/v1/chat/completions";
      headers = { "Content-Type": "application/json", Authorization: "Bearer " + s.apiKey };
      model = s.model || "gpt-4o-mini";
    } else {
      url = "https://api.sarvam.ai/v1/chat/completions";
      headers = { "Content-Type": "application/json", "api-subscription-key": s.apiKey };
      model = s.model || "sarvam-105b";
    }
    body = { model: model, messages: messages, temperature: 0.4, max_tokens: 1200 };
    const res = await fetch(url, { method: "POST", headers: headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error("API error " + res.status + (res.status === 403 ? " — check your API key." : "") + (txt ? " · " + txt.slice(0, 160) : ""));
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error("Empty response from the model.");
    return content;
  }
  async function askGemini(messages, s) {
    const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const models = [s.model || "gemini-2.5-flash", "gemini-2.5-flash", "gemini-2.0-flash"].filter((v, i, a) => a.indexOf(v) === i);
    let lastErr = null;
    for (let k = 0; k < models.length; k++) {
      const url = "https://generativelanguage.googleapis.com/v1beta/models/" + models[k] + ":generateContent";
      const body = { contents: contents };
      if (sys) body.systemInstruction = { parts: [{ text: sys }] };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": s.apiKey }, body: JSON.stringify(body) });
      if (res.ok) {
        const data = await res.json();
        const cand = data.candidates && data.candidates[0];
        const parts = cand && cand.content && cand.content.parts;
        const text = parts ? parts.map((p) => p.text || "").join("").trim() : "";
        if (text) return text;
        lastErr = new Error("Gemini returned an empty answer.");
        continue;
      }
      const txt = await res.text().catch(() => "");
      if (res.status === 404) { lastErr = new Error("Gemini model not found: " + models[k]); continue; }
      throw new Error("Gemini error " + res.status + (res.status === 400 || res.status === 403 ? " — check your API key." : "") + (txt ? " · " + txt.slice(0, 160) : ""));
    }
    throw lastErr || new Error("Gemini request failed.");
  }
  function notesContext(query) {
    if (!S.settings.useNotesContext || !S.notes.length) return "";
    const qw = (query.toLowerCase().match(/[a-z]{4,}/g) || []);
    if (!qw.length) return "";
    const hits = S.notes.map((n) => {
      const hay = (n.title + " " + n.content).toLowerCase();
      const sc = qw.reduce((a, w) => a + (hay.split(w).length - 1), 0);
      return { n: n, sc: sc };
    }).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 2);
    if (!hits.length) return "";
    return "Relevant notes from the student's own material:\n" + hits.map((x) => "# " + x.n.title + "\n" + x.n.content.slice(0, 1500)).join("\n\n");
  }
  function offlineAnswer(messages) {
    const q = messages[messages.length - 1].content;
    const qw = (q.toLowerCase().match(/[a-z]{4,}/g) || []);
    let best = null, bestSc = 0;
    S.notes.forEach((n) => {
      const hay = (n.title + " " + n.content).toLowerCase();
      const sc = qw.reduce((a, w) => a + (hay.split(w).length - 1), 0);
      if (sc > bestSc) { bestSc = sc; best = n; }
    });
    if (best && bestSc > 0) {
      const sents = sentences(best.content).filter((s) => qw.some((w) => s.toLowerCase().includes(w))).slice(0, 4);
      return "From your notes “" + best.title + "”:\n\n" + (sents.length ? sents.map((s) => "• " + s).join("\n") : best.content.slice(0, 500)) +
        "\n\nFor a full explanation of your exact doubt, add an API key in Settings (⚙️) — then I can explain step by step.";
    }
    return "I'm in offline mode, so I can only search your saved notes — and I couldn't find a match for that.\n\nTips:\n• Break the question into smaller parts.\n• Upload the chapter and I'll summarise it.\n• Add an API key in Settings (⚙️) to ask me anything and get a real, step-by-step answer.";
  }

  function renderMd(t) {
    let s = escapeHtml(t);
    s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/^### (.+)$/gm, "<b>$1</b>");
    s = s.replace(/^## (.+)$/gm, "<b>$1</b>");
    s = s.replace(/^- (.+)$/gm, "• $1");
    return s;
  }
  function renderNoteBody(t) {
    return escapeHtml(t)
      .replace(/^### (.+)$/gm, "<h4>$1</h4>")
      .replace(/^## (.+)$/gm, "<h4>$1</h4>")
      .replace(/^# (.+)$/gm, "<h4>$1</h4>")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/^- (.+)$/gm, "• $1");
  }

  /* ================= PROGRESS ================= */
  VIEWS.progress = function () {
    const t = todayISO();
    const last7 = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); last7.push(iso(d)); }
    const byDay = last7.map((d) => ({ d: d, m: S.sessions.filter((s) => s.day === d).reduce((a, b) => a + b.minutes, 0) }));
    const max = Math.max(60, ...byDay.map((x) => x.m));
    const week = byDay.reduce((a, b) => a + b.m, 0);
    const total = S.sessions.reduce((a, b) => a + b.minutes, 0);
    const bySub = {};
    S.sessions.forEach((s) => { bySub[s.subject || "general"] = (bySub[s.subject || "general"] || 0) + s.minutes; });
    const subs = Object.keys(bySub).map((k) => ({ id: k, m: bySub[k] })).sort((a, b) => b.m - a.m);
    const subMax = Math.max(1, ...subs.map((x) => x.m));

    let h = '<div class="section-title"><h2>Study tracking</h2></div>';
    h += '<div class="grid g2">' + stat(Math.round(total / 60 * 10) / 10 + "h", "Total focused") + stat(Math.round(week / 60 * 10) / 10 + "h", "This week") + stat(S.sessions.length, "Sessions") + stat("🔥 " + S.profile.streak, "Day streak") + "</div>";
    h += '<div class="section-title"><h2>Last 7 days</h2><span class="muted small">minutes</span></div><div class="card"><div class="bars">';
    h += byDay.map((x) => '<div class="col"><span class="muted small">' + (x.m || "") + '</span><div class="b" style="height:' + Math.max(3, (x.m / max) * 100) + '%"></div><span class="lb">' + DOW[new Date(x.d + "T00:00:00").getDay()].slice(0, 2) + "</span></div>").join("");
    h += "</div></div>";
    if (subs.length) {
      h += '<div class="section-title"><h2>By subject</h2></div><div class="card">';
      h += subs.map((x) => progressLine(x.id === "general" ? "General" : subjectName(x.id), Math.round((x.m / subMax) * 100), subjectColor(x.id === "general" ? "" : x.id)) + '<div class="muted small" style="margin-top:-6px;margin-bottom:10px">' + Math.round(x.m) + " min</div>").join("");
      h += "</div>";
    }
    const recent = S.sessions.slice(-6).reverse();
    if (recent.length) h += '<div class="section-title"><h2>Recent sessions</h2></div><div class="list">' + recent.map((s) => '<div class="item"><div class="grow"><div class="t">' + escapeHtml(s.subject ? subjectName(s.subject) : "General") + '</div><div class="muted small">' + relDay(s.day) + "</div></div><b>" + s.minutes + "m</b></div>").join("") + "</div>";
    if (!S.sessions.length) h += emptyBox("📊", "No sessions logged yet. Run the Focus timer and your progress shows up here.");
    return h;
  };

  /* ================= CALCULATOR ================= */
  let calcExpr = "", calcRes = "0", calcDeg = true, calcSci = false;
  VIEWS.calc = function () {
    const basic = [["7",""],["8",""],["9",""],["÷","op"],["4",""],["5",""],["6",""],["×","op"],["1",""],["2",""],["3",""],["−","op"],["0",""],["."],["%","op"],["+","op"]];
    const sci = [["sin","fn"],["cos","fn"],["tan","fn"],["√","fn"],["^","op"],["(",""],[" )",""],["π","fn"],["ln","fn"],["log","fn"],["e","fn"],["!","fn"]];
    let h = '<div class="section-title"><h2>Calculator</h2><button class="btn sm ghost" onclick="App.calcToggleSci()">' + (calcSci ? "Basic" : "Scientific") + "</button></div>";
    h += '<div class="calc"><div class="card" style="padding:14px"><div class="screen"><div class="expr">' + escapeHtml(calcExpr || " ") + '</div><div class="res">' + escapeHtml(calcRes) + "</div></div>";
    if (calcSci) h += '<div class="keys sci">' + sci.map((k) => keyBtn(k[0], k[1])).join("") + "</div>";
    h += '<div class="keys">' + basic.map((k) => keyBtn(k[0], k[1])).join("") + "</div>";
    h += '<div class="keys" style="grid-template-columns:repeat(4,1fr);margin-top:9px"><button onclick="App.calcClear()" style="background:var(--bad-soft);color:var(--bad)">AC</button><button onclick="App.calcBack()">⌫</button><button class="eq" style="grid-column:span 2" onclick="App.calcEq()">=</button></div>';
    h += "</div></div>";
    return h;
  };
  function keyBtn(l, cls) {
    const t = l.trim();
    return '<button class="' + (cls || "") + '" onclick="App.calcKey(' + JSON.stringify(l.trim() === ")" ? ")" : t) + ')">' + escapeHtml(t) + "</button>";
  }
  function calcEval(expr) {
    const s = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/π/g, "(3.141592653589793)").replace(/\be\b/g, "(2.718281828459045)");
    let i = 0;
    const D = () => (calcDeg ? Math.PI / 180 : 1);
    function skip() { while (s[i] === " ") i++; }
    function num() { let st = i; while (i < s.length && /[0-9.]/.test(s[i])) i++; return parseFloat(s.slice(st, i)); }
    function ident() { let st = i; while (i < s.length && /[a-z]/i.test(s[i])) i++; return s.slice(st, i); }
    function primary() {
      skip();
      if (s[i] === "(") { i++; const v = exprP(); skip(); if (s[i] === ")") i++; return v; }
      if (/[a-z]/i.test(s[i])) {
        const id = ident();
        const map = { sin: (x) => Math.sin(x * D()), cos: (x) => Math.cos(x * D()), tan: (x) => Math.tan(x * D()), sqrt: Math.sqrt, ln: Math.log, log: Math.log10, abs: Math.abs };
        if (id === "pi") return Math.PI;
        if (id === "e") return Math.E;
        skip();
        let arg;
        if (s[i] === "(") { i++; arg = exprP(); skip(); if (s[i] === ")") i++; } else { arg = primary(); }
        if (map[id]) return map[id](arg);
        throw new Error("bad fn " + id);
      }
      return num();
    }
    function unary() { skip(); if (s[i] === "-") { i++; return -unary(); } if (s[i] === "+") { i++; return unary(); } return postfix(); }
    function postfix() { let v = primary(); skip(); while (s[i] === "!") { v = fact(v); i++; skip(); } return v; }
    function fact(n) { n = Math.round(n); if (n < 0 || n > 170) throw new Error("bad factorial"); let r = 1; for (let k = 2; k <= n; k++) r *= k; return r; }
    function pow() { let v = unary(); skip(); if (s[i] === "^") { i++; v = Math.pow(v, pow()); } return v; }
    function termP() { let v = pow(); skip(); while (s[i] === "*" || s[i] === "/" || s[i] === "%") { const op = s[i++]; const r = pow(); v = op === "*" ? v * r : op === "/" ? v / r : v % r; skip(); } return v; }
    function exprP() { let v = termP(); skip(); while (s[i] === "+" || s[i] === "-") { const op = s[i++]; const r = termP(); v = op === "+" ? v + r : v - r; skip(); } return v; }
    const out = exprP(); skip();
    if (i < s.length) throw new Error("unexpected " + s[i]);
    if (!isFinite(out) || isNaN(out)) throw new Error("undefined");
    return out;
  }
  function fmtNum(n) {
    if (Math.abs(n) >= 1e12 || (Math.abs(n) < 1e-6 && n !== 0)) return n.toExponential(6);
    return String(Math.round(n * 1e10) / 1e10);
  }

  /* ================= SETTINGS ================= */
  function openSettings() {
    const s = S.settings;
    let h = '<div class="field"><label>Your name</label><input id="stName" value="' + escapeHtml(S.profile.name) + '" placeholder="e.g. Aarav"></div>';
    h += '<div class="field"><label>Class / standard</label><input id="stClass" value="' + escapeHtml(S.profile.klass) + '" placeholder="e.g. Class 9"></div>';
    h += '<div class="field"><label>Theme</label><select id="stTheme"><option value="light"' + (s.theme === "light" ? " selected" : "") + '>Light</option><option value="dark"' + (s.theme === "dark" ? " selected" : "") + ">Dark</option></select></div>";
    h += '<label class="row small" style="gap:8px;margin-bottom:6px"><input type="checkbox" id="stSound" style="width:auto"' + (s.sound ? " checked" : "") + "> Play a sound when the timer finishes</label>";
    h += '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0">';
    h += '<b class="small">Doubts bot</b>';
    h += '<div class="field" style="margin-top:8px"><label>Provider</label><select id="stProv" onchange="App.stProvChange(this.value)"><option value="gemini"' + (s.provider === "gemini" ? " selected" : "") + '>Google Gemini (free tier)</option><option value="sarvam"' + (s.provider === "sarvam" ? " selected" : "") + '>Sarvam AI</option><option value="openai"' + (s.provider === "openai" ? " selected" : "") + '>OpenAI</option><option value="offline"' + (s.provider === "offline" ? " selected" : "") + ">Offline (notes only)</option></select></div>";
    h += '<div class="field"><label>Answer language</label><select id="stLang">' + langOptions(s.lang) + '</select></div>';
    h += '<div class="field"><label>API key <span class="muted">(stored only on this device)</span></label><input id="stKey" type="password" value="' + escapeHtml(s.apiKey) + '" placeholder="paste your key"></div>';
    h += '<div class="field"><label>Model</label><input id="stModel" value="' + escapeHtml(s.model) + '"></div>';
    h += '<label class="row small" style="gap:8px;margin-bottom:6px"><input type="checkbox" id="stCtx" style="width:auto"' + (s.useNotesContext ? " checked" : "") + "> Let the bot use my notes as context</label>";
    h += '<div class="muted small" id="stHint">' + (s.provider === "gemini" ? "Get a free key at aistudio.google.com." : s.provider === "openai" ? "Get a key at platform.openai.com." : s.provider === "sarvam" ? "Get a key at dashboard.sarvam.ai." : "No key needed — the bot will only search your notes.") + ' Your key is saved only in this browser and sent straight to the provider.</div>';
    h += '<div style="margin:10px 0 4px"><button class="btn ghost sm" id="testBtn" onclick="App.testAI()">Test connection</button></div>';
    h += '<div class="muted small" id="testOut" style="min-height:16px"></div>';
    h += '<div class="actions"><button class="btn primary" onclick="App.saveSettings()">Save</button><button class="btn ghost" onclick="App.closeModal()">Cancel</button></div>';
    h += '<hr style="border:none;border-top:1px solid var(--border);margin:18px 0"><b class="small">Data</b>';
    h += '<div class="actions"><button class="btn ghost" onclick="App.exportData()">Export backup</button><button class="btn ghost" onclick="App.importData()">Import</button><button class="btn danger" onclick="App.resetData()">Reset all</button></div>';
    h += '<input type="file" id="impFile" class="hidden" accept=".json" onchange="App.doImport(this.files[0])">';
    h += '<div class="muted small" style="margin-top:14px;text-align:center">StudyBuddy · works offline · your data never leaves this device.<br><a href="privacy.html" target="_blank" rel="noopener">Privacy policy</a></div>';
    modal("Settings", h);
  }

  /* ================= App API (bound to window) ================= */
  const App = {
    go: function (v) { go(v); },
    closeModal: closeModal,
    settings: openSettings,

    /* tasks */
    addTask: function () {
      const title = $("#tkTitle").value.trim();
      if (!title) return toast("Enter a task name.");
      S.tasks.push({ id: uid(), title: title, subject: $("#tkSubj").value, due: $("#tkDue").value, priority: $("#tkPrio").value, done: false, created: Date.now() });
      save(); go("tasks"); toast("Task added.");
    },
    toggleTask: function (id) {
      const x = S.tasks.find((t) => t.id === id); if (!x) return;
      x.done = !x.done; x.doneOn = x.done ? todayISO() : null; save(); go(current);
    },
    delTask: function (id) { S.tasks = S.tasks.filter((t) => t.id !== id); save(); go(current); },

    /* calendar */
    calMove: function (d) { calMonth += d; if (calMonth < 0) { calMonth = 11; calYear--; } if (calMonth > 11) { calMonth = 0; calYear++; } go("calendar"); },
    pickDay: function (ds) { calSel = ds; go("calendar"); },
    addEvent: function () {
      let h = '<div class="field"><label>Title</label><input id="evTitle" placeholder="e.g. Maths unit test"></div>';
      h += '<div class="field"><label>Date</label><input type="date" id="evDate" value="' + calSel + '"></div>';
      h += '<div class="inline-form"><div class="field" style="flex:1"><label>Type</label><select id="evType">' + ["Exam","Assignment","Revision","Holiday","Other"].map((x) => "<option>" + x + "</option>").join("") + '</select></div><div class="field" style="flex:1"><label>Time (optional)</label><input type="time" id="evTime"></div></div>';
      h += '<div class="field"><label>Subject</label><select id="evSubj">' + subjectOptions() + "</select></div>";
      h += '<div class="field"><label>Note</label><input id="evNote" placeholder="optional"></div>';
      h += '<div class="actions"><button class="btn primary" onclick="App.saveEvent()">Add</button><button class="btn ghost" onclick="App.closeModal()">Cancel</button></div>';
      modal("New event", h);
    },
    saveEvent: function () {
      const title = $("#evTitle").value.trim(); if (!title) return toast("Enter a title.");
      S.events.push({ id: uid(), title: title, date: $("#evDate").value || calSel, type: $("#evType").value, time: $("#evTime").value, subject: $("#evSubj").value, note: $("#evNote").value.trim() });
      save(); closeModal(); go("calendar"); toast("Event added.");
    },
    delEvent: function (id) { S.events = S.events.filter((e) => e.id !== id); save(); go(current); },

    /* syllabus */
    addSubject: function () {
      const name = $("#syName").value.trim(); if (!name) return toast("Enter a subject name.");
      S.subjects.push({ id: uid(), name: name, color: $("#syColor").value, topics: [] }); save(); go("syllabus");
    },
    delSubject: function (id) { S.subjects = S.subjects.filter((s) => s.id !== id); save(); go("syllabus"); },
    addTopic: function (sid, input) {
      const name = input.value.trim(); if (!name) return;
      const s = subjectById(sid); if (!s) return; s.topics.push({ id: uid(), name: name, done: false }); save(); go("syllabus");
    },
    toggleTopic: function (sid, tid) { const s = subjectById(sid); const t = s && s.topics.find((x) => x.id === tid); if (!t) return; t.done = !t.done; save(); go(current); },
    delTopic: function (sid, tid) { const s = subjectById(sid); if (s) s.topics = s.topics.filter((x) => x.id !== tid); save(); go("syllabus"); },

    /* timer */
    tToggle: function () {
      if (T.running) { clearInterval(T.id); T.id = null; T.running = false; }
      else { T.running = true; T.id = setInterval(tick, 1000); }
      go("focus");
    },
    tReset: function () { clearInterval(T.id); T.id = null; T.running = false; T.left = dur(T.mode); go("focus"); },
    tSkip: function () { clearInterval(T.id); T.id = null; T.running = false; T.left = 0; finishPhase(true); },
    tSetMode: function (m) { clearInterval(T.id); T.id = null; T.running = false; T.mode = m; T.left = dur(m); go("focus"); },
    tSubject: function (v) { T.subject = v; },
    saveTimerCfg: function () {
      const g = (id) => Math.max(1, parseInt($("#" + id).value, 10) || 1);
      S.settings.work = g("cfgWork"); S.settings.short = g("cfgShort"); S.settings.long = g("cfgLong"); S.settings.rounds = g("cfgRounds");
      save(); if (!T.running) T.left = dur(T.mode); go("focus"); toast("Timer settings saved.");
    },

    /* notes */
    searchNotes: function (v) {
      noteSearch = v; if (current !== "notes") return;
      $("#view").innerHTML = VIEWS.notes();
      const el = $("#noteSearch"); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} }
    },
    newNote: function () {
      let h = '<div class="field"><label>Title</label><input id="ntTitle" placeholder="Note title"></div>';
      h += '<div class="field"><label>Subject</label><select id="ntSubj">' + subjectOptions() + "</select></div>";
      h += '<div class="field"><label>Content</label><textarea id="ntBody" style="min-height:180px" placeholder="Write your note…"></textarea></div>';
      h += '<div class="actions"><button class="btn primary" onclick="App.saveNote()">Save</button><button class="btn ghost" onclick="App.closeModal()">Cancel</button></div>';
      modal("New note", h);
    },
    saveNote: function () {
      const title = $("#ntTitle").value.trim() || "Untitled note";
      S.notes.push({ id: uid(), title: title, subject: $("#ntSubj").value, content: $("#ntBody").value, source: "manual", created: Date.now() });
      save(); closeModal(); go("notes"); toast("Note saved.");
    },
    openNote: function (id) {
      const n = S.notes.find((x) => x.id === id); if (!n) return;
      let h = '<div class="muted small" style="margin-bottom:10px">' + (n.subject ? escapeHtml(subjectName(n.subject)) + " · " : "") + new Date(n.created).toLocaleDateString("en-IN") + (n.source === "ai" ? " · AI-generated" : n.source === "offline" ? " · auto-generated" : "") + "</div>";
      h += '<div class="note-body">' + renderNoteBody(n.content) + "</div>";
      h += '<div class="actions"><button class="btn ghost" onclick="App.cardsFromNote(\'' + n.id + '\')">🃏 Make flashcards</button><button class="btn primary" onclick="App.closeModal()">Done</button></div>';
      modal(n.title, h);
    },
    delNote: function (id) { S.notes = S.notes.filter((n) => n.id !== id); save(); go("notes"); },

    pickChapter: function () { $("#chapFile").click(); },
    handleChapter: async function (file) {
      if (!file) return;
      modal("Making notes…", '<div class="empty"><span class="big">📄</span>Reading <b>' + escapeHtml(file.name) + '</b>…<div id="ocrProg" class="small" style="margin-top:8px"></div></div>');
      try {
        const raw = await readFileText(file);
        const text = cleanText(raw);
        if (!text || text.length < 40) throw new Error("Couldn't read enough text from that file.");
        const title = file.name.replace(/\.[^.]+$/, "");
        const useAI = S.settings.apiKey && S.settings.provider !== "offline";
        let note;
        if (useAI) {
          $("#sheet").innerHTML = "<h3>" + escapeHtml(title) + '</h3><div class="empty"><span class="big">🤖</span>Generating smart notes…<div class="small" style="margin-top:8px">Using ' + escapeHtml(S.settings.provider) + "</div></div>";
          try {
            const content = await askAI([{ role: "user", content: aiNotesPrompt(text, title) }]);
            note = { title: title, content: content, source: "ai" };
          } catch (e) { toast("AI failed, used offline notes."); note = offlineNotes(text, title); }
        } else {
          note = offlineNotes(text, title);
        }
        note.id = uid(); note.created = Date.now(); note.subject = "";
        note.content = note.content.slice(0, 200000);
        S.notes.push(note); save();
        let h = '<div class="muted small" style="margin-bottom:10px">' + (note.source === "ai" ? "AI-generated" : "Auto-generated") + " · " + text.length.toLocaleString("en-IN") + " characters read</div>";
        h += '<div class="field"><label>Subject</label><select id="genSubj">' + subjectOptions() + '</select></div><div class="note-body">' + renderNoteBody(note.content) + "</div>";
        h += '<div class="actions"><button class="btn primary" onclick="App.finishChapter(\'' + note.id + '\')">Save to notes</button><button class="btn ghost" onclick="App.closeModal()">Discard</button></div>';
        modal(note.title, h);
      } catch (e) {
        closeModal(); toast(e.message || "Could not read that file.");
      }
    },
    finishChapter: function (id) {
      const n = S.notes.find((x) => x.id === id); if (n) { n.subject = $("#genSubj").value; save(); }
      closeModal(); go("notes"); toast("Saved to notes.");
    },

    /* doubts */
    sendDoubt: async function () {
      const ta = $("#doubtInput"); if (!ta) return;
      const q = ta.value.trim(); if (!q) return;
      ta.value = "";
      S.chat.push({ role: "user", content: q });
      const chat = $("#chat");
      chat.insertAdjacentHTML("beforeend", '<div class="msg user">' + renderMd(q) + "</div>");
      chat.insertAdjacentHTML("beforeend", '<div class="typing" id="typing">StudyBuddy is thinking…</div>');
      chat.scrollTop = chat.scrollHeight;
      const btn = $("#sendBtn"); if (btn) btn.disabled = true;
      try {
        const sys = "You are StudyBuddy, a patient tutor for an Indian school student" + (S.profile.klass ? " in " + S.profile.klass : "") + ". Explain simply, step by step, with a small example. Use short paragraphs and bullet points. Always write your answer in " + S.settings.lang + ".";
        const ctx = notesContext(q);
        const msgs = [{ role: "system", content: sys + (ctx ? "\n\n" + ctx : "") }];
        S.chat.slice(-9).forEach((m) => msgs.push({ role: m.role === "bot" ? "assistant" : "user", content: m.content }));
        const answer = await askAI(msgs);
        S.chat.push({ role: "bot", content: answer });
        const ty = $("#typing"); if (ty) ty.remove();
        chat.insertAdjacentHTML("beforeend", '<div class="msg bot">' + renderMd(answer) + "</div>");
        chat.scrollTop = chat.scrollHeight;
        save();
      } catch (e) {
        const ty = $("#typing"); if (ty) ty.remove();
        chat.insertAdjacentHTML("beforeend", '<div class="msg bot">⚠️ ' + escapeHtml(e.message || "Something went wrong.") + "</div>");
        chat.scrollTop = chat.scrollHeight;
      } finally { if (btn) btn.disabled = false; }
    },
    clearChat: function () { S.chat = []; save(); go("doubts"); },

    /* calculator */
    calcKey: function (k) {
      if (k === "AC") return App.calcClear();
      calcExpr += k; try { calcRes = fmtNum(calcEval(calcExpr)); } catch (e) { calcRes = calcRes; }
      if (current === "calc") $("#view").innerHTML = VIEWS.calc();
    },
    calcClear: function () { calcExpr = ""; calcRes = "0"; go("calc"); },
    calcBack: function () { calcExpr = calcExpr.slice(0, -1); try { calcRes = fmtNum(calcEval(calcExpr)); } catch (e) {} if (current === "calc") $("#view").innerHTML = VIEWS.calc(); },
    calcEq: function () { try { calcRes = fmtNum(calcEval(calcExpr)); calcExpr = calcRes; } catch (e) { calcRes = "Error"; } go("calc"); },
    calcToggleSci: function () { calcSci = !calcSci; go("calc"); },

    /* settings */
    /* flashcards */
    newCard: function () {
      let h = '<div class="field"><label>Question</label><input id="cFront" placeholder="e.g. What is photosynthesis?"></div>';
      h += '<div class="field"><label>Answer</label><textarea id="cBack" style="min-height:80px"></textarea></div>';
      h += '<div class="field"><label>Subject</label><select id="cSubj">' + subjectOptions() + "</select></div>";
      h += '<div class="actions"><button class="btn primary" onclick="App.saveCard()">Save</button><button class="btn ghost" onclick="App.closeModal()">Cancel</button></div>';
      modal("New card", h);
    },
    saveCard: function () {
      const f = $("#cFront").value.trim(), b = $("#cBack").value.trim();
      if (!f || !b) return toast("Enter a question and an answer.");
      S.cards.push({ id: uid(), front: f, back: b, subject: $("#cSubj").value, created: Date.now() });
      save(); closeModal(); go("cards"); toast("Card added.");
    },
    delCard: function (id) { S.cards = S.cards.filter((c) => c.id !== id); save(); go(current); },
    cardsFromNote: async function (id) {
      const n = S.notes.find((x) => x.id === id); if (!n) return;
      modal("Making flashcards…", '<div class="empty"><span class="big">🃏</span>Reading “' + escapeHtml(n.title) + "”…</div>");
      let cards = [];
      if (S.settings.apiKey && S.settings.provider !== "offline") {
        try {
          const txt = await askAI([{ role: "user", content: "Create 10 flashcards from these study notes. Output each as two lines exactly: 'Q: <question>' then 'A: <short answer>'. No numbering and no extra text.\n\n" + n.content.slice(0, 8000) }]);
          cards = parseAICards(txt);
        } catch (e) { toast("AI failed — used offline cards."); }
      }
      if (!cards.length) cards = offlineCards(n.content);
      if (!cards.length) { closeModal(); return toast("Couldn't find questions in that note."); }
      cards.forEach((c) => S.cards.push({ id: uid(), front: c.front, back: c.back, subject: n.subject || "", noteId: n.id, created: Date.now() }));
      save(); closeModal(); go("cards"); toast(cards.length + " flashcards created.");
    },
    studyCards: function () {
      if (!S.cards.length) return toast("No cards to study.");
      study = { deck: S.cards.slice().sort(() => Math.random() - 0.5), i: 0, flipped: false, known: new Set() };
      openStudy();
    },
    flip: function () { if (study) { study.flipped = !study.flipped; openStudy(); } },
    studyNext: function () { if (!study) return; study.i++; study.flipped = false; if (study.i >= study.deck.length) return App.studyDone(); openStudy(); },
    gotIt: function () { if (!study) return; study.known.add(study.deck[study.i].id); App.studyNext(); },
    again: function () {
      if (!study) return;
      const c = study.deck.splice(study.i, 1)[0];
      study.deck.push(c); study.flipped = false;
      if (study.i >= study.deck.length) study.i = 0;
      openStudy();
    },
    studyDone: function () { const k = study ? study.known.size : 0, t = study ? study.deck.length : 0; study = null; closeModal(); toast("Deck done — " + k + "/" + t + " known. Nice!"); },
    setLang: function (v) { S.settings.lang = v; save(); if (current === "doubts") go("doubts"); toast("Answers in " + v + "."); },
    install: async function () {
      if (deferredPrompt && typeof deferredPrompt.prompt === "function") {
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch (e) {}
        deferredPrompt = null;
        go(current);
        return;
      }
      if (isIOS()) {
        modal("Add to Home Screen", '<div class="note-body">On iPhone or iPad:\n\n1. Tap the Share button (the square with an arrow) at the bottom of Safari.\n2. Scroll down and tap Add to Home Screen.\n3. Tap Add.\n\nStudyBuddy then opens full screen, like a normal app.</div><div class="actions"><button class="btn primary" onclick="App.closeModal()">Got it</button></div>');
      } else {
        modal("Add to Home Screen", '<div class="note-body">On Android:\n\n1. Open StudyBuddy in Chrome.\n2. Tap the three-dot menu (top right).\n3. Tap Install app (or Add to Home screen).\n\nStudyBuddy then opens full screen, like a normal app.</div><div class="actions"><button class="btn primary" onclick="App.closeModal()">Got it</button></div>');
      }
    },
    testAI: async function () {
      const key = $("#stKey").value.trim(), prov = $("#stProv").value, model = $("#stModel").value.trim();
      const out = $("#testOut"), btn = $("#testBtn");
      if (!key && prov !== "offline") { if (out) out.textContent = "Paste an API key first."; return toast("Paste an API key first."); }
      if (btn) { btn.disabled = true; btn.textContent = "Testing…"; }
      const prev = { provider: S.settings.provider, apiKey: S.settings.apiKey, model: S.settings.model };
      try {
        S.settings.provider = prov; S.settings.apiKey = key; S.settings.model = model;
        const reply = await askAI([{ role: "user", content: "Reply with exactly: OK" }]);
        if (out) out.textContent = "Connected — the bot replied: " + String(reply).slice(0, 90);
        toast("Connected!");
      } catch (e) {
        if (out) out.textContent = "Could not connect: " + (e.message || "unknown error");
        toast("Could not connect.");
      } finally {
        S.settings.provider = prev.provider; S.settings.apiKey = prev.apiKey; S.settings.model = prev.model;
        if (btn) { btn.disabled = false; btn.textContent = "Test connection"; }
      }
    },

    stProvChange: function (v) {
      const m = $("#stModel");
      if (v === "openai") m.value = "gpt-4o-mini";
      else if (v === "sarvam") m.value = "sarvam-105b";
      else if (v === "gemini") m.value = "gemini-2.5-flash";
      $("#stHint").textContent = v === "sarvam" ? "Get a key at dashboard.sarvam.ai (api-subscription-key)." : v === "openai" ? "Get a key at platform.openai.com." : v === "gemini" ? "Get a free key at aistudio.google.com — Google Gemini has a free tier." : "No key needed — the bot will only search your notes.";
    },
    saveSettings: function () {
      S.profile.name = $("#stName").value.trim();
      S.profile.klass = $("#stClass").value.trim();
      S.settings.theme = $("#stTheme").value;
      S.settings.provider = $("#stProv").value;
      S.settings.apiKey = $("#stKey").value.trim();
      S.settings.model = $("#stModel").value.trim();
      S.settings.useNotesContext = $("#stCtx").checked;
      S.settings.sound = $("#stSound").checked;
      S.settings.lang = $("#stLang").value;
      save(); applyTheme(); closeModal(); go(current); toast("Settings saved.");
    },
    exportData: function () {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "studybuddy-backup.json"; a.click();
      toast("Backup downloaded.");
    },
    importData: function () { $("#impFile").click(); },
    doImport: function (file) {
      if (!file) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const d = JSON.parse(fr.result);
          S = Object.assign(structuredClone(DEFAULT), d, { profile: Object.assign(structuredClone(DEFAULT.profile), d.profile || {}), settings: Object.assign(structuredClone(DEFAULT.settings), d.settings || {}) });
          save(); applyTheme(); closeModal(); go("home"); toast("Backup imported.");
        } catch (e) { toast("That file isn't a valid backup."); }
      };
      fr.readAsText(file);
    },
    resetData: function () {
      if (!confirm("Delete ALL StudyBuddy data on this device? This cannot be undone.")) return;
      localStorage.removeItem(KEY); S = structuredClone(DEFAULT); S.profile.created = Date.now();
      save(); applyTheme(); closeModal(); go("home"); toast("All data cleared.");
    }
  };
  window.App = App;

  /* ---------------- init ---------------- */
  let booted = false;
  function init() {
    if (booted) return; booted = true;
    applyTheme();
    $("#themeBtn").onclick = () => { S.settings.theme = S.settings.theme === "dark" ? "light" : "dark"; save(); applyTheme(); };
    $("#moreBtn").onclick = () => {
      let h = '<div class="list">';
      h += '<button class="item tap" onclick="App.closeModal();App.go(\'calendar\')"><span style="font-size:20px">📅</span><div class="grow"><div class="t">Calendar</div></div></button>';
      h += '<button class="item tap" onclick="App.closeModal();App.go(\'syllabus\')"><span style="font-size:20px">📖</span><div class="grow"><div class="t">Syllabus</div></div></button>';
      h += '<button class="item tap" onclick="App.closeModal();App.go(\'progress\')"><span style="font-size:20px">📊</span><div class="grow"><div class="t">Study tracking</div></div></button>';
      h += '<button class="item tap" onclick="App.closeModal();App.go(\'calc\')"><span style="font-size:20px">🧮</span><div class="grow"><div class="t">Calculator</div></div></button>';
      h += '<button class="item tap" onclick="App.closeModal();App.go(\'cards\')"><span style="font-size:20px">🃏</span><div class="grow"><div class="t">Flashcards</div></div></button>';
      if (!isStandalone()) h += '<button class="item tap" onclick="App.closeModal();App.install()"><span style="font-size:20px">📲</span><div class="grow"><div class="t">Add to home screen</div></div></button>';
      h += '<button class="item tap" onclick="App.settings()"><span style="font-size:20px">⚙️</span><div class="grow"><div class="t">Settings</div></div></button>';
      h += "</div>";
      modal("Menu", h);
    };
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; if (current === "home") go("home"); });
    window.addEventListener("appinstalled", () => { deferredPrompt = null; toast("StudyBuddy was added to your home screen."); });
    $$("#tabbar button").forEach((b) => b.onclick = () => go(b.dataset.view));
    $("#brandDate").textContent = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    const start = (location.hash || "").replace("#", "");
    go(VIEWS[start] ? start : "home");
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") init();
})();

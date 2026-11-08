(() => {
  "use strict";

  // ---------- constants ----------
  const STATUSES = [
    ["", "Не указан"],
    ["hypothesis", "Гипотеза"],
    ["single-source", "Один источник"],
    ["corroborated", "Подтверждено"],
    ["strongly-corroborated", "Надёжно подтверждено"],
    ["contradicted", "Противоречие"],
    ["unresolved", "Не решено"],
  ];
  const STATUS_LABEL = Object.fromEntries(STATUSES);
  const STATUS_COLOR = {
    hypothesis: "#ff9f0a", "single-source": "#ffd60a", corroborated: "#63da7d",
    "strongly-corroborated": "#30d158", contradicted: "#ff453a", unresolved: "#8e8e93",
  };
  const SEX_COLOR = { M: "#0a84ff", F: "#ff375f", U: "#8e8e93" };
  const WEAK = new Set(["hypothesis", "unresolved"]);
  const weakLink = (...ids) => (ids.some((id) => P(id) && WEAK.has(P(id).status)) ? "weak" : "");
  const SEX_LABEL = { M: "Мужской", F: "Женский", U: "Не указан" };

  const CARD_W = 210, CARD_H = 76, SP_W = 172, SP_GAP = 18, GAP_X = 28, ROW_H = 150;
  const LS_DATA = "rod-tree", LS_FOCUS = "rod-focus";

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");

  const state = {
    data: { meta: {}, people: [], families: [] },
    focusId: null,
    view: "full",
    depthUp: 4,
    depthDown: 3,
    privacy: false,
    serverMode: true,
    readOnly: false,
    site: null,          // опубликованная версия с правкой через GitHub: { repo, path, branch, iter, pass, token, sha, user }
    user: null,          // имя учётки, под которой вошли на сайт
    userRoot: null,      // главный человек этой учётки (на сайте у каждого свой)
    panelOpen: false,
    firstRender: true,
  };
  let idx = { people: new Map(), asPartner: new Map(), asChild: new Map() };

  // ---------- data helpers ----------
  function reindex() {
    const people = new Map(state.data.people.map((p) => [p.id, p]));
    const asPartner = new Map(), asChild = new Map();
    for (const f of state.data.families) {
      f.partners = f.partners || [];
      f.children = f.children || [];
      for (const p of f.partners) (asPartner.get(p) || asPartner.set(p, []).get(p)).push(f);
      for (const c of f.children) (asChild.get(c) || asChild.set(c, []).get(c)).push(f);
    }
    idx = { people, asPartner, asChild };
  }
  const P = (id) => idx.people.get(id);

  function parentFamily(id) { return (idx.asChild.get(id) || [])[0] || null; }

  function parentsOf(id) {
    const family = parentFamily(id);
    const res = { family, father: null, mother: null };
    if (!family) return res;
    const ps = family.partners.filter((x) => idx.people.has(x));
    res.father = ps.find((x) => P(x).sex === "M") || null;
    res.mother = ps.find((x) => P(x).sex === "F" && x !== res.father) || null;
    for (const x of ps) {
      if (x === res.father || x === res.mother) continue;
      if (!res.father) res.father = x; else if (!res.mother) res.mother = x;
    }
    return res;
  }

  function unionsOf(id) {
    return (idx.asPartner.get(id) || []).map((f) => ({
      family: f,
      spouse: f.partners.find((x) => x !== id && idx.people.has(x)) || null,
    }));
  }

  const birthKey = (id) => {
    const y = yearNum(P(id) && P(id).birth && P(id).birth.date);
    return y || 9999;
  };
  const byBirth = (ids) => ids.slice().sort((a, b) => birthKey(a) - birthKey(b));

  function childrenOf(id) {
    const out = [];
    for (const f of idx.asPartner.get(id) || [])
      for (const c of f.children) if (idx.people.has(c) && !out.includes(c)) out.push(c);
    return byBirth(out);
  }
  function siblingsOf(id) {
    const f = parentFamily(id);
    return f ? byBirth(f.children.filter((c) => c !== id && idx.people.has(c))) : [];
  }

  function newId(prefix) {
    let id;
    do id = prefix + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);
    while (idx.people.has(id) || state.data.families.some((f) => f.id === id));
    return id;
  }

  // Чистим пустые семьи и склеиваем дубли пар.
  function normalizeFamilies() {
    const ids = new Set(state.data.people.map((p) => p.id));
    const fams = [];
    const byPair = new Map();
    for (const f of state.data.families) {
      f.partners = [...new Set((f.partners || []).filter((x) => ids.has(x)))].slice(0, 2);
      f.children = [...new Set((f.children || []).filter((x) => ids.has(x) && !f.partners.includes(x)))];
      if (f.partners.length + f.children.length <= 1) continue;
      if (f.partners.length <= 1 && f.children.length === 0) continue;
      if (f.partners.length === 2) {
        const k = f.partners.slice().sort().join("|");
        const prev = byPair.get(k);
        if (prev) {
          for (const c of f.children) if (!prev.children.includes(c)) prev.children.push(c);
          if (!prev.marriage && f.marriage) prev.marriage = f.marriage;
          continue;
        }
        byPair.set(k, f);
      }
      fams.push(f);
    }
    state.data.families = fams;
  }

  // ---------- names & dates ----------
  function yearNum(d) {
    const m = String(d || "").match(/\d{4}/);
    return m ? +m[0] : 0;
  }
  function yearOf(d) {
    if (!d) return "";
    const m = String(d).match(/\d{4}/);
    if (!m) return "";
    return (/^\s*(ок|около|~|abt|прим)/i.test(d) ? "~" : "") + m[0];
  }
  function lifeYears(p) {
    if (isHidden(p)) return "";
    const b = yearOf(p.birth && p.birth.date), d = yearOf(p.death && p.death.date);
    if (p.living) return b ? `р. ${b}` : "";
    if (b || d) return `${b || "?"} – ${d || "?"}`;
    return "";
  }
  const isHidden = (p) => state.privacy && p.living;
  function surnameLine(p) {
    if (isHidden(p)) return "Живущий человек";
    let s = p.surname || "";
    if (p.birthSurname && p.birthSurname !== p.surname) s = s ? `${s} (${p.birthSurname})` : p.birthSurname;
    return s || (p.given ? "" : "Без имени");
  }
  function givenLine(p) {
    if (isHidden(p)) return "";
    return [p.given, p.patronymic].filter(Boolean).join(" ");
  }
  function fullName(p) {
    if (!p) return "";
    if (isHidden(p)) return "Живущий человек";
    return [p.surname, p.given, p.patronymic].filter(Boolean).join(" ") || "Без имени";
  }
  function shortName(p) {
    if (isHidden(p)) return "Живущий человек";
    return [p.given, p.surname].filter(Boolean).join(" ") || "Без имени";
  }
  function initials(p) {
    if (isHidden(p)) return "•";
    return (((p.given || "")[0] || "") + ((p.surname || "")[0] || "")).toUpperCase() || "?";
  }

  const PATR_SPECIAL = {
    "Илья": ["Ильич", "Ильинична"], "Лука": ["Лукич", "Лукинична"], "Фома": ["Фомич", "Фоминична"],
    "Кузьма": ["Кузьмич", "Кузьминична"], "Никита": ["Никитич", "Никитична"], "Савва": ["Саввич", "Саввична"],
    "Павел": ["Павлович", "Павловна"], "Лев": ["Львович", "Львовна"], "Пётр": ["Петрович", "Петровна"],
    "Петр": ["Петрович", "Петровна"], "Игорь": ["Игоревич", "Игоревна"], "Яков": ["Яковлевич", "Яковлевна"],
  };
  function patronymicFrom(name, sex) {
    const n = (name || "").trim();
    if (!n) return "";
    const f = sex === "F";
    if (PATR_SPECIAL[n]) return PATR_SPECIAL[n][f ? 1 : 0];
    if (/ий$/.test(n)) return n.slice(0, -2) + (f ? "ьевна" : "ьевич");
    if (/[йь]$/.test(n)) return n.slice(0, -1) + (f ? "евна" : "евич");
    if (/[ая]$/.test(n)) return n.slice(0, -1) + (f ? "ична" : "ич");
    return n + (f ? "овна" : "ович");
  }
  function nameFromPatronymic(pat) {
    if (!pat) return "";
    for (const [name, forms] of Object.entries(PATR_SPECIAL)) if (forms.includes(pat)) return name;
    let m;
    if ((m = pat.match(/^(.+)ьев(ич|на)$/))) return m[1] + "ий";
    if ((m = pat.match(/^(.+)ев(ич|на)$/))) return m[1] + "й";
    if ((m = pat.match(/^(.+)ов(ич|на)$/))) return m[1];
    if ((m = pat.match(/^(.+)(ична|ич)$/))) return m[1] + "а";
    return "";
  }
  function surnameFor(sex, base) {
    if (!base) return "";
    if (sex === "M") {
      if (/(ов|ев|ёв|ин|ын)а$/.test(base)) return base.slice(0, -1);
      if (/ская$/.test(base)) return base.slice(0, -2) + "ий";
      if (/цкая$/.test(base)) return base.slice(0, -2) + "ий";
    } else if (sex === "F") {
      if (/(ов|ев|ёв|ин|ын)$/.test(base)) return base + "а";
      if (/(ский|цкий)$/.test(base)) return base.slice(0, -2) + "ая";
    }
    return base;
  }

  // ---------- persistence ----------
  let saveTimer = null;
  function setSaveState(text, err) {
    const el = $("#saveState");
    el.textContent = text;
    el.classList.toggle("err", !!err);
  }
  function scheduleSave(opts) {
    if (state.readOnly) return;
    updateCancel();
    if (state.site && state.site.conflict) return;
    clearTimeout(saveTimer);
    setSaveState("изменено…");
    saveTimer = setTimeout(() => doSave(opts), state.site ? 2500 : 500);
  }
  async function doSave(opts = {}) {
    const body = JSON.stringify(state.data);
    const stamp = () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    if (state.site) return saveToSite(stamp);
    if (state.serverMode) {
      try {
        const r = await fetch("/api/tree" + (opts.backup ? "?backup=1" : ""), {
          method: "PUT", headers: { "Content-Type": "application/json" }, body,
        });
        if (!r.ok) throw new Error((await r.json()).error || r.status);
        setSaveState("сохранено " + stamp());
      } catch (e) {
        setSaveState("ошибка сохранения", true);
        toast("Не удалось сохранить: " + e.message);
      }
    } else {
      try {
        localStorage.setItem(LS_DATA, body);
        setSaveState("в браузере " + stamp());
      } catch (e) {
        setSaveState("ошибка сохранения", true);
      }
    }
  }
  // ---------- зашифрованная публикация ----------
  const b64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  async function decryptTree(enc, pass) {
    const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64(enc.salt), iterations: enc.iter, hash: "SHA-256" },
      km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  const toB64 = (u8) => { let t = ""; for (let i = 0; i < u8.length; i += 0x8000) t += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(t); };
  async function encryptJson(obj, pass, iter) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
      km, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
    return { v: 1, alg: "AES-GCM/PBKDF2-SHA256", iter, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
  }
  // Древо на сайте лежит в репозитории GitHub; читаем его через API, чтобы сразу видеть чужие правки.
  async function fetchSiteTree(cfg) {
    const r = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${cfg.path}?ref=${cfg.branch}&t=${Date.now()}`,
      { cache: "no-store", headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error("GitHub " + r.status);
    const j = await r.json();
    return { sha: j.sha, enc: JSON.parse(atob(j.content.replace(/\s/g, ""))) };
  }
  // ---------- кто что менял ----------
  const plainName = (p) => [p.surname, p.given, p.patronymic].filter(Boolean).join(" ") || "Без имени";
  function whenText(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  // Перед сохранением на сайт: у изменённых людей — отметка edited { by, at }, в meta.log — запись о правке.
  // Правки одного человека в течение получаса склеиваются в одну запись.
  function stampChanges(st, undo) {
    const by = st.user || "без имени", at = new Date().toISOString();
    const log = (state.data.meta.log = state.data.meta.log || []);
    if (undo) { log.push({ at, by, undo: true }); }
    else {
      let base;
      try { base = JSON.parse(st.base); } catch { return; }
      const strip = (p) => { const { edited, ...rest } = p; return JSON.stringify(rest); };
      const old = new Map((base.people || []).map((p) => [p.id, strip(p)]));
      const changed = [], added = [], now = new Set();
      for (const p of state.data.people) {
        now.add(p.id);
        if (!old.has(p.id)) added.push(p);
        else if (old.get(p.id) !== strip(p)) changed.push(p);
      }
      const removed = (base.people || []).filter((p) => !now.has(p.id)).map(plainName);
      const rel = JSON.stringify(base.families || []) !== JSON.stringify(state.data.families);
      if (!changed.length && !added.length && !removed.length && !rel) return;
      for (const p of [...changed, ...added]) p.edited = { by, at };
      const last = log[log.length - 1];
      const fresh = last && last.by === by && !last.undo && Date.now() - Date.parse(last.at) < 30 * 60000;
      const e = fresh ? last : { at, by, changed: [], added: [], removed: [] };
      const addAll = (arr, names) => { for (const n of names) if (!arr.includes(n)) arr.push(n); };
      addAll(e.changed, changed.map(plainName));
      addAll(e.added, added.map(plainName));
      addAll(e.removed, removed);
      if (rel) e.relations = true;
      e.at = at;
      if (!fresh) log.push(e);
    }
    if (log.length > 300) log.splice(0, log.length - 300);
  }
  function showHistory() {
    const log = (state.data.meta.log || []).slice().reverse();
    const list = (label, arr) => (arr && arr.length ? `<div>${label}: ${arr.map(esc).join(", ")}</div>` : "");
    dlg.innerHTML = `
      <h2>История правок</h2>
      ${log.length ? `<div class="history-list">${log.map((e) => `
        <div class="history-item">
          <div><b>${esc(e.by)}</b> <span class="when">${esc(whenText(e.at))}</span></div>
          ${e.undo ? "<div>отменил(а) свои правки</div>" : ""}
          ${list("изменил(а)", e.changed)}${list("добавил(а)", e.added)}${list("удалил(а)", e.removed)}
          ${e.relations ? "<div>менял(а) родственные связи</div>" : ""}
        </div>`).join("")}</div>` : `<div class="history-empty">Правок на сайте пока не было.</div>`}
      <div class="actions"><button class="primary" data-x="close">Закрыть</button></div>`;
    dlg.querySelector('[data-x="close"]').addEventListener("click", () => dlg.close());
    dlg.showModal();
  }

  let saving = false, saveAgain = false;
  async function saveToSite(stamp, opts = {}) {
    const st = state.site;
    if (saving) { saveAgain = true; return; }
    saving = true;
    setSaveState("сохраняю…");
    try {
      if (!st.sha) st.sha = (await fetchSiteTree(st)).sha;
      if (!st.retried) stampChanges(st, opts.undo);
      var bodyAtSave = JSON.stringify(state.data);
      const enc = await encryptJson(JSON.parse(bodyAtSave), st.pass, st.iter);
      const r = await fetch(`https://api.github.com/repos/${st.repo}/contents/${st.path}`, {
        method: "PUT",
        headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + st.token },
        body: JSON.stringify({ message: "Правка древа на сайте: " + (st.user || "без имени"), branch: st.branch, sha: st.sha,
          content: btoa(JSON.stringify(enc)) }),
      });
      if (r.status === 409 || r.status === 422) {
        // Метка версии могла устареть из-за кеша GitHub. Если на сайте то же древо, с которого начиналась
        // правка, — это не чужая правка: берём свежую метку и сохраняем ещё раз.
        const fresh = await fetchSiteTree(st);
        const remote = JSON.stringify(await decryptTree(fresh.enc, st.pass));
        if (remote === st.base && !st.retried) {
          st.sha = fresh.sha; st.retried = true;
          saving = false;
          return saveToSite(stamp, opts);
        }
        st.conflict = true;
        setSaveState("не сохранено", true);
        toast("Пока вы редактировали, древо изменил кто-то ещё. Перезагрузите страницу, чтобы увидеть новую версию, и повторите правку.");
        return;
      }
      if (r.status === 401 || r.status === 403) throw new Error("доступ к GitHub закрыт — попросите владельца обновить ключ сайта");
      if (!r.ok) throw new Error("GitHub " + r.status);
      st.sha = (await r.json()).content.sha;
      st.base = JSON.stringify(state.data) === bodyAtSave ? bodyAtSave : st.base;
      st.retried = false;
      setSaveState("сохранено " + stamp());
    } catch (e) {
      setSaveState("ошибка сохранения", true);
      toast("Не удалось сохранить: " + e.message);
    } finally {
      saving = false;
      if (saveAgain && !st.conflict) { saveAgain = false; scheduleSave(); }
    }
  }
  // На сайте правка включена сразу после входа. Снимок древа на момент входа — к нему возвращает
  // «Отменить»; кнопка видна, только пока есть изменения относительно снимка.
  function startSiteEditing() {
    state.site.snapshot = JSON.stringify(state.data);
    state.readOnly = false;
    document.body.classList.remove("readonly");
    document.body.classList.add("site-editing");
    updateCancel();
  }
  function updateCancel() {
    const st = state.site;
    $("#btnCancelEdit").hidden = !(st && st.snapshot && JSON.stringify(state.data) !== st.snapshot);
  }

  // «Отменить»: вернуть древо к снимку на момент входа, сохранить это на сайт и записать в историю.
  async function cancelEditing() {
    const st = state.site;
    if (!st || !st.snapshot) return;
    clearTimeout(saveTimer);
    const changed = JSON.stringify(state.data) !== st.snapshot;
    if (changed) {
      setData(JSON.parse(st.snapshot));
      // при конфликте на сайт ничего не ушло — достаточно вернуть локальную копию
      if (!st.conflict) {
        const stamp = () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        await saveToSite(stamp, { undo: true });
      }
    }
    // новая точка отсчёта — отменённое состояние (с записью «отменил(а)» в истории)
    st.snapshot = JSON.stringify(state.data);
    updateCancel();
    render();
    renderPanel();
    if (changed) toast("Правки отменены");
  }

  // Имя учётки на сайте ищется по хешу; нормализация — как в publish.mjs (normName/nameHash).
  const normName = (s) => String(s).trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  async function nameHash(s) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("genasaur:" + normName(s)));
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Экран входа. tryOpen(name, pass) расшифровывает и возвращает результат или бросает ошибку.
  // withName = false — старая сборка с одним общим паролем.
  const LOGIN_KEY = "genasaur-login", USER_KEY = "genasaur-user";
  function unlock(tryOpen, withName) {
    return new Promise((resolve) => {
      const lock = $("#lock"), form = lock.querySelector("form"), err = lock.querySelector(".lock-err");
      const nameIn = lock.querySelector('input[name="user"]'), passIn = lock.querySelector('input[name="pass"]');
      nameIn.hidden = !withName;
      // Пароль по умолчанию виден (так проще набрать на телефоне), глазик прячет символы.
      const eye = lock.querySelector(".pass-eye");
      eye.addEventListener("click", () => {
        const hide = passIn.type === "text";
        passIn.type = hide ? "password" : "text";
        eye.setAttribute("aria-pressed", String(hide));
        eye.title = eye.ariaLabel = hide ? "Показать пароль" : "Скрыть пароль";
        passIn.focus();
      });
      if (!withName) lock.querySelector(".lock-hint").textContent = "Древо закрыто паролем. Спросите его у того, кто прислал ссылку.";
      try { nameIn.value = localStorage.getItem(USER_KEY) || ""; } catch { /* ignore */ }
      const attempt = async (name, pass, silent) => {
        try {
          const res = await tryOpen(name, pass);
          try { sessionStorage.setItem(LOGIN_KEY, JSON.stringify({ name, pass })); } catch { /* ignore */ }
          if (withName) { try { localStorage.setItem(USER_KEY, name.trim()); } catch { /* ignore */ } }
          lock.hidden = true;
          resolve(res);
          return true;
        } catch {
          if (!silent) { err.textContent = withName ? "Неверное имя или пароль" : "Неверный пароль"; passIn.select(); }
          return false;
        }
      };
      let saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(LOGIN_KEY) || "null"); } catch { /* ignore */ }
      (saved ? attempt(saved.name, saved.pass, true) : Promise.resolve(false)).then((ok) => {
        if (ok) return;
        lock.hidden = false;
        (withName && !nameIn.value ? nameIn : passIn).focus();
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          err.textContent = "Проверяю…";
          attempt(nameIn.value, passIn.value, false);
        });
      });
    });
  }
  function logout() {
    try { sessionStorage.removeItem(LOGIN_KEY); } catch { /* ignore */ }
    location.reload();
  }

  async function load() {
    let data = null;
    try {
      const r = await fetch("/api/tree");
      if (!r.ok) throw new Error();
      data = await r.json();
      state.serverMode = true;
    } catch {
      state.serverMode = false;
      try {
        // опубликованная версия: зашифрованное древо (tree.enc.json) или открытое (tree.json), только просмотр
        let cfg = null, enc = null, sha = null;
        try { const rc = await fetch("site.json", { cache: "no-store" }); if (rc.ok) cfg = await rc.json(); } catch { /* ignore */ }
        if (cfg) { try { ({ enc, sha } = await fetchSiteTree(cfg)); } catch { enc = null; } }
        let r = enc ? null : await fetch("tree.enc.json", { cache: "no-store" });
        if (enc || r.ok) {
          const treeEnc = enc || await r.json();
          let accts = null;
          try { const ra = await fetch("accounts.enc.json", { cache: "no-store" }); if (ra.ok) accts = await ra.json(); } catch { /* ignore */ }
          if (accts) {
            // вход по имени и паролю: пароль открывает запись учётки, в ней ключ древа
            const { acc, tree } = await unlock(async (name, pass) => {
              const id = await nameHash(name);
              const u = accts.users.find((x) => x.id === id);
              if (!u || !name.trim()) throw new Error("нет учётки");
              const acc = await decryptTree(u, pass);
              return { acc, tree: await decryptTree(treeEnc, acc.key) };
            }, true);
            data = tree;
            state.user = acc.name;
            let own = null;
            try { own = localStorage.getItem("genasaur-root:" + acc.name); } catch { /* ignore */ }
            state.userRoot = own || acc.root;
            $("#menuLogout").hidden = false;
            $("#menuLogout").textContent = "Выйти (" + acc.name + ")";
            $("#menuHistory").hidden = false;
            if (cfg && acc.token) {
              state.site = { ...cfg, pass: acc.key, token: acc.token, sha, conflict: false, user: acc.name };
              document.body.classList.add("site");
            }
          } else {
            data = await unlock((name, pass) => decryptTree(treeEnc, pass), false);
          }
        } else {
          r = await fetch("tree.json", { cache: "no-store" });
          if (!r.ok) throw new Error();
          data = await r.json();
        }
        state.readOnly = true;
        document.body.classList.add("readonly");
      } catch {
        try { data = JSON.parse(localStorage.getItem(LS_DATA) || "null"); } catch { data = null; }
        toast("Сервер не запущен — данные хранятся только в этом браузере. Запустите start.bat.");
      }
    }
    if (state.site) state.site.base = JSON.stringify(data);   // как пришло с сайта, до нормализации
    setData(data || { meta: {}, people: [], families: [] });
    if (state.userRoot && idx.people.has(state.userRoot)) state.focusId = state.userRoot;
    if (state.site) startSiteEditing();
    $("#menuHistory").hidden = !(state.user || (state.data.meta.log || []).length);
    if (state.readOnly && data && data.meta && data.meta.hideLiving) {
      state.privacy = true;
    }
    setSaveState(state.readOnly ? "только просмотр" : state.serverMode ? "загружено" : "локально");
  }
  // Главный человек: на сайте — свой у каждой учётки, локально — общий из meta.rootId.
  function rootId() {
    if (state.userRoot && idx.people.has(state.userRoot)) return state.userRoot;
    return state.data.meta.rootId;
  }
  function setData(data) {
    data.meta = data.meta || {};
    data.people = data.people || [];
    data.families = data.families || [];
    state.data = data;
    normalizeFamilies();
    reindex();
    let focus = null;
    try { focus = localStorage.getItem(LS_FOCUS); } catch { /* ignore */ }
    state.focusId = idx.people.has(focus) ? focus
      : idx.people.has(data.meta.rootId) ? data.meta.rootId
      : (data.people[0] && data.people[0].id) || null;
  }

  function commit({ panel = true, save = true } = {}) {
    normalizeFamilies();
    reindex();
    if (state.focusId && !idx.people.has(state.focusId)) state.focusId = state.data.people[0] ? state.data.people[0].id : null;
    render();
    if (panel) renderPanel();
    if (save) scheduleSave();
  }

  let softTimer = null;
  function softCommit() {
    scheduleSave();
    clearTimeout(softTimer);
    softTimer = setTimeout(() => { render(); updatePanelHead(); }, 250);
  }

  // ---------- canvas & zoom ----------
  const svg = d3.select("#canvas");
  const vp = d3.select("#viewport");
  const zoom = d3.zoom().scaleExtent([0.12, 2.6]).on("zoom", (e) => vp.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);

  // minScale: если древо не помещается крупнее этого масштаба — центрируем на выбранном человеке.
  function fitView(animate = true, minScale = 0) {
    const node = vp.node();
    const box = node.getBBox();
    const { width, height } = svg.node().getBoundingClientRect();
    if (!box.width || !width) return;
    const pad = 60;
    let k = Math.min(1.25, Math.min((width - pad * 2) / box.width, (height - pad * 2) / box.height));
    let cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    if (k < minScale) { k = minScale; cx = 0; cy = state.view === "hourglass" ? -ROW_H : 0; }
    const t = d3.zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-cx, -cy);
    (animate ? svg.transition().duration(650) : svg).call(zoom.transform, t);
  }
  function centerOnFocus() {
    const { height } = svg.node().getBoundingClientRect();
    const k = d3.zoomTransform(svg.node()).k;
    const dy = state.view === "hourglass" ? -Math.min(height * 0.08, 60) / k : 0;
    const p = state.view === "full" ? fullPos.get(state.focusId) || { x: 0, y: 0 } : { x: 0, y: 0 };
    svg.transition().duration(650).ease(d3.easeCubicInOut).call(zoom.translateTo, p.x, p.y + dy);
  }

  const mctx = document.createElement("canvas").getContext("2d");
  function fitText(text, font, max) {
    if (!text) return "";
    mctx.font = font;
    if (mctx.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && mctx.measureText(t + "…").width > max) t = t.slice(0, -1);
    return t.trimEnd() + "…";
  }
  const SYS_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";
  const FONT_SURNAME = "600 15px " + SYS_FONT;
  const FONT_SURNAME_SP = "600 14px " + SYS_FONT;
  const FONT_GIVEN = "400 12.5px " + SYS_FONT;

  // ---------- hourglass layout ----------
  const curve = (x1, y1, x2, y2, stem = 0) => {
    const ys = y1 + stem;
    const my = (ys + y2) / 2;
    return `M${x1},${y1}L${x1},${ys}C${x1},${my} ${x2},${my} ${x2},${y2}`;
  };

  function genLabel(g) {
    const up = ["", "Родители", "Бабушки и дедушки", "Прадеды", "Прапрадеды"];
    const down = ["", "Дети", "Внуки", "Правнуки", "Праправнуки"];
    if (g < 0) return up[-g] || `${-g}-е поколение предков`;
    return down[g] || `${g}-е поколение потомков`;
  }

  function layoutHourglass() {
    const fid = state.focusId;
    const items = [], links = [];
    const occ = new Map();
    const key = (id) => { const n = (occ.get(id) || 0) + 1; occ.set(id, n); return n > 1 ? `p:${id}#${n}` : `p:${id}`; };

    // потомки (включая самого человека и супругов)
    const desc = (id, depth, path, viaFamily) => {
      const unions = unionsOf(id);
      const node = { id, viaFamily, unions, children: [] };
      node.w = CARD_W + unions.filter((u) => u.spouse).length * (SP_W + SP_GAP);
      if (depth < state.depthDown) {
        const np = new Set(path).add(id);
        for (const u of unions)
          for (const c of byBirth(u.family.children))
            if (idx.people.has(c) && !np.has(c)) node.children.push(desc(c, depth + 1, np, u.family.id));
      }
      return node;
    };
    const dRoot = d3.hierarchy(desc(fid, 0, new Set(), null));
    d3.tree().nodeSize([1, ROW_H])
      .separation((a, b) => (a.data.w + b.data.w) / 2 + (a.parent === b.parent ? GAP_X : GAP_X * 2.2))(dRoot);
    const rootPC = dRoot.x - (dRoot.data.w - CARD_W) / 2;
    dRoot.each((n) => { n.px = n.x - (n.data.w - CARD_W) / 2 - rootPC; n.py = n.depth * ROW_H; });

    dRoot.each((n) => {
      const d = n.data;
      items.push({ key: key(d.id), kind: "person", id: d.id, x: n.px, y: n.py, gen: n.depth, focus: n.depth === 0 });
      n.anchor = {};
      let k = 0, prevRight = n.px + CARD_W / 2;
      for (const u of d.unions) {
        if (!u.spouse) { n.anchor[u.family.id] = { x: n.px, y: n.py + CARD_H / 2, stem: 0 }; continue; }
        const sx = n.px + CARD_W / 2 + SP_GAP + SP_W / 2 + k * (SP_W + SP_GAP);
        k++;
        items.push({ key: key(u.spouse), kind: "spouse", id: u.spouse, x: sx, y: n.py, gen: n.depth });
        links.push({ key: `ls:${d.id}:${u.spouse}:${n.depth}`, cls: "spouse", d: `M${prevRight},${n.py}L${prevRight},${n.py}C${prevRight},${n.py} ${sx - SP_W / 2},${n.py} ${sx - SP_W / 2},${n.py}` });
        n.anchor[u.family.id] = { x: sx - SP_W / 2 - SP_GAP / 2, y: n.py, stem: CARD_H / 2 + 14 };
        prevRight = sx + SP_W / 2;
      }
      if (n.parent) {
        const a = n.parent.anchor[d.viaFamily] || { x: n.parent.px, y: n.parent.py + CARD_H / 2, stem: 0 };
        links.push({ key: `ld:${items[items.length - 1 - k].key}`, cls: weakLink(d.id), d: curve(a.x, a.y, n.px, n.py - CARD_H / 2, a.stem) });
      }
    });

    // предки
    const anc = (id, depth, path) => {
      const node = { kind: "person", id, children: [] };
      if (depth >= state.depthUp) return node;
      const { father, mother } = parentsOf(id);
      const np = new Set(path).add(id);
      for (const [pid, role] of [[father, "father"], [mother, "mother"]]) {
        if (pid && !np.has(pid)) node.children.push(anc(pid, depth + 1, np));
        else if (!pid && depth <= 1) node.children.push({ kind: "ghost", role, childId: id, children: [] });
      }
      return node;
    };
    const aRoot = d3.hierarchy(anc(fid, 0, new Set()));
    d3.tree().nodeSize([CARD_W + GAP_X, ROW_H]).separation((a, b) => (a.parent === b.parent ? 1 : 1.15))(aRoot);
    const ax = aRoot.x;
    aRoot.each((n) => { n.px = n.x - ax; n.py = -n.depth * ROW_H; });
    aRoot.each((n) => {
      if (n.depth === 0) return;
      const d = n.data, ghost = d.kind === "ghost";
      const it = ghost
        ? { key: `g:${d.role}:${d.childId}`, kind: "ghost", role: d.role, childId: d.childId, x: n.px, y: n.py, gen: -n.depth }
        : { key: key(d.id), kind: "person", id: d.id, x: n.px, y: n.py, gen: -n.depth };
      items.push(it);
      const c = n.parent;
      links.push({ key: `la:${it.key}`, cls: ghost ? "ghost" : weakLink(d.id), d: curve(c.px, c.py - CARD_H / 2, n.px, n.py + (ghost ? CARD_H * 0.375 : CARD_H / 2)) });
    });

    // братья и сёстры — в ряду выбранного человека, слева, по старшинству; их супруги рядом
    const sibs = siblingsOf(fid);
    if (sibs.length) {
      const top = -CARD_H / 2, yj = top - 22;
      let right = -CARD_W / 2 - GAP_X * 1.6;
      for (const sid of sibs.slice().reverse()) {
        const spouses = unionsOf(sid).map((u) => u.spouse).filter(Boolean);
        const w = CARD_W + spouses.length * (SP_W + SP_GAP);
        const sx = right - w + CARD_W / 2;
        items.push({ key: key(sid), kind: "person", id: sid, x: sx, y: 0, gen: 0 });
        links.push({ key: `lsib:${fid}:${sid}`, cls: weakLink(sid),
          d: `M0,${top}L0,${yj}L${sx + 14},${yj}Q${sx},${yj} ${sx},${yj + 14}L${sx},${top}` });
        let prevRight = sx + CARD_W / 2;
        spouses.forEach((sp, k) => {
          const px = sx + CARD_W / 2 + SP_GAP + SP_W / 2 + k * (SP_W + SP_GAP);
          items.push({ key: key(sp), kind: "spouse", id: sp, x: px, y: 0, gen: 0 });
          links.push({ key: `ls:${sid}:${sp}:sib`, cls: "spouse", d: `M${prevRight},0L${px - SP_W / 2},0` });
          prevRight = px + SP_W / 2;
        });
        right -= w + GAP_X * 1.6;
      }
    }

    // подписи поколений
    const gens = new Map();
    let minX = Infinity;
    for (const it of items) {
      minX = Math.min(minX, it.x - (it.kind === "spouse" ? SP_W : CARD_W) / 2);
      if (it.gen !== 0 && it.kind !== "ghost") gens.set(it.gen, it.y);
    }
    const labels = [...gens.entries()].map(([g, y]) => ({ key: "gl" + g, text: genLabel(g), x: minX - 34, y }));
    return { items, links, labels };
  }

  // ---------- full family layout ----------
  // Все люди по поколениям: супруги — одним блоком, дети — под парой родителей.
  // Порядок в ряду — барицентры, координаты — изотоническая регрессия (без наложений).
  const FULL_IN = 30, FULL_GAP = 56;
  function isotonic(vals, wts) {
    const st = [];
    for (let i = 0; i < vals.length; i++) {
      let b = { v: vals[i], w: wts[i], n: 1 };
      while (st.length && st[st.length - 1].v > b.v) {
        const a = st.pop(), w = a.w + b.w;
        b = { v: (a.v * a.w + b.v * b.w) / w, w, n: a.n + b.n };
      }
      st.push(b);
    }
    const out = [];
    for (const b of st) for (let k = 0; k < b.n; k++) out.push(b.v);
    return out;
  }

  // «Вся семья» раскладывается от главного человека: выбор другой карточки не перестраивает схему.
  function anchorId() {
    const r = rootId();
    if (r && idx.people.has(r)) return r;
    if (!state.anchorFallback || !idx.people.has(state.anchorFallback)) state.anchorFallback = state.focusId;
    return state.anchorFallback;
  }
  const fullPos = new Map();   // id → {x, y} на холсте «Вся семья», для плавного перехода к человеку
  function fullGeometry(W, IN, GAP) {
    const fid = anchorId();
    const gen = new Map(), order = [];
    const bfs = (start) => {
      gen.set(start, 0); order.push(start);
      const q = [start];
      while (q.length) {
        const a = q.shift(), g = gen.get(a);
        const push = (b, v) => { if (idx.people.has(b) && !gen.has(b)) { gen.set(b, v); order.push(b); q.push(b); } };
        for (const f of idx.asChild.get(a) || []) for (const p of f.partners) push(p, g - 1);
        for (const f of idx.asPartner.get(a) || []) {
          for (const p of f.partners) push(p, g);
          for (const c of byBirth(f.children)) push(c, g + 1);
        }
      }
    };
    bfs(fid);
    for (const p of state.data.people) if (!gen.has(p.id)) bfs(p.id);

    // блоки супругов внутри поколения
    const blockOf = new Map(), blocks = [];
    for (const id of order) {
      if (blockOf.has(id)) continue;
      const comp = [], st = [id], seen = new Set([id]);
      while (st.length) {
        const a = st.pop(); comp.push(a);
        for (const u of unionsOf(a))
          if (u.spouse && !seen.has(u.spouse) && gen.get(u.spouse) === gen.get(id)) { seen.add(u.spouse); st.push(u.spouse); }
      }
      const adj = (a) => unionsOf(a).map((u) => u.spouse).filter((s) => s && seen.has(s));
      const ends = comp.filter((a) => adj(a).length <= 1);
      let start = ends.find((a) => P(a).sex === "M") || ends[0] || comp[0];
      const members = [], vis = new Set();
      const walk = (a) => { vis.add(a); members.push(a); for (const b of adj(a)) if (!vis.has(b)) walk(b); };
      walk(start);
      for (const a of comp) if (!vis.has(a)) walk(a);
      const b = { gen: gen.get(id), members, w: members.length * W + (members.length - 1) * IN, left: 0 };
      members.forEach((m, i) => blockOf.set(m, { b, off: i * (W + IN) + W / 2 }));
      blocks.push(b);
    }
    // Сторона: родня отца — слева (-1), матери — справа (+1), прямая линия и свои потомки — по центру (0).
    // Прямые предки («ствол») стоят ближе к центру, боковая родня — с внешней стороны.
    const side = new Map(), spine = new Set([fid]);
    side.set(fid, 0);
    const markAnc = (id, s, guard) => {
      if (guard > 40) return;
      const { father, mother } = parentsOf(id);
      for (const [pid, ps] of [[father, s === 0 ? -1 : s], [mother, s === 0 ? 1 : s]])
        if (pid && !spine.has(pid)) { spine.add(pid); side.set(pid, ps); markAnc(pid, ps, guard + 1); }
    };
    markAnc(fid, 0, 0);
    {
      const q = [...spine];
      while (q.length) {
        const a = q.shift(), s = side.get(a);
        const visit = (b, v) => { if (idx.people.has(b) && !side.has(b)) { side.set(b, v); q.push(b); } };
        for (const f of idx.asChild.get(a) || []) for (const p of f.partners) visit(p, s);
        for (const f of idx.asPartner.get(a) || []) {
          for (const p of f.partners) visit(p, s);
          const sp = f.partners.filter((p) => spine.has(p)).map((p) => side.get(p));
          const cs = sp.length > 1 && sp.some((v) => v !== sp[0]) ? 0 : s;
          for (const c of f.children) visit(c, cs);
        }
      }
    }
    for (const b of blocks) {
      const sm = b.members.filter((m) => spine.has(m)).map((m) => side.get(m));
      if (sm.length) {
        const s = Math.sign(sm.reduce((t, v) => t + v, 0));
        b.rank = s;           // ствол: -1 / 0 / +1
      } else {
        const s = Math.sign(b.members.reduce((t, m) => t + (side.get(m) || 0), 0));
        b.rank = s * 2;       // боковая родня: -2 слева, +2 справа, 0 — родня самого человека
      }
    }

    const gens = [...new Set(blocks.map((b) => b.gen))].sort((a, b) => a - b);
    const rows = gens.map((g) => blocks.filter((b) => b.gen === g).sort((a, c) => a.rank - c.rank));
    for (const row of rows) {
      let x = 0;
      for (const b of row) { b.left = x; x += b.w + GAP; }
    }

    const cx = (id) => { const o = blockOf.get(id); return o.b.left + o.off; };
    // точка, откуда идут линии к детям семьи
    const anchor = (f) => {
      const ps = f.partners.filter((x) => blockOf.has(x));
      if (!ps.length) return null;
      if (ps.length >= 2) {
        const a = blockOf.get(ps[0]), c = blockOf.get(ps[1]);
        if (a.b === c.b && Math.abs(a.off - c.off) <= W + IN + 1)
          return { b: a.b, off: (a.off + c.off) / 2, pair: true };
      }
      return { b: blockOf.get(ps[0]).b, off: blockOf.get(ps[0]).off, pair: false };
    };
    const famAnchor = new Map(state.data.families.map((f) => [f.id, anchor(f)]));

    const targets = (b) => {
      let s = 0, w = 0;
      for (const m of b.members) {
        const mo = blockOf.get(m).off;
        for (const f of idx.asChild.get(m) || []) {
          const a = famAnchor.get(f.id);
          if (a && a.b !== b) { s += a.b.left + a.off - mo; w += 1; }
        }
      }
      for (const f of state.data.families) {
        const a = famAnchor.get(f.id);
        if (!a || a.b !== b) continue;
        const kids = f.children.filter((c) => blockOf.has(c) && blockOf.get(c).b !== b);
        if (!kids.length) continue;
        const mean = kids.reduce((t, c) => t + cx(c), 0) / kids.length;
        s += (mean - a.off) * 1.5; w += 1.5;
      }
      return w ? { t: s / w, w } : { t: b.left, w: 0.01 };
    };

    const ITER = 40;
    for (let it = 0; it < ITER; it++) {
      const seq = it % 2 ? rows.slice().reverse() : rows;
      for (const row of seq) {
        const tg = new Map(row.map((b) => [b, targets(b)]));
        if (it < ITER / 2) row.sort((a, c) => a.rank - c.rank || tg.get(a).t - tg.get(c).t || a.left - c.left);
        let off = 0;
        const offs = row.map((b) => { const o = off; off += b.w + GAP; return o; });
        const fit = isotonic(row.map((b, i) => tg.get(b).t - offs[i]), row.map((b) => tg.get(b).w));
        row.forEach((b, i) => { b.left = fit[i] + offs[i]; });
      }
    }

    return { fid, gen, blocks, blockOf, famAnchor, cx, gens, fg: gen.get(fid) };
  }

  function layoutFull() {
    const { fid, gen, blocks, blockOf, famAnchor, cx, gens } = fullGeometry(CARD_W, FULL_IN, FULL_GAP);
    // выбранный человек — в начале координат
    const fg = gen.get(fid), fx = cx(fid);
    const X = (id) => cx(id) - fx, Y = (id) => (gen.get(id) - fg) * ROW_H;
    const items = [], links = [];
    for (const b of blocks)
      b.members.forEach((m, i) => {
        fullPos.set(m, { x: X(m), y: Y(m) });
        items.push({ key: `p:${m}`, kind: "person", id: m, x: X(m), y: Y(m), gen: gen.get(m) - fg, focus: m === state.focusId });
        if (i) {
          const a = b.members[i - 1], y = Y(m);
          links.push({ key: `ls:${a}:${m}`, cls: "spouse", d: `M${X(a) + CARD_W / 2},${y}L${X(m) - CARD_W / 2},${y}` });
        }
      });
    for (const f of state.data.families) {
      const a = famAnchor.get(f.id);
      if (!a) continue;
      const ax = a.b.left + a.off - fx, ay = (a.b.gen - fg) * ROW_H;
      for (const c of f.children) {
        if (!blockOf.has(c)) continue;
        links.push({ key: `lc:${f.id}:${c}`, cls: weakLink(c, ...f.partners),
          d: a.pair ? curve(ax, ay, X(c), Y(c) - CARD_H / 2, CARD_H / 2 + 16)
                    : curve(ax, ay + CARD_H / 2, X(c), Y(c) - CARD_H / 2) });
      }
    }
    let minX = Infinity;
    for (const it of items) minX = Math.min(minX, it.x - CARD_W / 2);
    const labels = gens.filter((g) => g !== fg).map((g) => ({ key: "gl" + (g - fg), text: genLabel(g - fg), x: minX - 34, y: (g - fg) * ROW_H }));
    return { items, links, labels };
  }

  // ---------- print view ----------
  // Вертикальная схема для A4: поколения — колонками слева направо, люди одного поколения — столбиком.
  const PR = { W: 150, H: 50, IN: 8, GAP: 16, COL: 46, HEAD: 34 };
  const PR_SUR = "600 13px " + SYS_FONT;
  const PR_GIV = "400 10.5px " + SYS_FONT;
  function buildPrintView() {
    const host = $("#printView");
    if (!state.data.people.length) { host.innerHTML = ""; return; }
    const { fid, gen, blocks, blockOf, famAnchor, cx, gens, fg } = fullGeometry(PR.H, PR.IN, PR.GAP);
    const g0 = gens[0];
    const colX = (g) => (g - g0) * (PR.W + PR.COL);
    let minY = Infinity, maxY = -Infinity;
    for (const b of blocks) { minY = Math.min(minY, b.left); maxY = Math.max(maxY, b.left + b.w); }
    const Y = (id) => cx(id) - minY + PR.HEAD;
    const out = [];
    const T = (s) => esc(s);
    // заголовки колонок
    for (const g of gens) {
      const label = g === fg ? "Поколение " + (P(fid).given || "") : genLabel(g - fg);
      out.push(`<text class="pv-col" x="${colX(g) + PR.W / 2}" y="14">${T(label)}</text>`);
    }
    // линии к детям
    for (const f of state.data.families) {
      const a = famAnchor.get(f.id);
      if (!a) continue;
      const ax = colX(a.b.gen) + PR.W + (a.pair ? 8 : 0), ay = a.b.left + a.off - minY + PR.HEAD;
      for (const c of f.children) {
        if (!blockOf.has(c)) continue;
        const x2 = colX(gen.get(c)), y2 = Y(c), mx = (ax + x2) / 2;
        const weak = ["hypothesis", "unresolved"].includes(P(c).status) || f.partners.every((p) => ["hypothesis", "unresolved"].includes((P(p) || {}).status));
        out.push(`<path class="pv-link${weak ? " weak" : ""}" d="M${ax},${ay}C${mx},${ay} ${mx},${y2} ${x2},${y2}"/>`);
      }
    }
    // супруги — скобка справа
    for (const b of blocks)
      for (let i = 1; i < b.members.length; i++) {
        const x = colX(b.gen) + PR.W, y1 = Y(b.members[i - 1]), y2 = Y(b.members[i]);
        out.push(`<path class="pv-spouse" d="M${x},${y1}H${x + 8}V${y2}H${x}"/>`);
      }
    // карточки
    for (const b of blocks)
      for (const m of b.members) {
        const p = P(m), x = colX(b.gen), y = Y(m) - PR.H / 2, hidden = isHidden(p);
        const weak = ["hypothesis", "unresolved", "contradicted"].includes(p.status);
        const sur = hidden ? "Живущий человек" : surnameLine(p);
        const giv = hidden ? "" : [p.given, p.patronymic].filter(Boolean).join(" ");
        const yrs = hidden ? "" : (p.living && p.birth && p.birth.date ? "р. " + p.birth.date : lifeYears(p));
        out.push(`<g class="pv-card${m === state.focusId ? " focus" : ""}${weak ? " weak" : ""}">` +
          `<rect x="${x}" y="${y}" width="${PR.W}" height="${PR.H}" rx="5"/>` +
          `<rect class="sx sx-${p.sex || "U"}" x="${x}" y="${y}" width="3" height="${PR.H}"/>` +
          `<text class="s" x="${x + 9}" y="${y + 16}">${T(fitText(sur, PR_SUR, PR.W - 14))}</text>` +
          (giv ? `<text class="g" x="${x + 9}" y="${y + 30}">${T(fitText(giv, PR_GIV, PR.W - 14))}</text>` : "") +
          (yrs ? `<text class="y" x="${x + 9}" y="${y + 43}">${T(yrs)}${weak ? " · не подтв." : ""}</text>` : "") +
          `</g>`);
      }
    const W = colX(gens[gens.length - 1]) + PR.W + 12, H = maxY - minY + PR.HEAD + 6;
    const title = state.data.meta.title || "GENASAUR";
    const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

    // список людей по поколениям
    const rows = [];
    for (const g of gens) {
      const ids = state.data.people.map((p) => p.id).filter((id) => gen.get(id) === g)
        .sort((a, b) => birthKey(a) - birthKey(b));
      rows.push(`<tr class="pv-gen"><td colspan="4">${T(g === fg ? "Поколение " + (P(fid).given || "") : genLabel(g - fg))}</td></tr>`);
      for (const id of ids) {
        const p = P(id), hidden = isHidden(p);
        const ev = (e) => (e ? [e.date, e.place].filter(Boolean).join(", ") : "");
        rows.push(`<tr><td><b>${T(hidden ? "Живущий человек" : fullName(p))}</b>${!hidden && p.birthSurname && p.birthSurname !== p.surname ? ` <span class="pv-muted">(урожд. ${T(p.birthSurname)})</span>` : ""}</td>` +
          `<td>${T(hidden ? "" : ev(p.birth))}</td><td>${T(hidden ? "" : ev(p.death))}</td>` +
          `<td>${T(STATUS_LABEL[p.status] || "")}</td></tr>`);
      }
    }

    host.innerHTML = `
      <section class="pv-page">
        <header class="pv-head"><h1>${T(title)}</h1><p>${state.data.people.length} человек · составлено ${T(today)} · GENASAUR</p></header>
        <svg class="pv-tree" viewBox="-4 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${out.join("")}</svg>
        <p class="pv-legend">Поколения слева направо — от старших к младшим. Скобка справа соединяет супругов, линии идут от пары к детям.
          Пунктир — родство пока не подтверждено документом.${state.privacy ? " Данные живых людей скрыты." : ""}</p>
      </section>
      <section class="pv-page pv-list">
        <h2>Список людей</h2>
        <table><thead><tr><th>Имя</th><th>Рождение</th><th>Смерть</th><th>Надёжность</th></tr></thead>
        <tbody>${rows.join("")}</tbody></table>
      </section>`;
  }
  function printTree() {
    buildPrintView();
    window.print();
  }
  window.addEventListener("beforeprint", buildPrintView);

  function drawPersonCard(g, d) {
    const p = P(d.id);
    const spouse = d.kind === "spouse";
    const w = spouse ? SP_W : CARD_W, h = CARD_H, hidden = isHidden(p);
    g.attr("class", ["node", "card", spouse ? "spouse-card" : "", d.focus ? "focus" : "",
      p.status ? "st-" + p.status : "", hidden ? "private" : ""].join(" "));
    g.append("rect").attr("class", "bg").attr("x", -w / 2).attr("y", -h / 2).attr("width", w).attr("height", h).attr("rx", 14);
    const ax = -w / 2 + 34;
    const av = g.append("g").attr("class", "av av-" + (p.sex || "U")).attr("transform", `translate(${ax},0)`);
    av.append("circle").attr("class", "avatar-bg").attr("r", 20);
    if (p.photo && !hidden) {
      av.append("image").attr("href", p.photo).attr("x", -21).attr("y", -21).attr("width", 42).attr("height", 42)
        .attr("preserveAspectRatio", "xMidYMid slice").attr("clip-path", "url(#avatarClip)");
    } else {
      av.append("text").attr("class", "initials").text(initials(p));
    }
    if (p.status && STATUS_COLOR[p.status])
      av.append("circle").attr("class", "stdot").attr("cx", 15).attr("cy", -15).attr("r", 4.5).style("fill", `var(--st-${p.status})`);

    const tx = -w / 2 + 64, maxW = w - 74;
    const sur = surnameLine(p), giv = givenLine(p), yrs = lifeYears(p);
    const lines = [];
    if (sur) lines.push(["surname", fitText(sur, spouse ? FONT_SURNAME_SP : FONT_SURNAME, maxW)]);
    if (giv) lines.push(["given", fitText(giv, FONT_GIVEN, maxW)]);
    if (yrs) lines.push(["years", yrs]);
    const ys = lines.length === 3 ? [-11, 7, 23] : lines.length === 2 ? [-4, 14] : [5];
    lines.forEach(([cls, t], i) => g.append("text").attr("class", cls).attr("x", tx).attr("y", ys[i]).text(t));
    g.append("title").text(fullName(p) + (yrs ? `, ${yrs}` : "") + (p.status ? ` · ${STATUS_LABEL[p.status] || p.status}` : ""));
    g.on("click", (ev) => { ev.stopPropagation(); setFocus(d.id, { center: state.view !== "full" }); });
  }

  function drawGhost(g, d) {
    const w = CARD_W * 0.8, h = CARD_H * 0.75;
    g.attr("class", "node ghost-card");
    g.append("rect").attr("x", -w / 2).attr("y", -h / 2).attr("width", w).attr("height", h).attr("rx", 12);
    g.append("text").text(d.role === "father" ? "Добавить отца" : "Добавить мать");
    g.on("click", (ev) => { ev.stopPropagation(); openRelDialog(d.childId, d.role); });
  }

  function layers(view) {
    if (vp.attr("data-view") !== view) {
      vp.selectAll("*").remove();
      vp.attr("data-view", view);
      vp.append("g").attr("class", "l-labels");
      vp.append("g").attr("class", "l-links");
      vp.append("g").attr("class", "l-nodes");
      vp.append("defs").attr("class", "l-defs");
      return true;
    }
    return false;
  }

  function renderHourglass() {
    const view = state.view === "full" ? "full" : "hourglass";
    const fresh = layers(view);
    const { items, links, labels } = view === "full" ? layoutFull() : layoutHourglass();
    const T = d3.transition("move").duration(650).ease(d3.easeCubicInOut);
    const stagger = state.firstRender || fresh;

    vp.select(".l-labels").selectAll("text.gen-label").data(labels, (d) => d.key).join(
      (en) => en.append("text").attr("class", "gen-label").attr("text-anchor", "end").attr("opacity", 0)
        .attr("x", (d) => d.x).attr("y", (d) => d.y + 4).text((d) => d.text)
        .call((e) => e.transition(T).attr("opacity", 1)),
      (up) => up.text((d) => d.text).call((u) => u.transition(T).attr("x", (d) => d.x).attr("y", (d) => d.y + 4)),
      (ex) => ex.interrupt("move").transition("move").duration(250).attr("opacity", 0).remove());

    vp.select(".l-links").selectAll("path.link").data(links, (d) => d.key).join(
      (en) => en.append("path").attr("d", (d) => d.d).attr("opacity", 0)
        .call((e) => e.transition(T).delay(stagger ? 250 : 200).attr("opacity", 1)),
      (up) => up.call((u) => u.transition(T).attr("opacity", 1).attr("d", (d) => d.d)),
      (ex) => ex.interrupt("move").transition("move").duration(250).attr("opacity", 0).remove())
      .attr("class", (d) => "link " + d.cls);

    vp.select(".l-nodes").selectAll("g.node").data(items, (d) => d.key).join(
      (en) => en.append("g").attr("opacity", 0)
        .attr("transform", (d) => `translate(${d.x},${d.y + (d.gen < 0 ? 18 : d.gen > 0 ? -18 : 0)}) scale(.92)`)
        .call((e) => e.transition(T).delay((d) => (stagger ? Math.abs(d.gen) * 110 : 120))
          .attr("opacity", 1).attr("transform", (d) => `translate(${d.x},${d.y})`)),
      (up) => up.call((u) => u.transition(T).attr("opacity", 1).attr("transform", (d) => `translate(${d.x},${d.y})`)),
      (ex) => ex.interrupt("move").transition("move").duration(250).attr("opacity", 0).remove())
      .each(function (d) {
        const g = d3.select(this);
        g.selectAll("*").remove();
        if (d.kind === "ghost") drawGhost(g, d); else drawPersonCard(g, d);
      });
  }

  // ---------- render ----------
  function render() {
    const empty = !state.data.people.length;
    $("#empty").hidden = !empty;
    document.querySelector(".zoom-ctrl").style.display = empty ? "none" : "";
    $("#legendWrap").style.display = empty ? "none" : "";
    renderStats();
    if (empty) {
      vp.selectAll("*").remove();
      vp.attr("data-view", null);
      closePanel();
      return;
    }
    if (!idx.people.has(state.focusId)) state.focusId = state.data.people[0].id;
    renderHourglass();
    if (state.firstRender) {
      state.firstRender = false;
      // Панель открывается сразу после первого рендера и сужает сцену — ждём её.
      setTimeout(() => fitView(false, matchMedia("(max-width: 760px)").matches ? 0.8 : 0.45), 320);
    }
  }

  function renderStats() {
    const n = state.data.people.length;
    if (!n) { $("#stats").textContent = ""; return; }
    const memo = new Map();
    const depth = (id, guard = 0) => {
      if (memo.has(id)) return memo.get(id);
      if (guard > 60) return 1;
      memo.set(id, 1);
      const { father, mother } = parentsOf(id);
      const v = 1 + Math.max(father ? depth(father, guard + 1) : 0, mother ? depth(mother, guard + 1) : 0);
      memo.set(id, v);
      return v;
    };
    let gens = 0;
    for (const p of state.data.people) gens = Math.max(gens, depth(p.id));
    const word = (k, a, b, c) => (k % 10 === 1 && k % 100 !== 11 ? a : k % 10 >= 2 && k % 10 <= 4 && (k % 100 < 10 || k % 100 >= 20) ? b : c);
    $("#stats").textContent = `${n} ${word(n, "человек", "человека", "человек")} · ${gens} ${word(gens, "поколение", "поколения", "поколений")}`;
  }

  function renderLegend() {
    const items = [
      ...["M", "F"].map((s) => `<span><i style="background:var(--sex-${s})"></i>${s === "M" ? "мужчины" : "женщины"}</span>`),
      ...STATUSES.slice(1).map(([k, l]) => `<span><i style="background:var(--st-${k})"></i>${l}</span>`),
      `<span class="lg-dash"><svg width="18" height="8" aria-hidden="true"><path d="M1 4h16" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/></svg>родство не подтверждено</span>`,
    ];
    $("#legend").innerHTML = items.join("");
  }

  function setFocus(id, { center = true } = {}) {
    if (!idx.people.has(id)) return;
    const changed = id !== state.focusId;
    state.focusId = id;
    try { localStorage.setItem(LS_FOCUS, id); } catch { /* ignore */ }
    render();
    openPanel();
    if (changed && center) centerOnFocus();
  }

  // ---------- panel ----------
  const panel = $("#panel");
  function openPanel() {
    state.panelOpen = true;
    panel.hidden = false;
    document.body.classList.add("panel-open");
    renderPanel();
  }
  function closePanel() {
    state.panelOpen = false;
    panel.hidden = true;
    document.body.classList.remove("panel-open");
    resetPageScroll();
  }
  // На телефоне клавиатура сдвигает страницу, чтобы показать поле, и после закрытия карточки
  // страница могла остаться сдвинутой — шапка уезжала за верх экрана. Возвращаем на место.
  function resetPageScroll() {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  }
  document.addEventListener("focusout", () => setTimeout(() => {
    if (!document.activeElement || !document.activeElement.matches("input, textarea, select")) resetPageScroll();
  }, 50));

  const get = (obj, path) => path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
  function set(obj, path, value) {
    const ks = path.split(".");
    let o = obj;
    for (const k of ks.slice(0, -1)) o = o[k] = o[k] || {};
    const last = ks[ks.length - 1];
    if (value === "" || value == null) delete o[last]; else o[last] = value;
    if (ks.length > 1 && !Object.keys(o).length) delete obj[ks[0]];
  }

  const field = (p, k, label, cls = "", type = "text", ph = "") =>
    `<label class="field ${cls}"><span>${label}</span><input data-k="${k}" type="${type}" value="${esc(get(p, k))}" placeholder="${esc(ph)}"></label>`;

  function chip(id, removeAttr) {
    const p = P(id);
    return `<span class="chip" data-go="${id}"><i style="background:var(--sex-${p.sex || "U"})"></i>${esc(shortName(p))}` +
      `<small style="color:var(--faint)">${esc(lifeYears(p))}</small>` +
      (removeAttr ? `<button class="x" ${removeAttr} title="Убрать связь" aria-label="Убрать связь"><svg class="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>` : "") + `</span>`;
  }

  function avatarHtml(p) {
    return p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials(p));
  }

  function updatePanelHead() {
    if (!state.panelOpen) return;
    const p = P(state.focusId);
    if (!p) return;
    const n = panel.querySelector(".panel-name"), s = panel.querySelector(".panel-sub"), a = panel.querySelector(".avatar");
    if (n) n.textContent = fullName(p);
    if (s) s.textContent = [lifeYears(p), p.status ? STATUS_LABEL[p.status] : ""].filter(Boolean).join(" · ");
    if (a) a.innerHTML = avatarHtml(p);
  }

  function renderPanel() {
    if (!state.panelOpen) return;
    const p = P(state.focusId);
    if (!p) { closePanel(); return; }
    const { father, mother } = parentsOf(p.id);
    const unions = unionsOf(p.id);
    const kids = childrenOf(p.id);
    const sibs = siblingsOf(p.id);
    const isRoot = rootId() === p.id;

    const parentChips = [father, mother].filter(Boolean).map((id) => chip(id, `data-unparent="${id}"`)).join("");
    const spouseRows = unions.map((u) => `
      <div class="spouse-row">
        ${u.spouse ? chip(u.spouse, `data-unspouse="${u.family.id}"`) : `<span class="chip" style="cursor:default">партнёр неизвестен</span>`}
        <div class="grid">
          <label class="field"><span>Дата брака</span><input data-fam="${u.family.id}" data-fk="marriage.date" value="${esc(get(u.family, "marriage.date"))}" placeholder="12.06.1957"></label>
          <label class="field"><span>Место брака</span><input data-fam="${u.family.id}" data-fk="marriage.place" value="${esc(get(u.family, "marriage.place"))}"></label>
        </div>
      </div>`).join("");

    const sources = (p.sources || []).map((s, i) => `
      <div class="source" data-src="${i}">
        <div class="row"><input data-sk="title" value="${esc(s.title)}" placeholder="Название: метрическая книга, ОБД, письмо…"><button class="small x-src" title="Удалить" aria-label="Удалить источник"><svg class="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button></div>
        <div class="row"><input data-sk="url" value="${esc(s.url)}" placeholder="Ссылка">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Открыть <svg class="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16 8M9 8h7v7"/></svg></a>` : ""}</div>
        <div class="row"><input data-sk="note" value="${esc(s.note)}" placeholder="Архив, фонд, опись, дело, лист…"></div>
      </div>`).join("");

    panel.innerHTML = `
      <button class="panel-close" title="Закрыть" aria-label="Закрыть"><svg class="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>
      <div class="panel-head">
        <div class="avatar av-${p.sex || "U"}" title="Загрузить фото">${avatarHtml(p)}</div>
        <div>
          <div class="panel-name"></div>
          <div class="panel-sub"></div>
          ${p.edited ? `<div class="edited-note">Изменено: ${esc(p.edited.by)} · ${esc(whenText(p.edited.at))}</div>` : ""}
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            ${isRoot ? `<span class="chip root-chip">Главный человек</span>` : `<button class="small" data-act="root">Сделать главным</button>`}
            ${p.photo ? `<button class="small" data-act="nophoto">Убрать фото</button>` : ""}
          </div>
        </div>
      </div>

      <div class="section"><h3>Имя</h3><div class="grid">
        ${field(p, "surname", "Фамилия")}
        ${field(p, "birthSurname", "Девичья / при рождении")}
        ${field(p, "given", "Имя")}
        ${field(p, "patronymic", "Отчество")}
        <label class="field"><span>Пол</span><select data-k="sex">
          ${["M", "F", "U"].map((s) => `<option value="${s}" ${p.sex === s ? "selected" : ""}>${SEX_LABEL[s]}</option>`).join("")}
        </select></label>
        ${field(p, "occupation", "Занятие, сословие")}
      </div></div>

      <div class="section"><h3>Жизнь</h3><div class="grid">
        ${field(p, "birth.date", "Дата рождения", "", "text", "ДД.ММ.ГГГГ")}
        ${field(p, "birth.place", "Место рождения")}
        <label class="check full"><input type="checkbox" data-k="living" ${p.living ? "checked" : ""}> Жив(а)</label>
        ${p.living ? "" : field(p, "death.date", "Дата смерти") + field(p, "death.place", "Место смерти")}
      </div></div>

      <div class="section"><h3>Родственники</h3>
        <div class="rel-group"><div class="rel-title">Родители</div><div class="chips">${parentChips || '<span style="color:var(--faint)">не указаны</span>'}</div>
          <div class="add-row">${father ? "" : '<button class="small" data-rel="father">+ Отец</button>'}${mother ? "" : '<button class="small" data-rel="mother">+ Мать</button>'}</div></div>
        <div class="rel-group"><div class="rel-title">Супруги</div>${spouseRows || '<span style="color:var(--faint)">не указаны</span>'}
          <div class="add-row"><button class="small" data-rel="spouse">+ Супруг(а)</button></div></div>
        <div class="rel-group"><div class="rel-title">Дети</div><div class="chips">${kids.map((id) => chip(id, `data-unchild="${id}"`)).join("") || '<span style="color:var(--faint)">не указаны</span>'}</div>
          <div class="add-row"><button class="small" data-rel="son">+ Сын</button><button class="small" data-rel="daughter">+ Дочь</button></div></div>
        <div class="rel-group"><div class="rel-title">Братья и сёстры</div><div class="chips">${sibs.map((id) => chip(id)).join("") || '<span style="color:var(--faint)">не указаны</span>'}</div>
          <div class="add-row"><button class="small" data-rel="sibling">+ Брат / сестра</button></div></div>
      </div>

      <div class="section"><h3>Доказанность</h3>
        <label class="field"><span>Статус (как в исследовательском скилле)</span><select data-k="status">
          ${STATUSES.map(([k, l]) => `<option value="${k}" ${(p.status || "") === k ? "selected" : ""}>${l}</option>`).join("")}
        </select></label>
      </div>

      <div class="section"><h3>Источники</h3>${sources}
        <button class="small" data-act="addsrc">+ Источник</button>
      </div>

      <div class="section"><h3>Заметки</h3>
        <label class="field"><textarea data-k="notes" placeholder="Воспоминания, история, где искать дальше…">${esc(p.notes)}</textarea></label>
      </div>

      <div class="panel-foot">
        <button class="danger small" data-act="delete">Удалить человека</button>
        <span style="color:var(--faint);font-size:11px;align-self:center">ID ${esc(p.id)}</span>
      </div>`;
    if (state.readOnly) panel.querySelectorAll("input, select, textarea").forEach((el) => { el.disabled = true; });
    updatePanelHead();
  }

  panel.addEventListener("input", (e) => {
    const t = e.target, p = P(state.focusId);
    if (!p) return;
    if (t.dataset.k) {
      const v = t.type === "checkbox" ? t.checked : t.value;
      if (t.dataset.k === "living") {
        if (v) p.living = true; else delete p.living;
        commit();
        return;
      }
      set(p, t.dataset.k, typeof v === "string" ? v.replace(/^\s+/, "") : v);
      if (t.tagName === "SELECT") commit(); else softCommit();
    } else if (t.dataset.fam) {
      const f = state.data.families.find((x) => x.id === t.dataset.fam);
      if (f) { set(f, t.dataset.fk, t.value); scheduleSave(); }
    } else if (t.dataset.sk) {
      const i = +t.closest("[data-src]").dataset.src;
      p.sources[i][t.dataset.sk] = t.value;
      scheduleSave();
    }
  });

  panel.addEventListener("click", (e) => {
    const t = e.target.closest("button, .chip, .avatar");
    if (!t) return;
    const p = P(state.focusId);
    if (t.classList.contains("panel-close")) return closePanel();
    if (t.classList.contains("avatar")) return $("#photoInput").click();
    if (t.dataset.unparent) { e.stopPropagation(); return unlinkParent(p.id, t.dataset.unparent); }
    if (t.dataset.unchild) { e.stopPropagation(); return unlinkParent(t.dataset.unchild, p.id); }
    if (t.dataset.unspouse) { e.stopPropagation(); return unlinkSpouse(p.id, t.dataset.unspouse); }
    if (t.dataset.rel) return openRelDialog(p.id, t.dataset.rel);
    if (t.classList.contains("x-src")) {
      p.sources.splice(+t.closest("[data-src]").dataset.src, 1);
      if (!p.sources.length) delete p.sources;
      return commit();
    }
    if (t.dataset.go) return setFocus(t.dataset.go);
    const act = t.dataset.act;
    if (act === "addsrc") { (p.sources = p.sources || []).push({ title: "" }); commit({ save: false }); panel.querySelector(`[data-src="${p.sources.length - 1}"] input`).focus(); }
    if (act === "root") {
      if (state.user) {
        // на сайте главный человек личный: запоминается в этом браузере и не трогает общее древо
        state.userRoot = p.id;
        try { localStorage.setItem("genasaur-root:" + state.user, p.id); } catch { /* ignore */ }
        state.firstRender = true;
        render(); renderPanel();
      } else { state.data.meta.rootId = p.id; commit(); }
      toast("Главный человек — " + shortName(p));
    }
    if (act === "nophoto") { delete p.photo; commit(); }
    if (act === "delete") deletePerson(p.id);
  });

  // ---------- photo ----------
  $("#photoInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    const p = P(state.focusId);
    if (!file || !p) return;
    try {
      const blob = await resizeImage(file, 800);
      if (state.serverMode) {
        const r = await fetch(`/api/photo/${p.id}-${Date.now().toString(36)}.jpg`, { method: "PUT", body: blob });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        p.photo = j.url;
      } else {
        p.photo = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      }
      commit();
    } catch (err) {
      toast("Не удалось загрузить фото: " + err.message);
    }
  });
  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("не удалось сжать"))), "image/jpeg", 0.88);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => reject(new Error("не картинка"));
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------- relations ----------
  function addParent(childId, parentId) {
    let f = parentFamily(childId);
    if (!f) {
      state.data.families.push({ id: newId("F"), partners: [parentId], children: [childId] });
      return true;
    }
    if (f.partners.includes(parentId)) return true;
    if (f.partners.length >= 2) { toast("У человека уже указаны оба родителя"); return false; }
    // Если ребёнок — не единственный, новый родитель становится родителем и для братьев/сестёр.
    f.partners.push(parentId);
    return true;
  }
  function addSpouse(personId, spouseId) {
    if (unionsOf(personId).some((u) => u.spouse === spouseId)) return true;
    const lone = (idx.asPartner.get(personId) || []).find((f) => f.partners.length === 1);
    if (lone) lone.partners.push(spouseId);
    else state.data.families.push({ id: newId("F"), partners: [personId, spouseId], children: [] });
    return true;
  }
  function addChild(parentId, childId, familyId) {
    const existing = parentFamily(childId);
    if (existing && !(familyId && existing.id === familyId)) {
      if (existing.partners.includes(parentId)) return true;
      if (existing.partners.length >= 2) { toast("У этого человека уже есть оба родителя"); return false; }
      existing.partners.push(parentId);
      return true;
    }
    const fams = idx.asPartner.get(parentId) || [];
    let f = familyId ? fams.find((x) => x.id === familyId) : fams.length === 1 ? fams[0] : null;
    if (!f) { f = { id: newId("F"), partners: [parentId], children: [] }; state.data.families.push(f); }
    if (!f.children.includes(childId)) f.children.push(childId);
    return true;
  }
  function addSibling(personId, sibId) {
    if (parentFamily(sibId)) { toast("У этого человека уже есть семья родителей"); return false; }
    let f = parentFamily(personId);
    if (!f) { f = { id: newId("F"), partners: [], children: [personId] }; state.data.families.push(f); }
    f.children.push(sibId);
    return true;
  }
  function unlinkParent(childId, parentId) {
    const f = (idx.asChild.get(childId) || []).find((x) => x.partners.includes(parentId));
    if (!f) return;
    if (!confirm(`Убрать связь «${shortName(P(parentId))}» → «${shortName(P(childId))}»? Люди останутся в древе.`)) return;
    if (f.children.length === 1) {
      f.partners = f.partners.filter((x) => x !== parentId);
    } else {
      f.children = f.children.filter((x) => x !== childId);
      const other = f.partners.filter((x) => x !== parentId);
      if (other.length) state.data.families.push({ id: newId("F"), partners: other, children: [childId] });
    }
    commit();
  }
  function unlinkSpouse(personId, familyId) {
    const f = state.data.families.find((x) => x.id === familyId);
    if (!f) return;
    const sp = f.partners.find((x) => x !== personId);
    if (!confirm(`Убрать брак с «${shortName(P(sp))}»? ${f.children.length ? "Дети останутся детьми " + shortName(P(personId)) + "." : ""}`)) return;
    f.partners = f.partners.filter((x) => x !== sp);
    commit();
  }
  function deletePerson(id) {
    const p = P(id);
    if (!confirm(`Удалить «${fullName(p)}» из древа? Все связи этого человека тоже исчезнут.`)) return;
    const neighbours = [parentsOf(id).father, parentsOf(id).mother, ...childrenOf(id), ...unionsOf(id).map((u) => u.spouse)].filter(Boolean);
    state.data.people = state.data.people.filter((x) => x.id !== id);
    for (const f of state.data.families) {
      f.partners = f.partners.filter((x) => x !== id);
      f.children = f.children.filter((x) => x !== id);
    }
    if (state.data.meta.rootId === id) delete state.data.meta.rootId;
    state.focusId = neighbours[0] || (state.data.people[0] && state.data.people[0].id) || null;
    commit();
  }

  // ---------- relation dialog ----------
  const dlg = $("#relDialog");
  const REL_TITLE = { father: "отца", mother: "мать", spouse: "супруга(у)", son: "сына", daughter: "дочь", sibling: "брата или сестру" };

  function suggest(base, rel) {
    const baseSur = base.birthSurname || base.surname || "";
    const { father } = parentsOf(base.id);
    switch (rel) {
      case "father": return { sex: "M", surname: surnameFor("M", baseSur), given: nameFromPatronymic(base.patronymic) };
      case "mother": return { sex: "F", surname: surnameFor("F", baseSur) };
      case "spouse": return { sex: base.sex === "M" ? "F" : base.sex === "F" ? "M" : "U", surname: base.sex === "M" ? surnameFor("F", base.surname) : "" };
      case "son":
      case "daughter": {
        const sex = rel === "son" ? "M" : "F";
        const dad = base.sex === "M" ? base : (unionsOf(base.id).map((u) => u.spouse && P(u.spouse)).find((x) => x && x.sex === "M") || null);
        return { sex, surname: surnameFor(sex, (dad && dad.surname) || base.surname), patronymic: dad ? patronymicFrom(dad.given, sex) : "" };
      }
      case "sibling": {
        const sex = "U";
        return { sex, surname: baseSur, patronymic: father ? "" : "", fatherGiven: father && P(father).given };
      }
    }
    return {};
  }

  function openRelDialog(baseId, rel) {
    if (state.readOnly) return;
    const base = P(baseId);
    const sg = suggest(base, rel);
    const unions = unionsOf(baseId);
    const needFamily = (rel === "son" || rel === "daughter") && unions.length > 1;
    const famSelect = needFamily ? `<label class="field full"><span>От какого союза</span><select id="rdFam">
      ${unions.map((u) => `<option value="${u.family.id}">с ${esc(u.spouse ? shortName(P(u.spouse)) : "неизвестным партнёром")}</option>`).join("")}
      <option value="">без второго родителя</option></select></label>` : "";
    const sexSelect = rel === "spouse" || rel === "sibling" ? `<label class="field"><span>Пол</span><select id="rdSex">
      ${["M", "F", "U"].map((s) => `<option value="${s}" ${sg.sex === s ? "selected" : ""}>${SEX_LABEL[s]}</option>`).join("")}</select></label>` : "";

    dlg.innerHTML = `
      <h2>Добавить ${REL_TITLE[rel]}</h2>
      <div style="color:var(--muted);margin:-6px 0 12px">для ${esc(fullName(base))}</div>
      <div class="tabs"><button class="small active" data-tab="new">Новый человек</button><button class="small" data-tab="pick">Выбрать из древа</button></div>
      <div data-pane="new"><div class="grid">
        <label class="field"><span>Фамилия</span><input id="rdSur" value="${esc(sg.surname || "")}"></label>
        <label class="field"><span>Имя</span><input id="rdGiven" value="${esc(sg.given || "")}"></label>
        <label class="field"><span>Отчество</span><input id="rdPatr" value="${esc(sg.patronymic || "")}"></label>
        <label class="field"><span>Год / дата рождения</span><input id="rdBirth" placeholder="1905"></label>
        ${sexSelect}${famSelect}
      </div></div>
      <div data-pane="pick" hidden>
        <input id="rdSearch" class="field" style="width:100%;background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:8px 10px" placeholder="Начните вводить имя…">
        ${needFamily ? famSelect.replace('id="rdFam"', 'id="rdFam2"') : ""}
        <div class="pick-list" id="rdList"></div>
      </div>
      <div class="actions"><button data-x="cancel">Отмена</button><button class="primary" data-x="ok">Добавить</button></div>`;

    const tabs = dlg.querySelectorAll("[data-tab]");
    let mode = "new";
    tabs.forEach((b) => b.addEventListener("click", () => {
      mode = b.dataset.tab;
      tabs.forEach((x) => x.classList.toggle("active", x === b));
      dlg.querySelectorAll("[data-pane]").forEach((x) => (x.hidden = x.dataset.pane !== mode));
      dlg.querySelector('[data-x="ok"]').hidden = mode === "pick";
      if (mode === "pick") { dlg.querySelector("#rdSearch").focus(); fillPick(""); }
    }));

    const sibGiven = dlg.querySelector("#rdGiven");
    const updateSiblingPatr = () => {
      if (rel !== "sibling" || !sg.fatherGiven) return;
      dlg.querySelector("#rdPatr").value = patronymicFrom(sg.fatherGiven, dlg.querySelector("#rdSex").value);
      dlg.querySelector("#rdSur").value = surnameFor(dlg.querySelector("#rdSex").value, sg.surname);
    };
    if (rel === "sibling") dlg.querySelector("#rdSex").addEventListener("change", updateSiblingPatr);
    if (rel === "spouse") dlg.querySelector("#rdSex").addEventListener("change", (e) => {
      dlg.querySelector("#rdSur").value = e.target.value === "F" ? surnameFor("F", base.surname) : "";
    });

    function fillPick(q) {
      const nq = norm(q);
      const list = state.data.people.filter((x) => x.id !== baseId && (!nq || norm(fullName(x)).includes(nq))).slice(0, 40);
      dlg.querySelector("#rdList").innerHTML = list.map((x) =>
        `<button data-pick="${x.id}">${esc(fullName(x))}<small>${esc(lifeYears(x))}</small></button>`).join("") ||
        '<div style="color:var(--faint);padding:8px">Никого не найдено</div>';
    }
    dlg.querySelector("#rdSearch").addEventListener("input", (e) => fillPick(e.target.value));

    const finish = (personId) => {
      const famEl = dlg.querySelector(mode === "pick" ? "#rdFam2" : "#rdFam");
      const famId = famEl ? famEl.value || null : null;
      let ok = true;
      if (rel === "father" || rel === "mother") ok = addParent(baseId, personId);
      else if (rel === "spouse") ok = addSpouse(baseId, personId);
      else if (rel === "son" || rel === "daughter") {
        if (famEl && !famId) {
          const f = { id: newId("F"), partners: [baseId], children: [] };
          state.data.families.push(f);
          reindex();
          ok = addChild(baseId, personId, f.id);
        } else ok = addChild(baseId, personId, famId);
      } else if (rel === "sibling") ok = addSibling(baseId, personId);
      return ok;
    };

    dlg.querySelector("#rdList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      if (!b) return;
      if (finish(b.dataset.pick)) { dlg.close(); commit(); }
      else reindex();
    });

    dlg.querySelector('[data-x="cancel"]').addEventListener("click", () => dlg.close());
    dlg.querySelector('[data-x="ok"]').addEventListener("click", () => {
      const sexEl = dlg.querySelector("#rdSex");
      const sex = sexEl ? sexEl.value : sg.sex;
      const np = {
        id: newId("I"),
        surname: dlg.querySelector("#rdSur").value.trim(),
        given: dlg.querySelector("#rdGiven").value.trim(),
        patronymic: dlg.querySelector("#rdPatr").value.trim(),
        sex,
      };
      const b = dlg.querySelector("#rdBirth").value.trim();
      if (b) np.birth = { date: b };
      if (b && new Date().getFullYear() - yearNum(b) < 100) np.living = true;
      for (const k of ["surname", "given", "patronymic"]) if (!np[k]) delete np[k];
      state.data.people.push(np);
      reindex();
      if (!finish(np.id)) {
        state.data.people.pop();
        reindex();
        return;
      }
      dlg.close();
      commit();
    });
    dlg.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && mode === "new" && e.target.tagName === "INPUT") {
        e.preventDefault();
        dlg.querySelector('[data-x="ok"]').click();
      }
    });

    dlg.showModal();
    (sg.given ? dlg.querySelector("#rdGiven") : sibGiven).focus();
  }

  // ---------- search ----------
  const searchInput = $("#search"), searchBox = $("#searchResults");
  let searchHits = [], searchSel = 0;
  function runSearch() {
    const q = norm(searchInput.value.trim());
    if (!q) { searchBox.hidden = true; return; }
    const words = q.split(/\s+/);
    searchHits = state.data.people.filter((p) => {
      const n = norm([p.surname, p.birthSurname, p.given, p.patronymic].join(" "));
      return words.every((w) => n.includes(w));
    }).slice(0, 14);
    searchSel = 0;
    searchBox.innerHTML = searchHits.map((p, i) =>
      `<button data-id="${p.id}" class="${i === 0 ? "hl" : ""}">${esc(fullName(p))}<small>${esc(lifeYears(p))}</small></button>`).join("") ||
      '<div style="padding:8px;color:var(--faint)">Никого не найдено</div>';
    searchBox.hidden = false;
  }
  // На телефоне поиск свёрнут в иконку и раскрывается на всю шапку.
  function openSearch() {
    document.body.classList.add("search-open");
    searchInput.focus();
  }
  function closeSearch() {
    document.body.classList.remove("search-open");
    searchInput.value = "";
    searchBox.hidden = true;
    searchInput.blur();
  }
  function pickSearch(id) {
    closeSearch();
    setFocus(id);
  }
  $("#btnSearchOpen").addEventListener("click", openSearch);
  $("#btnSearchClose").addEventListener("click", closeSearch);
  searchInput.addEventListener("input", runSearch);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("search-open")) return closeSearch();
    if (searchBox.hidden || !searchHits.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      searchSel = (searchSel + (e.key === "ArrowDown" ? 1 : -1) + searchHits.length) % searchHits.length;
      searchBox.querySelectorAll("button").forEach((b, i) => b.classList.toggle("hl", i === searchSel));
    } else if (e.key === "Enter") pickSearch(searchHits[searchSel].id);
    else if (e.key === "Escape") searchBox.hidden = true;
  });
  searchBox.addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) pickSearch(b.dataset.id); });
  document.addEventListener("click", (e) => {
    if (e.target.closest(".search, #btnSearchOpen")) return;
    if (document.body.classList.contains("search-open")) closeSearch();
    else searchBox.hidden = true;
  });

  // ---------- top bar ----------
  document.querySelectorAll(".seg [data-view]").forEach((b) => b.addEventListener("click", () => {
    if (state.view === b.dataset.view) return;
    state.view = b.dataset.view;
    document.querySelectorAll(".seg [data-view]").forEach((x) => x.classList.toggle("active", x === b));
    document.body.classList.toggle("view-full", state.view === "full");
    render();
    setTimeout(() => fitView(true, 0.5), 60);
  }));
  for (const [sel, key, min, max] of [["#depthUp", "depthUp", 1, 8], ["#depthDown", "depthDown", 0, 6]]) {
    $(sel).addEventListener("change", (e) => {
      state[key] = Math.max(min, Math.min(max, +e.target.value || min));
      e.target.value = state[key];
      render();
    });
  }
  $("#btnPrint").addEventListener("click", printTree);
  $("#btnCancelEdit").addEventListener("click", cancelEditing);
  $("#btnLegend").addEventListener("click", (e) => {
    const lg = $("#legend"), open = lg.hidden;
    lg.hidden = !open;
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.classList.toggle("on", open);
  });
  const syncThemeSwitch = () => {
    const dark = document.documentElement.dataset.theme !== "light";
    const b = $("#btnTheme");
    b.setAttribute("aria-checked", String(dark));
    b.title = dark ? "Тёмная тема" : "Светлая тема";
  };
  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("genasaur-theme", next); } catch { /* ignore */ }
    syncThemeSwitch();
  };
  syncThemeSwitch();
  $("#btnTheme").addEventListener("click", toggleTheme);
  $("#menuPop").addEventListener("click", (e) => {
    if (e.target.closest('[data-act="theme"]')) { toggleTheme(); $("#menuPop").hidden = true; }
  });

  const menuPop = $("#menuPop");
  $("#btnMenu").addEventListener("click", (e) => { e.stopPropagation(); menuPop.hidden = !menuPop.hidden; });
  document.addEventListener("click", () => (menuPop.hidden = true));
  menuPop.addEventListener("click", (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    menuPop.hidden = true;
    if (act === "import") $("#fileInput").click();
    if (act === "export-ged") download(Gedcom.exportGedcom(state.data), fileBase() + ".ged", "text/plain;charset=utf-8");
    if (act === "export-json") download(JSON.stringify(state.data, null, 2), fileBase() + ".json", "application/json");
    if (act === "example") loadExample();
    if (act === "history") showHistory();
    if (act === "logout") logout();
    if (act === "new") {
      if (!confirm("Начать новое пустое древо? Текущее сохранится в резервной копии (data/backups).")) return;
      replaceData({ meta: { title: "" }, people: [], families: [] });
    }
  });

  function fileBase() {
    const t = (state.data.meta.title || "rodoslovnaya").replace(/[\\/:*?"<>|]+/g, "").trim().replace(/\s+/g, "_");
    return `${t}_${new Date().toISOString().slice(0, 10)}`;
  }
  function download(text, name, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function replaceData(data) {
    // Сначала форсируем резервную копию текущей версии на сервере.
    const hadData = state.data.people.length > 0;
    setData(data);
    state.firstRender = true;
    vp.attr("data-view", null);
    render();
    if (state.data.people.length) openPanel(); else closePanel();
    clearTimeout(saveTimer);
    doSave({ backup: hadData });
  }

  async function loadExample() {
    if (state.data.people.length && !confirm("Заменить текущее древо примером? Текущее сохранится в резервной копии (data/backups).")) return;
    const r = await fetch("example.json");
    replaceData(await r.json());
    toast("Это пример. Чтобы начать своё древо: Файл → Новое пустое древо.");
  }

  $("#fileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const data = /\.json$/i.test(file.name) ? JSON.parse(text) : Gedcom.importGedcom(text);
      if (!Array.isArray(data.people)) throw new Error("в файле нет списка людей");
      const msg = `Импортировать «${file.name}»: ${data.people.length} чел., ${(data.families || []).length} семей?` +
        (state.data.people.length ? `\nТекущее древо (${state.data.people.length} чел.) будет заменено и сохранено в резервной копии.` : "");
      if (!confirm(msg)) return;
      replaceData(data);
      toast(`Импортировано: ${data.people.length} чел.`);
    } catch (err) {
      toast("Не удалось импортировать: " + err.message);
    }
  });

  $("#btnStart").addEventListener("click", () => {
    const p = { id: newId("I"), sex: "U" };
    state.data.people.push(p);
    state.data.meta.rootId = p.id;
    state.focusId = p.id;
    state.firstRender = true;
    commit({ panel: false });
    openPanel();
    panel.querySelector('[data-k="surname"]').focus();
  });
  $("#btnEmptyImport").addEventListener("click", () => $("#fileInput").click());
  $("#btnEmptyExample").addEventListener("click", loadExample);

  $("#zoomIn").addEventListener("click", () => svg.transition().duration(250).call(zoom.scaleBy, 1.3));
  $("#zoomOut").addEventListener("click", () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.3));
  $("#zoomFit").addEventListener("click", () => fitView(true));  $("#goRoot").addEventListener("click", () => {
    const r = rootId();
    if (r && idx.people.has(r)) { setFocus(r, { center: false }); centerOnFocus(); } else toast("Главный человек не выбран — откройте карточку и нажмите «Сделать главным».");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dlg.open && state.panelOpen && !e.target.closest("input, textarea, select")) closePanel();
  });
  window.addEventListener("resize", () => { if (state.data.people.length) render(); });

  let toastTimer;
  function toast(text) {
    const el = $("#toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 4200);
  }

  // ---------- boot ----------
  renderLegend();
  load().then(() => {
    render();
    // на телефоне сначала показываем само древо, карточку — по нажатию
    if (state.data.people.length && !matchMedia("(max-width: 760px)").matches) openPanel();
    if (document.fonts) document.fonts.ready.then(() => state.data.people.length && render());
  });
})();

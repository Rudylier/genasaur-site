// GEDCOM 5.5.1 ⇄ модель древа { meta, people[], families[] }.
(function () {
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const PATRONYMIC_RE = /(вич|вна|ична|инична|ич|оглы|кызы)$/i;

  // "14.05.1990" → "14 MAY 1990", "ок. 1875" → "ABT 1875"
  function dateToGed(s) {
    if (!s) return "";
    s = String(s).trim();
    let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) return `${+m[1]} ${MONTHS[+m[2] - 1] || ""} ${m[3]}`.replace("  ", " ");
    m = s.match(/^(\d{1,2})\.(\d{4})$/);
    if (m) return `${MONTHS[+m[1] - 1] || ""} ${m[2]}`.trim();
    if (/^\d{3,4}$/.test(s)) return s;
    m = s.match(/^(ок\.?|около|~|прим\.?)\s*(\d{3,4})$/i);
    if (m) return "ABT " + m[2];
    m = s.match(/^(до)\s*(\d{3,4})$/i);
    if (m) return "BEF " + m[2];
    m = s.match(/^(после|не ранее)\s*(\d{3,4})$/i);
    if (m) return "AFT " + m[2];
    m = s.match(/^(\d{3,4})\s*[-–]\s*(\d{3,4})$/);
    if (m) return `BET ${m[1]} AND ${m[2]}`;
    return `(${s})`;
  }

  function dateFromGed(s) {
    if (!s) return "";
    s = s.trim();
    let m = s.match(/^(\d{1,2}) ([A-Z]{3}) (\d{4})$/i);
    if (m) {
      const mo = MONTHS.indexOf(m[2].toUpperCase()) + 1;
      if (mo) return `${String(m[1]).padStart(2, "0")}.${String(mo).padStart(2, "0")}.${m[3]}`;
    }
    m = s.match(/^([A-Z]{3}) (\d{4})$/i);
    if (m) {
      const mo = MONTHS.indexOf(m[1].toUpperCase()) + 1;
      if (mo) return `${String(mo).padStart(2, "0")}.${m[2]}`;
    }
    m = s.match(/^(ABT|EST|CAL) (.+)$/i);
    if (m) return "ок. " + dateFromGed(m[2]);
    m = s.match(/^BEF (.+)$/i);
    if (m) return "до " + dateFromGed(m[1]);
    m = s.match(/^AFT (.+)$/i);
    if (m) return "после " + dateFromGed(m[1]);
    m = s.match(/^BET (\d{3,4}) AND (\d{3,4})$/i);
    if (m) return `${m[1]}–${m[2]}`;
    m = s.match(/^\((.*)\)$/);
    if (m) return m[1];
    return s;
  }

  function textLines(level, tag, text) {
    const parts = String(text).split(/\r?\n/);
    const out = [`${level} ${tag} ${parts[0]}`.trimEnd()];
    for (const p of parts.slice(1)) out.push(`${level + 1} CONT ${p}`.trimEnd());
    return out;
  }

  function exportGedcom(data) {
    const L = [];
    const today = new Date();
    L.push("0 HEAD", "1 SOUR GENASAUR", "2 NAME GENASAUR", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED",
      "1 CHAR UTF-8", `1 DATE ${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`);
    if (data.meta && data.meta.title) L.push(...textLines(1, "NOTE", data.meta.title));

    const famsOf = {}, famcOf = {};
    for (const f of data.families) {
      for (const p of f.partners || []) (famsOf[p] = famsOf[p] || []).push(f.id);
      for (const c of f.children || []) (famcOf[c] = famcOf[c] || []).push(f.id);
    }
    const ev = (tag, e) => {
      if (!e || (!e.date && !e.place)) return;
      L.push(`1 ${tag}`);
      if (e.date) L.push(`2 DATE ${dateToGed(e.date)}`);
      if (e.place) L.push(`2 PLAC ${e.place}`);
    };

    for (const p of data.people) {
      L.push(`0 @${p.id}@ INDI`);
      const given = [p.given, p.patronymic].filter(Boolean).join(" ");
      const birthSurname = p.birthSurname || p.surname || "";
      L.push(`1 NAME ${given} /${birthSurname}/`.replace(/\s+\//, " /").trimEnd());
      if (p.given) L.push(`2 GIVN ${given}`);
      if (birthSurname) L.push(`2 SURN ${birthSurname}`);
      if (p.birthSurname && p.surname && p.surname !== p.birthSurname) {
        L.push(`1 NAME ${given} /${p.surname}/`, "2 TYPE married", `2 SURN ${p.surname}`);
      }
      L.push(`1 SEX ${p.sex === "M" || p.sex === "F" ? p.sex : "U"}`);
      ev("BIRT", p.birth);
      if (p.death && (p.death.date || p.death.place)) ev("DEAT", p.death);
      else if (p.living === false) L.push("1 DEAT Y");
      if (p.occupation) L.push(`1 OCCU ${p.occupation}`);
      if (p.notes) L.push(...textLines(1, "NOTE", p.notes));
      for (const s of p.sources || []) {
        L.push(`1 SOUR ${s.title || s.url || "Источник"}`);
        const t = [s.url, s.note].filter(Boolean).join("\n");
        if (t) L.push(...textLines(2, "TEXT", t));
      }
      if (p.photo) L.push("1 OBJE", `2 FILE ${p.photo}`);
      if (p.status) L.push(`1 _STAT ${p.status}`);
      for (const f of famcOf[p.id] || []) L.push(`1 FAMC @${f}@`);
      for (const f of famsOf[p.id] || []) L.push(`1 FAMS @${f}@`);
    }

    const byId = Object.fromEntries(data.people.map((p) => [p.id, p]));
    for (const f of data.families) {
      L.push(`0 @${f.id}@ FAM`);
      const parts = (f.partners || []).filter((id) => byId[id]);
      let husb = parts.find((id) => byId[id].sex === "M");
      let wife = parts.find((id) => byId[id].sex === "F" && id !== husb);
      for (const id of parts) {
        if (id === husb || id === wife) continue;
        if (!husb) husb = id; else if (!wife) wife = id;
      }
      if (husb) L.push(`1 HUSB @${husb}@`);
      if (wife) L.push(`1 WIFE @${wife}@`);
      for (const c of f.children || []) if (byId[c]) L.push(`1 CHIL @${c}@`);
      if (f.marriage && (f.marriage.date || f.marriage.place)) {
        L.push("1 MARR");
        if (f.marriage.date) L.push(`2 DATE ${dateToGed(f.marriage.date)}`);
        if (f.marriage.place) L.push(`2 PLAC ${f.marriage.place}`);
      }
    }
    L.push("0 TRLR");
    return L.join("\r\n") + "\r\n";
  }

  // ---------- import ----------
  function parseTree(text) {
    const root = { tag: "ROOT", children: [] };
    const stack = [root];
    for (const raw of text.replace(/^﻿/, "").split(/\r?\n|\r/)) {
      if (!raw.trim()) continue;
      const m = raw.match(/^\s*(\d+)\s+(@[^@]+@\s+)?(\S+)(?:\s(.*))?$/);
      if (!m) continue;
      const level = +m[1];
      const node = { level, xref: m[2] ? m[2].trim().slice(1, -1) : null, tag: m[3].toUpperCase(), value: m[4] || "", children: [] };
      if (node.tag === "CONT" || node.tag === "CONC") {
        const parent = stack[level];
        if (parent) parent.value += (node.tag === "CONT" ? "\n" : "") + node.value;
        continue;
      }
      stack.length = level + 1;
      (stack[level] || root).children.push(node);
      stack[level + 1] = node;
    }
    return root.children;
  }

  const kid = (n, tag) => n.children.find((c) => c.tag === tag);
  const kids = (n, tag) => n.children.filter((c) => c.tag === tag);
  const val = (n, tag) => { const k = n && kid(n, tag); return k ? k.value.trim() : ""; };

  function splitName(nameNode) {
    const v = nameNode.value || "";
    const m = v.match(/^(.*?)\/(.*?)\/(.*)$/);
    let given = (m ? m[1] : v).trim();
    let surname = (m ? m[2] : "").trim();
    if (val(nameNode, "GIVN")) given = val(nameNode, "GIVN");
    if (val(nameNode, "SURN")) surname = val(nameNode, "SURN");
    const words = given.split(/\s+/).filter(Boolean);
    let patronymic = "";
    if (words.length > 1 && PATRONYMIC_RE.test(words[words.length - 1])) patronymic = words.pop();
    return { given: words.join(" "), patronymic, surname };
  }

  function importGedcom(text) {
    const top = parseTree(text);
    const sources = {};
    for (const n of top) if (n.tag === "SOUR" && n.xref) sources[n.xref] = val(n, "TITL") || val(n, "ABBR") || n.value || n.xref;

    const event = (n, tag) => {
      const e = kid(n, tag);
      if (!e) return undefined;
      const out = {};
      const d = val(e, "DATE"), p = val(e, "PLAC");
      if (d) out.date = dateFromGed(d);
      if (p) out.place = p;
      return out;
    };

    const people = [], families = [];
    const thisYear = new Date().getFullYear();
    for (const n of top) {
      if (n.tag === "INDI" && n.xref) {
        const names = kids(n, "NAME");
        const primary = names.find((x) => !/married/i.test(val(x, "TYPE"))) || names[0];
        const married = names.find((x) => /married/i.test(val(x, "TYPE")));
        const nm = primary ? splitName(primary) : { given: "", patronymic: "", surname: "" };
        const p = { id: n.xref, given: nm.given, patronymic: nm.patronymic, surname: nm.surname };
        const marnm = (married && splitName(married).surname) || (primary && val(primary, "_MARNM")) || val(n, "_MARNM");
        if (marnm && marnm !== nm.surname) { p.birthSurname = nm.surname; p.surname = marnm; }
        const sex = val(n, "SEX").toUpperCase();
        p.sex = sex === "M" || sex === "F" ? sex : "U";
        const b = event(n, "BIRT") || event(n, "CHR") || event(n, "BAPM");
        if (b) p.birth = b;
        const d = event(n, "DEAT") || event(n, "BURI");
        if (d) p.death = d;
        const by = b && b.date && +(b.date.match(/\d{4}/) || [])[0];
        p.living = !kid(n, "DEAT") && !kid(n, "BURI") && !!by && thisYear - by < 100;
        const occ = kids(n, "OCCU").map((x) => x.value).filter(Boolean);
        if (occ.length) p.occupation = occ.join("; ");
        const notes = kids(n, "NOTE").map((x) => x.value).filter((v) => v && !/^@.+@$/.test(v));
        if (notes.length) p.notes = notes.join("\n\n");
        const srcs = kids(n, "SOUR").map((s) => {
          const ptr = s.value.match(/^@(.+)@$/);
          const title = ptr ? sources[ptr[1]] || ptr[1] : s.value;
          const page = val(s, "PAGE");
          const txt = kid(s, "DATA") ? val(kid(s, "DATA"), "TEXT") : val(s, "TEXT");
          const note = [page, txt].filter(Boolean).join("\n");
          const url = (note.match(/https?:\/\/\S+/) || [])[0];
          return Object.assign({ title }, url ? { url } : {}, note ? { note } : {});
        });
        if (srcs.length) p.sources = srcs;
        const obje = kid(n, "OBJE");
        if (obje && /^https?:|^\/photos\//.test(val(obje, "FILE"))) p.photo = val(obje, "FILE");
        const st = val(n, "_STAT");
        if (st) p.status = st;
        people.push(p);
      } else if (n.tag === "FAM" && n.xref) {
        const partners = [val(n, "HUSB"), val(n, "WIFE")].filter(Boolean).map((x) => x.replace(/@/g, ""));
        const children = kids(n, "CHIL").map((c) => c.value.replace(/@/g, "").trim());
        const f = { id: n.xref, partners, children };
        const marr = event(n, "MARR");
        if (marr) f.marriage = marr;
        families.push(f);
      }
    }
    // У идентификаторов из чужих программ бывают символы, неудобные для DOM — нормализуем.
    const remap = {};
    const clean = (id, prefix, i) => (remap[id] = /^[A-Za-z0-9_-]+$/.test(id) ? id : `${prefix}${i + 1}`);
    people.forEach((p, i) => (p.id = clean(p.id, "I", i)));
    families.forEach((f, i) => {
      f.id = /^[A-Za-z0-9_-]+$/.test(f.id) ? f.id : `F${i + 1}`;
      f.partners = f.partners.map((x) => remap[x] || x);
      f.children = f.children.map((x) => remap[x] || x);
    });
    const head = top.find((n) => n.tag === "HEAD");
    const title = head ? val(head, "NOTE").split("\n")[0] : "";
    return { meta: { title: title || "Импортированное древо", rootId: people[0] && people[0].id }, people, families };
  }

  window.Gedcom = { exportGedcom, importGedcom, dateToGed, dateFromGed };
})();

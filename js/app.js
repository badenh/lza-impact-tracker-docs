// LZA Impact Tracker — front-end
// Loads JSON artifacts produced by lza-impact-tracker-code/build/build.py
// and drives all interactive views. No build step; runs directly in the browser.

const DATA_BASE = "data/";
const DATA_VERSION = "6";  // bump when regenerating out/ to defeat caches

const state = {
  index: null,
  perVersion: {},           // version -> payload
  cross: null,
  hot: null,
  charts: {},               // key -> Chart instance
};

// -------- utilities

function fetchJson(name) {
  return fetch(DATA_BASE + name + "?v=" + DATA_VERSION).then(r => {
    if (!r.ok) throw new Error(`fetch ${name}: ${r.status}`);
    return r.json();
  });
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function replace(id, node) {
  const host = document.getElementById(id);
  host.innerHTML = "";
  host.appendChild(node);
}

function naturalKey(s) {
  return String(s).split(/(\d+)/).map(p => /^\d+$/.test(p) ? parseInt(p, 10) : p);
}
function naturalCmp(a, b) {
  const ka = naturalKey(a), kb = naturalKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const x = ka[i], y = kb[i];
    if (x === undefined) return -1;
    if (y === undefined) return  1;
    if (typeof x === typeof y) { if (x < y) return -1; if (x > y) return 1; }
    else return typeof x === "number" ? -1 : 1;
  }
  return 0;
}

// Size a bar chart's wrapper so each bar gets a fixed vertical row height,
// causing the chart to grow to fit N rows instead of squishing them together.
function sizeBarWrap(canvasId, rowCount, rowH = 26, extra = 90) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrap = canvas.parentElement;
  wrap.style.height = Math.max(160, rowCount * rowH + extra) + "px";
}

function fwLink(name) {
  return el("a", { href: "#framework-view", "data-fw": name, class: "fw-link" }, name);
}

function rcLink(framework, related) {
  return el("a",
    { href: "#related-view", "data-fw": framework, "data-rc": related, class: "rc-link" },
    related);
}

// Description tooltip lookup — returns the aggregate description if loaded,
// else empty string. Called by link helpers that want a `title` attribute.
function descOf(lza) {
  return (state.cross && state.cross.descriptions && state.cross.descriptions[lza]) || "";
}

function lzaLink(lza) {
  const attrs = { href: "#lza-view", "data-lza": lza, class: "lza-id-link" };
  const desc = descOf(lza);
  if (desc) attrs.title = desc;
  return el("a", attrs, lza);
}

function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

function buildTable(headers, rows) {
  const table = el("table");
  const thead = el("thead");
  const trh = el("tr");
  headers.forEach(h => trh.appendChild(el("th", { class: h.num ? "num" : "" }, h.label)));
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = el("tbody");
  rows.forEach(r => {
    const tr = el("tr");
    headers.forEach(h => {
      const td = el("td", { class: h.num ? "num" : "" });
      const v = r[h.key];
      if (v instanceof Node) td.appendChild(v);
      else td.textContent = v == null ? "" : String(v);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function fillSelect(sel, options, selected) {
  sel.innerHTML = "";
  options.forEach(opt => {
    const o = document.createElement("option");
    if (typeof opt === "string") { o.value = opt; o.textContent = opt; }
    else { o.value = opt.value; o.textContent = opt.label; }
    sel.appendChild(o);
  });
  if (selected != null) sel.value = selected;
}

// -------- ToC (built once from DOM section/h2/h3 structure)

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildToc() {
  const nav = document.getElementById("toc-nav");
  if (!nav) return;
  const sections = document.querySelectorAll("main.wrap > section[id]");
  const ol = document.createElement("ol");
  sections.forEach(section => {
    if (section.id === "toc") return;
    const h2 = section.querySelector("h2");
    if (!h2) return;
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "#" + section.id;
    // Use the raw h2 text via cloneNode + firstChild content, without the
    // back-to-top anchor we're about to inject below.
    a.textContent = h2.firstChild ? h2.firstChild.textContent.trim() : h2.textContent;
    li.appendChild(a);
    ol.appendChild(li);

    // Inject a "Back to Contents" nav anchor into the h2, aligned right.
    if (!h2.querySelector(".back-to-top")) {
      h2.classList.add("h2-with-nav");
      const back = document.createElement("a");
      back.href = "#toc";
      back.className = "back-to-top";
      back.textContent = "↑ Contents";
      back.setAttribute("aria-label", "Back to Contents");
      h2.appendChild(back);
    }
  });
  nav.innerHTML = "";
  nav.appendChild(ol);
}

// -------- boot

async function boot() {
  document.querySelectorAll(".year").forEach(el => {
    el.textContent = new Date().getFullYear();
  });
  state.index = await fetchJson("index.json");
  document.querySelectorAll(".build-time").forEach(el => {
    el.textContent = state.index.generated_at;
  });
  const tvEl = document.getElementById("tool-version");
  if (tvEl && state.index.tool_version) tvEl.textContent = state.index.tool_version;

  const versions = state.index.versions.map(v => v.version);
  await Promise.all([
    ...state.index.versions.map(v =>
      fetchJson(v.artifact).then(j => { state.perVersion[v.version] = j; })),
    fetchJson("cross-version.json").then(j => { state.cross = j; }),
    fetchJson("hot.json").then(j => { state.hot = j; }),
  ]);

  buildToc();

  // Global handler for framework and related-control jump links.
  // data-rc (with data-fw) -> jump to the related-view (framework + related
  // control drill). data-fw alone -> jump to the single-framework drill.
  document.addEventListener("click", (evt) => {
    const rcA = evt.target.closest("a[data-rc]");
    if (rcA) {
      evt.preventDefault();
      const f = document.getElementById("r-framework");
      const r = document.getElementById("r-select");
      f.value = rcA.dataset.fw;
      // Repopulate related-control options for that framework, then select.
      f.dispatchEvent(new Event("change"));
      r.value = rcA.dataset.rc;
      r.dispatchEvent(new Event("change"));
      document.getElementById("related-view").scrollIntoView({ behavior: "smooth" });
      return;
    }
    const a = evt.target.closest("a[data-fw]");
    if (!a) return;
    if (a.closest("#fl-table-wrap")) return;
    evt.preventDefault();
    const sel = document.getElementById("f-select");
    if (!sel) return;
    sel.value = a.dataset.fw;
    sel.dispatchEvent(new Event("change"));
    document.getElementById("framework-view").scrollIntoView({ behavior: "smooth" });
  });

  renderTotals();
  renderSources();
  initVersionView(versions);
  initFrameworkLongitudinalView();
  initFrameworkView(versions);
  initLzaView();
  initLzaHeatmapView();
  initRelatedView();
  initLifecycleView();
  initFrameworkLifecycleView();
  initCoverageView(versions);
  initRatiosView(versions);
  initHotLzaView(versions);
  initHotRcView(versions);
}

// -------- Totals table

function renderTotals() {
  const versions = state.index.versions;
  const labels = versions.map(v => "v" + v.version);
  const mini = (canvasId, values, color) => {
    destroyChart(canvasId);
    state.charts[canvasId] = new Chart(document.getElementById(canvasId), {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: color, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: c => c.parsed.y.toLocaleString() } } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: "#eef1f6" }, ticks: { precision: 0 } },
        },
      },
    });
  };
  mini("t-frameworks", versions.map(v => v.frameworks),     "#0a2d6b");
  mini("t-lza",        versions.map(v => v.lza_ids),        "#3a3f47");
  mini("t-tuples",     versions.map(v => v.mapping_tuples), "#ff8a3d");

  const rows = versions.map(v => ({
    version: "v" + v.version,
    published: v.publish_date || "—",
    source: v.source_file,
    frameworks: v.frameworks,
    lza: v.lza_ids,
    pairs: v.mapping_tuples.toLocaleString(),
  }));
  replace("totals-table", buildTable([
    { key: "version",   label: "LZA Compliance Workbook Version" },
    { key: "published", label: "Published" },
    { key: "source",    label: "Source file" },
    { key: "frameworks", label: "Compliance Frameworks", num: true },
    { key: "lza",       label: "LZA Common Control IDs", num: true },
    { key: "pairs",     label: "Mapping tuples", num: true },
  ], rows));
}

function renderSources() {
  const ul = document.getElementById("sources-list");
  state.index.versions.forEach(v => {
    const li = document.createElement("li");
    const date = v.publish_date || "date unknown";
    li.textContent = `v${v.version} (published ${date}) — ${v.source_file} (${v.frameworks} frameworks, ${v.lza_ids} LZA controls, ${v.mapping_tuples.toLocaleString()} mapping tuples)`;
    ul.appendChild(li);
  });
}

// -------- Version view

function initVersionView(versions) {
  const sel = document.getElementById("v-select");
  const metric = document.getElementById("v-metric");
  fillSelect(sel, versions.map(v => ({ value: v, label: "v" + v })), versions[versions.length - 1]);
  const render = () => renderVersionView(sel.value, metric.value);
  sel.addEventListener("change", render);
  metric.addEventListener("change", render);
  render();
}

function renderVersionView(version, metric) {
  const payload = state.perVersion[version];
  const rows = [...payload.frameworks].sort((a, b) => b[metric] - a[metric]);
  const labels = rows.map(r => r.name);
  const data = rows.map(r => r[metric]);

  destroyChart("v-chart");
  state.charts["v-chart"] = new Chart(document.getElementById("v-chart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: ({ mapping_tuples: "mapping tuples",
                  related_control_count: "distinct related controls",
                  lza_id_count: "distinct LZA controls" })[metric] || metric,
        data,
        backgroundColor: "#0a2d6b",
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.parsed.x.toLocaleString()}` } },
      },
      scales: {
        x: { grid: { color: "#eef1f6" }, ticks: { precision: 0 } },
        y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } },
      },
    },
  });

  const tableRows = rows.map(r => ({
    fw: fwLink(r.name),
    pairs: r.mapping_tuples.toLocaleString(),
    rc: r.related_control_count.toLocaleString(),
    lza: r.lza_id_count.toLocaleString(),
  }));
  replace("v-table", buildTable([
    { key: "fw",    label: "Compliance Framework" },
    { key: "pairs", label: "Mapping tuples", num: true },
    { key: "rc",    label: "Distinct Related Controls", num: true },
    { key: "lza",   label: "Distinct LZA Common Control IDs", num: true },
  ], tableRows));
}

// -------- Single Framework across all versions (longitudinal depth view)

const FL2_METRIC_LABEL = {
  lza_id_count: "LZA Common Control IDs mapped",
  related_control_count: "Distinct related controls",
  mapping_tuples: "Mapping tuples",
};

function initFrameworkLongitudinalView() {
  const f = document.getElementById("fl2-framework");
  const m = document.getElementById("fl2-metric");
  fillSelect(f, state.cross.all_frameworks, state.cross.all_frameworks[0]);
  const render = () => renderFrameworkLongitudinalView(f.value, m.value);
  f.addEventListener("change", render);
  m.addEventListener("change", render);
  render();
}

function renderFrameworkLongitudinalView(framework, metric) {
  const versions = state.cross.versions;
  const points = versions.map(v => {
    const payload = state.perVersion[v];
    const fw = payload.frameworks.find(x => x.name === framework);
    return fw
      ? { present: true, value: fw[metric] }
      : { present: false, value: 0 };
  });

  destroyChart("fl2-chart");
  state.charts["fl2-chart"] = new Chart(document.getElementById("fl2-chart"), {
    type: "bar",
    data: {
      labels: versions.map(v => "v" + v),
      datasets: [{
        label: FL2_METRIC_LABEL[metric] || metric,
        data: points.map(p => p.present ? p.value : null),
        backgroundColor: points.map(p => p.present ? "#e6efff" : "#f2f5fa"),
        borderColor:     points.map(p => p.present ? "#0a2d6b" : "#c8ccd4"),
        hoverBackgroundColor: points.map(p => p.present ? "#0a2d6b" : "#c8ccd4"),
        hoverBorderColor:     points.map(p => p.present ? "#0a2d6b" : "#c8ccd4"),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => points[c.dataIndex].present
              ? `${c.parsed.y.toLocaleString()} ${FL2_METRIC_LABEL[metric] || metric}`
              : "framework not in this workbook version",
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "#eef1f6" }, ticks: { precision: 0 } },
      },
    },
  });

  // Per-version table with delta vs previous present-version.
  const rows = [];
  let prev = null;
  versions.forEach((v, i) => {
    const cur = points[i];
    let delta = "—";
    if (cur.present && prev !== null) {
      const d = cur.value - prev;
      delta = (d > 0 ? "+" : "") + d.toLocaleString();
    }
    rows.push({
      version: "v" + v,
      value: cur.present ? cur.value.toLocaleString() : "N/A",
      delta,
    });
    if (cur.present) prev = cur.value;
  });
  replace("fl2-table", buildTable([
    { key: "version", label: "LZA Compliance Workbook Version" },
    { key: "value",   label: FL2_METRIC_LABEL[metric] || metric, num: true },
    { key: "delta",   label: "Δ vs previous", num: true },
  ], rows));
}

// -------- Framework view

function initFrameworkView(versions) {
  const f = document.getElementById("f-select");
  const v = document.getElementById("f-version");
  const t = document.getElementById("f-topn");
  fillSelect(f, state.cross.all_frameworks, state.cross.all_frameworks[0]);
  fillSelect(v, versions.map(x => ({ value: x, label: "v" + x })), versions[versions.length - 1]);
  const render = () => renderFrameworkView(f.value, v.value, parseInt(t.value, 10) || 0);
  f.addEventListener("change", render);
  v.addEventListener("change", render);
  t.addEventListener("change", render);
  render();
}

function renderFrameworkView(framework, version, topN) {
  // For the selected framework in the selected version: bar chart of related controls
  // by number of LZA IDs mapped. Table adds cross-version presence per related control.
  const payload = state.perVersion[version];
  const rcCounts = new Map();  // rc -> Set(lza_id)
  payload.mappings.forEach(m => {
    if (m.framework !== framework) return;
    if (!rcCounts.has(m.related_control)) rcCounts.set(m.related_control, new Set());
    rcCounts.get(m.related_control).add(m.lza_id);
  });

  let entries = Array.from(rcCounts, ([rc, set]) => ({ rc, count: set.size }))
    .sort((a, b) => b.count - a.count || naturalCmp(a.rc, b.rc));
  const total = entries.length;
  if (topN > 0) entries = entries.slice(0, topN);

  sizeBarWrap("f-chart", entries.length);
  destroyChart("f-chart");
  state.charts["f-chart"] = new Chart(document.getElementById("f-chart"), {
    type: "bar",
    data: {
      labels: entries.map(e => e.rc),
      datasets: [{
        label: `LZA IDs mapped in v${version}`,
        data: entries.map(e => e.count),
        backgroundColor: "#e6efff",
        borderColor: "#0a2d6b",
        hoverBackgroundColor: "#0a2d6b",
        hoverBorderColor: "#0a2d6b",
        borderWidth: 1,
        borderRadius: 4,
        barThickness: 18,
        maxBarThickness: 18,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: "#eef1f6" }, ticks: { precision: 0 } },
        y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 10 } } },
      },
    },
  });

  // Cross-version presence per related control
  const versions = state.cross.versions;
  const presenceByRc = new Map();
  state.cross.tuples.forEach(t => {
    if (t.framework !== framework) return;
    if (!presenceByRc.has(t.related_control))
      presenceByRc.set(t.related_control, new Set());
    t.versions.forEach(v => presenceByRc.get(t.related_control).add(v));
  });

  const tableRows = entries.map(e => {
    const versionsPresent = presenceByRc.get(e.rc) || new Set();
    const cell = el("span");
    versions.forEach(v => {
      if (versionsPresent.has(v))
        cell.appendChild(el("span", { class: "pill" }, "v" + v));
    });
    if (!cell.childNodes.length) cell.textContent = "—";
    return { rc: rcLink(framework, e.rc), count: e.count.toLocaleString(), versions: cell };
  });

  const showing = topN > 0 ? `Top ${entries.length} of ${total} related controls.` :
                             `All ${total} related controls.`;
  const wrap = el("div");
  wrap.appendChild(el("p", { class: "hint" }, showing));
  wrap.appendChild(buildTable([
    { key: "rc",       label: "Related control" },
    { key: "count",    label: "LZA Common Control IDs Mapped", num: true },
    { key: "versions", label: "Mapped In LZA Compliance Workbook Version" },
  ], tableRows));
  replace("f-table", wrap);
}

// -------- LZA view

function initLzaView() {
  const s = document.getElementById("l-select");
  const vsel = document.getElementById("l-version");
  const filter = document.getElementById("l-filter");
  fillSelect(s, state.cross.all_lza_ids, state.cross.all_lza_ids[0]);
  state.cross.versions.forEach(v => {
    const o = document.createElement("option");
    o.value = v; o.textContent = "v" + v;
    vsel.appendChild(o);
  });
  const render = () => renderLzaView(s.value, vsel.value);
  s.addEventListener("change", render);
  vsel.addEventListener("change", render);

  // Filter narrows the LZA ID dropdown options in place. Preserve the current
  // selection if it still matches, else fall back to the first match.
  let t;
  filter.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const needle = filter.value.trim().toLowerCase();
      const ids = needle
        ? state.cross.all_lza_ids.filter(id => id.toLowerCase().includes(needle))
        : state.cross.all_lza_ids;
      const keep = ids.includes(s.value) ? s.value : (ids[0] || "");
      fillSelect(s, ids, keep);
      render();
    }, 120);
  });

  render();
}

function initLzaHeatmapView() {
  const s = document.getElementById("lh-select");
  fillSelect(s, state.cross.all_lza_ids, state.cross.all_lza_ids[0]);
  s.addEventListener("change", () => renderLzaHeatmap(s.value));
  renderLzaHeatmap(s.value);
}

function renderLzaView(lza, versionFilter) {
  const versions = state.cross.versions;
  versionFilter = versionFilter || "all";

  const descHost = document.getElementById("l-description");
  if (descHost) {
    const desc = (state.cross.descriptions || {})[lza];
    descHost.innerHTML = "";
    if (desc) {
      descHost.appendChild(el("span", { class: "lza-desc-id" }, lza));
      descHost.appendChild(el("span", { class: "lza-desc-text" }, desc));
    } else {
      descHost.appendChild(el("span", { class: "lza-desc-text muted" },
        "No description available for " + lza));
    }
  }

  // Presence per version: single-row table, LZA ID | one column per version.
  const presenceHost = document.getElementById("l-presence");
  presenceHost.innerHTML = "";
  const table = el("table", { class: "presence-table" });
  const thead = el("thead");
  const trh = el("tr");
  trh.appendChild(el("th", {}, "LZA Common Control ID"));
  versions.forEach(v => trh.appendChild(el("th", { class: "num" }, "v" + v)));
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = el("tbody");
  const tr = el("tr");
  tr.appendChild(el("td", {},
    el("span", { class: "lza-id-mono", title: descOf(lza) || "" }, lza)));
  versions.forEach(v => {
    const present = (state.cross.lza_ids_by_version[v] || []).includes(lza);
    const td = el("td", { class: "presence-td" });
    if (present)
      td.appendChild(el("span", { class: "pill" }, "Included"));
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
  table.appendChild(tbody);
  presenceHost.appendChild(table);

  // Mappings by version — table of (framework, related, versions-present).
  // If versionFilter is a specific version, restrict rows to tuples that
  // appear in that version. Otherwise (aggregate) show all rows.
  const key = new Map();  // "fw||rc" -> Set(versions)
  state.cross.tuples.forEach(t => {
    if (t.lza_id !== lza) return;
    if (versionFilter !== "all" && !t.versions.includes(versionFilter)) return;
    const k = t.framework + "||" + t.related_control;
    if (!key.has(k)) key.set(k, new Set());
    t.versions.forEach(v => key.get(k).add(v));
  });
  const rows = Array.from(key, ([k, set]) => {
    const [fw, rc] = k.split("||");
    return { fw, rc, set };
  }).sort((a, b) => a.fw.localeCompare(b.fw) || naturalCmp(a.rc, b.rc));

  const tableRows = rows.map(r => {
    const cell = el("span");
    versions.forEach(v => {
      if (r.set.has(v)) cell.appendChild(el("span", { class: "pill" }, "v" + v));
    });
    if (!cell.childNodes.length) cell.textContent = "—";
    return { fw: fwLink(r.fw), rc: rcLink(r.fw, r.rc), cell };
  });
  replace("l-mappings", buildTable([
    { key: "fw",   label: "Compliance Framework" },
    { key: "rc",   label: "Related control" },
    { key: "cell", label: "Mapped In LZA Compliance Workbook Version" },
  ], tableRows));
}

// -------- LZA heatmap (WIP standalone Framework Coverage Per Version)

function renderLzaHeatmap(lza) {
  const versions = state.cross.versions;
  const allFw = state.cross.all_frameworks;
  const fwByVersion = state.cross.frameworks_by_version;

  const descHost = document.getElementById("lh-description");
  if (descHost) {
    const desc = descOf(lza);
    descHost.innerHTML = "";
    if (desc) {
      descHost.appendChild(el("span", { class: "lza-desc-id" }, lza));
      descHost.appendChild(el("span", { class: "lza-desc-text" }, desc));
    } else {
      descHost.appendChild(el("span", { class: "lza-desc-text muted" },
        "No description available for " + lza));
    }
  }

  // Rows ordered by the workbook version each framework first appeared in,
  // so growth reads top-down like the framework-lifecycle table.
  const firstSeen = new Map();
  allFw.forEach(fw => {
    for (const v of versions)
      if ((fwByVersion[v] || []).includes(fw)) { firstSeen.set(fw, v); break; }
  });
  const orderedFw = [...allFw].sort((a, b) => {
    const va = firstSeen.get(a) || "";
    const vb = firstSeen.get(b) || "";
    if (va !== vb) return naturalCmp(va, vb);
    return a.localeCompare(b);
  });

  // For each (framework, version) count distinct related controls the chosen
  // LZA ID maps to.
  const table = el("table", { class: "lifecycle-table" });
  const thead = el("thead");
  const trh = el("tr");
  trh.appendChild(el("th", {}, "Compliance Framework"));
  versions.forEach(v => trh.appendChild(el("th", {}, "v" + v)));
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = el("tbody");

  orderedFw.forEach(fw => {
    const tr = el("tr");
    const tdFw = el("td");
    tdFw.appendChild(fwLink(fw));
    tr.appendChild(tdFw);

    versions.forEach(v => {
      const td = el("td");
      const fwExists = (fwByVersion[v] || []).includes(fw);
      if (!fwExists) {
        td.appendChild(el("span", { class: "pill pill-blue" }, "Framework N/A"));
      } else {
        const payload = state.perVersion[v];
        const relSet = new Set();
        payload.mappings.forEach(m => {
          if (m.lza_id === lza && m.framework === fw) relSet.add(m.related_control);
        });
        if (relSet.size > 0)
          td.appendChild(el("span", { class: "pill pill-blue" },
            "Related Controls: " + relSet.size));
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const wrap = document.getElementById("lh-table-wrap");
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

// -------- Related-control view

function initRelatedView() {
  const f = document.getElementById("r-framework");
  const r = document.getElementById("r-select");
  fillSelect(f, state.cross.all_frameworks, state.cross.all_frameworks[0]);
  const onFramework = () => {
    const opts = state.cross.all_related_by_framework[f.value] || [];
    fillSelect(r, opts, opts[0]);
    renderRelatedView(f.value, r.value);
  };
  f.addEventListener("change", onFramework);
  r.addEventListener("change", () => renderRelatedView(f.value, r.value));

  document.getElementById("r-detail").addEventListener("click", (evt) => {
    const a = evt.target.closest("a[data-lza]");
    if (!a) return;
    evt.preventDefault();
    const sel = document.getElementById("l-select");
    sel.value = a.dataset.lza;
    sel.dispatchEvent(new Event("change"));
    document.getElementById("lza-view").scrollIntoView({ behavior: "smooth" });
  });

  onFramework();
}

function renderRelatedView(framework, related) {
  const versions = state.cross.versions;
  const lzaByVersion = new Map(versions.map(v => [v, new Set()]));
  state.cross.tuples.forEach(t => {
    if (t.framework !== framework || t.related_control !== related) return;
    t.versions.forEach(v => lzaByVersion.get(v).add(t.lza_id));
  });

  const allLza = new Set();
  lzaByVersion.forEach(set => set.forEach(id => allLza.add(id)));
  const rows = [...allLza].sort(naturalCmp).map(id => {
    const cell = el("span");
    versions.forEach(v => {
      if (lzaByVersion.get(v).has(id))
        cell.appendChild(el("span", { class: "pill" }, "v" + v));
    });
    if (!cell.childNodes.length) cell.textContent = "—";
    return { id: lzaLink(id), desc: descOf(id) || "—", cell };
  });

  const head = el("div");
  head.appendChild(el("p", { class: "hint" },
    `${allLza.size} distinct LZA Common Control IDs are mapped to ${framework} - ${related} across all LZA Compliance Workbook versions.`));
  head.appendChild(buildTable([
    { key: "id",   label: "LZA Common Control ID" },
    { key: "desc", label: "Description" },
    { key: "cell", label: "Mapped In LZA Compliance Workbook Version" },
  ], rows));
  replace("r-detail", head);
}

// -------- Lifecycle view: all LZA IDs across all workbook versions

function initLifecycleView() {
  const filter = document.getElementById("lc-filter");
  let t;
  filter.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => renderLifecycleView(filter.value.trim()), 120);
  });
  renderLifecycleView("");

  // Click an LZA ID link -> jump to that ID in the drill above.
  document.getElementById("lc-table-wrap").addEventListener("click", (evt) => {
    const a = evt.target.closest("a[data-lza]");
    if (!a) return;
    evt.preventDefault();
    const sel = document.getElementById("l-select");
    sel.value = a.dataset.lza;
    sel.dispatchEvent(new Event("change"));
    document.getElementById("lza-view").scrollIntoView({ behavior: "smooth" });
  });
}

function renderLifecycleView(filterText) {
  const versions = state.cross.versions;
  const allLza = state.cross.all_lza_ids;
  const idsByVersion = state.cross.lza_ids_by_version;
  const needle = filterText.toLowerCase();
  const ids = needle
    ? allLza.filter(id => id.toLowerCase().includes(needle))
    : allLza;

  // Pre-compute a Set per version so `has()` is O(1) and we can trust the check.
  const setByVersion = {};
  versions.forEach(v => { setByVersion[v] = new Set(idsByVersion[v] || []); });

  // Summary line — externally visible proof that the underlying data is right.
  const summary = document.getElementById("lc-summary");
  if (summary) {
    summary.textContent = versions.map(v =>
      `v${v}: ${setByVersion[v].size} IDs`).join(" · ") +
      (needle ? ` · showing ${ids.length} matching "${filterText}"` : "");
  }

  const table = el("table", { class: "lifecycle-table" });
  const thead = el("thead");
  const trh = el("tr");
  trh.appendChild(el("th", {}, "LZA Common Control ID"));
  trh.appendChild(el("th", {}, "Description"));
  versions.forEach(v => trh.appendChild(el("th", { class: "num" }, "v" + v)));
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = el("tbody");
  ids.forEach(id => {
    const tr = el("tr");
    const tdId = el("td");
    tdId.appendChild(lzaLink(id));
    tr.appendChild(tdId);
    tr.appendChild(el("td", { class: "desc-cell" }, descOf(id) || "—"));
    versions.forEach(v => {
      const td = el("td", { class: "num" });
      if (setByVersion[v].has(id))
        td.appendChild(el("span", { class: "pill pill-grey" }, "Included"));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const wrap = document.getElementById("lc-table-wrap");
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

// -------- Framework Lifecycle view: all frameworks across all versions

function initFrameworkLifecycleView() {
  renderFrameworkLifecycleView("");
  const filter = document.getElementById("fl-filter");
  let t;
  filter.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => renderFrameworkLifecycleView(filter.value.trim()), 120);
  });
  document.getElementById("fl-table-wrap").addEventListener("click", (evt) => {
    const a = evt.target.closest("a[data-fw]");
    if (!a) return;
    evt.preventDefault();
    const sel = document.getElementById("f-select");
    sel.value = a.dataset.fw;
    sel.dispatchEvent(new Event("change"));
    document.getElementById("framework-view").scrollIntoView({ behavior: "smooth" });
  });
}

function renderFrameworkLifecycleView(filterText) {
  const versions = state.cross.versions;
  const fwByVersion = state.cross.frameworks_by_version;
  // Union set, preserving first-appearance order so growth reads top-down.
  const allFw = [];
  const seen = new Set();
  versions.forEach(v => (fwByVersion[v] || []).forEach(fw => {
    if (!seen.has(fw)) { seen.add(fw); allFw.push(fw); }
  }));

  const setByVersion = {};
  versions.forEach(v => { setByVersion[v] = new Set(fwByVersion[v] || []); });

  const needle = (filterText || "").toLowerCase();
  const shownFw = needle
    ? allFw.filter(fw => fw.toLowerCase().includes(needle))
    : allFw;

  const summary = document.getElementById("fl-summary");
  if (summary) {
    summary.textContent = versions.map(v =>
      `v${v}: ${setByVersion[v].size} frameworks`).join(" · ") +
      ` · union across versions: ${allFw.length}` +
      (needle ? ` · showing ${shownFw.length} matching "${filterText}"` : "");
  }

  const table = el("table", { class: "lifecycle-table" });
  const thead = el("thead");
  const trh = el("tr");
  trh.appendChild(el("th", {}, "Compliance Framework"));
  versions.forEach(v => trh.appendChild(el("th", {}, "v" + v)));
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = el("tbody");
  shownFw.forEach(fw => {
    const tr = el("tr");
    const tdFw = el("td");
    tdFw.appendChild(el("a", { href: "#framework-view", "data-fw": fw }, fw));
    tr.appendChild(tdFw);
    versions.forEach(v => {
      const td = el("td");
      if (setByVersion[v].has(fw))
        td.appendChild(el("span", { class: "pill pill-blue" }, "Present"));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const wrap = document.getElementById("fl-table-wrap");
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

// -------- Coverage view: mapped vs unmapped LZA controls per framework

// coverageStats(version) -> { framework -> {mapped, unmapped, total, ratio} }
// Cached so repeated framework toggles don't rescan the mappings array.
const coverageCache = new Map();
function coverageStats(version) {
  if (coverageCache.has(version)) return coverageCache.get(version);
  const payload = state.perVersion[version];
  const total = payload.lza_ids.length;
  const mappedByFw = new Map();  // fw -> Set(lza_id)
  payload.mappings.forEach(m => {
    if (!mappedByFw.has(m.framework)) mappedByFw.set(m.framework, new Set());
    mappedByFw.get(m.framework).add(m.lza_id);
  });
  const out = new Map();
  payload.frameworks.forEach(fw => {
    const mapped = mappedByFw.get(fw.name)?.size || 0;
    const unmapped = total - mapped;
    out.set(fw.name, {
      mapped,
      unmapped,
      total,
      ratio: mapped === 0 ? Infinity : unmapped / mapped,
      mapped_ids: mappedByFw.get(fw.name) || new Set(),
    });
  });
  coverageCache.set(version, out);
  return out;
}

function initCoverageView(versions) {
  const cv = document.getElementById("c-version");
  const cf = document.getElementById("c-framework");
  fillSelect(cv, versions.map(v => ({ value: v, label: "v" + v })),
             versions[versions.length - 1]);
  const populateFrameworks = () => {
    const payload = state.perVersion[cv.value];
    const opts = payload.frameworks.map(f => f.name);
    fillSelect(cf, opts, opts[0]);
  };
  populateFrameworks();
  cv.addEventListener("change", () => { populateFrameworks(); render(); });
  cf.addEventListener("change", () => render());
  const render = () => renderCoverageView(cv.value, cf.value);
  render();
}

function renderCoverageView(version, framework) {
  const payload = state.perVersion[version];
  const stats = coverageStats(version);
  const s = stats.get(framework);

  // Stats box for selected framework
  const statsHost = document.getElementById("c-stats");
  statsHost.innerHTML = "";
  const ratioStr = s.ratio === Infinity ? "—" : s.ratio.toFixed(2);
  const pctUnmapped = s.total ? (s.unmapped / s.total * 100).toFixed(1) + "%" : "—";
  const stats_ = [
    { k: "LZA controls in v" + version, n: s.total.toLocaleString() },
    { k: "Mapped to " + framework, n: s.mapped.toLocaleString(), cls: "ok" },
    { k: "Unmapped to " + framework, n: s.unmapped.toLocaleString(), cls: "warn" },
    { k: "Unmapped %", n: pctUnmapped },
    { k: "Unmapped / mapped ratio", n: ratioStr },
  ];
  stats_.forEach(x => {
    const div = el("div", { class: "stat " + (x.cls || "") });
    div.appendChild(el("span", { class: "k" }, x.k));
    div.appendChild(el("div", { class: "n" }, x.n));
    statsHost.appendChild(div);
  });

  // Unmapped LZA table for the selected framework
  const listHost = document.getElementById("c-unmapped-list");
  listHost.innerHTML = "";
  const unmappedIds = payload.lza_ids.filter(id => !s.mapped_ids.has(id));
  if (!unmappedIds.length) {
    listHost.appendChild(el("p", { class: "unmapped-empty" },
      `Every LZA Common Control ID in v${version} maps to at least one ${framework} Related Control.`));
  } else {
    listHost.appendChild(el("p", { class: "hint" },
      `${unmappedIds.length} LZA Common Control ID${unmappedIds.length === 1 ? "" : "s"} unmapped to ${framework} in v${version}.`));
    listHost.appendChild(buildTable([
      { key: "id",   label: "LZA Common Control ID" },
      { key: "desc", label: "Description" },
    ], unmappedIds.map(id => ({ id: lzaLink(id), desc: descOf(id) || "—" }))));
  }
}

// -------- Ratios view: comparative across all frameworks for one version

function initRatiosView(versions) {
  const cv = document.getElementById("c2-version");
  fillSelect(cv, versions.map(v => ({ value: v, label: "v" + v })),
             versions[versions.length - 1]);
  cv.addEventListener("change", () => renderRatiosView(cv.value));
  renderRatiosView(cv.value);
}

function renderRatiosView(version) {
  const payload = state.perVersion[version];
  const stats = coverageStats(version);
  const fwNames = payload.frameworks.map(f => f.name);
  const mappedVals = fwNames.map(fw => stats.get(fw).mapped);
  const unmappedVals = fwNames.map(fw => stats.get(fw).unmapped);
  const ratios = fwNames.map(fw => stats.get(fw).ratio);
  const total = payload.lza_ids.length;

  const ratioLabel = {
    id: "ratioLabel2",
    afterDatasetsDraw(chart) {
      const { ctx, chartArea } = chart;
      const meta = chart.getDatasetMeta(1);
      ctx.save();
      ctx.font = "600 11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillStyle = "#556270";
      meta.data.forEach((bar, i) => {
        const txt = `${mappedVals[i]}/${total}`;
        ctx.fillText(txt, chartArea.right + 6, bar.y);
      });
      ctx.restore();
    },
  };

  destroyChart("c2-chart");
  state.charts["c2-chart"] = new Chart(document.getElementById("c2-chart"), {
    type: "bar",
    data: {
      labels: fwNames,
      datasets: [
        { label: "Mapped",   data: mappedVals,   backgroundColor: "#0a2d6b", borderRadius: 3 },
        { label: "Unmapped", data: unmappedVals, backgroundColor: "#dbe0ea", borderRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: "y",
      layout: { padding: { right: 70 } },
      plugins: {
        legend: { position: "top", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            afterLabel: (c) => {
              const r = ratios[c.dataIndex];
              const rs = r === Infinity ? "∞" : r.toFixed(2);
              return `Total LZA: ${total} · ratio (u/m): ${rs}`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { color: "#eef1f6" }, ticks: { precision: 0 } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
    plugins: [ratioLabel],
  });

  // Alternative view: 100% stacked bars — each framework normalized to the
  // total LZA-ID count so bars share a common baseline and ratio is the
  // proportion visible. Percentage of mapped annotated at the end of each bar.
  const mappedPct = fwNames.map(fw => (stats.get(fw).mapped / total) * 100);
  const unmappedPct = fwNames.map((_, i) => 100 - mappedPct[i]);

  const pctLabel = {
    id: "pctLabel",
    afterDatasetsDraw(chart) {
      const { ctx, chartArea } = chart;
      const meta = chart.getDatasetMeta(1);
      ctx.save();
      ctx.font = "600 11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillStyle = "#556270";
      meta.data.forEach((bar, i) => {
        ctx.fillText(mappedPct[i].toFixed(1) + "%", chartArea.right + 6, bar.y);
      });
      ctx.restore();
    },
  };

  destroyChart("c3-chart");
  state.charts["c3-chart"] = new Chart(document.getElementById("c3-chart"), {
    type: "bar",
    data: {
      labels: fwNames,
      datasets: [
        { label: "Mapped %",   data: mappedPct,   backgroundColor: "#0a2d6b", borderRadius: 3 },
        { label: "Unmapped %", data: unmappedPct, backgroundColor: "#dbe0ea", borderRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: "y",
      layout: { padding: { right: 70 } },
      plugins: {
        legend: { position: "top", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (c) => `${c.dataset.label}: ${c.parsed.x.toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: { stacked: true, min: 0, max: 100,
             grid: { color: "#eef1f6" },
             ticks: { callback: v => v + "%" } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
    plugins: [pctLabel],
  });
}

// -------- Hot view

function populateScopeSelect(selectId, versions) {
  const scope = document.getElementById(selectId);
  versions.forEach(v => {
    const o = document.createElement("option");
    o.value = "v:" + v; o.textContent = "v" + v;
    scope.appendChild(o);
  });
  scope.value = "v:" + versions[versions.length - 1];
}

function resolveHotScope(scopeValue) {
  if (scopeValue === "aggregate")
    return { hot: state.hot.aggregate, label: "aggregate" };
  const version = scopeValue.slice(2);
  return { hot: state.hot.per_version[version], label: "v" + version };
}

function initHotLzaView(versions) {
  populateScopeSelect("hL-scope", versions);
  const scope = document.getElementById("hL-scope");
  const topn  = document.getElementById("hL-topn");
  const render = () => renderHotLza(scope.value, parseInt(topn.value, 10));
  scope.addEventListener("change", render);
  topn.addEventListener("change", render);

  document.getElementById("hL-table").addEventListener("click", (evt) => {
    const a = evt.target.closest("a[data-lza]");
    if (!a) return;
    evt.preventDefault();
    const sel = document.getElementById("l-select");
    sel.value = a.dataset.lza;
    sel.dispatchEvent(new Event("change"));
    document.getElementById("lza-view").scrollIntoView({ behavior: "smooth" });
  });

  render();
}

function renderHotLza(scopeValue, topN) {
  const { hot, label } = resolveHotScope(scopeValue);
  const slice = hot.hot_lza.slice(0, topN);
  sizeBarWrap("hL-chart", slice.length);
  destroyChart("hL-chart");
  state.charts["hL-chart"] = new Chart(document.getElementById("hL-chart"), {
    type: "bar",
    data: {
      labels: slice.map(r => r.lza_id),
      datasets: [{ label: "mappings (" + label + ")",
                   data: slice.map(r => r.count),
                   backgroundColor: "#eef1f6",
                   borderColor: "#3a3f47",
                   hoverBackgroundColor: "#3a3f47",
                   hoverBorderColor: "#3a3f47",
                   borderWidth: 1,
                   borderRadius: 4,
                   barThickness: 18,
                   maxBarThickness: 18 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: "#eef1f6" }, ticks: { precision: 0 } },
        y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } },
      },
    },
  });
  replace("hL-table", buildTable([
    { key: "id",    label: "LZA Common Control ID" },
    { key: "desc",  label: "Description" },
    { key: "count", label: "Mappings", num: true },
  ], slice.map(r => ({
    id: lzaLink(r.lza_id),
    desc: descOf(r.lza_id) || "—",
    count: r.count.toLocaleString()
  }))));
}

function initHotRcView(versions) {
  populateScopeSelect("hR-scope", versions);
  const scope = document.getElementById("hR-scope");
  const topn  = document.getElementById("hR-topn");
  const render = () => renderHotRc(scope.value, parseInt(topn.value, 10));
  scope.addEventListener("change", render);
  topn.addEventListener("change", render);
  render();
}

function renderHotRc(scopeValue, topN) {
  const { hot, label } = resolveHotScope(scopeValue);
  const slice = hot.hot_related.slice(0, topN);
  sizeBarWrap("hR-chart", slice.length);
  destroyChart("hR-chart");
  state.charts["hR-chart"] = new Chart(document.getElementById("hR-chart"), {
    type: "bar",
    data: {
      labels: slice.map(r => `${r.related_control} · ${r.framework}`),
      datasets: [{ label: "mappings (" + label + ")",
                   data: slice.map(r => r.count),
                   backgroundColor: "#e6efff",
                   borderColor: "#0a2d6b",
                   hoverBackgroundColor: "#0a2d6b",
                   hoverBorderColor: "#0a2d6b",
                   borderWidth: 1,
                   borderRadius: 4,
                   barThickness: 18,
                   maxBarThickness: 18 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: "#eef1f6" }, ticks: { precision: 0 } },
        y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 10 } } },
      },
    },
  });
  replace("hR-table", buildTable([
    { key: "fw",    label: "Compliance Framework" },
    { key: "rc",    label: "Related control" },
    { key: "count", label: "Mappings", num: true },
  ], slice.map(r => ({ fw: fwLink(r.framework), rc: r.related_control,
                       count: r.count.toLocaleString() }))));
}

boot().catch(e => {
  document.body.insertAdjacentHTML("afterbegin",
    `<pre style="color:#a00;padding:20px">boot failed: ${e.message}</pre>`);
});

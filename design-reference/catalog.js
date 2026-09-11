/* Standalone visual demonstration: no APIs, persistence or runtime operations. */
(() => {
  const byId = (id) => document.getElementById(id);
  const search = byId("search");
  const state = byId("state");
  const count = byId("count");
  const density = byId("density");
  const theme = byId("theme");
  const rows = byId("rows");
  const pageSize = 10;
  let page = 0;
  let selected = null;
  const states = ["running", "stopped", "failed", "stopped", "running"];
  const stateLabels = { running: "Działa", stopped: "Zatrzymany", failed: "Błąd" };
  const stateClasses = { running: "success", stopped: "muted", failed: "failure" };
  const names = ["Customer Portal", "Billing API", "Auth Service", "Event Worker", "Analytics", "Search API", "Projekt-z-bardzo-długą-nazwą-do-sprawdzenia-czytelności"];
  const data = Array.from({ length: 300 }, (_, index) => ({
    id: index,
    name: names[index] || `Projekt ${String(index + 1).padStart(3, "0")}`,
    state: states[index % states.length],
    branch: index % 3 === 0 ? "feat/checkout" : "main",
    owner: index % 4 === 0 ? "Codex · 12 min" : "Wolny",
    hash: (0xa31f92c + index).toString(16),
  }));

  function cell(row, text, className = "") {
    const element = document.createElement("td");
    element.textContent = text;
    element.className = className;
    row.append(element);
    return element;
  }

  function showSelection() {
    for (const row of rows.children) {
      row.dataset.selected = String(Number(row.dataset.id) === selected);
    }
    byId("selection").textContent = selected === null
      ? "Nie wybrano projektu."
      : `Wybrano: ${data[selected].name}. Tylko podgląd demonstracyjny; stan serwera pozostaje bez zmian.`;
  }

  function render() {
    const query = search.value.trim().toLocaleLowerCase("pl");
    const filtered = data.slice(0, Number(count.value)).filter((project) =>
      (state.value === "all" || project.state === state.value)
      && `${project.name} ${project.branch}`.toLocaleLowerCase("pl").includes(query));
    page = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
    const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
    if (!visible.some((project) => project.id === selected)) selected = null;
    rows.replaceChildren();
    for (const project of visible) {
      const row = document.createElement("tr");
      row.dataset.id = String(project.id);
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "project";
      radio.checked = project.id === selected;
      radio.setAttribute("aria-label", `Wybierz ${project.name}`);
      radio.addEventListener("change", () => { selected = project.id; showSelection(); });
      cell(row, "").append(radio);
      const name = document.createElement("strong");
      name.textContent = project.name;
      cell(row, "").append(name);
      cell(row, stateLabels[project.state], stateClasses[project.state]);
      cell(row, project.state === "running" ? project.branch : "—", "mono muted");
      cell(row, project.owner, "muted");
      cell(row, project.id % 3 === 0 ? `Błąd · ${project.hash}` : `Zaliczone · ${project.hash}`, project.id % 3 === 0 ? "failure" : "success");
      rows.append(row);
    }
    byId("empty").hidden = filtered.length > 0;
    byId("results").textContent = filtered.length
      ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} z ${filtered.length} wyników · zestaw ${count.value}`
      : `0 wyników · zestaw ${count.value}`;
    byId("previous").disabled = page === 0;
    byId("next").disabled = (page + 1) * pageSize >= filtered.length;
    showSelection();
  }

  search.addEventListener("input", () => { page = 0; render(); });
  for (const input of [state, count]) input.addEventListener("change", () => { page = 0; render(); });
  density.addEventListener("change", () => byId("playground").classList.toggle("compact", density.value === "compact"));
  byId("previous").addEventListener("click", () => { page -= 1; render(); });
  byId("next").addEventListener("click", () => { page += 1; render(); });
  byId("reset").addEventListener("click", () => { search.value = ""; state.value = "all"; page = 0; render(); });
  function applyTheme() {
    document.documentElement.dataset.theme = theme.value;
    const tokens = getComputedStyle(document.documentElement);
    for (const label of document.querySelectorAll("[data-token]")) {
      label.textContent = tokens.getPropertyValue(label.dataset.token).trim().toUpperCase();
    }
  }
  theme.addEventListener("change", applyTheme);
  for (const button of document.querySelectorAll("[data-demo]")) {
    button.addEventListener("click", () => {
      byId("demo-message").textContent = `${button.dataset.demo}: przykład wyglądu. Nie wykonano żadnej operacji.`;
    });
  }
  applyTheme();
  render();
})();

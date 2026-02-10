//Renders sponsor-defined custom fields on the application page
//and shows a sponsor-only UI to add/remove those fields.

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function putJSON(url, body) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function makeIdFromLabel(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

//Fall back if /api/me fails
let meCache = { role: "Driver" };

//Current custom app schema
let schemaCache = { customFields: [] };

//Rendering
function renderCustomFields(fields) {
  const container = document.getElementById("customFields");
  if (!container) return;

  container.innerHTML = "";

  fields.forEach((f) => {
    const wrap = document.createElement("div");
    wrap.className = "form-group";

    const label = document.createElement("label");
    label.setAttribute("for", f.id);
    label.textContent = f.label;

    const input = document.createElement("input");
    input.id = f.id;
    input.name = f.id;

    //Supported basic types
    if (f.type === "text" || f.type === "number" || f.type === "date") {
      input.type = f.type;
    } else {
      input.type = "text";
    }

    if (f.required) input.required = true;

    wrap.appendChild(label);
    wrap.appendChild(input);
    container.appendChild(wrap);
  });
}

function renderSponsorEditor(fields) {
  const editor = document.getElementById("sponsorFieldEditor");
  const list = document.getElementById("fieldList");
  const addBtn = document.getElementById("addFieldBtn");

  if (!editor || !list || !addBtn) return;

  //Only sponsors can see editor UI
  if (meCache.role !== "Sponsor") {
    editor.style.display = "none";
    return;
  }

  editor.style.display = "block";

  //Render existing fields with Remove buttons
  list.innerHTML = "";
  fields.forEach((f) => {
    const li = document.createElement("li");
    li.style.marginBottom = "8px";
    li.textContent = `${f.label} (${f.type})`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Remove";
    btn.className = "btn btn-outline";
    btn.style.marginLeft = "10px";

    btn.addEventListener("click", async () => {
      try {
        const next = schemaCache.customFields.filter((x) => x.id !== f.id);
        await saveSchema(next);
      } catch (err) {
        console.error(err);
        alert("Could not remove field.");
      }
    });

    li.appendChild(btn);
    list.appendChild(li);
  });

  addBtn.onclick = null;
  addBtn.addEventListener("click", onAddFieldClick, { once: true });
}

function renderAll() {
  renderCustomFields(schemaCache.customFields);
  renderSponsorEditor(schemaCache.customFields);
}

//Data load/save
async function loadMeAndSchema() {
  meCache = await getJSON("/api/me");
  schemaCache = await getJSON("/api/application-schema");
  renderAll();
}

async function saveSchema(nextCustomFields) {
  await putJSON("/api/application-schema", { customFields: nextCustomFields });
  schemaCache = await getJSON("/api/application-schema");
  renderAll();
}


//Sponsor add field handler
async function onAddFieldClick() {
  const labelEl = document.getElementById("newFieldLabel");
  const typeEl = document.getElementById("newFieldType");
  const addBtn = document.getElementById("addFieldBtn");

  try {
    const label = (labelEl?.value || "").trim();
    const type = typeEl?.value || "text";

    if (!label) {
      alert("Please enter a field label.");
      return;
    }

    const id = makeIdFromLabel(label);
    if (!id) {
      alert("Invalid label.");
      return;
    }

    const exists = schemaCache.customFields.some((f) => f.id === id);
    if (exists) {
      alert("That field already exists.");
      return;
    }

    const next = [...schemaCache.customFields, { id, label, type, required: false }];

    await saveSchema(next);

    if (labelEl) labelEl.value = "";
  } catch (err) {
    console.error(err);
    alert("Could not add field.");
  } finally {
    if (addBtn) {
      addBtn.onclick = null;
      addBtn.addEventListener("click", onAddFieldClick, { once: true });
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadMeAndSchema().catch((err) => {
    console.error(err);
    const editor = document.getElementById("sponsorFieldEditor");
    if (editor) editor.style.display = "none";
  });
});

const roleSelect = document.getElementById("role");
const sponsorGroup = document.getElementById("sponsorGroup");

roleSelect.addEventListener("change", () => {
  if (roleSelect.value === "Driver") {
    sponsorGroup.style.display = "block";
  } else {
    sponsorGroup.style.display = "none";
  }
});
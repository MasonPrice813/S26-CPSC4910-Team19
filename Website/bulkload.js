async function setupAdmin() {
    const res = await fetch('/api/me');
    const user = await res.json();
    
    if (user.role === 'Admin') {
        const elements = document.querySelectorAll('.adminShowText');
        elements.forEach(el => {
            el.style.display = 'block';
        });
    }
}

setupAdmin();

async function setupSponsor() {
    const res = await fetch('/api/me');
    const user = await res.json();
    
    if (user.role === 'Sponsor') {
        const elements = document.querySelectorAll('.sponsorShowText');
        elements.forEach(el => {
            el.style.display = 'block';
        });
    }
}

setupSponsor();

document.getElementById("uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const output = document.getElementById("output");
  output.innerHTML = "";
  const fileInput = document.getElementById("file-upload");

  if (!fileInput.files.length) {
    output.innerHTML = `<p style="color:red;">Please select a file</p>`;
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  try {
    const res = await fetch("/api/upload-bulk", {
      method: "POST",
      body: formData
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      output.innerHTML = `<p style="color:red;">${data.error || "Upload failed"}</p>`;
      return;
    }

    const inserted = data.inserted ?? 0;
    const errors = data.errors || [];
    const insertedRows = data.insertedRows || [];
    output.innerHTML += `<h3>Inserted Users (${inserted})</h3>`;

    insertedRows.forEach(u => {
      output.innerHTML += `<p>${u.name} (${u.email})</p>`;
    });

    if (errors.length > 0) {
      output.innerHTML += `<h3 style="color:red;">Errors (${errors.length})</h3>`;
      errors.forEach(e => {
        output.innerHTML += `<p>Line ${e.lineNumber}: ${e.error}</p>`;
      });
    }

  } 
  catch (err) {
    console.error(err);
    output.innerHTML = `<p style="color:red;">Something went wrong</p>`;
  }
});

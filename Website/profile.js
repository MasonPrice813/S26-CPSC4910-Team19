const sectionsContainer = document.getElementById("sections-container");
let cropMode = false;
// PLACE TO ADD REST OF PROFILE INFORMATION
let sections = [
    {
        id: "profilePicture",
        title: "Profile Picture",
        content: ""
    },
    {
        id: "userbio",
        title: "User Bio",
        content: "" 
    },
    {
        id: "userPriorExperience",
        title: "Prior Experience",
        content: ""
    },
    {
        id: "userphone",
        title: "Phone number",
        content: ""
    },
    {
        id: "useremail",
        title: "Email",
        content: ""
    },
    {
        id: "userpassword",
        title: "Change Password",
        content: ""
    },
    {
        id: "useraddress",
        title: "Address",
        content: ""
    },
    {
        id: "sponsor",
        title: "Your Sponsor",
        content: "Example Sponsor"
    }
];

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `${url} -> ${res.status}`);
  return data;
}

function setSectionContent(id, value) {
  const s = sections.find(x => x.id === id);
  if (!s) return;
  s.content = (value ?? "").toString();
}

window.__profilePicError = async function(imgEl) {
  //prevent loops
  imgEl.onerror = null;

  //Show default avatar
  imgEl.src = "/Images/default_avatar.jpg";

  const hadCustom = imgEl.getAttribute("data-has-custom") === "1";
  if (!hadCustom) return;

  try {
    await fetch("/api/me/profile/photo", { method: "DELETE" });
  } catch (e) {
    console.error("Could not clear missing profile image:", e);
  }
};

async function loadProfileFromSession() {
    try {
        const data = await getJSON("/api/me/profile");
        const u = data.user;
        const p = data.profile || {};

        const meBadge = document.getElementById("meBadge");
        if (meBadge) meBadge.textContent = `${u.first_name} ${u.last_name} • ${u.role}`;

        const profileName = document.getElementById("profileName");
        if (profileName) profileName.textContent = `${u.first_name} ${u.last_name}`;

        setSectionContent("userphone", u.phone_number || "");
        setSectionContent("useremail", u.email || "");
        setSectionContent("sponsor", u.sponsor || "None");

        setSectionContent("userbio", p.bio || "");
        setSectionContent("userPriorExperience", p.prior_experience || "");
        setSectionContent("useraddress", p.address_text || "");

        const pic = sections.find(s => s.id === "profilePicture");
        if (pic) {
            pic.content = p.profile_image_url || "";
            pic.cropX = p.crop_x || "50%";
            pic.cropY = p.crop_y || "50%";
        }

        renderingSections();
        loadPointHistory();

  } catch (err) {
    console.error(err);
    window.location.href = "/Website/login.html";
  }
}

async function sendJSON(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `${url} -> ${res.status}`);
  return data;
}

async function saveProfileToDB() {
  const bio = sections.find(s => s.id === "userbio")?.content || "";
  const prior = sections.find(s => s.id === "userPriorExperience")?.content || "";
  const address = sections.find(s => s.id === "useraddress")?.content || "";
  const pic = sections.find(s => s.id === "profilePicture");

  await sendJSON("/api/me/profile", "PUT", {
    bio,
    prior_experience: prior,
    address_text: address,
    crop_x: pic?.cropX || null,
    crop_y: pic?.cropY || null
  });
}

function renderingSections() {
    sectionsContainer.innerHTML = "";
    // Going through each section and determining if the add button should be shown or the edit/remove
    sections.forEach(section => {
        let profileButtons = "";
        let profileContent = "";
        const sectionDiv = document.createElement("div");
        sectionDiv.className = "content-box";
        sectionDiv.dataset.id = section.id;
        
        if (section.id === "sponsor") {

        profileButtons = ""; 
        profileContent = `
            <p style="margin-top:12px; color: var(--muted);">
                ${section.content}
            </p>
        `;
        }
        else if (section.id === "profilePicture") {

            profileButtons = `
                ${section.content ? `
                    <button class="btn btn-outline edit-btn">Change</button>
                    <button class="btn btn-secondary remove-btn">Remove</button>
                    <button class="btn btn-primary crop-btn">Edit Crop</button>
                ` : `
                    <button class="btn btn-primary add-btn">Add</button>
                `}
            `;

            profileContent = `
                <img class="profile-pic"
                    src="${section.content || "/Images/default_avatar.jpg"}"
                    alt="Profile Picture"
                    data-has-custom="${section.content ? "1" : "0"}"
                    onerror="window.__profilePicError && window.__profilePicError(this)" />
            `;
        }
        else if (section.id === "userpassword") {
            profileButtons = `
                <button class="btn btn-primary pass-btn">Edit</button>
            `;
            profileContent = `
                <p style="margin-top:12px; color: var(--muted);">
                Must use at least one uppercase letter, one lowercase letter, one number, and be at least 8 characters long
                </p>
                <form class="form" id="resetForm" style="display:none;">
                    <label class="field">
                    <span>New password</span>
                    <input
                        id="newPassword"
                        type="password"
                        name="newPassword"
                        minlength="8"
                        pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}"
                        title="Must be 8+ characters and include 1 uppercase letter, 1 lowercase letter, and 1 number."
                        required
                        />
                    </label>

                    <label class="field">
                    <span>Confirm new password</span>
                    <input
                        id="confirmPassword"
                        type="password"
                        name="confirmPassword"
                        minlength="8"
                        pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}"
                        title="Must be 8+ characters and include 1 uppercase letter, 1 lowercase letter, and 1 number."
                        required
                        />
                    </label>

                    <button class="primary-btn" type="submit">Update password</button>

                    <p class="muted small" id="resetHint" style="margin-top: 10px;"></p>
                </form>
            `;
        }
        else {
            if (section.content.trim() === "") {
                // Showing add button if blank
                profileButtons = `
                    <button class="btn btn-primary add-btn">Add</button>
                `;
                profileContent = `
                    <p style="margin-top:12px; color: var(--muted-2);">
                       No information
                    </p>
                `;
            } 
            else {
                // Showing edit/remove button if there is text
                profileButtons = `
                    <button class="btn btn-outline edit-btn">Edit</button>
                    <button class="btn btn-secondary remove-btn">Remove</button>
                `;
                profileContent = `
                    <p style="margin-top:12px; color: var(--muted);">
                    ${section.content}
                    </p>
                `;
            }
        }

        // Putting the buttons and content in the current section
        sectionDiv.innerHTML = `
        <div class="info-row">
            <span class="label">${section.title}</span>
            <div>
            ${profileButtons}
            </div>
        </div>
        ${profileContent}
        `;
        sectionsContainer.appendChild(sectionDiv);
    });
}

function addOrEditSection(id) {
    const section = sections.find(s => s.id === id);
    if (!section) return;

    if (id === "profilePicture") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg";

        input.onchange = async function () {
            const file = input.files[0];
            if (!file) return;

            try {
                const fd = new FormData();
                fd.append("photo", file);

                const res = await fetch("/api/me/profile/photo", {
                    method: "POST",
                    body: fd
                });

                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error || "Upload failed");

                section.content = data.url;
                section.cropX = "50%";
                section.cropY = "50%";
                renderingSections();

                await saveProfileToDB();
            } catch (err) {
                alert(err.message || "Could not upload photo.");
            }
        };

        input.click();
        return;
    }

    // Changing what's shown to user based on content amount
    let message = section.content === "" ? "Add content:" : "Edit content:";
    const newContent = prompt(message, section.content);

    if (newContent !== null) {
        section.content = newContent.trim();
        renderingSections();
        saveProfileToDB().catch(err => console.error(err));
    }
}

async function removeSection(id) {
    const section = sections.find(s => s.id === id);
    if (!section) return;

    // If removing photo, clear DB photo too
    if (id === "profilePicture") {
        try {
            await fetch("/api/me/profile/photo", { method: "DELETE" });
        } catch (e) {
            console.error(e);
        }

        section.content = "";
        section.cropX = null;
        section.cropY = null;

        renderingSections();
        saveProfileToDB().catch(err => console.error(err));
        return;
    }

    section.content = "";
    renderingSections();
    saveProfileToDB().catch(err => console.error(err));
}

let pointHistoryData = [];
async function loadPointHistory() {
  try {
    const history = await getJSON("/api/me/points-history");
    pointHistoryData = history;
    const container = document.getElementById("pointsHistory");
    container.innerHTML = "";

    if (!history.length) {
      container.innerHTML = `<p class="muted small">No point history yet.</p>`;
      return;
    }

    history.forEach(entry => {
      const div = document.createElement("div");
      div.className = "history-item";
      const sign = entry.points_change > 0 ? "+" : "";

      div.innerHTML = `
        <div><strong>${sign}${entry.points_change} points</strong></div>
        <div class="muted small">
          ${entry.reason || "No reason provided"}
        </div>
        <div class="muted small">
          ${new Date(entry.created_at).toLocaleString()}
        </div>
        <hr />
      `;

      container.appendChild(div);
    });
  } catch (err) {
    console.error("Failed to load history:", err);
  }
}

function downloadCSV() {
  if (!pointHistoryData.length) {
    alert("No data to download");
    return;
  }
  const headers = ["Points Change", "Reason", "Date"];

  // Converting Data to Rows in CSV
  const rows = pointHistoryData.map(entry => [
    entry.points_change,
    `"${(entry.reason || "No reason provided").replace(/"/g, '""')}"`,
    new Date(entry.created_at).toLocaleString()
  ]);

  // Joining together and putting into blob
  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.join(","))
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "point_history.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

document.getElementById("downloadCSV").addEventListener("click", downloadCSV);

sectionsContainer.addEventListener("click", function(e) {
    const sectionDiv = e.target.closest(".content-box");
    if (!sectionDiv) {
        return;
    }
    const id = sectionDiv.dataset.id;

    // Goes through the button functions for each possible scenario
    if (e.target.classList.contains("add-btn")) {
        addOrEditSection(id);
    }
    if (e.target.classList.contains("edit-btn")) {
        addOrEditSection(id);
    }
    if (e.target.classList.contains("remove-btn")) {
        removeSection(id);
    }

});

document.addEventListener("mousedown", function (e) {
    if (!cropMode) {
        return;
    }
    const img = document.getElementById("profile-img");
    if (!img) {
        return;
    }
    const container = img.parentElement;
    if (!container.contains(e.target)) {
        return;
    }

    function moveProfPic(e) {
        // Getting all variables
        const rect = container.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        const xClamped = Math.max(0, Math.min(100, x));
        const yClamped = Math.max(0, Math.min(100, y));

        // Changing the position of the user's picture shown
        img.style.objectPosition = `${xClamped}% ${yClamped}%`;
        const profPicSection = sections.find(s => s.id === "profilePicture");
        profPicSection.cropX = `${xClamped}%`;
        profPicSection.cropY = `${yClamped}%`;
    }

    function stopMoveProfPic() {
        document.removeEventListener("mousemove", moveProfPic);
        document.removeEventListener("mouseup", stopMoveProfPic);
    }
    document.addEventListener("mousemove", moveProfPic);
    document.addEventListener("mouseup", stopMoveProfPic);
});

loadProfileFromSession();

document.addEventListener("submit", async (e) => {
  if (e.target && e.target.id === "resetForm") {
    e.preventDefault();

    const hint = document.getElementById("resetHint");
    if (hint) hint.textContent = "";

    const newPassword = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (newPassword !== confirmPassword) {
      if (hint) hint.textContent = "Passwords do not match.";
      return;
    }

    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (hint) hint.textContent = data?.message || "Password update failed.";
        return;
      }

      if (hint) hint.textContent = "Password updated!";
      e.target.reset();
    } catch (err) {
      if (hint) hint.textContent = "Network error. Try again.";
    }
  }
});

document.addEventListener("click", function (e) {
    if (e.target.classList.contains("crop-btn")) {
        cropMode = !cropMode;
        const container = document.querySelector(".profile-pic-container");
        // Switching options 
        if (cropMode) {
            e.target.textContent = "Done";
            if (container) {
                container.style.cursor = "crosshair";
            }
        } 
        else {
            e.target.textContent = "Edit Crop";
            if (container) {
                container.style.cursor = "default";
            }
            saveProfileToDB().catch(err => console.error(err));
        }
    }
});

document.addEventListener("click", function (e) {
    if (e.target.classList.contains("pass-btn")) {
        document.getElementById("resetForm").style.display = "block";
    }
});

document.getElementById("catalogBtn").addEventListener("click", async () => {
    window.location.href = "/Website/catalog.html";
});

document.addEventListener("DOMContentLoaded", () => {
    loadProfileFromSession();

    const saveBtn = document.getElementById("saveProfileBtn");
    const status = document.getElementById("saveStatus");

    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
        try {
            saveBtn.disabled = true;
            if (status) status.textContent = "Saving...";
            await saveProfileToDB();
            if (status) status.textContent = "Saved!";
            setTimeout(() => { if (status) status.textContent = ""; }, 1500);
        } catch (err) {
            console.error(err);
            if (status) status.textContent = err.message || "Save failed.";
        } finally {
            saveBtn.disabled = false;
        }
        });
    }
});
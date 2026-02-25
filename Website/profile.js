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

async function loadProfileFromSession() {
  try {
    const data = await getJSON("/api/me/profile");
    const u = data.user;

    const meBadge = document.getElementById("meBadge");
    if (meBadge) {
      meBadge.textContent = `${u.first_name} ${u.last_name} • ${u.role}`;
    }

    const profileName = document.getElementById("profileName");
    if (profileName) profileName.textContent = `${u.first_name} ${u.last_name}`;

    setSectionContent("userphone", u.phone_number || "");
    setSectionContent("useremail", u.email || "");
    setSectionContent("sponsor", u.sponsor || "None");

    renderingSections();
  } catch (err) {
    console.error(err);
    window.location.href = "/Website/login.html";
  }
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

            if (section.content === "") {
                profileButtons = `
                <button class="btn btn-primary add-btn">Add</button>
                `;
                profileContent = `
                    <p style="margin-top:12px; color: var(--muted-2);">
                        No profile picture
                    </p>
                `;
            } else {
                profileButtons = `
                    <button class="btn btn-outline edit-btn">Change</button>
                    <button class="btn btn-secondary remove-btn">Remove</button>
                    <button class="btn btn-primary crop-btn">Edit Crop</button>

                `;
                profileContent = `
                    <img id="profile-img" src="${section.content}" 
                        style="margin-top:12px; width:150px; height:150px; object-fit:cover; object-position:${section.cropX || "50%"} ${section.cropY || "50%"}; border-radius:50%;" />
                `;
            }

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
        input.accept = "image/*";

        input.onchange = function () {
            const file = input.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function (e) {
                section.content = e.target.result;
                renderingSections();
            };
            reader.readAsDataURL(file);
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
    }
}

function removeSection(id) {
    const section = sections.find(s => s.id === id);
    if (!section) {
        return;
    }
    section.content = ""; 
    renderingSections();
}


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
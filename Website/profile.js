const sectionsContainer = document.getElementById("sections-container");
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
        id: "useraddress",
        title: "Address",
        content: ""
    }
];

function renderingSections() {
    sectionsContainer.innerHTML = "";
    // Going through each section and determining if the add button should be shown or the edit/remove
    sections.forEach(section => {
        let profileButtons = "";
        let profileContent = "";
        const sectionDiv = document.createElement("div");
        sectionDiv.className = "content-box";
        sectionDiv.dataset.id = section.id;
        
        if (section.id === "profilePicture") {

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
                    `;
                    profileContent = `
                    <img src="${section.content}" 
                        style="margin-top:12px; width:150px; height:150px; object-fit:cover; border-radius:50%;" />
                    `;
            }

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

renderingSections();

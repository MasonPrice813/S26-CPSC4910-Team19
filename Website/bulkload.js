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
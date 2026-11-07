const query = new URLSearchParams(window.location.search);
query.set('view', 'audit');
window.location.replace(`/?${query.toString()}`);

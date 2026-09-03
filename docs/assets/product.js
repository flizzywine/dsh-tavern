// Navigation remains usable without JavaScript; details use native HTML controls.
document.querySelectorAll('[data-open-detail]').forEach(link => {
  link.addEventListener('click', () => {
    const target = document.getElementById(link.hash.slice(1));
    if (target?.tagName === 'DETAILS') target.open = true;
  });
});
function openLinkedDetail() {
  const target = document.getElementById(window.location.hash.slice(1));
  if (target?.tagName === 'DETAILS') target.open = true;
}
window.addEventListener('hashchange', openLinkedDetail);
openLinkedDetail();

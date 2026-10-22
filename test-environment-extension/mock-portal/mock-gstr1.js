// Log native portal clicks
document.getElementById('btnGeneratePdf').addEventListener('click', function() {
  console.log('[Mock Portal GSTR-1] Button clicked via DOM event.');
  window.angular.element(document.body).scope().genratepdfNew();
});

// Simulate Modern Angular Ivy Component state
const compEl = document.getElementById('compSummary');
compEl.__componentInstance = {
  period: '042025',
  gstin: '22AAIFT4081E1ZE',
  downloadPdf: function() {
    console.log('[Mock Portal GSTR-2B Ivy] downloadPdf() invoked on component instance.');
    // Emits official GSTN docDefinition with known null Financial Year (mimicking live portal bug)
    const docDef = {
      info: { title: 'FORM GSTR-2B AUTO-DRAFTED ITC STATEMENT' },
      content: [
        { text: 'FORM GSTR-2B (Section 16(2)(aa))', style: 'header' },
        {
          table: {
            body: [
              ['GSTIN', '22AAIFT4081E1ZE'],
              ['Financial Year:', null], // The real GST portal bug!
              ['Eligible ITC (Net)', '13,81,510.48']
            ]
          }
        }
      ]
    };
    return window.pdfMake.createPdf(docDef).download('GSTR2B_22AAIFT4081E1ZE_042025.pdf');
  }
};

// Attach click handler simulating Angular event binding
document.getElementById('btnGstr2bPdf').addEventListener('click', function() {
  compEl.__componentInstance.downloadPdf();
});

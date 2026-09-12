import { $ } from './ui.js';

$('#labelsLinkTemplate').addEventListener('input', e => {
  localStorage.setItem('labelsLinkTemplate', e.target.value);
});

$('#generateLabelsBtn').addEventListener('click', async () => {
  const button = $('#generateLabelsBtn');
  const status = $('#labelsStatus');
  const linkTemplate = $('#labelsLinkTemplate').value.trim();
  if (!linkTemplate) {
    status.textContent = 'Enter a link URL first.';
    status.className = 'text-danger small ms-2';
    return;
  }
  button.disabled = true;
  status.textContent = 'Generating...';
  status.className = 'text-muted small ms-2';
  try {
    const params = new URLSearchParams({
      link: linkTemplate,
      includeOutOfStock: $('#includeOutOfStock').checked ? '1' : '0',
      includeLocation: $('#includeLocation').checked ? '1' : '0'
    });
    const response = await fetch('/api/admin/labels-xlsx?' + params.toString());
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not generate labels');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'product-labels.xlsx';
    anchor.click();
    URL.revokeObjectURL(url);
    status.textContent = 'Downloaded.';
    status.className = 'text-success small ms-2';
  } catch (error) {
    status.textContent = error.message;
    status.className = 'text-danger small ms-2';
  } finally {
    button.disabled = false;
  }
});
const savedLabelsLinkTemplate = localStorage.getItem('labelsLinkTemplate');
if (savedLabelsLinkTemplate !== null) $('#labelsLinkTemplate').value = savedLabelsLinkTemplate;

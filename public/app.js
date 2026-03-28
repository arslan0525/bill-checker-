// ── DOM Elements ─────────────────────────────────────────────
const billForm       = document.getElementById('billForm');
const radioTypes     = document.getElementsByName('searchType');
const searchInput    = document.getElementById('searchValue');
const searchLabel    = document.getElementById('searchLabel');
const errorText      = document.getElementById('errorText');
const checkBtn       = document.getElementById('checkBtn');

const loadingSection = document.getElementById('loadingSection');
const errorSection   = document.getElementById('errorSection');
const resultSection  = document.getElementById('resultSection');
const errorMessage   = document.getElementById('errorMessage');
const pdfContainer   = document.getElementById('pdfContainer');
const billImage      = document.createElement('img');
billImage.id = 'billImage';
billImage.className = 'img-responsive';

const downloadBtn    = document.getElementById('downloadBtn');
const newSearchBtn   = document.getElementById('newSearchBtn');
const retryBtn       = document.getElementById('retryBtn');
const historyList    = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

let currentBase64 = null;
let searchHistory = [];

// ── Event Listeners ──────────────────────────────────────────

// Update UI based on radio selection
radioTypes.forEach(radio => {
  radio.addEventListener('change', (e) => {
    const type = e.target.value;
    if (type === 'refno') {
      searchLabel.textContent = 'Reference Number (14 Digits)';
      searchInput.placeholder = 'e.g. 15151121345600';
      searchInput.maxLength = 14;
    } else {
      searchLabel.textContent = 'Customer ID (10 Digits)';
      searchInput.placeholder = 'e.g. 2134560098';
      searchInput.maxLength = 10;
    }
    searchInput.value = '';
    clearInputError();
  });
});

// Clear errors on typing
searchInput.addEventListener('input', () => {
  clearInputError();
  // Filter non-numeric characters
  searchInput.value = searchInput.value.replace(/\D/g, '');
});

// Helper: Hide all state sections
function hideAllSections() {
  loadingSection.style.display = 'none';
  errorSection.style.display = 'none';
  resultSection.style.display = 'none';
}

function showInputError(msg) {
  errorText.textContent = msg;
  errorText.style.display = 'block';
  searchInput.classList.add('is-invalid');
}

function clearInputError() {
  errorText.textContent = '';
  errorText.style.display = 'none';
  searchInput.classList.remove('is-invalid');
}

// ── HISTORY LOGIC ──────────────────────────────────────────
function loadHistory() {
  const saved = localStorage.getItem('mepco_history');
  if (saved) {
    searchHistory = JSON.parse(saved);
    renderHistory();
  }
}

function saveToHistory(type, value) {
  // Remove duplicate if exists
  searchHistory = searchHistory.filter(item => item.value !== value);
  // Add to front
  searchHistory.unshift({ type, value, date: new Date().toLocaleDateString() });
  // Keep last 5
  if (searchHistory.length > 5) searchHistory.pop();
  
  localStorage.setItem('mepco_history', JSON.stringify(searchHistory));
  renderHistory();
}

function renderHistory() {
  if (searchHistory.length === 0) {
    historyList.innerHTML = '<p class="text-muted small">No recent searches.</p>';
    clearHistoryBtn.style.display = 'none';
    return;
  }

  clearHistoryBtn.style.display = 'block';
  historyList.innerHTML = '';
  
  searchHistory.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const label = item.type === 'refno' ? 'Ref' : 'ID';
    
    div.innerHTML = `
      <div class="history-info" onclick="useHistoryItem('${item.value}', '${item.type}')">
        <strong>${item.value}</strong>
        <span>${label} • ${item.date}</span>
      </div>
      <button class="history-delete" onclick="deleteHistoryItem('${item.value}')">&times;</button>
    `;
    historyList.appendChild(div);
  });
}

function useHistoryItem(value, type) {
  const radio = document.querySelector(`input[name="searchType"][value="${type}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
  searchInput.value = value;
  billForm.dispatchEvent(new Event('submit'));
}

function deleteHistoryItem(value) {
  searchHistory = searchHistory.filter(item => item.value !== value);
  localStorage.setItem('mepco_history', JSON.stringify(searchHistory));
  renderHistory();
}

window.useHistoryItem = useHistoryItem;
window.deleteHistoryItem = deleteHistoryItem;

loadHistory();

// ── Form Submit ──────────────────────────────────────────────
billForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const searchType = document.querySelector('input[name="searchType"]:checked').value;
  const searchValue = searchInput.value.trim();

  // Validate length
  if (searchType === 'refno' && searchValue.length !== 14) {
    return showInputError('Reference Number must be exactly 14 digits.');
  }
  if (searchType === 'appno' && searchValue.length !== 10) {
    return showInputError('Customer ID must be exactly 10 digits.');
  }

  // Valid, start fetch
  hideAllSections();
  clearInputError();
  checkBtn.disabled = true;
  loadingSection.style.display = 'block';

  try {
    const response = await fetch('/get-bill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchType, searchValue })
    });

    const data = await response.json();

    hideAllSections();

    if (!response.ok) {
      errorMessage.textContent = data.error || 'Failed to connect to official MEPCO portal.';
      errorSection.style.display = 'block';
      return;
    }

    if (data.success && data.image) {
      currentBase64 = data.image;
      billImage.src = `data:image/png;base64,${data.image}`;
      
      pdfContainer.innerHTML = '';
      pdfContainer.appendChild(billImage);
      
      saveToHistory(searchType, searchValue);
      
      resultSection.style.display = 'block';
      // Scroll to result naturally
      resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      throw new Error('Invalid response data structure.');
    }

  } catch (error) {
    console.error('Fetch error:', error);
    hideAllSections();
    errorMessage.textContent = 'A network error occurred. Please try again later.';
    errorSection.style.display = 'block';
  } finally {
    checkBtn.disabled = false;
  }
});

// ── Other Buttons ────────────────────────────────────────────

retryBtn.addEventListener('click', () => {
  checkBtn.click();
});

newSearchBtn.addEventListener('click', () => {
  hideAllSections();
  searchInput.value = '';
  searchInput.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

clearHistoryBtn.addEventListener('click', () => {
  searchHistory = [];
  localStorage.removeItem('mepco_history');
  renderHistory();
});

downloadBtn.addEventListener('click', () => {
  if (!currentBase64) return;
  const link = document.createElement('a');
  link.href = `data:image/png;base64,${currentBase64}`;
  const displayVal = searchInput.value || 'download';
  link.download = `MEPCO_Bill_${displayVal}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

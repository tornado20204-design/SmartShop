const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000' : window.location.origin;

// --- FETCH INTERCEPTOR FOR JWT ---
const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
  const token = localStorage.getItem('authToken');
  const absoluteUrl = new URL(url, window.location.href).href;
  if (token && absoluteUrl.startsWith(apiBase)) {
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await originalFetch(url, options);
  if (response.status === 401 || response.status === 403) {
    const urlStr = url.toString();
    if (urlStr.includes('/api/login') || urlStr.includes('/api/register')) {
      return response;
    }
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    window.location.href = 'account.html';
  }
  return response;
};
// ----------------------------------
// 1. Toast Notification Helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = '⚡';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  if (type === 'warning') icon = '⚠️';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slide-out 0.3s ease forwards';
    const safetyTimeout = setTimeout(() => {
      toast.remove();
    }, 400);
    toast.addEventListener('animationend', () => {
      clearTimeout(safetyTimeout);
      toast.remove();
    });
  }, 3000);
}

// 2. User Authentication UI Sync
function updateAvatarUI(avatarEl, user) {
  if (!avatarEl || !user) return;
  if (user.avatar) {
    avatarEl.style.backgroundImage = `url(${user.avatar})`;
    avatarEl.style.backgroundSize = 'cover';
    avatarEl.style.backgroundPosition = 'center';
    avatarEl.textContent = '';
  } else {
    const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    avatarEl.textContent = initials;
    avatarEl.style.backgroundImage = '';
  }
}

function updateUserUI(user) {
  const userInfo = document.getElementById('user-info');
  const userLink = document.getElementById('user-link');

  if (userInfo) {
    userInfo.textContent = user ? `Salom, ${user.name}` : 'Akaunt';
  }

  if (userLink) {
    userLink.textContent = user ? 'Profil' : 'Akaunt';
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Faylni o'qishda xatolik yuz berdi"));
    reader.readAsDataURL(file);
  });
}

// Escape HTML to avoid XSS when inserting user/product-provided strings into innerHTML
function escapeHtml(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function isValidPhone(phone) {
  const digits = normalizePhone(phone);
  return /^998\d{9}$/.test(digits);
}

function isValidPassport(passport) {
  return typeof passport === 'string' && /^[A-Z]{2}\d{7}$/.test(passport.trim().toUpperCase());
}

function isValidBirthDate(dateValue) {
  if (!dateValue) return false;
  const birthDate = new Date(dateValue);
  if (Number.isNaN(birthDate.getTime())) return false;
  const today = new Date();
  const age = today.getFullYear() - birthDate.getFullYear() - (today < new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate()) ? 1 : 0);
  return age >= 18 && age <= 100;
}

function loadCurrentUser() {
  const storedUser = localStorage.getItem('currentUser');
  if (!storedUser) {
    updateUserUI(null);
    return null;
  }

  const user = JSON.parse(storedUser);
  updateUserUI(user);
  return user;
}

// 3. Persistent Cart Logic
function getCart() {
  const cartJson = localStorage.getItem('cart');
  return cartJson ? JSON.parse(cartJson) : [];
}

function saveCart(cart) {
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartCountHeader();
}

function updateCartCountHeader() {
  const cart = getCart();
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartButtons = document.querySelectorAll('.cart-button, #cart-nav-btn');
  cartButtons.forEach((btn) => {
    btn.innerHTML = `<span>🛒</span> Savat (${totalQty})`;
  });
}

function addToCart(product) {
  if (product.stock <= 0) {
    showToast("Ushbu mahsulot omborda qolmagan!", "error");
    return;
  }

  const cart = getCart();
  const existing = cart.find(item => item.id === product.id);

  if (existing) {
    if (existing.quantity >= product.stock) {
      showToast(`Omborda faqat ${product.stock} ta mahsulot bor!`, "warning");
      return;
    }
    existing.quantity += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      cost: product.cost || Math.round(product.price * 0.65),
      image: product.image || 'smartphone.png',
      category: product.category || 'Elektronika',
      quantity: 1
    });
  }

  saveCart(cart);
  showToast(`"${product.name}" savatga qo'shildi!`);
}

// 4. Products Search, Filter, Sort & Modals
let allProducts = [];

async function fetchProducts() {
  const container = document.getElementById('products-list');
  const hotContainer = document.getElementById('hot-products-list');

  // Show skeleton loading cards
  if (container) {
    const skeletonHTML = Array.from({length: 8}).map(() => `
      <div class="skeleton-card">
        <div class="skeleton skeleton-img"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
        <div class="skeleton skeleton-line price"></div>
        <div class="skeleton skeleton-btn"></div>
      </div>
    `).join('');
    container.innerHTML = skeletonHTML;
  }

  try {
    const response = await fetch(`${apiBase}/api/products`);
    allProducts = await response.json();
    
    // If on products page, set up filtering
    if (container) {
      // 4a. Check category URL param
      const urlParams = new URLSearchParams(window.location.search);
      const urlCategory = urlParams.get('category');
      const catFilter = document.getElementById('category-filter');
      if (urlCategory && catFilter) {
        catFilter.value = urlCategory;
      }

      setupFilters();
      applyFilters();
    }

    // If on home page, populate hot deals
    if (hotContainer) {
      const discountProducts = allProducts.filter(p => p.originalPrice && p.originalPrice > p.price).slice(0, 4);
      renderHotProducts(discountProducts);
    }
  } catch (error) {
    if (container) container.innerHTML = '<p style="text-align: center; color: var(--text-muted); grid-column: 1/-1;">Mahsulotlarni yuklashda xatolik yuz berdi.</p>';
  }
}


function renderProducts(products) {
  const container = document.getElementById('products-list');
  if (!container) return;

  if (products.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--text-muted); grid-column: 1/-1; padding: 40px 0;">Mos mahsulotlar topilmadi.</p>';
    return;
  }

  // Get current wishlist from localStorage
  const currentUser = loadCurrentUser();
  const wishlistIds = currentUser ? (currentUser.wishlist || []) : [];

  container.innerHTML = products
    .map((product) => {
      const discountPercent = product.originalPrice ? Math.round((1 - product.price / product.originalPrice) * 100) : 0;
      const discountBadgeHtml = discountPercent > 0 ? `<span class="discount-badge">-${discountPercent}%</span>` : '';
      
      const priceHtml = product.originalPrice ? `
        <div class="price-container">
          <span class="product-price">$${product.price}</span>
          <span class="original-price">$${product.originalPrice}</span>
        </div>
      ` : `<span class="product-price">$${product.price}</span>`;

      const stockHtml = product.stock <= 3 ? 
        `<div class="stock-indicator"><span class="stock-low">Faqat ${product.stock} ta qoldi!</span></div>` : 
        `<div class="stock-indicator"><span class="stock-ok">Sotuvda bor (${product.stock} ta)</span></div>`;

      const isWishlisted = wishlistIds.includes(product.id);
      const wishlistBtn = `<button class="wishlist-btn" data-id="${product.id}" title="Sevimlilarga qo'shish" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.5);border:none;border-radius:50%;width:34px;height:34px;cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;transition:all .2s;z-index:2;" type="button">${isWishlisted ? '❤️' : '🤍'}</button>`;

      return `
        <article class="product-card" data-id="${product.id}">
          <div class="product-image-container" style="position:relative;">
            <img src="${escapeHtml(product.image || 'smartphone.png')}" alt="${escapeHtml(product.name)}" onerror="this.src='smartphone.png'" />
            <span class="product-badge">${escapeHtml(product.category || 'Elektronika')}</span>
            ${discountBadgeHtml}
            <span class="product-rating">★ ${escapeHtml(product.rating || '4.5')}</span>
            ${wishlistBtn}
          </div>
          <div class="product-info">
            <h3>${escapeHtml(product.name)}</h3>
            <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 4px; margin-bottom: 8px;">
              <span>👤 Sotuvchi:</span>
              <strong style="color: var(--primary);">${escapeHtml(product.sellerName || 'SmartShop')}</strong>
            </div>
            <p class="desc">${escapeHtml(product.description || 'Tavsif berilmagan')}</p>
            ${stockHtml}
            <div class="product-footer">
              ${priceHtml}
              <button class="add-to-cart-btn add-to-cart" data-id="${product.id}" type="button" ${product.stock <= 0 ? 'disabled style="background: var(--border-color); cursor: not-allowed;"' : ''}>
                ${product.stock <= 0 ? 'Tugagan' : '🛒 Qo\'shish'}
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  // Bind clicks
  document.querySelectorAll('#products-list .product-card').forEach((card) => {
    card.addEventListener('click', async (event) => {
      // Wishlist toggle
      if (event.target.closest('.wishlist-btn')) {
        event.stopPropagation();
        const btn = event.target.closest('.wishlist-btn');
        const pId = Number(btn.getAttribute('data-id'));
        const user = loadCurrentUser();
        if (!user) { showToast('Sevimlilar uchun tizimga kiring!', 'error'); return; }
        const inList = (user.wishlist || []).includes(pId);
        try {
          const method = inList ? 'DELETE' : 'POST';
          const fetchUrl = inList ? `${apiBase}/api/wishlist?productId=${pId}` : `${apiBase}/api/wishlist`;
          const opts = { method };
          if (!inList) { opts.headers = {'Content-Type':'application/json'}; opts.body = JSON.stringify({productId: pId}); }
          const res = await fetch(fetchUrl, opts);
          const data = await res.json();
          if (res.ok) {
            user.wishlist = data.wishlist;
            localStorage.setItem('currentUser', JSON.stringify(user));
            btn.textContent = data.wishlist.includes(pId) ? '❤️' : '🤍';
            showToast(inList ? 'Sevimlilardan olib tashlandi' : 'Sevimlilarga qo\'shildi!');
          }
        } catch(e) { showToast('Xatolik', 'error'); }
        return;
      }

      if (event.target.classList.contains('add-to-cart-btn')) {
        event.stopPropagation();
        const pId = Number(card.getAttribute('data-id'));
        const product = allProducts.find(p => p.id === pId);
        if (product) addToCart(product);
        return;
      }

      const pId = Number(card.getAttribute('data-id'));
      const product = allProducts.find(p => p.id === pId);
      if (product) openProductModal(product);
    });
  });
}

function renderHotProducts(products) {
  const container = document.getElementById('hot-products-list');
  if (!container) return;

  if (products.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--text-muted); grid-column: 1/-1;">Chegirmali mahsulotlar hozircha yo\'q.</p>';
    return;
  }

  container.innerHTML = products
    .map((product) => {
      const discountPercent = Math.round((1 - product.price / product.originalPrice) * 100);
      return `
        <article class="product-card" data-id="${product.id}">
          <div class="product-image-container">
            <img src="${escapeHtml(product.image || 'smartphone.png')}" alt="${escapeHtml(product.name)}" onerror="this.src='smartphone.png'" />
            <span class="product-badge">${escapeHtml(product.category || 'Elektronika')}</span>
            <span class="discount-badge">-${discountPercent}%</span>
            <span class="product-rating">★ ${escapeHtml(product.rating || '4.5')}</span>
          </div>
          <div class="product-info">
            <h3>${escapeHtml(product.name)}</h3>
            <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 4px; margin-bottom: 8px;">
              <span>👤 Sotuvchi:</span>
              <strong style="color: var(--primary);">${escapeHtml(product.sellerName || 'SmartShop')}</strong>
            </div>
            <p class="desc">${escapeHtml(product.description || 'Tavsif berilmagan')}</p>
            <div class="stock-indicator"><span class="${product.stock <= 3 ? 'stock-low' : 'stock-ok'}">${product.stock <= 3 ? 'Kamyob' : 'Omborda bor'} (${escapeHtml(product.stock) } ta)</span></div>
            <div class="product-footer">
              <div class="price-container">
                <span class="product-price">$${escapeHtml(product.price)}</span>
                <span class="original-price">$${escapeHtml(product.originalPrice)}</span>
              </div>
              <button class="add-to-cart-btn add-to-cart" data-id="${product.id}" type="button">🛒 Qo'shish</button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  document.querySelectorAll('#hot-products-list .product-card').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.classList.contains('add-to-cart-btn')) {
        event.stopPropagation();
        const pId = Number(card.getAttribute('data-id'));
        const product = allProducts.find(p => p.id === pId);
        if (product) addToCart(product);
        return;
      }

      const pId = Number(card.getAttribute('data-id'));
      const product = allProducts.find(p => p.id === pId);
      if (product) openProductModal(product);
    });
  });
}

function applyFilters() {
  const searchInput = document.getElementById('search-input');
  const categoryFilter = document.getElementById('category-filter');
  const sortSelect = document.getElementById('sort-select');
  const discountOnly = document.getElementById('discount-only-checkbox');
  const priceFilter = document.getElementById('price-filter');
  const priceVal = document.getElementById('price-val');

  if (!searchInput || !categoryFilter) return;

  const query = (searchInput.value || '').toLowerCase().trim();
  const category = categoryFilter.value;
  const sortBy = sortSelect ? sortSelect.value : 'popular';
  const maxPrice = priceFilter ? Number(priceFilter.value) : 1000;
  const showDiscountsOnly = discountOnly ? discountOnly.checked : false;

  if (priceVal) priceVal.textContent = maxPrice;

  let filtered = allProducts.filter((product) => {
    const pname = (product.name || '').toString().toLowerCase();
    const pdesc = (product.description || '').toString().toLowerCase();
    const matchesSearch = pname.includes(query) || pdesc.includes(query);
    const matchesCategory = category === 'all' || product.category === category;
    const matchesPrice = (typeof product.price === 'number' ? product.price : Number(product.price || 0)) <= maxPrice;
    const matchesDiscount = !showDiscountsOnly || (product.originalPrice && product.originalPrice > product.price);

    return matchesSearch && matchesCategory && matchesPrice && matchesDiscount;
  });

  // Sort logic
  if (sortBy === 'price-asc') {
    filtered.sort((a, b) => a.price - b.price);
  } else if (sortBy === 'price-desc') {
    filtered.sort((a, b) => b.price - a.price);
  } else if (sortBy === 'rating-desc') {
    filtered.sort((a, b) => b.rating - a.rating);
  } else if (sortBy === 'popular') {
    filtered.sort((a, b) => (b.reviewsCount || 0) - (a.reviewsCount || 0));
  }

  renderProducts(filtered);
}

function setupFilters() {
  const searchInput = document.getElementById('search-input');
  const categoryFilter = document.getElementById('category-filter');
  const sortSelect = document.getElementById('sort-select');
  const discountOnly = document.getElementById('discount-only-checkbox');
  const priceFilter = document.getElementById('price-filter');

  if (!searchInput) return;

  if (searchInput) searchInput.addEventListener('input', applyFilters);
  if (categoryFilter) categoryFilter.addEventListener('change', applyFilters);
  if (sortSelect) sortSelect.addEventListener('change', applyFilters);
  if (discountOnly) discountOnly.addEventListener('change', applyFilters);
  if (priceFilter) priceFilter.addEventListener('input', applyFilters);
}

// 5. Product Details Modal
const modal = document.getElementById('product-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');

async function openProductModal(product) {
  if (!modal) return;
  const modalContent = document.getElementById('modal-body-content');
  if (!modalContent) return;

  const originalPriceHtml = product.originalPrice ? `<span class="original-price" style="font-size: 1.1rem; margin-left: 8px;">$${escapeHtml(product.originalPrice)}</span>` : '';

  const reviews = product.reviews || [];
  const reviewsHtml = reviews.length === 0
    ? `<p style="color:var(--text-muted);font-size:0.9rem;">Hali sharh yo'q. Birinchi bo'lib sharh qoldiring!</p>`
    : reviews.map(r => `
      <div style="padding:10px;background:rgba(255,255,255,0.04);border-radius:10px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-weight:700;font-size:0.9rem;">${escapeHtml(r.userName)}</span>
          <span style="color:#fbbf24;">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
        </div>
        <p style="font-size:0.85rem;color:var(--text-muted);margin:0;">${escapeHtml(r.comment)}</p>
        <span style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(r.date)}</span>
      </div>`).join('');

  const currentUser = loadCurrentUser();
  const alreadyReviewed = currentUser && (product.reviews || []).some(r => r.userId === currentUser.id);

  let hasPurchased = false;
  if (currentUser && !alreadyReviewed) {
    try {
      const ordRes = await fetch(`${apiBase}/api/orders`);
      if (ordRes.ok) {
        const orders = await ordRes.json();
        hasPurchased = orders.some(o =>
          o.userId === currentUser.id &&
          Array.isArray(o.items) &&
          o.items.some(i => i.id === product.id)
        );
      }
    } catch(_) {}
  }

  let reviewFormHtml;
  if (!currentUser) {
    reviewFormHtml = `<p style="color:var(--text-muted);font-size:0.85rem;margin-top:12px;">Sharh qoldirish uchun <a href="account.html" style="color:var(--primary);">tizimga kiring</a>.</p>`;
  } else if (alreadyReviewed) {
    reviewFormHtml = `<p style="color:var(--success);font-size:0.85rem;margin-top:12px;display:flex;align-items:center;gap:6px;"><span>✅</span> Siz bu mahsulotga allaqachon sharh qoldirgansiñiz.</p>`;
  } else if (!hasPurchased) {
    reviewFormHtml = `<div style="margin-top:12px;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px dashed var(--border-color);border-radius:10px;font-size:0.85rem;color:var(--text-muted);">💡 Faqat ushbu mahsulotni <strong style="color:white;">xarid qilgan</strong> mijozlar sharh qoldira oladi.</div>`;
  } else {
    reviewFormHtml = `
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border-color);">
      <h4 style="color:white;margin-bottom:10px;font-size:1rem;">✍️ Sharh qoldirish</h4>
      <form id="quick-review-form" style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;gap:4px;" id="star-selector">
          ${[1,2,3,4,5].map(n => `<button type="button" data-star="${n}" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:#fbbf24;transition:.2s;">★</button>`).join('')}
        </div>
        <input type="hidden" id="review-rating" value="5" />
        <textarea id="review-comment" placeholder="Mahsulot haqida fikringiz..." rows="3" style="resize:vertical;"></textarea>
        <button type="submit" style="padding:10px;background:var(--primary);color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;">Sharh yuborish</button>
      </form>
      <p id="review-message" class="message"></p>
    </div>`;
  }

  modalContent.innerHTML = `
    <div class="modal-img-container">
      <img src="${escapeHtml(product.image || 'smartphone.png')}" alt="${escapeHtml(product.name)}" onerror="this.src='smartphone.png'" />
    </div>
    <div class="modal-details">
      <span class="modal-category">${escapeHtml(product.category || 'Elektronika')}</span>
      <h3 class="modal-title">${escapeHtml(product.name)}</h3>
      <span class="modal-rating">★ ${escapeHtml(product.rating || '4.5')} (${reviews.length} ta sharh)</span>
      <div style="margin: 8px 0 16px 0; font-size: 0.9rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
        <span>👤 Sotuvchi:</span>
        <strong style="color: var(--primary); font-weight: 700;">${escapeHtml(product.sellerName || 'SmartShop')}</strong>
      </div>
      <p class="modal-desc">${escapeHtml(product.description || 'Tavsif berilmagan')}</p>
      <div style="font-size: 0.9rem; margin-bottom: 20px; font-weight: 600;">
        Ombor holati: <span class="${product.stock <= 3 ? 'stock-low' : 'stock-ok'}">${product.stock <= 0 ? 'Sotuvda qolmagan' : 'Mavjud: ' + escapeHtml(product.stock) + ' ta'}</span>
      </div>
      <div style="font-size: 0.88rem; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: rgba(255,255,255,0.04); border-radius: 10px; border: 1px solid var(--border-color);">
        <span>${product.returnDays && product.returnDays > 0 ? '↩️' : '🚫'}</span>
        <span style="color: var(--text-muted); font-weight: 500;">Qaytarish muddati:</span>
        <strong style="color: ${product.returnDays && product.returnDays > 0 ? 'var(--success)' : 'var(--danger)'}">${product.returnDays && product.returnDays > 0 ? escapeHtml(product.returnDays) + ' kun' : "Qaytarish yo'q"}</strong>
      </div>
      <div class="modal-price-row">
        <div class="price-container">
          <span class="modal-price">$${escapeHtml(product.price)}</span>
          ${originalPriceHtml}
        </div>
        <button class="modal-add-btn" id="modal-add-to-cart-btn" ${product.stock <= 0 ? 'disabled style="background: var(--border-color); cursor: not-allowed;"' : ''}>
          ${product.stock <= 0 ? 'Sotib olib bo\'lmaydi' : 'Savatga qo\'shish'}
        </button>
      </div>

      <!-- Reviews Section -->
      <div style="margin-top:24px;">
        <h4 style="color:white;margin-bottom:12px;font-size:1rem;">Sharhlar</h4>
        <div id="reviews-list" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;">${reviewsHtml}</div>
        ${reviewFormHtml}
      </div>
    </div>
  `;

  document.getElementById('modal-add-to-cart-btn').addEventListener('click', () => {
    addToCart(product);
  });

  // Star rating interaction
  const starBtns = document.querySelectorAll('#star-selector button');
  const ratingInput = document.getElementById('review-rating');
  if (starBtns.length) {
    starBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const val = Number(btn.getAttribute('data-star'));
        if (ratingInput) ratingInput.value = val;
        starBtns.forEach((b, i) => { b.style.opacity = i < val ? '1' : '0.3'; });
      });
    });
  }

  // Review form submission
  const reviewForm = document.getElementById('quick-review-form');
  if (reviewForm) {
    reviewForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rating = Number(document.getElementById('review-rating').value);
      const comment = document.getElementById('review-comment').value;
      const msgEl = document.getElementById('review-message');
      try {
        const res = await fetch(`${apiBase}/api/reviews`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: product.id, rating, comment })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('Sharh muvaffaqiyatli qoldirildi!');
          product.reviews = product.reviews || [];
          product.reviews.push(data.review);
          product.rating = data.newRating;
          openProductModal(product); // Re-render to show new review
        } else {
          if (msgEl) { msgEl.textContent = data.message; msgEl.className = 'message error'; }
        }
      } catch { showToast('Xatolik yuz berdi', 'error'); }
    });
  }

  modal.classList.add('active');
}

function closeProductModal() {
  if (modal) modal.classList.remove('active');
}

if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeProductModal);
if (modal) {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeProductModal();
  });
}

// 6. Cart Page Rendering & Delivery Options Setup
let appliedPromoDiscount = 0;

function loadCartPage() {
  const cartList = document.getElementById('cart-list');
  const checkoutSection = document.getElementById('checkout-section');
  
  if (!cartList) return;

  const cart = getCart();

  if (cart.length === 0) {
    cartList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🛒</div>
        <p>Savatingiz hozircha bo'sh.</p>
        <a href="products.html" class="primary-btn" style="margin-top: 16px;">Mahsulotlarni ko'rish</a>
      </div>
    `;
    if (checkoutSection) checkoutSection.style.display = 'none';
    return;
  }

  if (checkoutSection) checkoutSection.style.display = 'block';

  // Render items list
  cartList.innerHTML = cart
    .map(
      (item) => `
        <li class="cart-item">
          <div class="cart-item-img">
            <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" onerror="this.src='smartphone.png'" />
          </div>
          <div class="cart-item-info">
            <h4>${escapeHtml(item.name)}</h4>
            <p>${escapeHtml(item.category)}</p>
            <div class="cart-item-price">$${escapeHtml(item.price)}</div>
          </div>
          <div class="cart-item-controls">
            <button class="quantity-btn dec-qty" data-id="${item.id}">-</button>
            <span class="cart-qty">${escapeHtml(item.quantity)}</span>
            <button class="quantity-btn inc-qty" data-id="${item.id}">+</button>
            <button class="remove-btn remove-item" data-id="${item.id}">O'chirish</button>
          </div>
        </li>
      `
    )
    .join('');

  // Bind delivery option tabs
  setupDeliveryTabs();

  // Bind Promo Code Button
  const btnApplyPromo = document.getElementById('btn-apply-promo');
  if (btnApplyPromo) {
    btnApplyPromo.onclick = () => {
      const codeInput = document.getElementById('checkout-promo-code');
      const promoMsg = document.getElementById('promo-message');
      const rowPromo = document.getElementById('row-promo-discount');
      const discountEl = document.getElementById('checkout-discount');

      if (!codeInput || !promoMsg) return;

      const code = codeInput.value.toUpperCase().trim();
      const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

      if (code === 'PROMO20') {
        appliedPromoDiscount = Math.round(subtotal * 0.2 * 100) / 100;
        promoMsg.textContent = "20% promo-kod faollashdi!";
        promoMsg.style.color = "var(--success)";
        promoMsg.style.display = "block";
        if (rowPromo) rowPromo.style.display = "flex";
        if (discountEl) discountEl.textContent = `-$${appliedPromoDiscount.toFixed(2)}`;
        showToast("Promo-kod qo'llanildi: -20% chegirma!");
      } else {
        appliedPromoDiscount = 0;
        promoMsg.textContent = "Noto'g'ri promo-kod!";
        promoMsg.style.color = "var(--danger)";
        promoMsg.style.display = "block";
        if (rowPromo) rowPromo.style.display = "none";
        showToast("Noto'g'ri promo-kod kiritildi.", "error");
      }
      recalculateCartTotal();
    };
  }

  // Bind Payment Method change listener
  const payMethodSelect = document.getElementById('checkout-payment-method');
  if (payMethodSelect) {
    payMethodSelect.onchange = () => {
      recalculateCartTotal();
    };
  }

  // Calculate and display prices
  recalculateCartTotal();

  // Quantity control listeners
  cartList.querySelectorAll('.inc-qty').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.getAttribute('data-id'));
      const activeCart = getCart();
      const item = activeCart.find(i => i.id === id);
      
      // Look up stock limit
      const product = allProducts.find(p => p.id === id);
      const stockLimit = product ? product.stock : 99;

      if (item) {
        if (item.quantity >= stockLimit) {
          showToast(`Ushbu mahsulot qoldig'i faqat ${stockLimit} ta!`, "warning");
          return;
        }
        item.quantity += 1;
        saveCart(activeCart);
        loadCartPage();
      }
    });
  });

  cartList.querySelectorAll('.dec-qty').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.getAttribute('data-id'));
      const activeCart = getCart();
      const item = activeCart.find(i => i.id === id);
      if (item) {
        item.quantity -= 1;
        if (item.quantity <= 0) {
          const filtered = activeCart.filter(i => i.id !== id);
          saveCart(filtered);
        } else {
          saveCart(activeCart);
        }
        loadCartPage();
      }
    });
  });

  cartList.querySelectorAll('.remove-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.getAttribute('data-id'));
      const activeCart = getCart();
      const filtered = activeCart.filter(i => i.id !== id);
      saveCart(filtered);
      loadCartPage();
      showToast("Mahsulot savatdan olib tashlandi.", "warning");
    });
  });
}

let checkoutMap = null;
let checkoutMarker = null;
let initialGeoTriggered = false;

function setupDeliveryTabs() {
  const btnPickup = document.getElementById('btn-delivery-pickup');
  const btnCourier = document.getElementById('btn-delivery-courier');
  const groupPickup = document.getElementById('group-pickup');
  const groupCourier = document.getElementById('group-courier');
  const deliveryMethod = document.getElementById('checkout-delivery-method');
  const shippingLabel = document.getElementById('checkout-shipping');
  const inputAddress = document.getElementById('checkout-address');
  const btnGetLocation = document.getElementById('btn-get-location');
  const locationStatus = document.getElementById('location-status');

  if (!btnPickup) return;

  // Setup geocoding function on marker/map action
  const onMarkerMove = async (lat, lon) => {
    if (locationStatus) {
      locationStatus.style.display = 'block';
      locationStatus.textContent = "Kutilmoqda: Tanlangan nuqta manzili aniqlanmoqda...";
      locationStatus.style.color = "var(--text-muted)";
    }
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=uz,ru,en`);
      if (!res.ok) throw new Error("Tarmoq xatoligi");
      const data = await res.json();
      if (data && data.display_name) {
        if (inputAddress) inputAddress.value = data.display_name;
        if (locationStatus) {
          locationStatus.textContent = "Nuqta belgilandi va manzil to'ldirildi!";
          locationStatus.style.color = "var(--success)";
        }
      }
    } catch (err) {
      if (inputAddress) inputAddress.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
      if (locationStatus) {
        locationStatus.textContent = `Koordinatalar olingan: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        locationStatus.style.color = "var(--warning)";
      }
    }
  };

  // GPS Geolocation trigger
  const triggerAutoGeolocation = () => {
    if (!navigator.geolocation) {
      showToast("Sizning brauzeringiz geolokatsiyani qo'llab-quvvatlamaydi.", "error");
      return;
    }

    if (btnGetLocation) {
      btnGetLocation.disabled = true;
      btnGetLocation.innerHTML = `⏳ Joylashuv aniqlanmoqda...`;
    }
    if (locationStatus) {
      locationStatus.style.display = 'block';
      locationStatus.textContent = "Kutilmoqda: GPS koordinatalari olinmoqda...";
      locationStatus.style.color = "var(--text-muted)";
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        if (checkoutMap && checkoutMarker) {
          checkoutMap.setView([lat, lon], 16);
          checkoutMarker.setLatLng([lat, lon]);
        }

        if (locationStatus) {
          locationStatus.textContent = `GPS olingan. Manzil aniqlanmoqda...`;
        }

        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=uz,ru,en`);
          if (!res.ok) throw new Error("Tarmoq xatoligi");
          const data = await res.json();
          if (data && data.display_name) {
            if (inputAddress) inputAddress.value = data.display_name;
            if (locationStatus) {
              locationStatus.textContent = "Muvaffaqiyatli aniqlandi!";
              locationStatus.style.color = "var(--success)";
            }
            showToast("Joylashuvingiz muvaffaqiyatli aniqlandi va manzil to'ldirildi!");
          } else {
            if (inputAddress) inputAddress.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
            if (locationStatus) {
              locationStatus.textContent = `Koordinatalar: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
              locationStatus.style.color = "var(--success)";
            }
          }
        } catch (err) {
          if (inputAddress) inputAddress.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
          if (locationStatus) {
            locationStatus.textContent = `Tarmoq xatosi. Koordinatalar: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
            locationStatus.style.color = "var(--warning)";
          }
        } finally {
          if (btnGetLocation) {
            btnGetLocation.disabled = false;
            btnGetLocation.innerHTML = `📍 Aniq joylashuvni aniqlash`;
          }
        }
      },
      (error) => {
        if (btnGetLocation) {
          btnGetLocation.disabled = false;
          btnGetLocation.innerHTML = `📍 Aniq joylashuvni aniqlash`;
        }
        if (locationStatus) {
          locationStatus.style.color = "var(--danger)";
          switch (error.code) {
            case error.PERMISSION_DENIED:
              locationStatus.textContent = "Xato: Joylashuvni aniqlash ruxsati rad etildi.";
              break;
            case error.POSITION_UNAVAILABLE:
              locationStatus.textContent = "Xato: Joylashuv ma'lumotlari mavjud emas.";
              break;
            case error.TIMEOUT:
              locationStatus.textContent = "Xato: Joylashuvni aniqlash vaqti tugadi.";
              break;
            default:
              locationStatus.textContent = "Xato: Joylashuvni aniqlab bo'lmadi.";
          }
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0
      }
    );
  };

  btnPickup.onclick = () => {
    btnPickup.classList.add('active');
    btnCourier.classList.remove('active');
    groupPickup.style.display = 'block';
    groupCourier.style.display = 'none';
    deliveryMethod.value = 'pickup';
    shippingLabel.textContent = 'Bepul (Olib ketish nuqtasi)';
    inputAddress.removeAttribute('required');
    recalculateCartTotal();
  };

  btnCourier.onclick = () => {
    btnCourier.classList.add('active');
    btnPickup.classList.remove('active');
    groupCourier.style.display = 'block';
    groupPickup.style.display = 'none';
    deliveryMethod.value = 'courier';
    shippingLabel.textContent = '$15.00 (Hamkor kuryer)';
    inputAddress.setAttribute('required', 'true');
    recalculateCartTotal();

    // Initialize Leaflet Map if selected
    if (!checkoutMap) {
      const defaultLat = 41.31108;
      const defaultLon = 69.24056;
      
      // Initialize map container
      checkoutMap = L.map('checkout-map').setView([defaultLat, defaultLon], 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(checkoutMap);

      checkoutMarker = L.marker([defaultLat, defaultLon], {
        draggable: true
      }).addTo(checkoutMap);

      // Handle map clicks to place marker manually
      checkoutMap.on('click', (e) => {
        const { lat, lng } = e.latlng;
        checkoutMarker.setLatLng([lat, lng]);
        onMarkerMove(lat, lng);
      });

      // Handle marker dragend
      checkoutMarker.on('dragend', () => {
        const position = checkoutMarker.getLatLng();
        onMarkerMove(position.lat, position.lng);
      });

      if (btnGetLocation) {
        btnGetLocation.onclick = triggerAutoGeolocation;
      }
    } else {
      setTimeout(() => {
        checkoutMap.invalidateSize();
      }, 100);
    }

    // Trigger automatic geolocation on first Courier tab click
    if (!initialGeoTriggered) {
      triggerAutoGeolocation();
      initialGeoTriggered = true;
    }
  };
}

function recalculateCartTotal() {
  const subtotalEl = document.getElementById('checkout-subtotal');
  const totalEl = document.getElementById('checkout-total');
  const deliveryMethod = document.getElementById('checkout-delivery-method');
  const payMethodSelect = document.getElementById('checkout-payment-method');
  const nasiyaBox = document.getElementById('nasiya-calculation-box');
  const nasiyaMonthlyEl = document.getElementById('nasiya-monthly-pay');

  if (!subtotalEl) return;

  const cart = getCart();
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  
  const isCourier = deliveryMethod ? (deliveryMethod.value === 'courier') : false;
  const shippingFee = isCourier ? 15 : 0;
  
  const total = Math.max(0, subtotal - appliedPromoDiscount + shippingFee);

  subtotalEl.textContent = `$${subtotal.toFixed(2)}`;
  totalEl.textContent = `$${total.toFixed(2)}`;

  // Installments details math
  if (payMethodSelect && nasiyaBox && nasiyaMonthlyEl) {
    const method = payMethodSelect.value;
    if (method.startsWith('nasiya-')) {
      const months = Number(method.split('-')[1]);
      const monthly = total / months;
      nasiyaMonthlyEl.textContent = `$${monthly.toFixed(2)} / oyiga`;
      nasiyaBox.style.display = 'block';
    } else {
      nasiyaBox.style.display = 'none';
    }
  }
}

// 7. Order Submission (Cart Checkout)
const checkoutForm = document.getElementById('checkout-form');
if (checkoutForm) {
  checkoutForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const currentUser = loadCurrentUser();
    if (!currentUser) {
      showToast("Buyurtma berish uchun avval tizimga kiring!", "error");
      setTimeout(() => {
        window.location.href = 'account.html';
      }, 1500);
      return;
    }

    const name = document.getElementById('checkout-name').value;
    const phone = document.getElementById('checkout-phone').value;
    const deliveryMethod = document.getElementById('checkout-delivery-method').value;
    const paymentMethod = document.getElementById('checkout-payment-method').value;
    
    let address = "";
    if (deliveryMethod === 'pickup') {
      address = document.getElementById('checkout-pickup-point').value;
    } else {
      address = document.getElementById('checkout-address').value;
    }

    const cart = getCart();
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shippingFee = deliveryMethod === 'courier' ? 15 : 0;
    const total = Math.max(0, subtotal - appliedPromoDiscount + shippingFee);

    const orderData = {
      userId: currentUser.id,
      customerName: name,
      customerPhone: phone,
      customerAddress: address,
      deliveryMethod: deliveryMethod,
      pickupPoint: deliveryMethod === 'pickup' ? address : null,
      shippingFee: shippingFee,
      appliedPromoDiscount: appliedPromoDiscount,
      paymentMethod: paymentMethod,
      items: cart,
      total: total,
      date: new Date().toLocaleString('uz-UZ'),
      status: "Tayyorlanmoqda"
    };

    // Check if electronic payment method selected - show mock payment modal
    if (paymentMethod === 'payme' || paymentMethod === 'click') {
      showPaymentModal(paymentMethod, total, orderData);
    } else {
      await submitOrder(orderData, deliveryMethod);
    }
  });
}

function showPaymentModal(provider, amount, orderData) {
  const existing = document.getElementById('payment-gateway-modal');
  if (existing) existing.remove();

  const isPayme = provider === 'payme';
  const providerName = isPayme ? 'Payme' : 'Click';
  const providerColor = isPayme ? '#00b6f0' : '#00aa3c';
  const providerLogo = isPayme ? '💙' : '💚';

  const modal = document.createElement('div');
  modal.id = 'payment-gateway-modal';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 99999;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    backdrop-filter: blur(10px);
  `;

  modal.innerHTML = `
    <div style="background:#fff; border-radius:20px; padding:0; width:100%; max-width:400px;
        box-shadow: 0 40px 80px rgba(0,0,0,0.8); overflow:hidden; animation: slideUp 0.3s ease;">
      <!-- Provider Header -->
      <div style="background:${providerColor}; padding:24px 28px; text-align:center;">
        <div style="font-size:2.5rem; margin-bottom:8px;">${providerLogo}</div>
        <div style="color:white; font-size:1.4rem; font-weight:800; letter-spacing:-0.5px;">${providerName}</div>
        <div style="color:rgba(255,255,255,0.8); font-size:0.85rem; margin-top:4px;">To'lov tizimi</div>
      </div>
      <!-- Amount -->
      <div style="padding:20px 28px; background:#f8f9fa; text-align:center; border-bottom:1px solid #e5e7eb;">
        <div style="font-size:0.85rem; color:#6b7280; margin-bottom:4px;">To'lov miqdori</div>
        <div style="font-size:2rem; font-weight:900; color:#111;">${(amount * 12500).toLocaleString()} so'm</div>
        <div style="font-size:0.8rem; color:#9ca3af;">≈ $${amount.toFixed(2)} USD</div>
      </div>
      <!-- Secure Payment Notification -->
      <div style="padding:24px 28px; text-align:center;">
        <div style="font-size:3rem; margin-bottom:16px; color:#10b981;">🔒</div>
        <p style="font-size:0.95rem; color:#374151; margin-bottom:20px; line-height:1.5;">
          Xavfsizlik nuqtai nazaridan karta ma'lumotlari bizning serverimizga kelmaydi. To'lovni yakunlash uchun <strong>${providerName}</strong> xavfsiz sahifasiga yo'naltirilasiz.
        </p>
        <div id="payment-modal-error" style="display:none; color:#ef4444; font-size:0.85rem; margin-bottom:12px; padding:8px 12px; background:#fef2f2; border-radius:8px; border:1px solid #fecaca; text-align:left;"></div>
        <button id="confirm-payment-btn" style="
          width:100%; padding:14px; border-radius:12px; border:none;
          background:${providerColor}; color:white; font-size:1.05rem; font-weight:800;
          cursor:pointer; transition: opacity 0.2s; margin-bottom:10px;
        ">Provayder saytida to'lash</button>
        <button id="cancel-payment-btn" style="
          width:100%; padding:10px; border-radius:10px; border:1px solid #e5e7eb;
          background:transparent; color:#6b7280; font-size:0.9rem; cursor:pointer;
        ">Bekor qilish</button>
        <div style="text-align:center; margin-top:14px; font-size:0.75rem; color:#9ca3af;">
          🔒 256-bit SSL shifrlash • Click/Payme integratsiyasi
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('cancel-payment-btn').onclick = () => modal.remove();

  document.getElementById('confirm-payment-btn').onclick = async () => {
    const errEl = document.getElementById('payment-modal-error');
    errEl.style.display = 'none';

    const btn = document.getElementById('confirm-payment-btn');
    btn.textContent = '⏳ Provayderga bog\'lanmoqda...';
    btn.disabled = true;

    try {
      const initResponse = await fetch(`${apiBase}/api/payment/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({
          amount: amount,
          provider: provider,
          description: `SmartShop buyurtma to'lovi`,
          orderId: orderData.id || Date.now()
        })
      });

      const initResult = await initResponse.json();
      if (!initResponse.ok || !initResult.success) {
        throw new Error(initResult.message || "To'lovni boshlashda xatolik yuz berdi");
      }

      btn.textContent = '✅ Redirect qilinmoqda...';
      btn.style.background = '#10b981';

      // To'lov provayderi sahifasiga redirect (yangi oyna)
      window.open(initResult.payUrl, '_blank');

      await new Promise(r => setTimeout(r, 700));
      modal.remove();

      // Buyurtmani serverga yuborish
      orderData.transactionId = initResult.transactionId;
      await submitOrder(orderData, orderData.deliveryMethod);
    } catch (err) {
      btn.textContent = "To'lovni amalga oshirish";
      btn.disabled = false;
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  };
}

async function submitOrder(orderData, deliveryMethod) {
    try {
      const response = await fetch(`${apiBase}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });

      const result = await response.json();
      if (result.success) {
        showToast("Buyurtmangiz muvaffaqiyatli qabul qilindi!");
        localStorage.removeItem('cart');
        appliedPromoDiscount = 0; // Reset discount
        updateCartCountHeader();

        // Update local cashback wallets if returned
        const currentUser = loadCurrentUser();
        if (result.order && currentUser) {
          const cashbackEarned = result.order.cashbackEarned || 0;
          currentUser.walletBalance = Math.round(((currentUser.walletBalance || 0) + cashbackEarned) * 100) / 100;
          localStorage.setItem('currentUser', JSON.stringify(currentUser));
        }

            // Redirect to live tracking if courier delivery, otherwise to profile
            setTimeout(() => {
              if (deliveryMethod === 'courier' && result.order) {
                window.location.href = `delivery.html?orderId=${result.order.id}`;
              } else {
                window.location.href = 'account.html';
              }
            }, 1500);
      } else {
        showToast(result.message || "Xatolik yuz berdi.", "error");
      }
    } catch (error) {
      showToast("Tarmoq xatosi yuz berdi.", "error");
    }
}


// 8. User Dashboard Routing
async function loadDashboard() {
  const userContainer = document.getElementById('user-container');
  const sellerContainer = document.getElementById('seller-container');
  const adminContainer = document.getElementById('admin-container');
  const authContainer = document.getElementById('auth-forms-container');

  if (!userContainer || !authContainer) return; // Not on account.html page

  const currentUser = loadCurrentUser();

  // Hide all
  userContainer.style.display = 'none';
  sellerContainer.style.display = 'none';
  adminContainer.style.display = 'none';
  authContainer.style.display = 'none';

  if (!currentUser) {
    authContainer.style.display = 'grid';
    return;
  }

  // Set wallet balances in widgets
  const userWallet = document.getElementById('user-wallet-balance');
  const sellerWallet = document.getElementById('seller-wallet-balance');
  const adminWallet = document.getElementById('admin-wallet-balance');
  
  const balanceStr = `$${(currentUser.walletBalance || 0).toFixed(2)}`;
  if (userWallet) userWallet.textContent = balanceStr;
  if (sellerWallet) sellerWallet.textContent = balanceStr;
  if (adminWallet) adminWallet.textContent = balanceStr;

  // Display based on role
  if (currentUser.role === 'admin' || currentUser.role === 'director') {
    adminContainer.style.display = 'grid';
    
    const adminHeaderTitle = adminContainer.querySelector('h3');
    const adminAvatar = adminContainer.querySelector('.profile-avatar');
    const adminEmailEl = document.getElementById('admin-email');
    const tabDirAudit = document.getElementById('tab-director-audit');
    
    if (adminEmailEl) adminEmailEl.textContent = currentUser.email;

    if (currentUser.role === 'director') {
      if (adminHeaderTitle) adminHeaderTitle.textContent = "Direktor boshqaruv paneli";
      if (adminAvatar) {
        adminAvatar.textContent = "DIR";
        adminAvatar.style.background = "linear-gradient(135deg, var(--primary) 0%, #a855f7 100%)";
      }
      if (tabDirAudit) tabDirAudit.style.display = 'inline-block';
    } else {
      const specLabels = {
        products: 'Mahsulotlar Admini',
        delivery: 'Logistika Admini',
        support: 'Support & KYC Admini'
      };
      const specLabel = specLabels[currentUser.specialization] || 'Admin Panel';
      if (adminHeaderTitle) adminHeaderTitle.textContent = specLabel;
      if (adminAvatar) {
        adminAvatar.textContent = currentUser.name ? currentUser.name.slice(0, 2).toUpperCase() : 'AD';
        adminAvatar.style.background = 'linear-gradient(135deg, var(--danger) 0%, var(--primary) 100%)';
      }
      if (tabDirAudit) tabDirAudit.style.display = 'none';
    }

    setupAdminDashboard();
  } else if (currentUser.role === 'seller') {
    sellerContainer.style.display = 'grid';
    setupSellerDashboard(currentUser);
  } else {
    userContainer.style.display = 'grid';
    // Fill customer details
    document.getElementById('user-name').textContent = currentUser.name;
    document.getElementById('user-email').textContent = currentUser.email;
    const userBankDisplay = document.getElementById('user-bank-display');
    if (userBankDisplay) {
      userBankDisplay.textContent = currentUser.bankDetails ? currentUser.bankDetails : 'Kiritilmagan';
    }
    const avatarEl = document.getElementById('user-avatar-letters');
    updateAvatarUI(avatarEl, currentUser);
    
    // Bind Logout
    const btnLogout = document.getElementById('user-logout-button');
    if (btnLogout) {
      btnLogout.onclick = () => {
        localStorage.removeItem('currentUser');
      localStorage.removeItem('authToken');
        showToast("Tizimdan chiqildi.", "warning");
        loadDashboard();
      };
    }

    loadUserOrders(currentUser);
    loadUserWishlist();
  }
}

async function loadUserWishlist() {
  const container = document.getElementById('user-wishlist-container');
  if (!container) return;
  try {
    const res = await fetch(`${apiBase}/api/wishlist`);
    if (!res.ok) { container.innerHTML = `<p style="color:var(--text-muted)">Yuklab bo'lmadi.</p>`; return; }
    const data = await res.json();
    if (!data.wishlist || data.wishlist.length === 0) {
      container.innerHTML = `<p style="color:var(--text-muted);grid-column:1/-1;">Sevimlilarga mahsulot qo'shmagansiz.</p>`;
      return;
    }
    container.innerHTML = data.wishlist.map(p => `
      <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:12px;overflow:hidden;position:relative;">
        <img src="${p.image || 'smartphone.png'}" alt="${p.name}" style="width:100%;aspect-ratio:1;object-fit:cover;" onerror="this.src='smartphone.png'" />
        <div style="padding:8px;">
          <p style="font-weight:700;font-size:0.85rem;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</p>
          <p style="color:var(--primary);font-weight:800;margin:4px 0;font-size:0.9rem;">$${p.price}</p>
          <button onclick="removeFromWishlistUI(${p.id}, this)" style="width:100%;padding:6px;background:transparent;border:1px solid var(--danger);color:var(--danger);border-radius:8px;cursor:pointer;font-size:0.8rem;">Olib tashlash</button>
        </div>
      </div>`).join('');
  } catch(e) {
    container.innerHTML = `<p style="color:var(--text-muted)">Xatolik yuz berdi.</p>`;
  }
}

async function removeFromWishlistUI(productId, btn) {
  try {
    const res = await fetch(`${apiBase}/api/wishlist?productId=${productId}`, { method: 'DELETE' });
    if (res.ok) {
      const user = loadCurrentUser();
      if (user) { user.wishlist = (user.wishlist || []).filter(id => id !== productId); localStorage.setItem('currentUser', JSON.stringify(user)); }
      showToast('Sevimlilardan olib tashlandi', 'warning');
      loadUserWishlist();
    }
  } catch(e) { showToast('Xatolik', 'error'); }
}

async function loadUserOrders(currentUser) {
  const orderHistoryList = document.getElementById('order-history-list');
  const nasiyaList = document.getElementById('user-nasiya-list');

  if (!orderHistoryList) return;

  try {
    const response = await fetch(`${apiBase}/api/orders`);
    const allOrders = await response.json();
    const userOrders = allOrders.filter(order => order.userId === currentUser.id);

    // Mahsulot sharhlarini yuklash
    let reviewProducts = allProducts && allProducts.length > 0 ? allProducts : [];
    if (!reviewProducts.length) {
      try {
        const pRes = await fetch(`${apiBase}/api/products`);
        if (pRes.ok) reviewProducts = await pRes.json();
      } catch(_) {}
    }

    // Populate Nasiya (installment) lists
    if (nasiyaList) {
      const nasiyaOrders = userOrders.filter(o => o.paymentMethod && o.paymentMethod.startsWith('nasiya-'));
      if (nasiyaOrders.length === 0) {
        nasiyaList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">Sizda faol muddatli to'lovlar (nasiya) mavjud emas.</p>`;
      } else {
        nasiyaList.innerHTML = nasiyaOrders
          .map(order => {
            const months = Number(order.paymentMethod.split('-')[1]);
            const monthly = order.total / months;
            return `
              <div class="order-box" style="border-left: 4px solid #fbbf24;">
                <div class="order-box-header">
                  <span class="order-box-id" style="color: #fbbf24; font-weight: 700;">Nasiya #${order.id}</span>
                  <span class="order-box-date">${months} oyga bo'lingan</span>
                </div>
                <div style="font-size: 0.85rem; color: var(--text-main); margin-top: 6px; line-height: 1.5;">
                  <strong>Jami summa:</strong> $${order.total.toFixed(2)}<br/>
                  <strong>Oylik to'lov:</strong> $${monthly.toFixed(2)} / oyiga<br/>
                  <strong>Holati:</strong> Faol (0% ustama)<br/>
                  <div style="background: rgba(255,255,255,0.05); border-radius: 8px; height: 8px; width: 100%; margin-top: 10px; overflow: hidden; position: relative;">
                    <div style="background: #fbbf24; width: 16%; height: 100%;"></div>
                  </div>
                  <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; display: flex; justify-content: space-between;">
                    <span>To'lov jadvali: 1 / ${months} oy</span>
                    <span>Keyingi to'lov: 30 kundan so'ng</span>
                  </div>
                </div>
              </div>
            `;
          })
          .join('');
      }
    }

    if (userOrders.length === 0) {
      orderHistoryList.innerHTML = `<p style="color: var(--text-muted); padding: 10px 0;">Sizda hozircha buyurtmalar tarixi mavjud emas.</p>`;
      return;
    }

    orderHistoryList.innerHTML = userOrders
      .map(
        (order) => {
          const isCourier = order.deliveryMethod === 'courier';
          const trackingBtnHtml = isCourier ? `
            <a href="delivery.html?orderId=${order.id}" class="primary-btn" style="margin-top: 12px; font-size: 0.85rem; padding: 6px 14px; background: #ea580c; display: inline-block; border-color: transparent;">
              🛵 Hamkor kuryerni kuzatish
            </a>
          ` : '';

          const cashbackHtml = order.cashbackEarned ? `
            <div style="font-size: 0.8rem; color: var(--success); font-weight: 700; margin-top: 4px; display: flex; align-items: center; gap: 4px;">
              <span>💰</span> +$${order.cashbackEarned.toFixed(2)} Keshbek olindi
            </div>
          ` : '';

          return `
            <div class="order-box">
              <div class="order-box-header">
                <span class="order-box-id">Buyurtma #${order.id}</span>
                <span class="order-box-date">${order.date}</span>
              </div>
              <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 8px;">
                Yetkazish turi: <strong>${isCourier ? 'Hamkor kuryer' : 'Olib ketish nuqtasi'}</strong><br/>
                Manzil: ${order.customerAddress}<br/>
                To'lov usuli: <strong>${order.paymentMethod === 'full' ? 'Naqd / Karta' : 'Nasiya (muddatli to\'lov)'}</strong>
              </p>
              <ul class="order-items-list" style="border-top: 1px dashed var(--border-color); padding-top: 8px;">
                ${order.items
                  .map(
                    (item) => `
                      <li class="order-item-detail">
                        <span class="order-item-name">${item.name}</span>
                        <span class="order-item-qty">${item.quantity} x $${item.price}</span>
                      </li>
                    `
                  )
                  .join('')}
              </ul>
              <div class="order-box-footer" style="margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
                <div>
                  <span class="order-box-status">${order.status}</span>
                  ${cashbackHtml}
                </div>
                <span class="order-box-total">Jami: $${order.total.toFixed(2)}</span>
              </div>
              ${trackingBtnHtml}
              ${buildOrderReviewSection(order, reviewProducts, currentUser)}
            </div>
          `;
        }
      )
      .join('');
  } catch (e) {
    orderHistoryList.innerHTML = `<p style="color: var(--text-muted);">Buyurtmalar tarixini yuklab bo'lmadi.</p>`;
  }
}

// ===== ORDER ITEM REVIEW HELPERS =====
function buildOrderReviewSection(order, products, currentUser) {
  if (!order.items || !order.items.length || !currentUser) return '';

  var itemsHtml = order.items.map(function(item) {
    var prod = products.find(function(p) { return p.id === item.id; });
    var myReview = prod ? (prod.reviews || []).find(function(r) { return r.userId === currentUser.id; }) : null;
    var pid = item.id;
    var oid = order.id;

    if (myReview) {
      var stars = '★'.repeat(myReview.rating) + '☆'.repeat(5 - myReview.rating);
      return '<div style="background:rgba(16,185,129,0.07);border:1px solid rgba(16,185,129,0.18);border-radius:12px;padding:12px 14px;margin-bottom:8px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">'
        + '<span style="font-size:0.82rem;font-weight:700;color:white;">🛍️ ' + item.name + '</span>'
        + '<span style="color:#fbbf24;font-size:0.9rem;white-space:nowrap;">' + stars + ' <span style="color:var(--text-muted);font-size:0.72rem;">' + myReview.rating + '/5</span></span>'
        + '</div>'
        + (myReview.comment ? '<p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 4px;line-height:1.5;">\u201c' + myReview.comment + '\u201d</p>' : '')
        + '<span style="font-size:0.72rem;color:var(--success);">✅ Sharh qoldirildi \u2022 ' + myReview.date + '</span>'
        + '</div>';
    } else {
      var starBtns = [1,2,3,4,5].map(function(n) {
        return '<button type="button" onclick="window.setOrderStar(' + pid + ',' + oid + ',' + n + ')" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#fbbf24;padding:0;">★</button>';
      }).join('');
      return '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-color);border-radius:12px;padding:10px 14px;margin-bottom:8px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
        + '<span style="font-size:0.82rem;font-weight:700;color:var(--text-muted);">🛍️ ' + item.name + '</span>'
        + '<button onclick="window.openOrderItemReview(' + pid + ',' + oid + ')" style="font-size:0.76rem;padding:5px 12px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);border-radius:8px;color:var(--primary);cursor:pointer;font-weight:600;white-space:nowrap;font-family:inherit;">✍️ Sharh qoldirish</button>'
        + '</div>'
        + '<div id="order-review-form-' + pid + '-' + oid + '" style="display:none;margin-top:10px;">'
        + '<div style="display:flex;gap:4px;margin-bottom:8px;" id="order-stars-' + pid + '-' + oid + '">' + starBtns + '</div>'
        + '<input type="hidden" id="order-review-rating-' + pid + '-' + oid + '" value="5"/>'
        + '<textarea id="order-review-comment-' + pid + '-' + oid + '" placeholder="Bu mahsulot haqida fikringiz..." rows="3" style="width:100%;padding:9px;background:rgba(11,15,25,0.6);border:1px solid var(--border-color);border-radius:8px;color:var(--text-main);font-family:inherit;font-size:0.83rem;resize:vertical;outline:none;box-sizing:border-box;"></textarea>'
        + '<div style="display:flex;gap:8px;margin-top:8px;align-items:center;">'
        + '<button onclick="window.submitOrderItemReview(' + pid + ',' + oid + ',this)" style="padding:7px 18px;background:var(--primary);color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.83rem;font-family:inherit;">Yuborish</button>'
        + '<span id="order-review-msg-' + pid + '-' + oid + '" style="font-size:0.78rem;"></span>'
        + '</div>'
        + '</div>'
        + '</div>';
    }
  }).join('');

  return '<div style="margin-top:14px;border-top:1px dashed var(--border-color);padding-top:14px;">'
    + '<div style="font-size:0.82rem;font-weight:700;color:var(--text-muted);margin-bottom:10px;display:flex;align-items:center;gap:6px;">'
    + '📝 <span>Mahsulot sharhlari</span></div>'
    + itemsHtml
    + '</div>';
}

window.openOrderItemReview = function(productId, orderId) {
  var form = document.getElementById('order-review-form-' + productId + '-' + orderId);
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
};

window.setOrderStar = function(productId, orderId, val) {
  var ratingInput = document.getElementById('order-review-rating-' + productId + '-' + orderId);
  if (ratingInput) ratingInput.value = val;
  var starBtns = document.querySelectorAll('#order-stars-' + productId + '-' + orderId + ' button');
  starBtns.forEach(function(b, i) { b.style.opacity = i < val ? '1' : '0.35'; });
};

window.submitOrderItemReview = async function(productId, orderId, btn) {
  var ratingInput = document.getElementById('order-review-rating-' + productId + '-' + orderId);
  var commentInput = document.getElementById('order-review-comment-' + productId + '-' + orderId);
  var msgEl = document.getElementById('order-review-msg-' + productId + '-' + orderId);

  var rating = Number(ratingInput ? ratingInput.value : 5) || 5;
  var comment = (commentInput ? commentInput.value : '').trim();

  btn.disabled = true;
  var origText = btn.textContent;
  btn.textContent = '⏳ Yuborilmoqda...';

  try {
    var res = await fetch(apiBase + '/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: productId, rating: rating, comment: comment })
    });
    var data = await res.json();
    if (res.ok) {
      // Mahalliy keshni yangilash
      var prod = allProducts.find(function(p) { return p.id === productId; });
      if (prod) {
        prod.reviews = prod.reviews || [];
        prod.reviews.push(data.review);
        prod.rating = data.newRating;
      }
      showToast('Sharh muvaffaqiyatli qoldirildi!');
      var cu = loadCurrentUser();
      if (cu) loadUserOrders(cu);
    } else {
      if (msgEl) { msgEl.textContent = data.message || 'Xatolik'; msgEl.style.color = 'var(--danger)'; }
      btn.disabled = false;
      btn.textContent = origText;
    }
  } catch(e) {
    if (msgEl) { msgEl.textContent = 'Tarmoq xatosi'; msgEl.style.color = 'var(--danger)'; }
    btn.disabled = false;
    btn.textContent = origText;
  }
};
// ===== END ORDER REVIEW HELPERS =====

// 9. Seller Dashboard Logic
function setupSellerDashboard(currentUser) {
  const cardPending = document.getElementById('seller-kyc-pending-card');
  const cardRejected = document.getElementById('seller-kyc-rejected-card');
  const normalProfile = document.getElementById('seller-normal-profile');

  // Set default view visibility based on KYC
  if (currentUser.kycStatus === 'pending') {
    if (cardPending) cardPending.style.display = 'block';
    if (cardRejected) cardRejected.style.display = 'none';
    if (normalProfile) normalProfile.style.display = 'none';
  } else if (currentUser.kycStatus === 'rejected') {
    if (cardPending) cardPending.style.display = 'none';
    if (cardRejected) cardRejected.style.display = 'block';
    if (normalProfile) normalProfile.style.display = 'none';
    
    const txtRejection = document.getElementById('seller-rejection-text');
    const txtRejectionCount = document.getElementById('seller-rejection-count');
    if (txtRejection) txtRejection.textContent = `Rad etilgan sababi: ${currentUser.rejectionReason || 'Noaniq'}`;
    if (txtRejectionCount) txtRejectionCount.textContent = currentUser.rejectionCount || 0;
  } else {
    // Approved or normal seller
    if (cardPending) cardPending.style.display = 'none';
    if (cardRejected) cardRejected.style.display = 'none';
    if (normalProfile) normalProfile.style.display = 'contents';
  }

  // Fill details
  document.getElementById('seller-name').textContent = currentUser.name;
  document.getElementById('seller-email').textContent = currentUser.email;
  const sellerBankDisplay = document.getElementById('seller-bank-display');
  if (sellerBankDisplay) {
    sellerBankDisplay.textContent = currentUser.bankDetails ? currentUser.bankDetails : 'Kiritilmagan';
  }
  const sellerAvatarEl = document.querySelector('#seller-container .profile-avatar');
  updateAvatarUI(sellerAvatarEl, currentUser);

  // Bind Logout Buttons
  const logouts = [
    document.getElementById('seller-logout-button'),
    document.getElementById('seller-pending-logout-btn'),
    document.getElementById('seller-rejected-logout-btn')
  ];
  
  logouts.forEach(btn => {
    if (btn) {
      btn.onclick = () => {
        localStorage.removeItem('currentUser');
        localStorage.removeItem('authToken');
        showToast("Tizimdan chiqildi.", "warning");
        loadDashboard();
      };
    }
  });

  // Re-apply logic
  const btnReapply = document.getElementById('seller-reapply-btn');
  if (btnReapply) {
    btnReapply.onclick = () => {
      // Copy previous values to register form inputs
      document.getElementById('register-name').value = currentUser.name;
      document.getElementById('register-email').value = currentUser.email;
      document.getElementById('register-phone').value = currentUser.phone;
      document.getElementById('register-is-seller').checked = true;
      
      // Trigger toggle event to show KYC inputs
      const isSellerCheckbox = document.getElementById('register-is-seller');
      if (isSellerCheckbox) {
        isSellerCheckbox.dispatchEvent(new Event('change'));
      }
      
      document.getElementById('kyc-passport').value = currentUser.passportNumber || '';
      document.getElementById('kyc-birthdate').value = currentUser.birthDate || '';
      
      const sellerType = currentUser.sellerType || 'jismoniy';
      const radios = document.getElementsByName('kyc-seller-type');
      for (const r of radios) {
        if (r.value === sellerType) r.checked = true;
      }
      
      document.getElementById('kyc-passport-photo').value = currentUser.passportPhoto || '';
      document.getElementById('kyc-selfie-photo').value = currentUser.selfieUrl || '';
      
      // Clear active login
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authToken');
      
      // Load login/register forms and show register section
      loadDashboard();
      const authContainer = document.getElementById('auth-forms-container');
      const loginSec = document.getElementById('login-section');
      const registerSec = document.getElementById('register-section');
      if (authContainer) {
        authContainer.style.display = 'grid';
        if (loginSec) loginSec.style.display = 'none';
        if (registerSec) registerSec.style.display = 'block';
      }
      showToast("Iltimos, xatoliklarni tuzatib arizani qayta yuboring.", "warning");
    };
  }

  // Bind Tabs
  const tabStats = document.getElementById('tab-seller-stats');
  const tabAdd = document.getElementById('tab-seller-add');
  const secStats = document.getElementById('seller-stats-section');
  const secAdd = document.getElementById('seller-add-section');

  if (tabStats && tabAdd) {
    tabStats.onclick = () => {
      tabStats.classList.add('active');
      tabAdd.classList.remove('active');
      secStats.style.display = 'block';
      secAdd.style.display = 'none';
      loadSellerProducts();
    };

    tabAdd.onclick = () => {
      tabAdd.classList.add('active');
      tabStats.classList.remove('active');
      secAdd.style.display = 'block';
      secStats.style.display = 'none';
    };
  }

  // Bind seller product adding form submit
  const sellerForm = document.getElementById('seller-product-form');
  const sellerMessage = document.getElementById('seller-product-message');

  if (sellerForm) {
    sellerForm.onsubmit = async (event) => {
      event.preventDefault();

      const name = document.getElementById('seller-product-name').value;
      const price = Number(document.getElementById('seller-product-price').value);
      const cost = Number(document.getElementById('seller-product-cost').value);
      const stock = Number(document.getElementById('seller-product-stock').value);
      const category = document.getElementById('seller-product-category').value;
      const originalPrice = Number(document.getElementById('seller-product-original-price').value) || null;
      const image = document.getElementById('seller-product-image').value;
      const description = document.getElementById('seller-product-description').value;
      const returnDays = Number(document.getElementById('seller-product-return-days')?.value) || 0;

      try {
        const response = await fetch(`${apiBase}/api/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, price, cost, stock, category, originalPrice, image, description, returnDays })
        });

        const result = await response.json();

        if (response.status === 201 && result.product) {
          showToast("Yangi mahsulot muvaffaqiyatli sotuvga joylandi!");
          sellerForm.reset();
          document.getElementById('seller-product-image').value = "smartphone.png";
          tabStats.click(); // switch back to stats tab
        } else {
          sellerMessage.textContent = result.message;
          sellerMessage.className = 'message error';
          showToast(result.message, 'error');
        }
      } catch (e) {
        showToast("Mahsulot qo'shishda xato yuz berdi.", "error");
      }
    };
  }

  // Load stats and lists initially
  loadSellerProducts();
}

async function loadSellerProducts() {
  const productsList = document.getElementById('seller-products-list');
  const revenueEl = document.getElementById('seller-revenue');
  const countEl = document.getElementById('seller-products-count');
  const alertsContainer = document.getElementById('seller-stock-alerts');
  const alertsList = document.getElementById('seller-alerts-list');

  if (!productsList) return;

  try {
    const pResponse = await fetch(`${apiBase}/api/products`);
    const products = await pResponse.json();

    const oResponse = await fetch(`${apiBase}/api/orders`);
    const orders = await oResponse.json();

    // 9a. Compute revenue (Sum of all orders sales)
    let totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
    revenueEl.textContent = `$${totalRevenue.toFixed(2)}`;
    countEl.textContent = `${products.length} ta`;

    // 9a+. Render seller sales chart (last 7 orders)
    const chartCanvas = document.getElementById('seller-sales-chart');
    if (chartCanvas && typeof Chart !== 'undefined') {
      const last7 = orders.slice(-7);
      const labels = last7.map((o, i) => `#${o.id}`);
      const data = last7.map(o => o.total);

      // Destroy existing chart instance if any
      if (chartCanvas._chartInstance) { chartCanvas._chartInstance.destroy(); }

      chartCanvas._chartInstance = new Chart(chartCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: "Buyurtma summasi ($)",
            data,
            backgroundColor: 'rgba(99,102,241,0.7)',
            borderColor: 'rgba(99,102,241,1)',
            borderWidth: 2,
            borderRadius: 8,
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { labels: { color: '#a0aec0', font: { size: 12 } } },
            tooltip: { callbacks: { label: ctx => `$${ctx.raw}` } }
          },
          scales: {
            x: { ticks: { color: '#a0aec0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#a0aec0', callback: v => '$' + v }, grid: { color: 'rgba(255,255,255,0.05)' } }
          }
        }
      });
    }


    // 9b. Find products with low stock <= 3
    const lowStockProducts = products.filter(p => p.stock <= 3);
    if (lowStockProducts.length > 0) {
      alertsContainer.style.display = 'block';
      alertsList.innerHTML = lowStockProducts
        .map(p => `
          <li>⚠️ <strong>"${p.name}"</strong> qoldig'i kam qoldi! Omborda atigi <strong>${p.stock} ta</strong> bor.</li>
        `)
        .join('');
    } else {
      alertsContainer.style.display = 'none';
    }

    // 9c. Render products list with +/- stock controls
    productsList.innerHTML = products
      .map(
        (product) => `
          <div class="admin-item-row" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; background: rgba(11, 15, 25, 0.4); border: 1px solid var(--border-color); border-radius: 12px; gap: 16px;">
            <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
              <img src="${product.image || 'smartphone.png'}" alt="${product.name}" onerror="this.src='smartphone.png'" style="width: 40px; height: 40px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border-color);" />
              <div style="text-align: left;">
                <strong style="color: white; font-size: 0.95rem;">${product.name}</strong> 
                <span style="font-size: 0.75rem; color: var(--text-muted); padding: 2px 6px; background: var(--border-color); border-radius: 4px; margin-left: 6px;">${product.category}</span>
                <div style="font-size: 0.9rem; color: var(--success); font-weight: 700; margin-top: 2px;">$${product.price} (Tan narxi: $${product.cost || 0})</div>
              </div>
            </div>
            
            <!-- Stock Control Counter -->
            <div style="display: flex; align-items: center; gap: 8px; background: rgba(11, 15, 25, 0.8); padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 10px;">
              <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600; margin-right: 4px;">Ombor:</span>
              <button class="quantity-btn dec-stock" data-id="${product.id}" style="width:24px; height:24px;">-</button>
              <span class="stock-badge ${product.stock <= 3 ? 'stock-low' : 'stock-ok'}" style="font-size:0.85rem; font-weight:700; min-width:20px; text-align:center;">${product.stock}</span>
              <button class="quantity-btn inc-stock" data-id="${product.id}" style="width:24px; height:24px;">+</button>
            </div>
            
            <button class="remove-btn seller-product-delete-btn" data-id="${product.id}" style="font-size: 0.85rem;">O'chirish</button>
            <button class="seller-product-edit-btn" data-id="${product.id}" style="font-size:0.85rem; padding:6px 12px; border-radius:8px; border:1px solid var(--primary); background:transparent; color:var(--primary); cursor:pointer; font-weight:600;">Tahrirlash</button>
          </div>
        `
      )
      .join('');

    // Bind +/- Stock Controls
    productsList.querySelectorAll('.inc-stock').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.getAttribute('data-id'));
        const product = products.find(p => p.id === id);
        if (product) {
          const newStock = product.stock + 1;
          await updateProductStock(id, newStock);
        }
      };
    });

    productsList.querySelectorAll('.dec-stock').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.getAttribute('data-id'));
        const product = products.find(p => p.id === id);
        if (product) {
          const newStock = Math.max(0, product.stock - 1);
          await updateProductStock(id, newStock);
        }
      };
    });

    // Bind delete product
    productsList.querySelectorAll('.seller-product-delete-btn').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.getAttribute('data-id'));
        if (!confirm("Ushbu mahsulotni o'chirishni xohlaysizmi?")) return;

        try {
          const res = await fetch(`${apiBase}/api/products?id=${id}`, { method: 'DELETE' });
          const result = await res.json();
          if (result.success) {
            showToast("Mahsulot do'kondan olib tashlandi.", "warning");
            loadSellerProducts();
          }
        } catch (e) {
          showToast("Xatolik yuz berdi.", "error");
        }
      };
    });

    // Bind edit product
    productsList.querySelectorAll('.seller-product-edit-btn').forEach((btn) => {
      btn.onclick = () => {
        const id = Number(btn.getAttribute('data-id'));
        const product = products.find(p => p.id === id);
        if (!product) return;
        openProductEditModal(product);
      };
    });

  } catch (error) {
    productsList.innerHTML = `<p style="color: var(--text-muted);">Mahsulotlar ro'yxatini yuklab bo'lmadi.</p>`;
  }
}

async function updateProductStock(productId, stock) {
  try {
    const res = await fetch(`${apiBase}/api/products/stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, stock })
    });
    const result = await res.json();
    if (result.success) {
      showToast(`Ombor qoldig'i yangilandi: ${stock} ta`, "success");
      loadSellerProducts();
      // Reload on main catalog if applicable
      fetchProducts();
    }
  } catch (e) {
    showToast("Ombor yangilanishida xato yuz berdi.", "error");
  }
}

// 10. Admin Dashboard Logic
function setupAdminDashboard() {
  const adminLogoutBtn = document.getElementById('admin-logout-button');
  if (adminLogoutBtn) {
    adminLogoutBtn.onclick = () => {
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authToken');
      showToast("Tizimdan chiqildi.", "warning");
      loadCurrentUser();
      loadDashboard();
    };
  }

  // Bind Tabs
  const tabFinancials = document.getElementById('tab-admin-financials');
  const tabOrders = document.getElementById('tab-admin-orders');
  const tabProducts = document.getElementById('tab-admin-products');
  const tabUsers = document.getElementById('tab-admin-users');
  const tabDirector = document.getElementById('tab-director-audit');

  const secFinancials = document.getElementById('admin-financials-section');
  const secOrders = document.getElementById('admin-orders-section');
  const secProducts = document.getElementById('admin-products-section');
  const secUsers = document.getElementById('admin-users-section');
  const secDirector = document.getElementById('director-audit-section');

  const resetActiveTabs = () => {
    if (tabFinancials) tabFinancials.classList.remove('active');
    if (tabOrders) tabOrders.classList.remove('active');
    if (tabProducts) tabProducts.classList.remove('active');
    if (tabUsers) tabUsers.classList.remove('active');
    if (tabDirector) tabDirector.classList.remove('active');

    if (secFinancials) secFinancials.style.display = 'none';
    if (secOrders) secOrders.style.display = 'none';
    if (secProducts) secProducts.style.display = 'none';
    if (secUsers) secUsers.style.display = 'none';
    if (secDirector) secDirector.style.display = 'none';
  };

  const currentUser = loadCurrentUser();
  if (currentUser) {
    if (currentUser.role === 'admin') {
      const spec = currentUser.specialization;
      if (tabFinancials) tabFinancials.style.display = 'none';
      if (tabOrders) tabOrders.style.display = spec === 'delivery' ? 'inline-block' : 'none';
      if (tabProducts) tabProducts.style.display = spec === 'products' ? 'inline-block' : 'none';
      if (tabUsers) tabUsers.style.display = spec === 'support' ? 'inline-block' : 'none';
      if (tabDirector) tabDirector.style.display = 'none';

      // Load specific view
      resetActiveTabs();
      if (spec === 'products') {
        if (tabProducts) tabProducts.classList.add('active');
        if (secProducts) secProducts.style.display = 'block';
        loadAdminProducts();
      } else if (spec === 'delivery') {
        if (tabOrders) tabOrders.classList.add('active');
        if (secOrders) secOrders.style.display = 'block';
        loadAdminOrders();
      } else if (spec === 'support') {
        // Rename tab to KYC Tekshiruvi
        if (tabUsers) tabUsers.textContent = '🔍 KYC Tekshiruvi';
        const secHeader = document.querySelector('#admin-users-section h2');
        if (secHeader) secHeader.textContent = '🔍 KYC Tekshiruvi & Foydalanuvchilar';
        if (tabUsers) tabUsers.classList.add('active');
        if (secUsers) secUsers.style.display = 'block';
        loadAdminUsers();
      }
    } else if (currentUser.role === 'director') {
      if (tabFinancials) tabFinancials.style.display = 'inline-block';
      if (tabOrders) tabOrders.style.display = 'inline-block';
      if (tabProducts) tabProducts.style.display = 'inline-block';
      if (tabUsers) tabUsers.style.display = 'inline-block';
      if (tabDirector) tabDirector.style.display = 'inline-block';

      resetActiveTabs();
      if (tabFinancials) tabFinancials.classList.add('active');
      if (secFinancials) secFinancials.style.display = 'block';
      loadAdminFinancials();
    }
  }

  if (tabFinancials && secFinancials) {
    tabFinancials.onclick = () => {
      resetActiveTabs();
      tabFinancials.classList.add('active');
      secFinancials.style.display = 'block';
      loadAdminFinancials();
    };
  }

  if (tabOrders && secOrders) {
    tabOrders.onclick = () => {
      resetActiveTabs();
      tabOrders.classList.add('active');
      secOrders.style.display = 'block';
      loadAdminOrders();
    };
  }

  if (tabProducts && secProducts) {
    tabProducts.onclick = () => {
      resetActiveTabs();
      tabProducts.classList.add('active');
      secProducts.style.display = 'block';
      loadAdminProducts();
    };
  }

  if (tabUsers && secUsers) {
    tabUsers.onclick = () => {
      resetActiveTabs();
      tabUsers.classList.add('active');
      secUsers.style.display = 'block';
      loadAdminUsers();
    };
  }

  if (tabDirector && secDirector) {
    tabDirector.onclick = () => {
      resetActiveTabs();
      tabDirector.classList.add('active');
      secDirector.style.display = 'block';
      loadDirectorAudit();
    };
  }

  // Load lists
  loadAdminFinancials();
  loadAdminOrders();
  loadAdminProducts();
  loadAdminUsers();

  if (currentUser && currentUser.role === 'director') {
    loadDirectorAudit();
  }
}

async function loadDirectorAudit() {
  const cashbackEl = document.getElementById('dir-total-cashback');
  const stockValEl = document.getElementById('dir-stock-value');
  const totalOrdersEl = document.getElementById('dir-total-orders');
  const sellersTable = document.getElementById('dir-sellers-table');

  if (!cashbackEl) return;

  const token = localStorage.getItem('authToken');
  const authHeaders = { 'Authorization': token ? `Bearer ${token}` : '' };

  try {
    const [usersRes, productsRes, ordersRes] = await Promise.all([
      fetch(`${apiBase}/api/users`, { headers: authHeaders }),
      fetch(`${apiBase}/api/products`),
      fetch(`${apiBase}/api/orders`)
    ]);

    const users = await usersRes.json();
    const products = await productsRes.json();
    const orders = await ordersRes.json();

    // 1. Calculate Cashback Pool
    const totalCashback = users
      .filter(u => u.role === 'user')
      .reduce((sum, u) => sum + (u.walletBalance || 0), 0);
    cashbackEl.textContent = `$${totalCashback.toFixed(2)}`;

    // 2. Calculate Stock Value
    const totalStockVal = products.reduce((sum, p) => sum + (p.price * (p.stock || 0)), 0);
    stockValEl.textContent = `$${totalStockVal.toFixed(2)}`;

    // 3. Count Orders
    totalOrdersEl.textContent = `${orders.length} ta`;

    // 4. Render Sellers Table
    const sellers = users.filter(u => u.role === 'seller');
    if (sellers.length === 0) {
      sellersTable.innerHTML = `<tr><td colspan="4" style="padding: 20px; text-align: center; color: var(--text-muted);">Sotuvchilar topilmadi.</td></tr>`;
    } else {
      sellersTable.innerHTML = sellers.map(s => `
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 10px; font-weight: 600; color: white;">${s.name}</td>
          <td style="padding: 12px 10px; color: var(--text-muted);">${s.email}</td>
          <td style="padding: 12px 10px; text-align: center; color: var(--success); font-weight: 700;">$${(s.walletBalance || 0).toFixed(2)}</td>
          <td style="padding: 12px 10px; text-align: center;"><span style="background: rgba(16, 185, 129, 0.15); color: var(--success); font-size: 0.8rem; padding: 4px 10px; border-radius: 6px; font-weight: bold;">Sotuvchi</span></td>
        </tr>
      `).join('');
    }

    // 4.1. Render Admins & Directors Table
    const adminsTable = document.getElementById('dir-admins-table');
    if (adminsTable) {
      const adminsAndDirectors = users.filter(u => u.role === 'admin' || u.role === 'director');
      if (adminsAndDirectors.length === 0) {
        adminsTable.innerHTML = `<tr><td colspan="6" style="padding: 20px; text-align: center; color: var(--text-muted);">Adminlar va direktorlar topilmadi.</td></tr>`;
      } else {
        adminsTable.innerHTML = adminsAndDirectors.map(a => `
          <tr style="border-bottom: 1px solid var(--border-color);">
            <td style="padding: 12px 10px; color: var(--text-muted);">${a.id}</td>
            <td style="padding: 12px 10px; font-weight: 600; color: white;">${a.name}</td>
            <td style="padding: 12px 10px; color: var(--text-muted);">${a.email}</td>
            <td style="padding: 12px 10px;"><span style="background: ${a.role === 'director' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(59, 130, 246, 0.15)'}; color: ${a.role === 'director' ? '#a855f7' : '#3b82f6'}; font-size: 0.8rem; padding: 4px 10px; border-radius: 6px; font-weight: bold;">${a.role.toUpperCase()}</span></td>
            <td style="padding: 12px 10px; color: white;">${a.specialization ? a.specialization.toUpperCase() : 'Barchasi (Full)'}</td>
            <td style="padding: 12px 10px; text-align: center;">
              <button onclick="editAdminUser(${JSON.stringify(a).replace(/"/g, '&quot;')})" style="padding: 6px 12px; background: var(--primary); color: white; border: none; border-radius: 6px; font-size: 0.8rem; cursor: pointer; font-weight: bold;">Tahrirlash</button>
            </td>
          </tr>
        `).join('');
      }
    }

    // 5. Render Audit Logs Table
    const logsTable = document.getElementById('dir-audit-logs-table');
    if (logsTable) {
      try {
        const auditResponse = await fetch(`${apiBase}/api/audit`, {
          headers: {
            'Authorization': token ? `Bearer ${token}` : ''
          }
        });
        const logs = await auditResponse.json();
        
        if (!Array.isArray(logs) || logs.length === 0) {
          logsTable.innerHTML = `<tr><td colspan="4" style="padding: 20px; text-align: center; color: var(--text-muted);">Audit yozuvlari topilmadi.</td></tr>`;
        } else {
          // Sort descending by timestamp (newest first)
          const sorted = [...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          logsTable.innerHTML = sorted.map(log => {
            const dateStr = new Date(log.timestamp).toLocaleString('uz-UZ');
            let actionBadgeColor = 'rgba(99, 102, 241, 0.15); color: var(--primary);';
            if (log.action === 'kyc_approve') actionBadgeColor = 'rgba(16, 185, 129, 0.15); color: var(--success);';
            if (log.action === 'kyc_reject') actionBadgeColor = 'rgba(239, 68, 68, 0.15); color: var(--danger);';
            
            return `
              <tr style="border-bottom: 1px solid var(--border-color); font-size: 0.85rem;">
                <td style="padding: 10px 8px; color: var(--text-muted); white-space: nowrap;">${dateStr}</td>
                <td style="padding: 10px 8px; color: white;">ID: ${log.actorId} <span style="font-size:0.75rem; color: var(--text-muted);">(${log.actorRole})</span></td>
                <td style="padding: 10px 8px;"><span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size:0.75rem; background: ${actionBadgeColor}">${log.action.toUpperCase()}</span></td>
                <td style="padding: 10px 8px; color: var(--text-main); max-width: 250px; word-break: break-all;">${log.details}</td>
              </tr>
            `;
          }).join('');
        }
      } catch (err) {
        logsTable.innerHTML = `<tr><td colspan="4" style="padding: 20px; text-align: center; color: var(--danger);">Audit harakatlarini yuklashda xatolik.</td></tr>`;
      }
    }
  } catch (err) {
    showToast("Audit ma'lumotlarini yuklashda xatolik.", "error");
  }
}

async function loadAdminFinancials() {
  const revEl = document.getElementById('fin-revenue');
  const expEl = document.getElementById('fin-expenses');
  const profEl = document.getElementById('fin-profit');
  const margEl = document.getElementById('fin-margin');

  const catTable = document.getElementById('fin-category-table');
  const ordTable = document.getElementById('fin-orders-table');

  if (!revEl) return;

  try {
    const response = await fetch(`${apiBase}/api/orders`);
    const orders = await response.json();

    let totalRevenue = 0;
    let totalExpenses = 0;
    const categoryStats = {};
    const ordersListHtml = [];

    orders.forEach((order) => {
      let orderCost = 0;
      order.items.forEach((item) => {
        const itemCost = item.cost || Math.round(item.price * 0.65);
        const itemQty = item.quantity || 1;
        const lineCost = itemCost * itemQty;
        const lineRevenue = item.price * itemQty;

        orderCost += lineCost;

        const cat = item.category || 'Elektronika';
        if (!categoryStats[cat]) {
          categoryStats[cat] = { qty: 0, revenue: 0, cost: 0 };
        }
        categoryStats[cat].qty += itemQty;
        categoryStats[cat].revenue += lineRevenue;
        categoryStats[cat].cost += lineCost;
      });

      const orderRevenue = order.total;
      const orderProfit = orderRevenue - orderCost;

      totalRevenue += orderRevenue;
      totalExpenses += orderCost;

      ordersListHtml.push(`
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 10px;">#${order.id}</td>
          <td style="padding: 12px 10px; font-weight: 600;">${order.customerName}</td>
          <td style="padding: 12px 10px; font-size: 0.85rem; color: var(--text-muted);">${order.date.split(',')[0]}</td>
          <td style="padding: 12px 10px; text-align: right; color: white; font-weight: 600;">$${orderRevenue}</td>
          <td style="padding: 12px 10px; text-align: right; color: var(--text-muted);">$${orderCost}</td>
          <td style="padding: 12px 10px; text-align: right; color: ${orderProfit >= 0 ? 'var(--success)' : 'var(--danger)'}; font-weight: 700;">$${orderProfit}</td>
        </tr>
      `);
    });

    const netProfit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    revEl.textContent = `$${totalRevenue.toFixed(2)}`;
    expEl.textContent = `$${totalExpenses.toFixed(2)}`;
    profEl.textContent = `$${netProfit.toFixed(2)}`;
    margEl.textContent = `${profitMargin.toFixed(1)}%`;

    if (ordTable) {
      if (ordersListHtml.length === 0) {
        ordTable.innerHTML = `<tr><td colspan="6" style="padding: 20px; text-align: center; color: var(--text-muted);">Buyurtmalar tarixi bo'sh.</td></tr>`;
      } else {
        ordTable.innerHTML = ordersListHtml.reverse().join('');
      }
    }

    if (catTable) {
      const categories = Object.keys(categoryStats);
      if (categories.length === 0) {
        catTable.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">Sotilgan mahsulotlar topilmadi.</td></tr>`;
      } else {
        catTable.innerHTML = categories
          .map((cat) => {
            const stats = categoryStats[cat];
            const profit = stats.revenue - stats.cost;
            return `
              <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 12px 10px; font-weight: 700; color: white;">${cat}</td>
                <td style="padding: 12px 10px; text-align: center;">${stats.qty}</td>
                <td style="padding: 12px 10px; text-align: right; color: white;">$${stats.revenue}</td>
                <td style="padding: 12px 10px; text-align: right; color: var(--text-muted);">$${stats.cost}</td>
                <td style="padding: 12px 10px; text-align: right; color: var(--success); font-weight: 700;">$${profit}</td>
              </tr>
            `;
          })
          .join('');
      }
    }
  } catch (error) {
    showToast("Moliyaviy ko'rsatkichlarni yuklashda xato yuz berdi.", "error");
  }
}

async function loadAdminOrders() {
  const container = document.getElementById('admin-orders-list');
  if (!container) return;

  try {
    const response = await fetch(`${apiBase}/api/orders`);
    const orders = await response.json();

    if (orders.length === 0) {
      container.innerHTML = `<p style="color: var(--text-muted); padding: 10px 0;">Hozircha buyurtmalar mavjud emas.</p>`;
      return;
    }

    container.innerHTML = orders
      .map(
        (order) => `
          <div class="order-box">
            <div class="order-box-header">
              <span class="order-box-id">Buyurtma #${order.id} (Mijoz ID: ${order.userId})</span>
              <span class="order-box-date">${order.date}</span>
            </div>
            <div style="font-size: 0.9rem; margin-bottom: 8px; color: var(--text-main); line-height: 1.5;">
              <strong>Yetkazish:</strong> ${order.deliveryMethod === 'courier' ? 'Hamkor kuryer' : 'Olib ketish nuqtasi'}<br/>
              <strong>Xaridor:</strong> ${order.customerName}<br/>
              <strong>Telefon:</strong> ${order.customerPhone}<br/>
              <strong>Manzil:</strong> ${order.customerAddress}
            </div>
            <ul class="order-items-list" style="border-top: 1px dashed var(--border-color); padding-top: 8px;">
              ${order.items
                .map(
                  (item) => `
                    <li class="order-item-detail">
                      <span class="order-item-name">${item.name}</span>
                      <span class="order-item-qty">${item.quantity} x $${item.price}</span>
                    </li>
                  `
                )
                .join('')}
            </ul>
            <div class="order-box-footer" style="margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <label style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">Status:</label>
                <select class="admin-status-select filter-select" data-id="${order.id}" style="padding: 6px 12px; font-size: 0.85rem; background: rgba(11,15,25,0.8); border: 1px solid var(--border-color); border-radius: 8px; color: white;">
                  <option value="Tayyorlanmoqda" ${order.status === 'Tayyorlanmoqda' ? 'selected' : ''}>Tayyorlanmoqda</option>
                  <option value="Yo'lda" ${order.status === "Yo'lda" ? 'selected' : ''}>Yo'lda</option>
                  <option value="Yetkazildi" ${order.status === 'Yetkazildi' ? 'selected' : ''}>Yetkazildi</option>
                </select>
              </div>
              <div style="display: flex; align-items: center; gap: 12px;">
                <span class="order-box-total" style="font-size: 1.1rem; color: var(--success);">$${order.total}</span>
                <button class="remove-btn admin-order-delete-btn" data-id="${order.id}" style="font-size: 0.85rem; padding: 4px 8px;">O'chirish</button>
              </div>
            </div>
          </div>
        `
      )
      .join('');

    container.querySelectorAll('.admin-status-select').forEach((select) => {
      select.addEventListener('change', async () => {
        const orderId = Number(select.getAttribute('data-id'));
        const status = select.value;
        try {
          const res = await fetch(`${apiBase}/api/orders/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, status })
          });
          const result = await res.json();
          if (result.success) {
            showToast("Buyurtma statusi yangilandi!");
            loadAdminOrders();
          }
        } catch (e) {
          showToast("Xatolik yuz berdi.", "error");
        }
      });
    });

    container.querySelectorAll('.admin-order-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const orderId = Number(btn.getAttribute('data-id'));
        if (!confirm(`Buyurtma #${orderId} ni o'chirishni xohlaysizmi?`)) return;
        try {
          const res = await fetch(`${apiBase}/api/orders?id=${orderId}`, { method: 'DELETE' });
          const result = await res.json();
          if (result.success) {
            showToast("Buyurtma o'chirildi!", "warning");
            loadAdminOrders();
          }
        } catch (e) {
          showToast("Xatolik yuz berdi.", "error");
        }
      });
    });
  } catch (error) {
    container.innerHTML = `<p style="color: var(--text-muted);">Buyurtmalarni yuklashda xatolik yuz berdi.</p>`;
  }
}

async function loadAdminProducts() {
  const container = document.getElementById('admin-products-list');
  if (!container) return;

  try {
    const response = await fetch(`${apiBase}/api/products`);
    const products = await response.json();

    if (products.length === 0) {
      container.innerHTML = `<p style="color: var(--text-muted);">Hozircha mahsulotlar mavjud emas.</p>`;
      return;
    }

    container.innerHTML = products
      .map(
        (product) => `
          <div class="admin-item-row" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; background: rgba(11, 15, 25, 0.4); border: 1px solid var(--border-color); border-radius: 12px; gap: 16px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="${product.image || 'smartphone.png'}" alt="${product.name}" onerror="this.src='smartphone.png'" style="width: 40px; height: 40px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border-color);" />
              <div style="text-align: left;">
                <strong style="color: white;">${product.name}</strong> 
                <span style="font-size: 0.8rem; color: var(--text-muted); padding: 2px 6px; background: var(--border-color); border-radius: 4px; margin-left: 6px;">${product.category}</span>
                <span style="font-size: 0.8rem; margin-left: 6px;" class="${product.stock <= 3 ? 'stock-low' : 'stock-ok'}">Ombor: ${product.stock} ta</span>
                <div style="font-size: 0.95rem; color: var(--success); font-weight: 700; margin-top: 2px;">$${product.price}</div>
              </div>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <button class="admin-product-edit-btn" data-id="${product.id}" style="font-size:0.82rem; padding:6px 12px; border-radius:8px; border:1px solid var(--primary); background:transparent; color:var(--primary); cursor:pointer; font-weight:600;">Tahrirlash</button>
              <button class="remove-btn admin-product-delete-btn" data-id="${product.id}">O'chirish</button>
            </div>
          </div>
        `
      )
      .join('');

    container.querySelectorAll('.admin-product-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pId = Number(btn.getAttribute('data-id'));
        const product = products.find(p => p.id === pId);
        if (product) openProductEditModal(product);
      });
    });

    container.querySelectorAll('.admin-product-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pId = Number(btn.getAttribute('data-id'));
        if (!confirm("Ushbu mahsulotni sotuvdan butunlay o'chirishni xohlaysizmi?")) return;
        try {
          const res = await fetch(`${apiBase}/api/products?id=${pId}`, { method: 'DELETE' });
          const result = await res.json();
          if (result.success) {
            showToast("Mahsulot sotuvdan o'chirildi!", "warning");
            loadAdminProducts();
            fetchProducts();
          }
        } catch (e) {
          showToast("Xatolik yuz berdi.", "error");
        }
      });
    });
  } catch (error) {
    container.innerHTML = `<p style="color: var(--text-muted);">Mahsulotlarni yuklashda xato yuz berdi.</p>`;
  }
}

async function loadAdminUsers() {
  const container = document.getElementById('admin-users-list');
  if (!container) return;

  try {
    const token = localStorage.getItem('authToken');
    const response = await fetch(`${apiBase}/api/users`, {
      headers: {
        'Authorization': token ? `Bearer ${token}` : ''
      }
    });
    const users = await response.json();

    container.innerHTML = users
      .map(
        (user) => `
          <div class="admin-item-row" style="display: flex; flex-direction: column; padding: 18px; background: rgba(11, 15, 25, 0.4); border: 1px solid var(--border-color); border-radius: 12px; gap: 12px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 10px;">
              <div style="text-align: left;">
                <strong style="color: white; font-size: 1rem;">${user.name}</strong> 
                <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 6px;">(${user.email})</span>
                <span style="display: inline-block; margin-left: 10px; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: bold; background: ${user.role === 'admin' ? 'rgba(239, 68, 68, 0.15)' : user.role === 'seller' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)'}; color: ${user.role === 'admin' ? 'var(--danger)' : user.role === 'seller' ? 'var(--success)' : 'var(--primary)'};">${user.role.toUpperCase()}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <select class="admin-user-role-select filter-select" data-id="${user.id}" style="padding: 6px 12px; font-size: 0.8rem; background: rgba(11,15,25,0.8); color: white; border: 1px solid var(--border-color); border-radius: 8px;">
                  <option value="user" ${user.role === 'user' ? 'selected' : ''}>Mijoz (User)</option>
                  <option value="seller" ${user.role === 'seller' ? 'selected' : ''}>Sotuvchi (Seller)</option>
                  <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin (Manager)</option>
                  <option value="director" ${user.role === 'director' ? 'selected' : ''}>Direktor (Director)</option>
                </select>
                <button class="remove-btn admin-user-delete-btn" data-id="${user.id}" style="font-size: 0.85rem;" ${user.id === 999 ? 'disabled style="color: var(--border-color); cursor: not-allowed;"' : ''}>O'chirish</button>
              </div>
            </div>
            
            ${user.role === 'seller' ? `
              <div style="background: rgba(11, 15, 25, 0.6); padding: 12px; border-radius: 8px; font-size: 0.85rem; border: 1px dashed var(--border-color);">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; color: var(--text-muted);">
                  <div>Passport: <strong style="color: white;">${user.passportNumber || 'Kiritilmagan'}</strong></div>
                  <div>Tug'ilgan sana: <strong style="color: white;">${user.birthDate || 'Kiritilmagan'}</strong></div>
                  <div>Turi: <strong style="color: white;">${user.sellerType ? (user.sellerType === 'jismoniy' ? 'Jismoniy shaxs' : 'Yuridik shaxs') : 'Jismoniy shaxs'}</strong></div>
                  <div>Karta/Hisob: <strong style="color: white;">${user.bankDetails || 'Kiritilmagan'}</strong></div>
                  <div>KYC Holati: <strong style="color: ${user.kycStatus === 'approved' ? 'var(--success)' : user.kycStatus === 'rejected' ? 'var(--danger)' : '#fbbf24'};">${user.kycStatus ? user.kycStatus.toUpperCase() : 'PENDING'}</strong></div>
                  <div>Hujjatlar: 
                    <a href="${apiBase}/api/documents?id=${user.id}&type=passport&token=${token || ''}" target="_blank" style="color: var(--primary); text-decoration: underline;">Pasport nusxasi</a> | 
                    <a href="${apiBase}/api/documents?id=${user.id}&type=selfie&token=${token || ''}" target="_blank" style="color: var(--primary); text-decoration: underline;">Selfi</a>
                  </div>
                  <div>Rad etishlar: <strong style="color: white;">${user.rejectionCount || 0} ta</strong> ${user.rejectionCount >= 3 ? '<strong style="color: var(--danger); font-size:0.75rem;">(⚠️ 3+ marta rad etilgan, Direktor nazoratida!)</strong>' : ''}</div>
                </div>
                
                ${user.kycStatus === 'pending' || !user.kycStatus ? `
                  <div style="display: flex; gap: 10px; margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 10px;">
                    <button class="kyc-approve-btn" data-id="${user.id}" style="background: var(--success); color: white; border: none; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 0.8rem;">Tasdiqlash</button>
                    <button class="kyc-reject-btn" data-id="${user.id}" style="background: var(--danger); color: white; border: none; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 0.8rem;">Rad etish</button>
                  </div>
                ` : ''}
              </div>
            ` : ''}
          </div>
        `
      )
      .join('');

    // Bind User Role Change
    container.querySelectorAll('.admin-user-role-select').forEach(select => {
      select.onchange = async () => {
        const userId = Number(select.getAttribute('data-id'));
        const role = select.value;
        try {
          const res = await fetch(`${apiBase}/api/users/role`, {
            method: 'PUT',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({ userId, role })
          });
          const result = await res.json();
          if (result.success) {
            showToast("Foydalanuvchi roli o'zgartirildi!");
            loadAdminUsers();
          }
        } catch (e) {
          showToast("Xatolik yuz berdi.", "error");
        }
      };
    });

    // Bind KYC Approvals
    container.querySelectorAll('.kyc-approve-btn').forEach(btn => {
      btn.onclick = async () => {
        const userId = Number(btn.getAttribute('data-id'));
        if (!confirm("Sotuvchi arizasini tasdiqlashni xohlaysizmi?")) return;
        try {
          const res = await fetch(`${apiBase}/api/users/kyc`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({ userId, status: 'approved' })
          });
          const result = await res.json();
          if (res.status === 200) {
            showToast("Sotuvchi arizasi tasdiqlandi!");
            loadAdminUsers();
          } else {
            showToast(result.message, "error");
          }
        } catch (e) {
          showToast("Tasdiqlashda xatolik yuz berdi.", "error");
        }
      };
    });

    // Bind KYC Rejections
    container.querySelectorAll('.kyc-reject-btn').forEach(btn => {
      btn.onclick = async () => {
        const userId = Number(btn.getAttribute('data-id'));
        const reason = prompt("Rad etish sababini kiriting:");
        if (reason === null) return;
        if (!reason.trim()) {
          showToast("Rad etish sababi majburiy!", "error");
          return;
        }
        try {
          const res = await fetch(`${apiBase}/api/users/kyc`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({ userId, status: 'rejected', reason })
          });
          const result = await res.json();
          if (res.status === 200) {
            showToast("Sotuvchi arizasi rad etildi.");
            loadAdminUsers();
          } else {
            showToast(result.message, "error");
          }
        } catch (e) {
          showToast("Rad etishda xatolik yuz berdi.", "error");
        }
      };
    });

    // Bind User Deletion
    container.querySelectorAll('.admin-user-delete-btn').forEach(btn => {
      btn.onclick = async () => {
        const id = Number(btn.getAttribute('data-id'));
        if (id === 999) return;
        if (!confirm("Foydalanuvchini o'chirishni xohlaysizmi?")) return;
        try {
          const res = await fetch(`${apiBase}/api/users?id=${id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': token ? `Bearer ${token}` : ''
            }
          });
          const result = await res.json();
          if (result.success) {
            showToast("Foydalanuvchi tizimdan o'chirildi.", "warning");
            loadAdminUsers();
          }
        } catch (e) {
          showToast("Xatolik yuz berdi.", "error");
        }
      };
    });
  } catch (error) {
    container.innerHTML = `<p style="color: var(--text-muted);">Mijozlarni yuklashda xatolik yuz berdi.</p>`;
  }
}

// 11. Admin Product Adding Form submit
const adminProductForm = document.getElementById('admin-product-form');
const adminProductMessage = document.getElementById('admin-product-message');

if (adminProductForm) {
  adminProductForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = document.getElementById('admin-product-name').value;
    const price = Number(document.getElementById('admin-product-price').value);
    const cost = Number(document.getElementById('admin-product-cost').value);
    const originalPrice = Number(document.getElementById('admin-product-original-price').value) || null;
    const stock = Number(document.getElementById('admin-product-stock').value);
    const category = document.getElementById('admin-product-category').value;
    const image = document.getElementById('admin-product-image').value;
    const description = document.getElementById('admin-product-description').value;

    try {
      const response = await fetch(`${apiBase}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, price, cost, stock, category, originalPrice, image, description })
      });

      const result = await response.json();

      if (response.status === 201 && result.product) {
        showToast("Yangi mahsulot muvaffaqiyatli qo'shildi!");
        adminProductForm.reset();
        document.getElementById('admin-product-image').value = "smartphone.png";
        loadAdminProducts();
        fetchProducts();
      } else {
        adminProductMessage.textContent = result.message;
        adminProductMessage.className = 'message error';
        showToast(result.message, 'error');
      }
    } catch (e) {
      showToast("Mahsulot qo'shishda xato yuz berdi.", "error");
    }
  });
}

// 12. Authentication Switch Tabs Logic
function setupAuthTabs() {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const tabTelegram = document.getElementById('tab-telegram');
  const loginSection = document.getElementById('login-section');
  const registerSection = document.getElementById('register-section');
  const telegramSection = document.getElementById('telegram-section');
  const goToRegister = document.getElementById('go-to-register');
  const goToLogin = document.getElementById('go-to-login');

  if (!tabLogin || !tabRegister || !loginSection || !registerSection) return;

  const showLogin = () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    if (tabTelegram) tabTelegram.classList.remove('active');
    loginSection.style.display = 'block';
    registerSection.style.display = 'none';
    if (telegramSection) telegramSection.style.display = 'none';
    resetRegisterForms();
  };

  const showRegister = () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    if (tabTelegram) tabTelegram.classList.remove('active');
    registerSection.style.display = 'block';
    loginSection.style.display = 'none';
    if (telegramSection) telegramSection.style.display = 'none';
    resetRegisterForms();
  };

  const showTelegram = () => {
    if (tabTelegram) {
      tabTelegram.classList.add('active');
      tabLogin.classList.remove('active');
      tabRegister.classList.remove('active');
    }
    if (telegramSection) telegramSection.style.display = 'block';
    loginSection.style.display = 'none';
    registerSection.style.display = 'none';
    resetRegisterForms();
  };

  tabLogin.onclick = showLogin;
  tabRegister.onclick = showRegister;
  if (tabTelegram) tabTelegram.onclick = showTelegram;

  if (goToRegister) {
    goToRegister.onclick = (e) => {
      e.preventDefault();
      showRegister();
    };
  }

  if (goToLogin) {
    goToLogin.onclick = (e) => {
      e.preventDefault();
      showLogin();
    };
  }
}

// 13. Login & Register Forms submit
const registerFormStep1 = document.getElementById('register-form-step-1');
const registerFormStep2 = document.getElementById('register-form-step-2');
const loginForm = document.getElementById('login-form');
const registerMessage = document.getElementById('register-message');
const loginMessage = document.getElementById('login-message');

function resetRegisterForms() {
  const step1 = document.getElementById('register-form-step-1');
  const step2 = document.getElementById('register-form-step-2');
  if (step1) step1.style.display = 'block';
  if (step2) step2.style.display = 'none';
  if (registerMessage) {
    registerMessage.textContent = '';
    registerMessage.className = 'message';
  }
  const tgMessage = document.getElementById('telegram-message');
  if (tgMessage) {
    tgMessage.textContent = '';
    tgMessage.className = 'message';
  }
  const tgPhone = document.getElementById('telegram-phone');
  if (tgPhone) tgPhone.value = '';
}

let pendingRegistration = null;
let otpTimerInterval = null;

function startOtpTimer() {
  const timerLabel = document.getElementById('otp-timer-label');
  const timerCount = document.getElementById('otp-timer-count');
  const btnResend = document.getElementById('btn-otp-resend');

  if (!timerLabel || !timerCount || !btnResend) return;

  btnResend.style.display = 'none';
  timerLabel.style.display = 'inline-block';
  
  let timeLeft = 60;
  timerCount.textContent = timeLeft;

  clearInterval(otpTimerInterval);
  otpTimerInterval = setInterval(() => {
    timeLeft -= 1;
    timerCount.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(otpTimerInterval);
      timerLabel.style.display = 'none';
      btnResend.style.display = 'inline-block';
    }
  }, 1000);
}

const otpModal = document.getElementById('otp-verification-modal');
const closeOtpModalBtn = document.getElementById('close-otp-modal');
if (closeOtpModalBtn && otpModal) {
  closeOtpModalBtn.onclick = () => {
    otpModal.classList.remove('active');
    clearInterval(otpTimerInterval);
  };
}

const registerPhone = document.getElementById('register-phone');
if (registerPhone) {
  registerPhone.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 0 && !val.startsWith('998')) {
      val = '998' + val;
    }
    val = val.substring(0, 12);
    
    let formatted = '+';
    if (val.length > 0) formatted += val.substring(0, 3);
    if (val.length > 3) formatted += ' ' + val.substring(3, 5);
    if (val.length > 5) formatted += ' ' + val.substring(5, 8);
    if (val.length > 8) formatted += ' ' + val.substring(8, 10);
    if (val.length > 10) formatted += ' ' + val.substring(10, 12);
    
    e.target.value = formatted;
  });
}

const isSellerCheckbox = document.getElementById('register-is-seller');
const kycFieldsContainer = document.getElementById('kyc-fields-container');
if (isSellerCheckbox && kycFieldsContainer) {
  isSellerCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      kycFieldsContainer.style.display = 'block';
      document.getElementById('kyc-passport').required = true;
      document.getElementById('kyc-birthdate').required = true;
      document.getElementById('kyc-passport-photo').required = true;
      document.getElementById('kyc-selfie-photo').required = true;
    } else {
      kycFieldsContainer.style.display = 'none';
      document.getElementById('kyc-passport').required = false;
      document.getElementById('kyc-birthdate').required = false;
      document.getElementById('kyc-passport-photo').required = false;
      document.getElementById('kyc-selfie-photo').required = false;
    }
  });
}

const telegramAuthForm = document.getElementById('telegram-auth-form');
const telegramMessage = document.getElementById('telegram-message');

if (telegramAuthForm) {
  telegramAuthForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('telegram-phone').value.trim();
    if (!isValidPhone(phone)) {
      telegramMessage.textContent = 'Telefon raqamingizni +998XXYYYYYYY formatida kiriting.';
      telegramMessage.className = 'message error';
      return;
    }

    telegramMessage.textContent = 'Yo\'naltirilmoqda...';
    telegramMessage.className = 'message info';

    try {
      const res = await fetch(`${apiBase}/api/auth/telegram-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        telegramMessage.textContent = 'Muvaffaqiyatli! Telegram bot ochilmoqda...';
        telegramMessage.className = 'message success';

        // Check if there is a local Telegram simulator modal
        const simModal = document.getElementById('telegram-sim-modal');
        if (simModal) {
          simModal.classList.add('active');
          const simInput = document.getElementById('tg-sim-input');
          if (simInput) {
            simInput.value = `/start ${data.token}`;
          }
        }

        // Open real Telegram link
        try {
          window.open(data.link, '_blank');
        } catch (err) {
          console.log("Deep link redirect prevented.");
        }
      } else {
        telegramMessage.textContent = data.message || 'Xatolik yuz berdi';
        telegramMessage.className = 'message error';
      }
    } catch (err) {
      telegramMessage.textContent = 'Server bilan ulanishda xato.';
      telegramMessage.className = 'message error';
    }
  });
}

  if (registerFormStep1) {
    registerFormStep1.addEventListener('submit', async (event) => {
      event.preventDefault();

      const phone = document.getElementById('register-phone').value.trim();
      const isSeller = document.getElementById('register-is-seller') ? document.getElementById('register-is-seller').checked : false;

      if (!isValidPhone(phone)) {
        registerMessage.textContent = 'Telefon raqamingizni +998XXYYYYYYY formatida kiriting.';
        registerMessage.className = 'message error';
        return;
      }

      const normalizedPhone = normalizePhone(phone);

      if (isSeller) {
        const passportNumberRaw = document.getElementById('kyc-passport').value.trim();
        const birthDate = document.getElementById('kyc-birthdate').value;
        const typeRadio = document.querySelector('input[name="kyc-seller-type"]:checked');
        const sellerType = typeRadio ? typeRadio.value : 'jismoniy';
        const passportPhotoInput = document.getElementById('kyc-passport-photo');
        const selfiePhotoInput = document.getElementById('kyc-selfie-photo');
        const passportPhotoFile = passportPhotoInput ? passportPhotoInput.files[0] : null;
        const selfieFile = selfiePhotoInput ? selfiePhotoInput.files[0] : null;
        const passportNumber = passportNumberRaw.toUpperCase();

        if (!passportNumber || !isValidPassport(passportNumber)) {
          registerMessage.textContent = 'Pasport seriya va raqamingizni AA1234567 formatida kiriting.';
          registerMessage.className = 'message error';
          return;
        }

        if (!isValidBirthDate(birthDate)) {
          registerMessage.textContent = 'Yaroqli tug’ilgan sana kiriting (18 yoshdan katta bo‘lishi kerak).';
          registerMessage.className = 'message error';
          return;
        }

        if (!passportPhotoFile || !selfieFile) {
          registerMessage.textContent = 'Iltimos passport va selfi fotosuratlarini yuklang.';
          registerMessage.className = 'message error';
          return;
        }

        pendingRegistration = {
          phone: normalizedPhone,
          role: 'seller',
          kycStatus: 'pending',
          rejectionReason: '',
          rejectionCount: 0,
          passportNumber,
          birthDate,
          sellerType,
          passportPhotoFile: await fileToDataUrl(passportPhotoFile),
          passportPhotoFileName: passportPhotoFile.name,
          selfieFile: await fileToDataUrl(selfieFile),
          selfieFileName: selfieFile.name
        };
      } else {
        pendingRegistration = {
          phone: normalizedPhone,
          role: 'user'
        };
      }

      const otpMessage = document.getElementById('otp-message');
      if (otpMessage) {
        otpMessage.textContent = '';
        otpMessage.className = 'message';
      }

      try {
        const response = await fetch(`${apiBase}/api/sms/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone })
        });

        const result = await response.json();

        if (response.status === 200) {
          showToast("Tasdiqlash kodi yuborildi!");
          
          document.getElementById('otp-phone-text').textContent = `Biz sizning ${phone} telefon raqamingizga tasdiqlash kodini yubordik.`;
          if (result.code) {
            document.getElementById('otp-dev-code').textContent = result.code;
            document.getElementById('otp-dev-code-box').style.display = 'block';
          }
          
          otpModal.classList.add('active');
          startOtpTimer();
        } else {
          registerMessage.textContent = result.message;
          registerMessage.className = 'message error';
          showToast(result.message, 'error');
        }
      } catch (e) {
        showToast("So'rov yuborishda xato yuz berdi.", "error");
      }
    });
  }

  if (registerFormStep2) {
    registerFormStep2.addEventListener('submit', async (event) => {
      event.preventDefault();

      const name = document.getElementById('register-name').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;

      if (!name) {
        registerMessage.textContent = 'Ismingizni kiriting.';
        registerMessage.className = 'message error';
        return;
      }

      if (!isValidEmail(email)) {
        registerMessage.textContent = 'To‘g‘ri email manzil kiriting.';
        registerMessage.className = 'message error';
        return;
      }

      if (!password || password.length < 8) {
        registerMessage.textContent = 'Parol kamida 8 ta belgidan iborat bo‘lishi kerak.';
        registerMessage.className = 'message error';
        return;
      }

      if (!pendingRegistration) {
        showToast("Xatolik: Ro'yxatdan o'tish ma'lumotlari topilmadi.", "error");
        resetRegisterForms();
        return;
      }

      pendingRegistration.name = name;
      pendingRegistration.email = email;
      pendingRegistration.password = password;

      try {
        const regResponse = await fetch(`${apiBase}/api/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pendingRegistration)
        });

        const regResult = await regResponse.json();

        if (regResponse.status === 201 && regResult.user) {
          showToast("Akaunt muvaffaqiyatli yaratildi!");
          localStorage.setItem('currentUser', JSON.stringify(regResult.user));
          if (regResult.token) localStorage.setItem('authToken', regResult.token);
          
          resetRegisterForms();
          document.getElementById('register-form-step-1').reset();
          document.getElementById('register-form-step-2').reset();
          
          loadCurrentUser();
          loadDashboard();
        } else {
          registerMessage.textContent = regResult.message;
          registerMessage.className = 'message error';
          showToast(regResult.message, 'error');
        }
      } catch (e) {
        showToast("Ro'yxatdan o'tishda xatolik yuz berdi.", "error");
      }
    });
  }

  const otpForm = document.getElementById('otp-verification-form');
  if (otpForm) {
    otpForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = document.getElementById('otp-input-code').value;
      const otpMessage = document.getElementById('otp-message');

      if (!pendingRegistration) return;

      try {
        const response = await fetch(`${apiBase}/api/sms/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: pendingRegistration.phone.replace(/[^0-9]/g, ''), code })
        });

        const result = await response.json();

        if (response.status === 200) {
          showToast("Telefon raqamingiz tasdiqlandi!");
          otpModal.classList.remove('active');
          clearInterval(otpTimerInterval);
          
          // Switch to Step 2
          document.getElementById('register-form-step-1').style.display = 'none';
          document.getElementById('register-form-step-2').style.display = 'block';
          
          registerMessage.textContent = "Telefon tasdiqlandi. Endi qolgan ma'lumotlarni kiriting.";
          registerMessage.className = 'message success';
        } else {
          otpMessage.textContent = result.message;
          otpMessage.className = 'message error';
        }
      } catch (e) {
        showToast("Xatolik yuz berdi.", "error");
      }
    });
  }

const btnOtpResend = document.getElementById('btn-otp-resend');
if (btnOtpResend) {
  btnOtpResend.addEventListener('click', async () => {
    if (!pendingRegistration) return;
    const otpMessage = document.getElementById('otp-message');
    if (otpMessage) {
      otpMessage.textContent = '';
    }
    try {
      const response = await fetch(`${apiBase}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: pendingRegistration.phone.replace(/[^0-9]/g, ''), email: pendingRegistration.email })
      });
      const result = await response.json();
      if (response.status === 200) {
        showToast("Kod qayta yuborildi!");
        if (result.code) {
          document.getElementById('otp-dev-code').textContent = result.code;
        }
        startOtpTimer();
      } else {
        if (otpMessage) {
          otpMessage.textContent = result.message;
          otpMessage.className = 'message error';
        }
        showToast(result.message, 'error');
      }
    } catch (e) {
      showToast("Kodni qayta yuborishda xato yuz berdi.", "error");
    }
  });
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
      const response = await fetch(`${apiBase}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const result = await response.json();

      if (response.status === 200 && result.user) {
        showToast("Xush kelibsiz!");
        localStorage.setItem('currentUser', JSON.stringify(result.user));
        if (result.token) localStorage.setItem('authToken', result.token);
        loadCurrentUser();
        loadDashboard();
      } else {
        loginMessage.textContent = result.message;
        loginMessage.className = 'message error';
        showToast(result.message, 'error');
      }
    } catch (e) {
      showToast("So'rov yuborishda xato yuz berdi.", "error");
    }
  });
}

// 14. Forgot Password Logic
const forgotPasswordLink = document.getElementById('forgot-password-link');
const backToLoginLink = document.getElementById('back-to-login');
const forgotPasswordSection = document.getElementById('forgot-password-section');
const loginSectionEl = document.getElementById('login-section');
const authTabs = document.querySelector('.auth-tabs');
const forgotForm = document.getElementById('forgot-password-form');
const resetForm = document.getElementById('reset-password-form');
const forgotMessage = document.getElementById('forgot-message');

if (forgotPasswordLink && forgotPasswordSection && loginSectionEl) {
  forgotPasswordLink.addEventListener('click', (e) => {
    e.preventDefault();
    loginSectionEl.style.display = 'none';
    if(authTabs) authTabs.style.display = 'none';
    forgotPasswordSection.style.display = 'block';
  });

  backToLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    forgotPasswordSection.style.display = 'none';
    if(authTabs) authTabs.style.display = 'flex';
    loginSectionEl.style.display = 'block';
  });

  let resetEmail = '';

  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    resetEmail = document.getElementById('forgot-email').value;
    try {
      const res = await fetch(`${apiBase}/api/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message);
        if (data.demoCode) alert(`DEMO MAXFIY KOD: Sizning tasdiqlash kodingiz - ${data.demoCode}`);
        forgotForm.style.display = 'none';
        resetForm.style.display = 'block';
        forgotMessage.textContent = '';
      } else {
        forgotMessage.textContent = data.message;
        forgotMessage.className = 'message error';
      }
    } catch(err) {
      showToast("So'rov yuborishda xato yuz berdi.", "error");
    }
  });

  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('reset-code').value;
    const newPassword = document.getElementById('reset-new-password').value;
    try {
      const res = await fetch(`${apiBase}/api/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, code, newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Parolingiz muvaffaqiyatli yangilandi!");
        forgotPasswordSection.style.display = 'none';
        if(authTabs) authTabs.style.display = 'flex';
        loginSectionEl.style.display = 'block';
        resetForm.reset();
        forgotForm.reset();
        forgotForm.style.display = 'block';
        resetForm.style.display = 'none';
      } else {
        forgotMessage.textContent = data.message;
        forgotMessage.className = 'message error';
      }
    } catch(err) {
      showToast("So'rov yuborishda xato yuz berdi.", "error");
    }
  });
}

// 15. Profile Edit Logic
const profileEditModal = document.getElementById('profile-edit-modal');
const closeProfileModalBtn = document.getElementById('close-profile-modal');
const profileEditForm = document.getElementById('profile-edit-form');
const userEditProfileBtn = document.getElementById('user-edit-profile-btn');
const sellerEditProfileBtn = document.getElementById('seller-edit-profile-btn');

function openProfileModal() {
  const user = loadCurrentUser();
  if (!user) return;
  document.getElementById('edit-profile-name').value = user.name || '';
  document.getElementById('edit-profile-email').value = user.email || '';
  document.getElementById('edit-profile-phone').value = user.phone || '';
  document.getElementById('edit-profile-avatar').value = user.avatar || '';
  const bankEl = document.getElementById('edit-profile-bank');
  if (bankEl) bankEl.value = user.bankDetails || '';
  const addrEl = document.getElementById('edit-profile-addresses');
  if (addrEl) addrEl.value = (user.addresses || []).join('\n');
  if(profileEditModal) profileEditModal.classList.add('active');
}

if (userEditProfileBtn) userEditProfileBtn.onclick = openProfileModal;
if (sellerEditProfileBtn) sellerEditProfileBtn.onclick = openProfileModal;
const adminEditProfileBtn = document.getElementById('admin-edit-profile-btn');
if (adminEditProfileBtn) adminEditProfileBtn.onclick = openProfileModal;
if (closeProfileModalBtn) {
  closeProfileModalBtn.onclick = () => { profileEditModal.classList.remove('active'); };
}

function showProfileOtpModal(callback) {
  const existing = document.getElementById('profile-otp-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'profile-otp-modal';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 99999;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    backdrop-filter: blur(5px);
  `;
  
  modal.innerHTML = `
    <div style="background: #111827; border: 1px solid #374151; padding: 30px; border-radius: 20px; width: 100%; max-width: 400px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); text-align: center; font-family: inherit;">
      <div style="font-size: 2.5rem; margin-bottom: 12px;">🛡️</div>
      <h3 style="color: white; margin-bottom: 8px; font-size: 1.25rem;">Karta raqamini tasdiqlash</h3>
      <p style="font-size: 0.88rem; color: #9ca3af; margin-bottom: 20px; line-height: 1.4;">
        Xavfsizlik maqsadida telefoningizga yuborilgan 6 xonali tasdiqlash kodini kiriting.
      </p>
      <input type="text" id="profile-otp-input" placeholder="000000" maxlength="6" style="
        width: 100%; padding: 12px; border-radius: 10px; border: 1px solid #374151;
        background: #1f2937; color: white; font-size: 1.5rem; text-align: center;
        letter-spacing: 6px; font-weight: bold; margin-bottom: 20px; outline: none;
      "/>
      <div id="profile-otp-error" style="display: none; color: #ef4444; font-size: 0.8rem; margin-bottom: 12px; padding: 8px 12px; background: #fef2f2; border-radius: 8px; text-align: left; border: 1px solid #fecaca;"></div>
      <button id="profile-otp-submit-btn" style="
        width: 100%; padding: 12px; border-radius: 10px; border: none;
        background: var(--primary, #6366f1); color: white; font-size: 1rem; font-weight: bold;
        cursor: pointer; transition: opacity 0.2s; margin-bottom: 10px;
      ">Tasdiqlash</button>
      <button id="profile-otp-cancel-btn" style="
        width: 100%; padding: 10px; border-radius: 10px; border: 1px solid #374151;
        background: transparent; color: #9ca3af; font-size: 0.9rem; cursor: pointer;
      ">Bekor qilish</button>
    </div>
  `;

  document.body.appendChild(modal);

  const input = document.getElementById('profile-otp-input');
  input.focus();

  document.getElementById('profile-otp-cancel-btn').onclick = () => {
    modal.remove();
  };

  document.getElementById('profile-otp-submit-btn').onclick = () => {
    const code = input.value.trim();
    if (code.length !== 6 || isNaN(code)) {
      const err = document.getElementById('profile-otp-error');
      err.textContent = "Iltimos 6 xonali raqamli kod kiriting!";
      err.style.display = 'block';
      return;
    }
    callback(code, modal);
  };
}

if (profileEditForm) {
  profileEditForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('edit-profile-name').value;
    const email = document.getElementById('edit-profile-email').value;
    const phone = document.getElementById('edit-profile-phone').value;
    const avatar = document.getElementById('edit-profile-avatar').value;
    const bankEl = document.getElementById('edit-profile-bank');
    const bankDetails = bankEl ? bankEl.value.trim() : '';
    const passwordEl = document.getElementById('edit-profile-password');
    const password = passwordEl ? passwordEl.value : '';
    
    // Validate bank account / card format (16 or 20 digits only)
    const cleanedBank = bankDetails.replace(/\s/g, '');
    if (cleanedBank && !/^\d{16}$|^\d{20}$/.test(cleanedBank)) {
      showToast("Karta raqami (16 xona) yoki bank hisob raqami (20 xona) noto'g'ri!", "error");
      return;
    }

    const addrEl = document.getElementById('edit-profile-addresses');
    const addresses = addrEl ? addrEl.value.split('\n').map(a => a.trim()).filter(Boolean) : [];

    try {
      const sendProfileUpdate = async (otpCode = null) => {
        const payload = { name, email, phone, avatar, addresses, bankDetails };
        if (password && password.trim().length >= 8) {
          payload.password = password;
        }
        if (otpCode) {
          payload.otpCode = otpCode;
        }

        const res = await fetch(`${apiBase}/api/users/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        
        if (res.ok) {
          if (data.otpRequired) {
            showProfileOtpModal(async (code, modalInstance) => {
              const submitBtn = document.getElementById('profile-otp-submit-btn');
              submitBtn.textContent = '⏳ Tekshirilmoqda...';
              submitBtn.disabled = true;
              
              try {
                const innerPayload = { name, email, phone, avatar, addresses, bankDetails, otpCode: code };
                const innerRes = await fetch(`${apiBase}/api/users/profile`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(innerPayload)
                });
                const innerData = await innerRes.json();
                
                if (innerRes.ok) {
                  showToast(innerData.message);
                  localStorage.setItem('currentUser', JSON.stringify(innerData.user));
                  if (innerData.token) localStorage.setItem('authToken', innerData.token);
                  modalInstance.remove();
                  profileEditModal.classList.remove('active');
                  loadCurrentUser();
                  loadDashboard();
                } else {
                  const errEl = document.getElementById('profile-otp-error');
                  errEl.textContent = innerData.message;
                  errEl.style.display = 'block';
                  submitBtn.textContent = 'Tasdiqlash';
                  submitBtn.disabled = false;
                }
              } catch (err) {
                const errEl = document.getElementById('profile-otp-error');
                errEl.textContent = "Tarmoq xatosi yuz berdi.";
                errEl.style.display = 'block';
                submitBtn.textContent = 'Tasdiqlash';
                submitBtn.disabled = false;
              }
            });
          } else {
            showToast(data.message);
            if (passwordEl) passwordEl.value = '';
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            if (data.token) localStorage.setItem('authToken', data.token);
            profileEditModal.classList.remove('active');
            loadCurrentUser();
            loadDashboard();
          }
        } else {
          showToast(data.message, 'error');
        }
      };

      await sendProfileUpdate();
    } catch(err) {
      showToast("Xatolik yuz berdi", "error");
    }
  });
}

// 15b. Delete Account Logic
const deleteAccountBtn = document.getElementById('delete-account-btn');
if (deleteAccountBtn) {
  deleteAccountBtn.onclick = async () => {
    const user = loadCurrentUser();
    if (!user) return;
    const confirmed = confirm(`Diqqat! "${user.name}" akkauntini butunlay o'chirishni xohlaysizmi? Bu amalni qaytarib bo'lmaydi.`);
    if (!confirmed) return;
    try {
      const res = await fetch(`${apiBase}/api/users?id=${user.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showToast("Akkaunt muvaffaqiyatli o'chirildi.", "warning");
        localStorage.removeItem('currentUser');
        localStorage.removeItem('authToken');
        if(profileEditModal) profileEditModal.style.display = 'none';
        loadCurrentUser();
        loadDashboard();
      } else {
        showToast(data.message || "O'chirib bo'lmadi.", "error");
      }
    } catch(err) {
      showToast("Xatolik yuz berdi.", "error");
    }
  };
}

// 16. Product Edit Modal
function openProductEditModal(product) {
  // Remove any existing edit modal
  const existing = document.getElementById('product-edit-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'product-edit-modal';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 9999;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    backdrop-filter: blur(6px);
  `;

  modal.innerHTML = `
    <div style="background: var(--surface); border: 1px solid var(--border-color); border-radius: 20px;
        padding: 32px; width: 100%; max-width: 520px; box-shadow: 0 30px 60px rgba(0,0,0,0.6);
        max-height: 90vh; overflow-y: auto;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
        <h3 style="margin:0; font-size:1.3rem; color:white;">✏️ Mahsulotni tahrirlash</h3>
        <button id="close-edit-modal" style="background:transparent; border:none; color:var(--text-muted); font-size:1.5rem; cursor:pointer; line-height:1;">×</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:14px;">
        <div>
          <label style="font-size:0.82rem; color:var(--text-muted); display:block; margin-bottom:4px;">Mahsulot nomi</label>
          <input id="edit-prod-name" type="text" value="${product.name}" style="width:100%; padding:10px 14px; border-radius:10px; border:1px solid var(--border-color); background:rgba(11,15,25,0.8); color:white; box-sizing:border-box; font-size:0.95rem;">
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:0.82rem; color:var(--text-muted); display:block; margin-bottom:4px;">Sotish narxi ($)</label>
            <input id="edit-prod-price" type="number" value="${product.price}" min="0" step="0.01" style="width:100%; padding:10px 14px; border-radius:10px; border:1px solid var(--border-color); background:rgba(11,15,25,0.8); color:white; box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:0.82rem; color:var(--text-muted); display:block; margin-bottom:4px;">Tan narxi ($)</label>
            <input id="edit-prod-cost" type="number" value="${product.cost || 0}" min="0" step="0.01" style="width:100%; padding:10px 14px; border-radius:10px; border:1px solid var(--border-color); background:rgba(11,15,25,0.8); color:white; box-sizing:border-box;">
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:0.82rem; color:var(--text-muted); display:block; margin-bottom:4px;">Ombor (dona)</label>
            <input id="edit-prod-stock" type="number" value="${product.stock}" min="0" style="width:100%; padding:10px 14px; border-radius:10px; border:1px solid var(--border-color); background:rgba(11,15,25,0.8); color:white; box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:0.82rem; color:var(--text-muted); display:block; margin-bottom:4px;">Eski narx ($, ixtiyoriy)</label>
            <input id="edit-prod-original" type="number" value="${product.originalPrice || ''}" min="0" step="0.01" placeholder="0" style="width:100%; padding:10px 14px; border-radius:10px; border:1px solid var(--border-color); background:rgba(11,15,25,0.8); color:white; box-sizing:border-box;">
          </div>
        </div>
        <div>
          <label style="font-size:0.82rem; color:var(--text-muted); display:block; margin-bottom:4px;">Kategoriya</label>
          <select id="edit-prod-category" style="width:100%; padding:10px 14px; border-radius:10px; border:1px solid var(--border-color); background:rgba(11,15,25,0.8); color:white; box-sizing:border-box;">
            ${['Smartfonlar','Audio','Planshetlar','Aksessuarlar','Kiyimlar','Elektronika','Uy-joy','Sport','Go\'zallik','Oziq-ovqat'].map(c =>
              `<option value="${c}" ${product.category === c ? 'selected' : ''}>${c}</option>`
            ).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.82rem; color:var(--text-muted); display:block; margin-bottom:4px;">Rasm URL</label>
          <input id="edit-prod-image" type="text" value="${product.image || ''}" placeholder="https://..." style="width:100%; padding:10px 14px; border-radius:10px; border:1px solid var(--border-color); background:rgba(11,15,25,0.8); color:white; box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:0.82rem; color:var(--text-muted); display:block; margin-bottom:4px;">Tavsif</label>
          <textarea id="edit-prod-desc" rows="3" style="width:100%; padding:10px 14px; border-radius:10px; border:1px solid var(--border-color); background:rgba(11,15,25,0.8); color:white; box-sizing:border-box; resize:vertical; font-family:inherit;">${product.description || ''}</textarea>
        </div>
        <div id="edit-prod-error" style="color:var(--danger); font-size:0.85rem; display:none;"></div>
        <button id="save-edit-product-btn" style="
          width:100%; padding:14px; border-radius:12px; border:none;
          background: linear-gradient(135deg, var(--primary), var(--primary-dark));
          color:white; font-size:1rem; font-weight:700; cursor:pointer; margin-top:6px;
          transition: opacity 0.2s;
        ">💾 Saqlash</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('close-edit-modal').onclick = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  document.getElementById('save-edit-product-btn').onclick = async () => {
    const errEl = document.getElementById('edit-prod-error');
    errEl.style.display = 'none';

    const name = document.getElementById('edit-prod-name').value.trim();
    const price = parseFloat(document.getElementById('edit-prod-price').value);
    const cost = parseFloat(document.getElementById('edit-prod-cost').value) || 0;
    const stock = parseInt(document.getElementById('edit-prod-stock').value) || 0;
    const category = document.getElementById('edit-prod-category').value;
    const image = document.getElementById('edit-prod-image').value.trim();
    const description = document.getElementById('edit-prod-desc').value.trim();
    const originalPriceVal = document.getElementById('edit-prod-original').value;
    const originalPrice = originalPriceVal ? parseFloat(originalPriceVal) : null;

    if (!name || isNaN(price) || price < 0) {
      errEl.textContent = "Mahsulot nomi va narxi to'g'ri to'ldirilishi kerak.";
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('save-edit-product-btn');
    btn.textContent = 'Saqlanmoqda...';
    btn.disabled = true;

    try {
      const res = await fetch(`${apiBase}/api/products`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id, name, price, cost, stock, category, image, description, originalPrice })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Mahsulot muvaffaqiyatli yangilandi!', 'success');
        modal.remove();
        // Reload both seller and admin product lists
        if (typeof loadSellerProducts === 'function') loadSellerProducts();
        if (typeof loadAdminProducts === 'function') loadAdminProducts();
        if (typeof fetchProducts === 'function') fetchProducts();
      } else {
        errEl.textContent = data.message || "Saqlashda xatolik.";
        errEl.style.display = 'block';
        btn.textContent = '💾 Saqlash';
        btn.disabled = false;
      }
    } catch(e) {
      errEl.textContent = "Server bilan bog'lanishda xatolik.";
      errEl.style.display = 'block';
      btn.textContent = '💾 Saqlash';
      btn.disabled = false;
    }
  };
}

// 17. CSV Export for Admin Financials
function exportFinancialsCSV() {
  const rows = document.querySelectorAll('#fin-orders-table tr');
  if (!rows || rows.length === 0) {
    showToast("Eksport qilish uchun ma'lumot yo'q.", "warning");
    return;
  }
  const headers = ['Buyurtma ID', 'Xaridor', 'Sana', 'Daromad ($)', 'Xarajat ($)', "Foyda ($)"];
  const csvLines = [headers.join(',')];

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 6) {
      const line = Array.from(cells).map(td => `"${td.textContent.trim().replace(/"/g, '""')}"`).join(',');
      csvLines.push(line);
    }
  });

  const csvContent = '\uFEFF' + csvLines.join('\n'); // BOM for Excel UTF-8
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `SmartShop_moliya_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("CSV fayl yuklab olindi!", "success");
}

// 16. Initialization
async function checkTelegramAuth() {
  const urlParams = new URLSearchParams(window.location.search);
  const tgToken = urlParams.get('tgToken');
  if (tgToken) {
    try {
      const res = await fetch(`${apiBase}/api/telegram/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tgToken })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message || "Tizimga kirildi!");
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        localStorage.setItem('authToken', data.token);
        
        // Clean URL parameter
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        
        loadCurrentUser();
        loadDashboard();
      } else {
        showToast(data.message || "Kirishda xatolik yuz berdi", "error");
      }
    } catch (e) {
      showToast("Telegram orqali avtorizatsiyada xatolik", "error");
    }
  }
}

// Bind Telegram Simulator actions
const closeTgSimModalBtn = document.getElementById('close-tg-sim-modal');
const tgSimSendBtn = document.getElementById('tg-sim-send-btn');
const tgSimInput = document.getElementById('tg-sim-input');
const tgSimChatArea = document.getElementById('tg-sim-chat-area');

if (closeTgSimModalBtn) {
  closeTgSimModalBtn.onclick = () => {
    document.getElementById('telegram-sim-modal').classList.remove('active');
  };
}

if (tgSimSendBtn && tgSimInput && tgSimChatArea) {
  const sendSimMessage = async () => {
    const text = tgSimInput.value.trim();
    if (!text) return;
    
    // Add user message bubble
    const userBubble = document.createElement('div');
    userBubble.style.cssText = `
      align-self: flex-end; background: #2b5278; color: white; font-size: 0.88rem;
      padding: 10px 14px; border-radius: 12px 12px 0px 12px; max-width: 80%;
      line-height: 1.4; border: 1px solid rgba(255,255,255,0.03); margin-top: 10px;
    `;
    userBubble.textContent = text;
    tgSimChatArea.appendChild(userBubble);
    tgSimInput.value = '';
    tgSimChatArea.scrollTop = tgSimChatArea.scrollHeight;
    
    try {
      const res = await fetch(`${apiBase}/api/telegram/mock-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, username: 'test_user' })
      });
      const data = await res.json();
      
      // Parse link if any
      let botHtml = data.text || 'Xatolik';
      const linkMatch = botHtml.match(/(https?:\/\/[^\s]+)/);
      if (linkMatch) {
        const link = linkMatch[1];
        botHtml = botHtml.replace(link, `<a href="${link}" style="color: #40c4ff; text-decoration: underline; font-weight: bold;">Ushbu havolaga bosing (Kirish)</a>`);
      }

      // Add bot message bubble
      const botBubble = document.createElement('div');
      botBubble.style.cssText = `
        align-self: flex-start; background: #182533; color: #f5f5f5; font-size: 0.88rem;
        padding: 10px 14px; border-radius: 12px 12px 12px 0px; max-width: 80%;
        line-height: 1.4; border: 1px solid rgba(255,255,255,0.03); margin-top: 10px;
      `;
      botBubble.innerHTML = botHtml.replace(/\n/g, '<br>');
      tgSimChatArea.appendChild(botBubble);
      tgSimChatArea.scrollTop = tgSimChatArea.scrollHeight;
    } catch (e) {
      showToast("Xatolik yuz berdi", "error");
    }
  };
  
  tgSimSendBtn.onclick = sendSimMessage;
  tgSimInput.onkeydown = (e) => {
    if (e.key === 'Enter') sendSimMessage();
  };
}

async function syncUserProfile() {
  const token = localStorage.getItem('authToken');
  if (!token) return;
  try {
    const res = await fetch(`${apiBase}/api/users/profile`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.user) {
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        loadCurrentUser();
      }
    }
  } catch(e) {}
}

window.editAdminUser = function(user) {
  document.getElementById('edit-admin-id').value = user.id;
  document.getElementById('edit-admin-name').value = user.name;
  document.getElementById('edit-admin-email').value = user.email;
  document.getElementById('edit-admin-role').value = user.role;
  document.getElementById('edit-admin-spec').value = user.specialization || '';
  document.getElementById('edit-admin-password').value = '';
  document.getElementById('edit-admin-message').textContent = '';
  document.getElementById('dir-admin-edit-form-container').style.display = 'block';
  document.getElementById('edit-admin-title').textContent = `Tahrirlash: ${user.name} (ID: ${user.id})`;
};

document.addEventListener('DOMContentLoaded', async () => {
  loadCurrentUser();
  await syncUserProfile();
  updateCartCountHeader();
  
  fetchProducts();
  loadCartPage();
  loadDashboard();
  setupAuthTabs();
  checkTelegramAuth();

  // Director Admin Edit cancel button
  const cancelEditBtn = document.getElementById('cancel-edit-admin-btn');
  if (cancelEditBtn) {
    cancelEditBtn.onclick = () => {
      document.getElementById('dir-admin-edit-form-container').style.display = 'none';
    };
  }

  // Director Admin Edit form submit
  const editAdminForm = document.getElementById('dir-admin-edit-form');
  if (editAdminForm) {
    editAdminForm.onsubmit = async (e) => {
      e.preventDefault();
      const token = localStorage.getItem('authToken');
      const authHeaders = { 
        'Authorization': token ? `Bearer ${token}` : '',
        'Content-Type': 'application/json'
      };

      const id = document.getElementById('edit-admin-id').value;
      const name = document.getElementById('edit-admin-name').value;
      const email = document.getElementById('edit-admin-email').value;
      const role = document.getElementById('edit-admin-role').value;
      const specialization = document.getElementById('edit-admin-spec').value;
      const password = document.getElementById('edit-admin-password').value;

      const msgEl = document.getElementById('edit-admin-message');
      msgEl.textContent = 'Saqlanmoqda...';
      msgEl.className = 'message';

      try {
        const response = await fetch(`${apiBase}/api/users/admin-edit`, {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify({ userId: id, name, email, role, specialization, password })
        });
        const resData = await response.json();
        if (response.ok && resData.success) {
          msgEl.textContent = 'Muvaffaqiyatli saqlandi!';
          msgEl.className = 'message success';
          showToast('Foydalanuvchi muvaffaqiyatli tahrirlandi.', 'success');
          setTimeout(() => {
            document.getElementById('dir-admin-edit-form-container').style.display = 'none';
            loadDirectorAudit();
          }, 1500);
        } else {
          msgEl.textContent = resData.message || 'Xatolik yuz berdi';
          msgEl.className = 'message error';
        }
      } catch (err) {
        msgEl.textContent = 'Server bilan ulanishda xato.';
        msgEl.className = 'message error';
      }
    };
  }
});

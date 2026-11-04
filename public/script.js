// ⚠️ METS TA CLÉ PUBLIQUE STRIPE ICI
const STRIPE_PUBLISHABLE_KEY = 'pk_live_51UXoxwIdrLYmf8r6xzNhqvvPUhDMISHio5DSevxbYCfAH8zAo7a0dcjC4WgxWomZEEuON37Xv0HkTdpmwInsvqRZ00OqgtUpml';
const API_URL = '/api/create-payment-intent';
const DEPOSIT_AMOUNT = 2000;
const MAX_BOOKINGS_PER_SLOT = 1;
const TIME_SLOTS = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'];

const navbar = document.getElementById('navbar');
if (navbar) window.addEventListener('scroll', () => navbar.classList.toggle('scrolled', window.scrollY > 50));

const burger = document.getElementById('burger');
const navLinks = document.querySelector('.nav-links');
if (burger) burger.addEventListener('click', () => { burger.classList.toggle('open'); navLinks.classList.toggle('open'); });

const baContainer = document.getElementById('baContainer');
const baBefore = document.getElementById('baBefore');
const baSlider = document.getElementById('baSlider');
let isDragging = false;
if (baContainer) {
  const updateSlider = (x) => {
    const rect = baContainer.getBoundingClientRect();
    let percent = ((x - rect.left) / rect.width) * 100;
    percent = Math.max(5, Math.min(95, percent));
    baBefore.style.width = percent + '%';
    baSlider.style.left = percent + '%';
  };
  baContainer.addEventListener('mousedown', (e) => { isDragging = true; updateSlider(e.clientX); });
  window.addEventListener('mousemove', (e) => { if (isDragging) updateSlider(e.clientX); });
  window.addEventListener('mouseup', () => { isDragging = false; });
  baContainer.addEventListener('touchstart', (e) => { isDragging = true; updateSlider(e.touches[0].clientX); }, {passive:true});
  window.addEventListener('touchmove', (e) => { if (isDragging) updateSlider(e.touches[0].clientX); }, {passive:true});
  window.addEventListener('touchend', () => { isDragging = false; });
}

let currentStep = 1;
const totalSteps = 3;
// On met à jour le packLabel par défaut ici
const state = { vehicle: 'citadine', vehicleMultiplier: 1, vehicleLabel: 'Citadine', packPrice: 129, packLabel: 'Nettoyage Intérieur' };

const steps = document.querySelectorAll('.booking-step');
const dots = document.querySelectorAll('.progress-dots .dot');
const prevBtn = document.getElementById('prevStep');
const nextBtn = document.getElementById('nextStep');

function goToStep(step) {
  currentStep = Math.max(1, Math.min(totalSteps, step));
  steps.forEach(s => s.classList.toggle('active', +s.dataset.step === currentStep));
  dots.forEach((d, i) => d.classList.toggle('active', i === currentStep - 1));
  if (prevBtn) prevBtn.disabled = currentStep === 1;
  if (nextBtn) nextBtn.textContent = currentStep === totalSteps ? '✓ Envoyer' : 'Suivant →';
}
if (prevBtn) prevBtn.addEventListener('click', () => goToStep(currentStep - 1));
if (nextBtn) nextBtn.addEventListener('click', () => { if (currentStep === totalSteps) document.getElementById('submitBooking').click(); else goToStep(currentStep + 1); });

document.querySelectorAll('.vehicle-option').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.vehicle-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.vehicle = btn.dataset.vehicle;
    state.vehicleMultiplier = parseFloat(btn.dataset.multiplier);
    state.vehicleLabel = btn.querySelector('.vehicle-name').textContent;
    updateSummary(); updateBookingRecap();
  });
});
document.querySelectorAll('input[name="pack"]').forEach(radio => {
  radio.addEventListener('change', () => {
    state.packPrice = parseFloat(radio.dataset.price);
    state.packLabel = radio.closest('.pack-option').querySelector('span').textContent;
    updateSummary(); updateBookingRecap();
  });
});

function updateSummary() {
  const supp = Math.round(state.packPrice * (state.vehicleMultiplier - 1));
  const total = state.packPrice + supp;
  const sumV = document.getElementById('sumVehicle'), sumP = document.getElementById('sumPack'), sumS = document.getElementById('sumSupp'), sumT = document.getElementById('sumTotal');
  if (sumV) sumV.textContent = state.vehicleLabel;
  if (sumP) sumP.textContent = state.packLabel;
  if (sumS) sumS.textContent = supp > 0 ? `+${supp}€` : '+0€';
  if (sumT) sumT.textContent = `${total}€`;
  document.querySelectorAll('.pack-option-price').forEach(el => { el.textContent = `${Math.round(parseFloat(el.dataset.base) * state.vehicleMultiplier)}€`; });
}

document.getElementById('submitBooking')?.addEventListener('click', (e) => {
  e.preventDefault();
  const form = document.getElementById('bookingForm');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  document.getElementById('calendrier').scrollIntoView({ behavior: 'smooth' });
});

let currentDate = new Date();
let selectedDate = null;
let selectedSlot = null;
let bookedSlots = {};
const monthLabel = document.getElementById('monthLabel');
const calendarGrid = document.getElementById('calendarGrid');
const slotsGrid = document.getElementById('slotsGrid');
const slotsTitle = document.getElementById('slotsTitle');

async function loadBookedSlots() {
  try {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const res = await fetch(`/api/slots?from=${from}&to=${to}`);
    if (res.ok) bookedSlots = await res.json();
  } catch (err) { bookedSlots = {}; }
}

function renderCalendar() {
  if (!calendarGrid) return;
  const year = currentDate.getFullYear(), month = currentDate.getMonth();
  const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  monthLabel.textContent = `${months[month]} ${year}`;
  calendarGrid.innerHTML = '';
  const firstDay = new Date(year, month, 1);
  let startDay = firstDay.getDay() - 1; if (startDay < 0) startDay = 6;
  for (let i = 0; i < startDay; i++) { const e = document.createElement('div'); e.className = 'cal-day empty'; calendarGrid.appendChild(e); }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(year, month, day);
    const btn = document.createElement('button');
    btn.className = 'cal-day'; btn.textContent = day;
    btn.dataset.date = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    if (dateObj < today || dateObj.getDay() === 0) btn.disabled = true;
    if (dateObj.getTime() === today.getTime()) btn.classList.add('today');
    if (selectedDate === btn.dataset.date) btn.classList.add('selected');
    btn.addEventListener('click', () => selectDate(btn.dataset.date, dateObj));
    calendarGrid.appendChild(btn);
  }
}

function selectDate(dateStr, dateObj) {
  selectedDate = dateStr; selectedSlot = null;
  document.querySelectorAll('.cal-day').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.cal-day').forEach(b => { if (b.dataset.date === dateStr) b.classList.add('selected'); });
  renderSlots(dateObj); updateBookingRecap();
}

function renderSlots(dateObj) {
  if (!slotsGrid) return;
  slotsTitle.textContent = `Créneaux du ${dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  slotsGrid.innerHTML = '';
  const booked = bookedSlots[selectedDate] || [];
  TIME_SLOTS.forEach(time => {
    const btn = document.createElement('button');
    btn.className = 'slot-btn'; btn.textContent = time; btn.dataset.time = time;
    if (booked.filter(t => t === time).length >= MAX_BOOKINGS_PER_SLOT) btn.disabled = true;
    btn.addEventListener('click', () => selectSlot(time));
    slotsGrid.appendChild(btn);
  });
}

function selectSlot(time) {
  selectedSlot = time;
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.slot-btn').forEach(b => { if (b.dataset.time === time) b.classList.add('selected'); });
  updateBookingRecap();
}

document.getElementById('prevMonth')?.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); const n = new Date(); if (currentDate < new Date(n.getFullYear(), n.getMonth(), 1)) currentDate = new Date(n.getFullYear(), n.getMonth(), 1); renderCalendar(); });
document.getElementById('nextMonth')?.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });

function updateBookingRecap() {
  const recap = document.getElementById('bookingRecap'), goBtn = document.getElementById('goToPayment');
  if (!recap || !goBtn) return;
  const vehicle = document.querySelector('.vehicle-option.active')?.querySelector('.vehicle-name')?.textContent || '—';
  const packInput = document.querySelector('input[name="pack"]:checked');
  const packLabel = packInput?.closest('.pack-option').querySelector('span').textContent || '—';
  const packPrice = packInput ? parseFloat(packInput.dataset.price) : 0;
  const multiplier = parseFloat(document.querySelector('.vehicle-option.active')?.dataset.multiplier || 1);
  const totalPrice = Math.round(packPrice * multiplier);
  if (selectedDate && selectedSlot) {
    recap.style.display = 'block';
    const [y, m, d] = selectedDate.split('-');
    document.getElementById('recapDate').textContent = new Date(y, m-1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    document.getElementById('recapTime').textContent = selectedSlot;
    document.getElementById('recapVehicle').textContent = vehicle;
    document.getElementById('recapPack').textContent = packLabel;
    document.getElementById('recapTotal').textContent = `${totalPrice}€`;
    goBtn.disabled = false;
    window._bookingData = { date: selectedDate, slot: selectedSlot, vehicle, pack: packLabel, total: totalPrice, deposit: 20, reste: totalPrice - 20 };
  } else { recap.style.display = 'none'; goBtn.disabled = true; }
}

(async () => { await loadBookedSlots(); renderCalendar(); updateSummary(); updateBookingRecap(); })();

const paymentModal = document.getElementById('paymentModal');
const goToPayment = document.getElementById('goToPayment');
const closeModal = document.getElementById('closeModal');
const closeSuccess = document.getElementById('closeSuccess');
let stripe = null, cardElement = null;

function loadStripeLib() {
  return new Promise((resolve) => {
    if (window.Stripe) { resolve(window.Stripe(STRIPE_PUBLISHABLE_KEY)); return; }
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = () => resolve(window.Stripe(STRIPE_PUBLISHABLE_KEY));
    document.head.appendChild(script);
  });
}

goToPayment?.addEventListener('click', async () => {
  if (!window._bookingData) return;
  showModalStep(1); paymentModal.classList.add('open');
  if (!stripe) {
    stripe = await loadStripeLib();
    const elements = stripe.elements();
    cardElement = elements.create('card', { style: { base: { color: '#FFFFFF', fontFamily: 'Montserrat, sans-serif', fontSize: '16px', '::placeholder': { color: '#B8C0CC' } }, invalid: { color: '#ff4757' } } });
    cardElement.mount('#stripeCardElement');
    cardElement.on('change', (e) => { document.getElementById('stripeError').textContent = e.error ? e.error.message : ''; });
  }
  document.getElementById('payPrestation').textContent = window._bookingData.pack;
  document.getElementById('payTotal').textContent = `${window._bookingData.total}€`;
  document.getElementById('payReste').textContent = `${window._bookingData.reste}€`;
});

function showModalStep(n) {
  document.querySelectorAll('.modal-step').forEach(s => s.classList.remove('active'));
  document.getElementById(`modalStep${n}`)?.classList.add('active');
}

document.getElementById('paymentForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!e.target.checkValidity()) { e.target.reportValidity(); return; }
  window._customerData = Object.fromEntries(new FormData(e.target));
  showModalStep(2);
});

document.getElementById('confirmPayment')?.addEventListener('click', async () => {
  const btn = document.getElementById('confirmPayment'), errorEl = document.getElementById('stripeError');
  errorEl.textContent = ''; btn.disabled = true; btn.textContent = '⏳ Traitement…';
  
  try {
    const response = await fetch(API_URL, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ amount: DEPOSIT_AMOUNT, booking: window._bookingData, customer: window._customerData }) 
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Erreur de communication avec Stripe');
    }
    
    const { clientSecret } = await response.json();
    
    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, { 
      payment_method: { 
        card: cardElement, 
        billing_details: { name: window._customerData.nom, email: window._customerData.email, phone: window._customerData.tel } 
      } 
    });
    
    if (error) throw error;
    if (paymentIntent.status === 'succeeded') showSuccess();
    
  } catch (err) {
    errorEl.textContent = err.message;
    btn.disabled = false; btn.textContent = '🔒 Payer 20€ maintenant';
  }
});

function showSuccess() {
  showModalStep(3);
  const b = window._bookingData, c = window._customerData;
  const [y, m, d] = b.date.split('-');
  const dateObj = new Date(y, m-1, d);
  document.getElementById('successRecap').innerHTML = `
    <div><strong>${b.pack}</strong> — ${b.vehicle}</div>
    <div>📅 ${dateObj.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' })} à ${b.slot}</div>
    <div>👤 ${c.nom} · ${c.tel}</div>
    <div>📍 ${c.adresse}</div>
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(0,108,255,0.3);"><strong>Acompte payé : 20€</strong><br>Reste sur place : ${b.reste}€</div>
  `;
  setTimeout(() => { loadBookedSlots().then(() => renderCalendar()); }, 1000);
}

function closeAll() { paymentModal.classList.remove('open'); showModalStep(1); }
closeModal?.addEventListener('click', closeAll);
closeSuccess?.addEventListener('click', () => { closeAll(); renderCalendar(); });
paymentModal?.addEventListener('click', (e) => { if (e.target === paymentModal) closeAll(); });

// ⚠️ METS TA CLÉ PUBLIQUE STRIPE ICI
const STRIPE_PUBLISHABLE_KEY = 'pk_live_51UXoxwIdrLYmf8r6xzNhqvvPUhDMISHio5DSevxbYCfAH8zAo7a0dcjC4WgxWomZEEuON37Xv0HkTdpmwInsvqRZ00OqgtUpml';
const API_URL = '/api/create-payment-intent';
const DEPOSIT_AMOUNT = 2000;
const MAX_BOOKINGS_PER_SLOT = 1;
const TIME_SLOTS = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'];

// ===== INITIALISATION UI =====
document.addEventListener('DOMContentLoaded', () => {
  // Navigation des étapes du formulaire
  let currentStep = 1;
  const totalSteps = 3;
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
  if (nextBtn) nextBtn.addEventListener('click', () => { 
    if (currentStep === totalSteps) {
      document.getElementById('calendrier').scrollIntoView({ behavior: 'smooth' });
    } else {
      goToStep(currentStep + 1); 
    }
  });

  // ==========================================
  // SÉLECTION DU VÉHICULE
  // ==========================================
  document.querySelectorAll('.vehicle-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.vehicle-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const vehicleType = btn.dataset.vehicle;
      
      // --- SYNCHRONISATION AUTOMATIQUE DU PACK ---
      if (vehicleType === 'canape') {
        // Si Canapé, on coche le pack Canapé
        const canapePack = document.querySelector('input[name="pack"][value="canape"]');
        if (canapePack) {
          canapePack.checked = true;
          canapePack.dispatchEvent(new Event('change')); // Déclenche la mise à jour du prix
        }
      } else {
        // Si c'est une voiture, on coche le pack Intérieur
        const interieurPack = document.querySelector('input[name="pack"][value="interieur"]');
        if (interieurPack) {
          interieurPack.checked = true;
          interieurPack.dispatchEvent(new Event('change'));
        }
      }
      updatePrices();
    });
  });

  // ==========================================
  // SÉLECTION DU PACK
  // ==========================================
  document.querySelectorAll('input[name="pack"]').forEach(radio => {
    radio.addEventListener('change', () => {
      // --- SYNCHRONISATION AUTOMATIQUE DU VÉHICULE ---
      if (radio.value === 'canape') {
        // Si on choisit le pack Canapé, on force le véhicule sur Canapé
        const canapeBtn = document.querySelector('.vehicle-option[data-vehicle="canape"]');
        if (canapeBtn) {
          document.querySelectorAll('.vehicle-option').forEach(b => b.classList.remove('active'));
          canapeBtn.classList.add('active');
        }
      } else {
        // Si on choisit un pack voiture, et que le véhicule était Canapé, on remet Citadine
        const activeVehicle = document.querySelector('.vehicle-option.active');
        if (activeVehicle && activeVehicle.dataset.vehicle === 'canape') {
          const citadineBtn = document.querySelector('.vehicle-option[data-vehicle="citadine"]');
          if (citadineBtn) {
            document.querySelectorAll('.vehicle-option').forEach(b => b.classList.remove('active'));
            citadineBtn.classList.add('active');
          }
        }
      }
      updatePrices();
    });
  });

  // ==========================================
  // CALCUL DES PRIX
  // ==========================================
  function updatePrices() {
    const vehicle = document.querySelector('.vehicle-option.active');
    const multiplier = parseFloat(vehicle?.dataset.multiplier || 1);
    const vehicleName = vehicle?.querySelector('.vehicle-name').textContent || '—';
    const packInput = document.querySelector('input[name="pack"]:checked');
    const packPrice = packInput ? parseFloat(packInput.dataset.price) : 129;
    
    // Si c'est un canapé, on annule le multiplicateur de voiture
    const finalMultiplier = (vehicle?.dataset.vehicle === 'canape') ? 1 : multiplier;
    
    const total = Math.round(packPrice * finalMultiplier);
    const supp = total - packPrice;

    if (document.getElementById('sumVehicle')) document.getElementById('sumVehicle').textContent = vehicleName;
    if (document.getElementById('sumPack')) document.getElementById('sumPack').textContent = packInput ? packInput.closest('.pack-option').querySelector('span').textContent : '—';
    if (document.getElementById('sumSupp')) document.getElementById('sumSupp').textContent = supp > 0 ? `+${supp}€` : '+0€';
    if (document.getElementById('sumTotal')) document.getElementById('sumTotal').textContent = `${total}€`;

    // Mettre à jour les prix affichés dans les cases
    document.querySelectorAll('.pack-option-price').forEach(el => {
      el.textContent = `${Math.round(parseFloat(el.dataset.base) * finalMultiplier)}€`;
    });

    // Mettre à jour le récapitulatif du calendrier
    if (document.getElementById('recapVehicle')) document.getElementById('recapVehicle').textContent = vehicleName;
    if (document.getElementById('recapPack')) document.getElementById('recapPack').textContent = packInput ? packInput.closest('.pack-option').querySelector('span').textContent : '—';
    if (document.getElementById('recapTotal')) document.getElementById('recapTotal').textContent = `${total}€`;
  }

  // ==========================================
  // INITIALISATION DU CALENDRIER
  // ==========================================
  let currentDate = new Date();
  let selectedDate = null;
  let selectedSlot = null;
  let bookedSlots = {};

  async function loadBookedSlots() {
    try {
      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const res = await fetch(`/api/slots?from=${from}&to=${to}`);
      if (res.ok) bookedSlots = await res.json();
    } catch (err) { bookedSlots = {}; }
  }

  function renderCalendar() {
    const calendarGrid = document.getElementById('calendarGrid');
    const monthLabel = document.getElementById('monthLabel');
    if (!calendarGrid) return;

    const year = currentDate.getFullYear(), month = currentDate.getMonth();
    const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    monthLabel.textContent = `${months[month]} ${year}`;
    calendarGrid.innerHTML = '';

    const firstDay = new Date(year, month, 1);
    let startDay = firstDay.getDay() - 1; if (startDay < 0) startDay = 6;
    for (let i = 0; i < startDay; i++) { 
      const e = document.createElement('div'); e.className = 'cal-day empty'; calendarGrid.appendChild(e); 
    }

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
      
      btn.addEventListener('click', () => {
        selectedDate = btn.dataset.date;
        selectedSlot = null;
        document.querySelectorAll('.cal-day').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        renderSlots(dateObj);
        updateRecap();
      });
      calendarGrid.appendChild(btn);
    }
  }

  function renderSlots(dateObj) {
    const slotsGrid = document.getElementById('slotsGrid');
    const slotsTitle = document.getElementById('slotsTitle');
    if (!slotsGrid) return;

    slotsTitle.textContent = `Créneaux du ${dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`;
    slotsGrid.innerHTML = '';
    
    const booked = bookedSlots[selectedDate] || [];

    TIME_SLOTS.forEach(time => {
      const btn = document.createElement('button');
      btn.className = 'slot-btn'; btn.textContent = time;
      if (booked.includes(time)) btn.disabled = true;
      
      btn.addEventListener('click', () => {
        selectedSlot = time;
        document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        updateRecap();
      });
      slotsGrid.appendChild(btn);
    });
  }

  function updateRecap() {
    const recap = document.getElementById('bookingRecap');
    const goBtn = document.getElementById('goToPayment');
    if (!recap || !goBtn) return;

    if (selectedDate && selectedSlot) {
      recap.style.display = 'block';
      const [y, m, d] = selectedDate.split('-');
      document.getElementById('recapDate').textContent = new Date(y, m-1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      document.getElementById('recapTime').textContent = selectedSlot;
      goBtn.disabled = false;
      
      // Sauvegarde des données pour Stripe
      const total = parseInt(document.getElementById('sumTotal').textContent);
      window._bookingData = { 
        date: selectedDate, 
        slot: selectedSlot, 
        vehicle: document.getElementById('sumVehicle').textContent, 
        pack: document.getElementById('sumPack').textContent, 
        total: total, 
        deposit: 20, 
        reste: total - 20 
      };
    } else {
      recap.style.display = 'none';
      goBtn.disabled = true;
    }
  }

  document.getElementById('prevMonth')?.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
  document.getElementById('nextMonth')?.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });

  // Lancement des fonctions
  updatePrices();
  loadBookedSlots().then(renderCalendar);

  // =====================================================================
  // PARTIE STRIPE
  // =====================================================================
  let stripe = null;
  let cardElement = null;
  const paymentModal = document.getElementById('paymentModal');
  const goToPayment = document.getElementById('goToPayment');
  const closeModal = document.getElementById('closeModal');
  const closeSuccess = document.getElementById('closeSuccess');
  const paymentForm = document.getElementById('paymentForm');
  const confirmPayment = document.getElementById('confirmPayment');
  const stripeError = document.getElementById('stripeError');

  function showModalStep(n) {
    document.querySelectorAll('.modal-step').forEach(s => s.classList.remove('active'));
    document.getElementById(`modalStep${n}`)?.classList.add('active');
  }

  if (goToPayment) {
    goToPayment.addEventListener('click', async () => {
      if (!window._bookingData) return;
      
      paymentModal.classList.add('open');
      showModalStep(1);

      document.getElementById('payPrestation').textContent = window._bookingData.pack;
      document.getElementById('payTotal').textContent = `${window._bookingData.total}€`;
      document.getElementById('payReste').textContent = `${window._bookingData.reste}€`;

      if (!stripe) {
        const script = document.createElement('script');
        script.src = 'https://js.stripe.com/v3/';
        script.onload = () => {
          stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
          const elements = stripe.elements();
          cardElement = elements.create('card', { 
            style: { base: { color: '#FFFFFF', fontFamily: 'Montserrat, sans-serif', fontSize: '16px' } } 
          });
          cardElement.mount('#stripeCardElement');
          cardElement.on('change', (e) => {
            stripeError.textContent = e.error ? e.error.message : '';
          });
        };
        document.head.appendChild(script);
      }
    });
  }

  if (paymentForm) {
    paymentForm.addEventListener('submit', (e) => {
      e.preventDefault();
      window._customerData = Object.fromEntries(new FormData(e.target));
      showModalStep(2);
    });
  }

  if (confirmPayment) {
    confirmPayment.addEventListener('click', async () => {
      confirmPayment.disabled = true;
      confirmPayment.textContent = '⏳ Traitement…';
      stripeError.textContent = '';

      try {
        const response = await fetch('/api/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            amount: 2000, // 20€ en centimes
            booking: window._bookingData, 
            customer: window._customerData 
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Erreur serveur');
        }

        const { clientSecret } = await response.json();
        const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
          payment_method: { 
            card: cardElement,
            billing_details: { name: window._customerData.nom, email: window._customerData.email }
          }
        });

        if (error) throw error;
        if (paymentIntent.status === 'succeeded') showModalStep(3);

      } catch (err) {
        stripeError.textContent = err.message;
        confirmPayment.disabled = false;
        confirmPayment.textContent = '🔒 Payer 20€ maintenant';
      }
    });
  }

  if (closeModal) closeModal.addEventListener('click', () => paymentModal.classList.remove('open'));
  if (closeSuccess) closeSuccess.addEventListener('click', () => paymentModal.classList.remove('open'));
});

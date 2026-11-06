require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const app = express();
app.set('trust proxy', 1);

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Configuration de sécurité
const ADMIN_PASSWORD = "admin";
const JWT_SECRET = "mon-secret-super-securise";
const FROM_EMAIL = "onboarding@resend.dev";
const ADMIN_EMAIL = "contact.dnkcleaning@gmail.com";

app.use(cors({ origin: '*' }));
app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// Vérification par Token
function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expirée' });
  }
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Mot de passe incorrect' });
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ ok: true, token });
});

app.get('/api/admin/me', verifyAdmin, (req, res) => res.json({ ok: true }));

// ===== CRM : ENVOI VERS AIRTABLE =====
app.post('/api/send-to-airtable', async (req, res) => {
  try {
    const data = req.body;
    
    // Le nom de la table est récupéré dans Render, avec une sécurité si vide
    const tableName = encodeURIComponent(process.env.AIRTABLE_TABLE_NAME || 'Table 1');
    const baseId = process.env.AIRTABLE_BASE_ID;
    const token = process.env.AIRTABLE_TOKEN;

    if (!baseId || !token) {
      throw new Error("Configuration Airtable manquante sur Render.");
    }

    const airtableData = {
      fields: {
        "prenom": data.prenom || "",
        "telephone": data.telephone || "",
        "email": data.email || "",
        "service": data.service || "",
        "type_vehicule": data.type_vehicule || "",
        "type_canape": data.type_canape || "",
        "statut": "Nouveau",
        "source": "Meta Ads"
      }
    };

    const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(airtableData)
    });

    if (!response.ok) {
      const errorData = await response.json();
      // On renvoie le vrai message d'erreur d'Airtable au site
      throw new Error(errorData.error?.message || "Erreur Airtable inconnue");
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur Airtable:', err.message);
    res.status(500).json({ error: err.message }); // On envoie l'erreur au navigateur
  }
});

// ===== RESERVATIONS =====
app.get('/api/slots', async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = supabase.from('bookings').select('date, slot').in('status', ['pending', 'confirmed']);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    const { data, error } = await query;
    if (error) throw error;
    const booked = {};
    (data || []).forEach(b => {
      if (!booked[b.date]) booked[b.date] = [];
      booked[b.date].push(b.slot.slice(0, 5));
    });
    res.json(booked);
  } catch (err) { res.json({}); }
});

app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, booking, customer } = req.body;
    const paymentIntent = await stripe.paymentIntents.create({
      amount, currency: 'eur',
      automatic_payment_methods: { enabled: true },
      receipt_email: customer.email,
    });
    const { error: dbError } = await supabase.from('bookings').insert({
      customer_name: customer.nom, customer_email: customer.email, customer_phone: customer.tel,
      address: customer.adresse, date: booking.date, slot: booking.slot,
      vehicle: booking.vehicle, pack: booking.pack, total_price: booking.total,
      deposit_amount: 20, stripe_payment_intent_id: paymentIntent.id, status: 'pending',
    });
    if (dbError) console.error('DB error:', dbError);
    
    try {
      await resend.emails.send({
        from: `DNK-CLEANING <${FROM_EMAIL}>`, to: customer.email,
        subject: `✅ Réservation confirmée — ${booking.date}`,
        html: `<p>Bonjour ${customer.nom}, votre réservation est confirmée.</p>`,
      });
    } catch (e) { console.error('Resend error', e); }

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/bookings', verifyAdmin, async (req, res) => {
  const { data } = await supabase.from('bookings').select('*').order('date', { ascending: false }).limit(100);
  res.json(data || []);
});

app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
  const { data: all } = await supabase.from('bookings').select('status, total_price, deposit_amount, date, stripe_status');
  const arr = all || [];
  res.json({
    total_bookings: arr.length, confirmed: arr.filter(b => b.status === 'confirmed').length,
    revenue_total: arr.filter(b => b.status === 'confirmed').reduce((s, b) => s + (b.total_price || 0), 0),
    deposits_collected: arr.filter(b => b.stripe_status === 'paid').reduce((s, b) => s + (b.deposit_amount || 0), 0),
  });
});

app.get('/admin', (req, res) => res.sendFile(__dirname + '/public/admin.html'));

const PORT = process.env.PORT || 4242;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Serveur sur le port ${PORT}`));

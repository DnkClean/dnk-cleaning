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
app.set('trust proxy', 1); // Indispensable pour Render

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Configuration de sécurité (mot de passe en dur pour éviter les bugs de variables)
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

// Vérification par Token (au lieu du cookie)
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

// Connexion admin
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Mot de passe incorrect' });
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ ok: true, token }); // On renvoie le token
});

app.get('/api/admin/me', verifyAdmin, (req, res) => res.json({ ok: true }));

// Créneaux réservés
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

// Paiement + Base de données + Email
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, booking, customer } = req.body;
    if (!amount || amount < 100) return res.status(400).json({ error: 'Montant invalide' });

    const { data: existing } = await supabase.from('bookings').select('id').eq('date', booking.date).eq('slot', booking.slot).in('status', ['pending', 'confirmed']).single();
    if (existing) return res.status(409).json({ error: 'Ce créneau vient d\'être réservé.' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount, currency: 'eur',
      automatic_payment_methods: { enabled: true },
      description: `Acompte — ${booking.pack} (${booking.vehicle})`,
      metadata: { date: booking.date, slot: booking.slot, pack: booking.pack, vehicle: booking.vehicle },
      receipt_email: customer.email,
    });

    const { error: dbError } = await supabase.from('bookings').insert({
      customer_name: customer.nom, customer_email: customer.email, customer_phone: customer.tel,
      address: customer.adresse, date: booking.date, slot: booking.slot,
      vehicle: booking.vehicle, pack: booking.pack, total_price: booking.total,
      message: customer.message || null, deposit_amount: 20,
      stripe_payment_intent_id: paymentIntent.id, stripe_status: 'pending', status: 'pending',
    });

    if (dbError) console.error('DB error:', dbError);

    try {
      await resend.emails.send({
        from: `DNK-CLEANING <${FROM_EMAIL}>`,
        to: customer.email,
        subject: `✅ Réservation confirmée — ${booking.date} à ${booking.slot}`,
        html: `<p>Bonjour ${customer.nom}, votre réservation est confirmée pour le ${booking.date} à ${booking.slot}.</p>`,
      });
      await resend.emails.send({
        from: `DNK-CLEANING <${FROM_EMAIL}>`,
        to: ADMIN_EMAIL,
        subject: `💰 Nouvelle réservation : ${customer.nom}`,
        html: `<p>Client : ${customer.nom} - ${customer.tel}. Date : ${booking.date} à ${booking.slot}.</p>`,
      });
    } catch (emailErr) { console.error('Erreur Resend:', emailErr.message); }

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin : Voir les réservations
app.get('/api/admin/bookings', verifyAdmin, async (req, res) => {
  const { status, limit = 100 } = req.query;
  let query = supabase.from('bookings').select('*').order('date', { ascending: false }).limit(limit);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Admin : Statistiques
app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
  const { data: all } = await supabase.from('bookings').select('status, total_price, deposit_amount, date, stripe_status');
  const arr = all || [];
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    total_bookings: arr.length || 0,
    confirmed: arr.filter(b => b.status === 'confirmed').length || 0,
    pending: arr.filter(b => b.status === 'pending').length || 0,
    cancelled: arr.filter(b => b.status === 'cancelled').length || 0,
    revenue_total: arr.filter(b => b.status === 'confirmed').reduce((s, b) => s + (b.total_price || 0), 0) || 0,
    deposits_collected: arr.filter(b => b.stripe_status === 'paid').reduce((s, b) => s + (b.deposit_amount || 0), 0) || 0,
    upcoming: arr.filter(b => b.date >= today && b.status === 'confirmed').length || 0,
  });
});

app.patch('/api/admin/bookings/:id', verifyAdmin, async (req, res) => {
  const { status } = req.body;
  const { data, error } = await supabase.from('bookings').update({ status }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/admin/bookings/:id/refund', verifyAdmin, async (req, res) => {
  try {
    const { data: booking } = await supabase.from('bookings').select('*').eq('id', req.params.id).single();
    if (!booking || booking.stripe_status !== 'paid') return res.status(400).json({ error: 'Remboursement impossible' });
    const refund = await stripe.refunds.create({ payment_intent: booking.stripe_payment_intent_id, amount: booking.deposit_amount * 100 });
    await supabase.from('bookings').update({ stripe_status: 'refunded', status: 'cancelled' }).eq('id', booking.id);
    res.json({ ok: true, refundId: refund.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin', (req, res) => res.sendFile(__dirname + '/public/admin.html'));

// ===== ENVOI VERS AIRTABLE =====
app.post('/api/send-to-airtable', async (req, res) => {
  try {
    const data = req.body;
    
    // On prépare les données pour Airtable
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

    // On envoie à l'API Airtable
    const response = await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Imported%20table%203, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(airtableData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur Airtable:', err.message);
    res.status(500).json({ error: err.message }); 
}
});
const PORT = process.env.PORT || 4242;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur sur le port ${PORT}`);
});

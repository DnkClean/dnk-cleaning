require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend'); // Ajout de Resend

const app = express();
app.set('trust proxy', 1);
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors({ origin: process.env.BASE_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// ===== AUTH ADMIN =====
function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = req.cookies.admin_token;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }
  
  if (!token) return res.status(401).json({ error: 'Non autorisé' });
  try { jwt.verify(token, "mon-secret-super-securise"); next(); }
  catch { res.status(401).json({ error: 'Session expirée' }); }
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== "admin") return res.status(401).json({ error: 'Mot de passe incorrect' });
  const token = jwt.sign({ admin: true }, "mon-secret-super-securise", { expiresIn: '7d' });
  res.json({ ok: true, token });
});

app.post('/api/admin/logout', (req, res) => { res.clearCookie('admin_token'); res.json({ ok: true }); });
app.get('/api/admin/me', verifyAdmin, (req, res) => res.json({ ok: true }));

// ===== CRÉNEAUX RÉSERVÉS =====
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

// ===== CRÉER PAYMENT INTENT + SAUVEGARDER + EMAIL =====
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

    // 1. Sauvegarder en base
    const { error: dbError } = await supabase.from('bookings').insert({
      customer_name: customer.nom, customer_email: customer.email, customer_phone: customer.tel,
      address: customer.adresse, date: booking.date, slot: booking.slot,
      vehicle: booking.vehicle, pack: booking.pack, total_price: booking.total,
      message: customer.message || null, deposit_amount: 20,
      stripe_payment_intent_id: paymentIntent.id, stripe_status: 'pending', status: 'pending',
    });

    if (dbError) console.error('DB error:', dbError);

    // 2. Envoyer les emails (Resend)
    try {
      // Email au client
      await resend.emails.send({
        from: `DNK-CLEANING <${process.env.FROM_EMAIL}>`,
        to: customer.email,
        subject: `✅ Réservation confirmée — ${booking.date} à ${booking.slot}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#050505;color:#fff;padding:40px;border-radius:16px;">
            <h1 style="color:#00A8FF;">DNK-CLEANING</h1>
            <p>Bonjour ${customer.nom},</p>
            <p>Votre réservation est bien confirmée !</p>
            <div style="background:#111;padding:20px;border-radius:12px;margin:20px 0;">
              <p><strong>Prestation :</strong> ${booking.pack} — ${booking.vehicle}</p>
              <p><strong>Date :</strong> ${booking.date} à ${booking.slot}</p>
              <p><strong>Adresse :</strong> ${customer.adresse}</p>
              <p><strong>Acompte payé :</strong> 20€</p>
              <p><strong>Reste à payer sur place :</strong> ${booking.reste}€</p>
            </div>
            <p>À bientôt !</p>
          </div>
        `,
      });

      // Email à l'admin
      await resend.emails.send({
        from: `DNK-CLEANING <${process.env.FROM_EMAIL}>`,
        to: process.env.ADMIN_EMAIL,
        subject: `💰 Nouvelle réservation : ${customer.nom} (${booking.date})`,
        html: `
          <h2>Nouvelle réservation !</h2>
          <p><strong>Client :</strong> ${customer.nom} - ${customer.tel}</p>
          <p><strong>Date :</strong> ${booking.date} à ${booking.slot}</p>
          <p><strong>Prestation :</strong> ${booking.pack} (${booking.vehicle})</p>
          <p><strong>Adresse :</strong> ${customer.adresse}</p>
        `,
      });
      console.log('📧 Emails envoyés avec succès !');
    } catch (emailErr) {
      console.error('Erreur Resend:', emailErr);
    }

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

// ===== ADMIN =====
app.get('/api/admin/bookings', verifyAdmin, async (req, res) => {
  const { status, limit = 100 } = req.query;
  let query = supabase.from('bookings').select('*').order('date', { ascending: false }).limit(limit);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
  const { data: all } = await supabase.from('bookings').select('status, total_price, deposit_amount, date, stripe_status');
  const arr = all || [];
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    total_bookings: arr.length,
    confirmed: arr.filter(b => b.status === 'confirmed').length,
    pending: arr.filter(b => b.status === 'pending').length,
    cancelled: arr.filter(b => b.status === 'cancelled').length,
    revenue_total: arr.filter(b => b.status === 'confirmed').reduce((s, b) => s + (b.total_price || 0), 0),
    deposits_collected: arr.filter(b => b.stripe_status === 'paid').reduce((s, b) => s + (b.deposit_amount || 0), 0),
    upcoming: arr.filter(b => b.date >= today && b.status === 'confirmed').length,
  });
});

app.patch('/api/admin/bookings/:id', verifyAdmin, async (req, res) => {
  const { status, message } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (status) updates.status = status;
  if (message !== undefined) updates.message = message;
  const { data, error } = await supabase.from('bookings').update(updates).eq('id', req.params.id).select().single();
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

const PORT = process.env.PORT || 4242;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur sur le port ${PORT}`);
});

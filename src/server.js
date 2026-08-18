'use strict';
// quiet: dotenv v17 prints a sponsor tip with a third-party URL on every boot.
// Harmless, but this log is going to be read by people auditing a government-
// facing platform, and an unexplained external domain in the startup banner is
// a question nobody needs to answer.
require('dotenv').config({ quiet: true });

const path         = require('path');
const express      = require('express');
const session      = require('express-session');
const passport     = require('passport');
const bcrypt       = require('bcryptjs');
const helmet       = require('helmet');
const morgan       = require('morgan');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const pgSession    = require('connect-pg-simple')(session);
const LocalStrategy = require('passport-local') ;

const { pool, query, initDb } = require('./db');
const { requireAuth, denyWritesForReadOnly } = require('./middleware/auth');
const { startWorker, enqueue } = require('./services/jobRunner');
const verra = require('./services/verraService');   // registers its job handler

const app     = express();
const PORT    = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Startup checks ─────────────────────────────────────────────────────────
// Fail at boot, loudly, rather than at the first request. Railway's healthcheck
// then fails the deploy and the error lands in the deploy log somebody is
// already reading.
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set'); process.exit(1);
}
if (IS_PROD && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 24)) {
  console.error('❌ SESSION_SECRET must be set to at least 24 characters in production');
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) {
  // Not fatal. Every AI surface has a deterministic fallback, and an ESG score
  // is arithmetic — the platform is fully usable with Groq switched off.
  console.warn('⚠️  GROQ_API_KEY not set — AI narrative will use offline templates.');
}

// ── Middleware ─────────────────────────────────────────────────────────────
app.set('trust proxy', 1);                     // Railway terminates TLS upstream
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // The design system's token floor is inlined by utils/layout.js, so
      // 'unsafe-inline' is required for styleSrc. Nothing else is named.
      //
      // cdnjs.cloudflare.com WAS in scriptSrc for the dashboard's Chart.js
      // radar. Run 53 deleted the radar; Run 54 closes the policy. A CSP that
      // allows a script host the product no longer loads from is a
      // supply-chain surface held open for nothing — anyone who can inject a
      // tag gets a permitted origin to fetch from. This is a security cleanup,
      // not a tidy-up, and test/no-model-figures-test.js asserts the host does
      // not come back.
      styleSrc:  ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:   ["'self'", 'https://fonts.gstatic.com', 'data:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc:    ["'self'", 'data:'],
      connectSrc:["'self'"],
    },
  },
}));
app.use(morgan(IS_PROD ? 'combined' : 'dev'));
app.use(cors({ origin: process.env.APP_URL || true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
// `index: false` so express.static does NOT quietly answer `/` with
// public/index.html before the explicit route below ever runs. Left on, the
// landing page would be served by middleware ordering rather than by a route
// anyone can find, and the `app.get('/')` handler would be unreachable dead
// code that still reads as live.
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: IS_PROD ? '7d' : 0, index: false,
}));

app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 7 * 24 * 3600 * 1000 },
}));
app.use(passport.initialize());
app.use(passport.session());

// ── Passport ───────────────────────────────────────────────────────────────
// The session user's column list is written out in full at each query rather
// than interpolated from a constant. It IS a constant and it WAS safe — but
// test/no-model-figures-test.js bans `${...}` inside a SQL literal outright,
// and carving an exception for "this one is fine" is how the rule stops being
// a rule. Four repetitions cost nothing; a guard nobody trusts costs a lot.

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const { rows } = await query(`SELECT id, company_id, email, name, role, is_active FROM esg_users WHERE id = $1 AND is_active`, [id]);
    done(null, rows[0] || false);
  } catch (err) { done(err); }
});

passport.use(new LocalStrategy.Strategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const { rows } = await query(
      `SELECT id, company_id, email, name, role, is_active, password_hash FROM esg_users WHERE email = $1`, [String(email).toLowerCase()]);
    const u = rows[0];
    // Same generic failure for "no such user" and "wrong password": telling them
    // apart turns the login form into an account-enumeration oracle.
    if (!u || !u.password_hash) return done(null, false);
    if (!u.is_active) return done(null, false);
    const ok = await bcrypt.compare(String(password), u.password_hash);
    if (!ok) return done(null, false);
    await query(`UPDATE esg_users SET last_login_at = now() WHERE id = $1`, [u.id]);
    delete u.password_hash;
    return done(null, u);
  } catch (err) { return done(err); }
}));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  const GoogleStrategy = require('passport-google-oauth20').Strategy;
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.APP_URL || `http://localhost:${PORT}`}/auth/google/callback`,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = (profile.emails && profile.emails[0] && profile.emails[0].value || '').toLowerCase();
      if (!email) return done(null, false);
      const { rows: existing } = await query(
        `SELECT id, company_id, email, name, role, is_active FROM esg_users WHERE google_id = $1 OR email = $2`, [profile.id, email]);
      if (existing[0]) {
        await query(`UPDATE esg_users SET google_id = $2, last_login_at = now() WHERE id = $1`,
                    [existing[0].id, profile.id]);
        return done(null, existing[0]);
      }
      // New Google user: a company shell is created so company_id is never null
      // downstream. Every query in this app is scoped by company_id; a null
      // there would silently widen the scope to "no rows" or, worse, to a join
      // that ignores the filter.
      const { rows: c } = await query(
        `INSERT INTO esg_companies (name) VALUES ($1) RETURNING id`,
        [profile.displayName ? `${profile.displayName}'s company` : 'New company']);
      const { rows } = await query(
        `INSERT INTO esg_users (company_id, email, name, google_id, role, last_login_at)
         VALUES ($1,$2,$3,$4,'company_admin', now())
         RETURNING id, company_id, email, name, role, is_active`,
        [c[0].id, email, profile.displayName || email, profile.id]);
      return done(null, rows[0]);
    } catch (err) { return done(err); }
  }));
}

// ── Routes ─────────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, service: 'esg-ereporting', db: 'up' });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: err.message });
  }
});

// Mounted BEFORE the auth guards, because a favicon request is not a page
// request. Left behind the guards it 302s an anonymous visitor to the login
// page, and once signed in it fell through to the HTML 404 — which rendered
// the whole shell, 97 KB of inlined CSS, to say "not found" about a 1 KB icon.
// Every browser asks for this on every navigation.
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

// robots.txt is served by express.static from /public, which is mounted above
// the auth guard — deliberately. A crawler has no session, so a robots.txt
// sitting behind requireAuth answers 302-to-login, which a crawler treats as
// "no robots.txt exists" and proceeds to index whatever it can reach. The
// Railway HTTP log showed exactly that: GET /robots.txt -> 302.
//
// This route exists only to make the guarantee explicit and testable; without
// the file present, static would miss and the request would fall through to
// the guard again.
app.get('/robots.txt', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/robots.txt')));

// Public landing page. A signed-in visitor still goes straight to their
// dashboard — the marketing page is for people who do not have an account yet,
// and bouncing a signed-in user onto it looks like being logged out.
app.get('/', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
app.use('/auth', require('./routes/auth'));
app.use('/api',  requireAuth, denyWritesForReadOnly, require('./routes/api'));

// ── Shell context ───────────────────────────────────────────────────────────
//
// The chrome shows the company, what needs review and what the AI has produced,
// on EVERY page. Loading it here rather than in each route means the shell can
// never differ between two pages because one of them forgot.
//
// IT HANGS OFF req.user ON PURPOSE. passport.serializeUser stores only user.id
// and deserializeUser rebuilds this object from the database on every request,
// so a property added here is per-request and is NEVER written to the session.
// The alternative was threading a fifth argument through 39 layout() calls, and
// a shell that renders context only where someone remembered to pass it is the
// inconsistency this middleware exists to remove.
//
// IT DOES NOT SWALLOW. An earlier draft caught the error and carried on with a
// null context, so a broken database produced a page that looked fine with no
// chips — the exact shape RULE 6 bans, and the same defect class as a count
// query rendering 0 when the connection is down. `.catch(next)` hands the real
// error to the error handler, which is the only place that decides what a user
// is told. The promise form is here because Express 4 hangs a request on an
// unhandled rejection from async middleware rather than 500-ing.
const shellContext = require('./services/shellContext');
app.use((req, res, next) => {
  if (!req.user || !req.user.company_id) return next();
  shellContext.load(req.user.company_id)
    .then((ctx) => { req.user.shell = ctx; next(); })
    .catch(next);
});

app.use('/',     requireAuth, denyWritesForReadOnly, require('./routes/documents'));
app.use('/',     requireAuth, denyWritesForReadOnly, require('./routes/carbonImport'));
app.use('/',     requireAuth, denyWritesForReadOnly, require('./routes/greenFinance'));
app.use('/',     requireAuth, denyWritesForReadOnly, require('./routes/journey'));
app.use('/',     requireAuth, denyWritesForReadOnly, require('./routes/improvement'));
// pages.js stays LAST of the page routers: its `/:id` patterns are broad enough
// to swallow a sibling module's path if it is mounted above one.
app.use('/',     requireAuth, denyWritesForReadOnly, require('./routes/pages'));

// 404
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  // A request with a file extension is an asset, not a page. Answering it with
  // a rendered HTML shell wastes ~97 KB and, worse, returns Content-Type
  // text/html for something the browser asked for as an image or a script.
  if (/\.[a-z0-9]{2,5}$/i.test(req.path)) return res.status(404).type('txt').send('Not found');
  const { layout } = require('./utils/layout');
  res.status(404).send(layout('Not found',
    '<div class="empty-state"><div class="es-icon">🔍</div><h3>Page not found</h3></div>',
    req.user, ''));
});

// Error handler. Logs the stack, returns a message — never the stack — to the
// caller, and always answers: an async route that throws with no handler leaves
// the request hanging, which reads as a network fault and produces no useful log.
app.use((err, req, res, next) => {
  console.error('❌', req.method, req.originalUrl, '→', err.stack || err.message);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: IS_PROD ? 'Internal error' : err.message });
  }
  const { layout, esc } = require('./utils/layout');
  res.status(500).send(layout('Something went wrong', `
    <div class="empty-state"><div class="es-icon">⚠️</div>
      <h3>Something went wrong</h3>
      <p>${esc(IS_PROD ? 'The team has been notified. Please try again.' : err.message)}</p>
    </div>`, req.user, ''));
});

// ── Boot ───────────────────────────────────────────────────────────────────
async function start() {
  await initDb();                       // throws → process exits → deploy fails
  startWorker();
  if (verra.ingestEnabled()) {
    await enqueue(verra.JOB_TYPE, { country: 'Malaysia' });
  }
  app.listen(PORT, () => {
    console.log(`✅ Malaysia SMEs ESG e-Reporting System listening on ${PORT} (${IS_PROD ? 'production' : 'development'})`);
  });
}

if (require.main === module) {
  start().catch((err) => { console.error('❌ Boot failed:', err.message); process.exit(1); });
}

module.exports = { app, start };

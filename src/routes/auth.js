'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const passport = require('passport');
const { query } = require('../db');
const { layout, esc } = require('../utils/layout');

const previewLock = require('../utils/previewLock');
const router = express.Router();

function authPage(title, body, error) {
  return layout(title, `
    <div class="card">
      <h2 style="margin-bottom:4px">${esc(title)}</h2>
      <p class="text-muted" style="margin-bottom:20px">Malaysia SMEs ESG e-Reporting System</p>
      ${error ? `<div class="badge badge-red" style="display:block;margin-bottom:16px">${esc(error)}</div>` : ''}
      ${body}
    </div>`, null, '');
}

router.get('/login', (req, res) => {
  const google = process.env.GOOGLE_CLIENT_ID
    ? `<a class="btn btn-outline" style="width:100%;margin-top:12px" href="/auth/google">Continue with Google</a>` : '';
  res.send(authPage('Sign in', `
    <form method="post" action="/auth/login">
      <div class="form-group"><label for="email">Email</label>
        <input id="email" name="email" type="email" required autocomplete="username"></div>
      <div class="form-group"><label for="password">Password</label>
        <input id="password" name="password" type="password" required autocomplete="current-password"></div>
      <button class="btn btn-primary" style="width:100%" type="submit">Sign in</button>
    </form>${google}
    <p class="text-muted" style="margin-top:16px">No account? <a href="/auth/register">Register your company</a></p>`,
    req.query.error));
});

router.post('/login',
  previewLock.guardCredentials,
  passport.authenticate('local', { failureRedirect: '/auth/login?error=Invalid+email+or+password' }),
  (req, res) => res.redirect('/dashboard'));

router.get('/register', (req, res) => {
  res.send(authPage('Register', `
    <form method="post" action="/auth/register">
      <div class="form-group"><label for="company">Company name</label>
        <input id="company" name="company" required></div>
      <div class="form-group"><label for="name">Your name</label>
        <input id="name" name="name" required></div>
      <div class="form-group"><label for="email">Email</label>
        <input id="email" name="email" type="email" required autocomplete="username"></div>
      <div class="form-group"><label for="password">Password (min 10 characters)</label>
        <input id="password" name="password" type="password" minlength="10" required autocomplete="new-password"></div>
      <button class="btn btn-primary" style="width:100%" type="submit">Create account</button>
    </form>`, req.query.error));
});

router.post('/register', previewLock.guardCredentials, async (req, res, next) => {
  try {
    const { company, name, email, password } = req.body;
    if (!company || !name || !email || !password || String(password).length < 10) {
      return res.redirect('/auth/register?error=All+fields+required,+password+min+10+characters');
    }
    const exists = await query('SELECT id FROM esg_users WHERE email = $1', [email]);
    if (exists.rowCount) return res.redirect('/auth/register?error=That+email+is+already+registered');

    const { rows: c } = await query(
      'INSERT INTO esg_companies (name) VALUES ($1) RETURNING id', [String(company).trim()]);
    const hash = await bcrypt.hash(String(password), 12);
    const { rows: u } = await query(
      `INSERT INTO esg_users (company_id, email, name, password_hash, role)
       VALUES ($1,$2,$3,$4,'company_admin')
       RETURNING id, email, name, role, company_id`,
      [c[0].id, String(email).trim().toLowerCase(), String(name).trim(), hash]);
    req.login(u[0], (err) => (err ? next(err) : res.redirect('/company')));
  } catch (err) { next(err); }
});

if (process.env.GOOGLE_CLIENT_ID) {
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
  router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth/login?error=Google+sign-in+failed' }),
  // The Google address is not known until passport has resolved the profile, so
    // the preview lock runs HERE rather than on /auth/google. A refused account
    // holds a session for the length of this handler and no longer.
    previewLock.guardSession,
    (req, res) => res.redirect('/dashboard'));
}

router.get('/logout', (req, res, next) => {
  req.logout((err) => (err ? next(err) : req.session.destroy(() => res.redirect('/auth/login'))));
});

module.exports = router;

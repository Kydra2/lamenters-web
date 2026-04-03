require("dotenv").config();
const express = require("express");
const session = require("express-session");
const axios   = require("axios");

const app = express();

// ─── Config ───────────────────────────────────────────────────────────────────
const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI,
  DISCORD_GUILD_ID,
  ALLOWED_ROLE_IDS,
  SESSION_SECRET,
  ADDON_DOWNLOAD_URL,
  PORT = 3000,
} = process.env;

const ALLOWED_ROLES = (ALLOWED_ROLE_IDS || "").split(",").map((r) => r.trim());

const DISCORD_OAUTH_URL =
  "https://discord.com/api/oauth2/authorize" +
  `?client_id=${DISCORD_CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=identify%20guilds.members.read`;

// ─── Middlewares ──────────────────────────────────────────────────────────────
// Ne pas mettre en cache le HTML (pour que les mises à jour soient immédiates)
app.use((req, res, next) => {
  if (req.path === "/" || req.path.endsWith(".html")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

app.use(express.static("public"));

app.use(
  session({
    secret: SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24h
    },
  })
);

// ─── Routes d'authentification ────────────────────────────────────────────────

// 1. Redirection vers Discord
app.get("/auth/discord", (req, res) => {
  res.redirect(DISCORD_OAUTH_URL);
});

// 2. Callback OAuth2
app.get("/auth/callback", async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect("/?error=cancelled");
  }

  try {
    // Échange du code contre un access token
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id:     DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type:    "authorization_code",
        code,
        redirect_uri:  DISCORD_REDIRECT_URI,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenRes.data.access_token;

    // Infos de l'utilisateur
    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = userRes.data;

    // Infos du membre dans la guilde (rôles)
    let hasAccess = false;
    let memberRoles = [];
    try {
      const memberRes = await axios.get(
        `https://discord.com/api/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      memberRoles = memberRes.data.roles || [];
      hasAccess = memberRoles.some((roleId) => ALLOWED_ROLES.includes(roleId));
      console.log(`[Auth] ${user.username} — roles: ${memberRoles.join(", ")}`);
      console.log(`[Auth] ALLOWED_ROLES: ${ALLOWED_ROLES.join(", ")}`);
      console.log(`[Auth] hasAccess: ${hasAccess}`);
    } catch (memberErr) {
      const status = memberErr.response?.status;
      const data   = memberErr.response?.data;
      console.error(`[Auth] Erreur guild member — status: ${status}`, data);
      hasAccess = false;
    }

    // Sauvegarde en session
    req.session.user = {
      id:        user.id,
      username:  user.username,
      avatar:    user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || 0) % 5}.png`,
      hasAccess,
    };

    res.redirect("/");
  } catch (err) {
    console.error("[Auth Error]", err.response?.data || err.message);
    res.redirect("/?error=auth_failed");
  }
});

// 3. Déconnexion
app.get("/auth/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// ─── API ──────────────────────────────────────────────────────────────────────

// Retourne les infos de l'utilisateur connecté (utilisé par le frontend)
app.get("/api/me", (req, res) => {
  res.json(req.session.user || null);
});

// ─── Téléchargement (protégé) ─────────────────────────────────────────────────
app.get("/download", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Non connecté" });
  }
  if (!req.session.user.hasAccess) {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const url = ADDON_DOWNLOAD_URL ||
    "https://github.com/AlexDN-dev/LamentersHelper/archive/refs/heads/main.zip";

  res.redirect(url);
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ Lamenters Web démarré sur http://0.0.0.0:${PORT}\n`);
});

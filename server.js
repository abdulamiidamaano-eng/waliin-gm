const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 60000
});

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL hin argamne.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   MEMORY
========================= */

const onlineUsers = new Map();
const socketUsers = new Map();
const clubs = new Map();

/* =========================
   HELPERS
========================= */

function cleanUsername(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 30);
}

function cleanText(value, max = 5000) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function makeId() {
  return crypto.randomUUID();
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashPassword(password, salt) {
  return crypto
    .createHash("sha256")
    .update(String(salt) + String(password))
    .digest("hex");
}

function authToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

async function getUserByToken(token) {
  if (!token) return null;

  const result = await pool.query(
    `SELECT id, username, email, bio, avatar
     FROM users
     WHERE token=$1
     LIMIT 1`,
    [token]
  );

  return result.rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await getUserByToken(authToken(req));

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error(err);

    res.status(500).json({
      ok: false,
      error: "Server error."
    });
  }
}

async function isBlocked(a, b) {
  const result = await pool.query(
    `SELECT 1
     FROM blocks
     WHERE (blocker=$1 AND blocked=$2)
        OR (blocker=$2 AND blocked=$1)
     LIMIT 1`,
    [a, b]
  );

  return result.rowCount > 0;
}

function addOnline(username, socketId) {
  if (!onlineUsers.has(username)) {
    onlineUsers.set(username, new Set());
  }

  onlineUsers.get(username).add(socketId);
  socketUsers.set(socketId, username);
}

function removeOnline(socketId) {
  const username = socketUsers.get(socketId);

  if (!username) return null;

  socketUsers.delete(socketId);

  const sockets = onlineUsers.get(username);

  if (sockets) {
    sockets.delete(socketId);

    if (sockets.size === 0) {
      onlineUsers.delete(username);
    }
  }

  return username;
}

async function notifyUser(username, type, message, data = {}) {
  const id = makeId();

  await pool.query(
    `INSERT INTO notifications
     (id,username,type,message,data,is_read,created_at)
     VALUES ($1,$2,$3,$4,$5,false,NOW())`,
    [
      id,
      username,
      type,
      message,
      JSON.stringify(data)
    ]
  );

  const sockets = onlineUsers.get(username);

  if (sockets) {
    for (const socketId of sockets) {
      io.to(socketId).emit("notification", {
        id,
        username,
        type,
        message,
        data
      });
    }
  }
}

/* =========================
   DATABASE
========================= */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      token TEXT,
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      password_reset_token TEXT,
      password_reset_expires TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id TEXT PRIMARY KEY,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      deleted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS follows (
      id TEXT PRIMARY KEY,
      follower TEXT NOT NULL,
      following TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(follower,following)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      blocker TEXT NOT NULL,
      blocked TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(blocker,blocked)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      data JSONB DEFAULT '{}'::jsonb,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gifts (
      id TEXT PRIMARY KEY,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      gift TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_history (
      id TEXT PRIMARY KEY,
      caller TEXT NOT NULL,
      receiver TEXT NOT NULL,
      call_type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TIMESTAMP DEFAULT NOW(),
      ended_at TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS club_messages (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_history (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  /* POSTS */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      image TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      username TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(post_id,username)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      username TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_reset_token TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP;
  `);

  console.log("🟢 Database ready.");
}

/* =========================
   HEALTH
========================= */

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      app: "Waliin-GM",
      database: true,
      online: onlineUsers.size,
      time: new Date().toISOString()
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      ok: false,
      database: false
    });
  }
});

/* =========================
   REGISTER
========================= */
app.post("/api/register", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");

    if (username.length < 3) {
      return res.status(400).json({
        ok: false,
        error: "Username yoo xiqqaate characters 3 qabaachuu qaba."
      });
    }

    if (!email.includes("@")) {
      return res.status(400).json({
        ok: false,
        error: "Email sirrii galchi."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        ok: false,
        error: "Password yoo xiqqaate characters 6 qabaachuu qaba."
      });
    }

    const exists = await pool.query(
      `SELECT id
       FROM users
       WHERE LOWER(username)=LOWER($1)
          OR LOWER(email)=LOWER($2)
       LIMIT 1`,
      [username, email]
    );

    if (exists.rowCount) {
      return res.status(409).json({
        ok: false,
        error: "Username ykn email duraan jira."
      });
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const token = makeToken();

    // Database'n id INTEGER waan ta'eef,
    // PostgreSQL'n ofumaan id haa uumu.
    const result = await pool.query(
      `INSERT INTO users
       (username,email,password_hash,salt,token,bio,avatar)
       VALUES ($1,$2,$3,$4,$5,'','')
       RETURNING id,username,email,bio,avatar`,
      [
        username,
        email,
        passwordHash,
        salt,
        token
      ]
    );

    const user = result.rows[0];

    await pool.query(
      `INSERT INTO activity_history
       (id,username,type,description)
       VALUES ($1,$2,$3,$4)`,
      [
        makeId(),
        username,
        "register",
        "Account created"
      ]
    );

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        bio: user.bio || "",
        avatar: user.avatar || ""
      }
    });

  } catch (err) {
    console.error("REGISTER ERROR:", err);

    res.status(500).json({
      ok: false,
      error: "Register failed."
    });
  }
});
/* =========================
   LOGIN
========================= */
app.post("/api/login", async (req, res) => {
  try {
    // Frontend irraa "value" dhufa
    const login = String(
      req.body.value || req.body.login || ""
    ).trim();

    const password = String(req.body.password || "");

    if (!login || !password) {
      return res.status(400).json({
        ok: false,
        error: "Username/email fi password guuti."
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM users
       WHERE LOWER(username)=LOWER($1)
          OR LOWER(email)=LOWER($1)
       LIMIT 1`,
      [login]
    );

    if (!result.rowCount) {
      return res.status(401).json({
        ok: false,
        error: "Username/email ykn password dogoggora."
      });
    }

    const user = result.rows[0];

    const hash = hashPassword(
      password,
      user.salt
    );

    if (hash !== user.password_hash) {
      return res.status(401).json({
        ok: false,
        error: "Username/email ykn password dogoggora."
      });
    }

    const token = makeToken();

    await pool.query(
      `UPDATE users
       SET token=$1
       WHERE id=$2`,
      [token, user.id]
    );

    await pool.query(
      `INSERT INTO activity_history
       (id,username,type,description)
       VALUES ($1,$2,$3,$4)`,
      [
        makeId(),
        user.username,
        "login",
        "User logged in"
      ]
    );

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        bio: user.bio || "",
        avatar: user.avatar || ""
      }
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);

    res.status(500).json({
      ok: false,
      error: "Login failed."
    });
  }
});

/* =========================
   LOGOUT
========================= */

app.post("/api/logout", requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE users
       SET token=NULL
       WHERE id=$1`,
      [req.user.id]
    );

    res.json({
      ok: true
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Logout failed."
    });
  }
});

/* =========================
   FORGOT PASSWORD
========================= */

app.post("/api/forgot-password", async (req, res) => {
  try {
    const login = String(req.body.login || "")
      .trim();

    const result = await pool.query(
      `SELECT id,username,email
       FROM users
       WHERE LOWER(username)=LOWER($1)
          OR LOWER(email)=LOWER($1)
       LIMIT 1`,
      [login]
    );

    if (!result.rowCount) {
      return res.json({
        ok: true,
        message: "Yoo account jira ta'e reset qophaa'eera."
      });
    }

    const user = result.rows[0];
    const resetToken = makeToken();

    await pool.query(
      `UPDATE users
       SET password_reset_token=$1,
           password_reset_expires=
             NOW()+INTERVAL '30 minutes'
       WHERE id=$2`,
      [resetToken, user.id]
    );

    /*
      MVP keessatti token deebifameera.
      Production keessatti email irratti erguun wayya.
    */

    res.json({
      ok: true,
      message: "Reset token qophaa'eera.",
      resetToken
    });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);

    res.status(500).json({
      ok: false,
      error: "Password reset failed."
    });
  }
});

/* =========================
   RESET PASSWORD
========================= */

app.post("/api/reset-password", async (req, res) => {
  try {
    const resetToken =
      String(req.body.resetToken || "").trim();

    const newPassword =
      String(req.body.password || "");

    if (!resetToken) {
      return res.status(400).json({
        ok: false,
        error: "Reset token barbaachisa."
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        ok: false,
        error: "Password yoo xiqqaate 6 qabaachuu qaba."
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM users
       WHERE password_reset_token=$1
         AND password_reset_expires>NOW()
       LIMIT 1`,
      [resetToken]
    );

    if (!result.rowCount) {
      return res.status(400).json({
        ok: false,
        error: "Reset token sirrii miti ykn yeroon isaa darbeera."
      });
    }

    const user = result.rows[0];

    const salt = crypto.randomBytes(16).toString("hex");

    const passwordHash =
      hashPassword(newPassword, salt);

    await pool.query(
      `UPDATE users
       SET password_hash=$1,
           salt=$2,
           password_reset_token=NULL,
           password_reset_expires=NULL,
           token=NULL
       WHERE id=$3`,
      [
        passwordHash,
        salt,
        user.id
      ]
    );

    res.json({
      ok: true,
      message: "Password haaraan jijjiirame."
    });
  } catch (err) {
    console.error("RESET ERROR:", err);

    res.status(500).json({
      ok: false,
      error: "Reset failed."
    });
  }
});

/* =========================
   PROFILE
========================= */

app.get("/api/profile/:username", async (req, res) => {
  try {
    const username =
      cleanUsername(req.params.username);

    const result = await pool.query(
      `SELECT id,username,email,bio,avatar,created_at
       FROM users
       WHERE LOWER(username)=LOWER($1)
       LIMIT 1`,
      [username]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        ok: false,
        error: "User hin argamne."
      });
    }

    const user = result.rows[0];

    const followers = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM follows
       WHERE following=$1`,
      [user.username]
    );

    const following = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM follows
       WHERE follower=$1`,
      [user.username]
    );

    res.json({
      ok: true,
      user,
      followers: followers.rows[0].count,
      following: following.rows[0].count
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      ok: false,
      error: "Profile failed."
    });
  }
});

app.post("/api/profile/update", requireAuth, async (req, res) => {
  try {
    const bio = cleanText(req.body.bio, 500);

    const avatar = String(
      req.body.avatar || ""
    ).slice(0, 2000000);

    await pool.query(
      `UPDATE users
       SET bio=$1,avatar=$2
       WHERE id=$3`,
      [
        bio,
        avatar,
        req.user.id
      ]
    );

    res.json({
      ok: true,
      message: "Profile updated."
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      ok: false,
      error: "Profile update failed."
    });
  }
});

/* =========================
   SEARCH
========================= */

app.get("/api/users/search", async (req, res) => {
  try {
    const q = cleanText(
      req.query.q,
      50
    );

    const result = await pool.query(
      `SELECT username,bio,avatar
       FROM users
       WHERE username ILIKE $1
       ORDER BY username
       LIMIT 30`,
      [`%${q}%`]
    );

    res.json({
      ok: true,
      users: result.rows
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Search failed."
    });
  }
});

/* =========================
   ONLINE USERS
========================= */

app.get("/api/users/online", async (req, res) => {
  try {
    const usernames = [
      ...onlineUsers.keys()
    ];

    if (!usernames.length) {
      return res.json({
        ok: true,
        users: []
      });
    }

    const result = await pool.query(
      `SELECT username,bio,avatar
       FROM users
       WHERE username=ANY($1::text[])`,
      [usernames]
    );

    res.json({
      ok: true,
      users: result.rows
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Online users failed."
    });
  }
});

/* =========================
   FOLLOW
========================= */

app.post("/api/follow", requireAuth, async (req, res) => {
  try {
    const follower =
      req.user.username;

    const following =
      cleanUsername(req.body.following);

    if (!following ||
        follower === following) {
      return res.status(400).json({
        ok: false,
        error: "Follow hin danda'amu."
      });
    }

    const user = await pool.query(
      `SELECT username
       FROM users
       WHERE LOWER(username)=LOWER($1)
       LIMIT 1`,
      [following]
    );

    if (!user.rowCount) {
      return res.status(404).json({
        ok: false,
        error: "User hin argamne."
      });
    }

    const existing = await pool.query(
      `SELECT id
       FROM follows
       WHERE follower=$1
         AND following=$2`,
      [
        follower,
        following
      ]
    );

    if (existing.rowCount) {
      await pool.query(
        `DELETE FROM follows
         WHERE follower=$1
           AND following=$2`,
        [
          follower,
          following
        ]
      );

      return res.json({
        ok: true,
        following: false
      });
    }

    await pool.query(
      `INSERT INTO follows
       (id,follower,following)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [
        makeId(),
        follower,
        following
      ]
    );

    await notifyUser(
      following,
      "follow",
      `${follower} si hordofe.`,
      { follower }
    );

    res.json({
      ok: true,
      following: true
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      ok: false,
      error: "Follow failed."
    });
  }
});

app.get("/api/follow/status", requireAuth, async (req, res) => {
  try {
    const following =
      cleanUsername(req.query.following);

    const result = await pool.query(
      `SELECT id
       FROM follows
       WHERE follower=$1
         AND following=$2`,
      [
        req.user.username,
        following
      ]
    );

    res.json({
      ok: true,
      following: result.rowCount > 0
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Follow status failed."
    });
  }
});

/* =========================
   BLOCK
========================= */

app.post("/api/block", requireAuth, async (req, res) => {
  try {
    const blocker =
      req.user.username;

    const blocked =
      cleanUsername(req.body.blocked);

    if (!blocked ||
        blocker === blocked) {
      return res.status(400).json({
        ok: false,
        error: "Block hin danda'amu."
      });
    }

    const existing = await pool.query(
      `SELECT id
       FROM blocks
       WHERE blocker=$1
         AND blocked=$2`,
      [
        blocker,
        blocked
      ]
    );

    if (existing.rowCount) {
      await pool.query(
        `DELETE FROM blocks
         WHERE blocker=$1
           AND blocked=$2`,
        [
          blocker,
          blocked
        ]
      );

      return res.json({
        ok: true,
        blocked: false
      });
    }

    await pool.query(
      `INSERT INTO blocks
       (id,blocker,blocked)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [
        makeId(),
        blocker,
        blocked
      ]
    );

    res.json({
      ok: true,
      blocked: true
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      ok: false,
      error: "Block failed."
    });
  }
});

app.get("/api/block/status", requireAuth, async (req, res) => {
  try {
    const username =
      cleanUsername(req.query.username);

    const result = await pool.query(
      `SELECT id
       FROM blocks
       WHERE blocker=$1
         AND blocked=$2`,
      [
        req.user.username,
        username
      ]
    );

    res.json({
      ok: true,
      blocked: result.rowCount > 0
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Block status failed."
    });
  }
});

/* =========================
   PRIVATE MESSAGES
========================= */

app.get("/api/messages", requireAuth, async (req, res) => {
  try {
    const other =
      cleanUsername(req.query.user2);

    if (!other) {
      return res.status(400).json({
        ok: false,
        error: "user2 barbaachisa."
      });
    }

    const result = await pool.query(
      `SELECT id,sender,receiver,message,
              is_read,deleted,created_at
       FROM private_messages
       WHERE
       (sender=$1 AND receiver=$2)
       OR
       (sender=$2 AND receiver=$1)
       ORDER BY created_at ASC
       LIMIT 500`,
      [
        req.user.username,
        other
      ]
    );

    res.json({
      ok: true,
      messages: result.rows
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      ok: false,
      error: "Messages failed."
    });
  }
});

app.get(
  "/api/messages/unread/:username",
  requireAuth,
  async (req, res) => {
    try {
      const username =
        cleanUsername(req.params.username);

      const result = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM private_messages
         WHERE receiver=$1
           AND sender=$2
           AND is_read=false
           AND deleted=false`,
        [
          req.user.username,
          username
        ]
      );

      res.json({
        ok: true,
        count: result.rows[0].count
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: "Unread count failed."
      });
    }
  }
);

/* =========================
   NOTIFICATIONS
========================= */

app.get(
  "/api/notifications/:username",
  requireAuth,
  async (req, res) => {
    try {
      const username =
        cleanUsername(req.params.username);

      if (username !== req.user.username) {
        return res.status(403).json({
          ok: false,
          error: "Forbidden"
        });
      }

      const result = await pool.query(
        `SELECT *
         FROM notifications
         WHERE username=$1
         ORDER BY created_at DESC
         LIMIT 100`,
        [username]
      );

      res.json({
        ok: true,
        notifications: result.rows
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: "Notifications failed."
      });
    }
  }
);

app.get(
  "/api/notifications/unread-count/:username",
  requireAuth,
  async (req, res) => {
    try {
      const username =
        cleanUsername(req.params.username);

      const result = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM notifications
         WHERE username=$1
           AND is_read=false`,
        [username]
      );

      res.json({
        ok: true,
        count: result.rows[0].count
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: "Unread notifications failed."
      });
    }
  }
);

app.post(
  "/api/notifications/read",
  requireAuth,
  async (req, res) => {
    try {
      await pool.query(
        `UPDATE notifications
         SET is_read=true
         WHERE username=$1`,
        [req.user.username]
      );

      res.json({
        ok: true
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: "Notification read failed."
      });
    }
  }
);

/* =========================
   CALL HISTORY
========================= */

app.get(
  "/api/call-history",
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT *
         FROM call_history
         WHERE caller=$1
            OR receiver=$1
         ORDER BY started_at DESC
         LIMIT 100`,
        [req.user.username]
      );

      res.json({
        ok: true,
        history: result.rows
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: "Call history failed."
      });
    }
  }
);

/* =========================
   ACTIVITY HISTORY
========================= */

app.get(
  "/api/history",
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT *
         FROM activity_history
         WHERE username=$1
         ORDER BY created_at DESC
         LIMIT 200`,
        [req.user.username]
      );

      res.json({
        ok: true,
        history: result.rows
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: "History failed."
      });
    }
  }
);

/* =====================================================
   POSTS
===================================================== */

/* GET POSTS */

app.get(
  "/api/posts",
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           p.id,
           p.username,
           p.content,
           p.image,
           p.created_at,
           u.avatar,

           COALESCE(
             (
               SELECT COUNT(*)::int
               FROM post_likes pl
               WHERE pl.post_id=p.id
             ),
             0
           ) AS likes,

           COALESCE(
             (
               SELECT COUNT(*)::int
               FROM post_comments pc
               WHERE pc.post_id=p.id
             ),
             0
           ) AS comments,

           EXISTS(
             SELECT 1
             FROM post_likes me
             WHERE me.post_id=p.id
               AND me.username=$1
           ) AS liked

         FROM posts p

         LEFT JOIN users u
           ON LOWER(u.username)=LOWER(p.username)

         ORDER BY p.created_at DESC

         LIMIT 100`,
        [req.user.username]
      );

      res.json({
        ok: true,
        posts: result.rows
      });
    } catch (err) {
      console.error("GET POSTS ERROR:", err);

      res.status(500).json({
        ok: false,
        error: "Posts fe'uu hin argamne."
      });
    }
  }
);

/* CREATE POST */

app.post(
  "/api/posts",
  requireAuth,
  async (req, res) => {
    try {
      const content =
        cleanText(req.body.content, 5000);

      const image =
        String(req.body.image || "")
          .trim()
          .slice(0, 2000000);

      if (!content && !image) {
        return res.status(400).json({
          ok: false,
          error: "Post ykn suuraa galchi."
        });
      }

      if (image) {
        const validImage =
          image.startsWith("https://") ||
          image.startsWith("http://") ||
          image.startsWith("data:image/");

        if (!validImage) {
          return res.status(400).json({
            ok: false,
            error: "Image URL sirrii miti."
          });
        }
      }

      const id = makeId();

      await pool.query(
        `INSERT INTO posts
         (id,username,content,image)
         VALUES ($1,$2,$3,$4)`,
        [
          id,
          req.user.username,
          content,
          image
        ]
      );

      await pool.query(
        `INSERT INTO activity_history
         (id,username,type,description)
         VALUES ($1,$2,$3,$4)`,
        [
          makeId(),
          req.user.username,
          "post",
          "New post created"
        ]
      );

      res.json({
        ok: true,
        message: "Post milkaa'inaan maxxanfame.",
        postId: id
      });
    } catch (err) {
      console.error("CREATE POST ERROR:", err);

      res.status(500).json({
        ok: false,
        error: "Post uumuu hin dandeenye."
      });
    }
  }
);

/* DELETE POST */

app.delete(
  "/api/posts/:id",
  requireAuth,
  async (req, res) => {
    try {
      const id =
        String(req.params.id || "");

      const result = await pool.query(
        `DELETE FROM posts
         WHERE id=$1
           AND username=$2
         RETURNING id`,
        [
          id,
          req.user.username
        ]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          ok: false,
          error: "Post hin argamne ykn kan kee miti."
        });
      }

      await pool.query(
        `DELETE FROM post_likes
         WHERE post_id=$1`,
        [id]
      );

      await pool.query(
        `DELETE FROM post_comments
         WHERE post_id=$1`,
        [id]
      );

      res.json({
        ok: true,
        message: "Post haqame."
      });
    } catch (err) {
      console.error("DELETE POST ERROR:", err);

      res.status(500).json({
        ok: false,
        error: "Post haquu hin dandeenye."
      });
    }
  }
);

/* LIKE */

app.post(
  "/api/posts/:id/like",
  requireAuth,
  async (req, res) => {
    try {
      const postId =
        String(req.params.id || "");

      const username =
        req.user.username;

      const post = await pool.query(
        `SELECT username
         FROM posts
         WHERE id=$1`,
        [postId]
      );

      if (!post.rowCount) {
        return res.status(404).json({
          ok: false,
          error: "Post hin argamne."
        });
      }

      const existing =
        await pool.query(
          `SELECT id
           FROM post_likes
           WHERE post_id=$1
             AND username=$2`,
          [
            postId,
            username
          ]
        );

      if (existing.rowCount) {
        await pool.query(
          `DELETE FROM post_likes
           WHERE post_id=$1
             AND username=$2`,
          [
            postId,
            username
          ]
        );

        const count =
          await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM post_likes
             WHERE post_id=$1`,
            [postId]
          );

        return res.json({
          ok: true,
          liked: false,
          likes: count.rows[0].count
        });
      }

      await pool.query(
        `INSERT INTO post_likes
         (id,post_id,username)
         VALUES ($1,$2,$3)
         ON CONFLICT(post_id,username)
         DO NOTHING`,
        [
          makeId(),
          postId,
          username
        ]
      );

      if (
        post.rows[0].username !== username
      ) {
        await notifyUser(
          post.rows[0].username,
          "post_like",
          `${username} post kee jaalate.`,
          {
            postId,
            username
          }
        );
      }

      const count =
        await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM post_likes
           WHERE post_id=$1`,
          [postId]
        );

      res.json({
        ok: true,
        liked: true,
        likes: count.rows[0].count
      });
    } catch (err) {
      console.error("LIKE ERROR:", err);

      res.status(500).json({
        ok: false,
        error: "Like hin hojjenne."
      });
    }
  }
);

/* GET COMMENTS */

app.get(
  "/api/posts/:id/comments",
  requireAuth,
  async (req, res) => {
    try {
      const postId =
        String(req.params.id || "");

      const result = await pool.query(
        `SELECT
           pc.id,
           pc.username,
           pc.comment,
           pc.created_at,
           u.avatar

         FROM post_comments pc

         LEFT JOIN users u
           ON LOWER(u.username)=
              LOWER(pc.username)

         WHERE pc.post_id=$1

         ORDER BY pc.created_at ASC

         LIMIT 100`,
        [postId]
      );

      res.json({
        ok: true,
        comments: result.rows
      });
    } catch (err) {
      console.error(
        "COMMENTS ERROR:",
        err
      );

      res.status(500).json({
        ok: false,
        error: "Comments hin argamne."
      });
    }
  }
);

/* ADD COMMENT */

app.post(
  "/api/posts/:id/comments",
  requireAuth,
  async (req, res) => {
    try {
      const postId =
        String(req.params.id || "");

      const comment =
        cleanText(req.body.comment, 1000);

      if (!comment) {
        return res.status(400).json({
          ok: false,
          error: "Comment barreessi."
        });
      }

      const post = await pool.query(
        `SELECT username
         FROM posts
         WHERE id=$1`,
        [postId]
      );

      if (!post.rowCount) {
        return res.status(404).json({
          ok: false,
          error: "Post hin argamne."
        });
      }

      const id = makeId();

      await pool.query(
        `INSERT INTO post_comments
         (id,post_id,username,comment)
         VALUES ($1,$2,$3,$4)`,
        [
          id,
          postId,
          req.user.username,
          comment
        ]
      );

      if (
        post.rows[0].username !==
        req.user.username
      ) {
        await notifyUser(
          post.rows[0].username,
          "post_comment",
          `${req.user.username} post kee irratti comment godhe.`,
          {
            postId,
            username:
              req.user.username
          }
        );
      }

      res.json({
        ok: true,
        comment: {
          id,
          post_id: postId,
          username:
            req.user.username,
          comment,
          created_at: new Date()
        }
      });
    } catch (err) {
      console.error(
        "ADD COMMENT ERROR:",
        err
      );

      res.status(500).json({
        ok: false,
        error: "Comment hin ergamne."
      });
    }
  }
);

/* =====================================================
   SOCKET.IO
===================================================== */

io.on("connection", socket => {
  console.log(
    "🟢 Socket connected:",
    socket.id
  );

  /* IDENTIFY */

  socket.on("identify", data => {
    try {
      const username =
        cleanUsername(data?.username);

      if (!username) return;

      socket.username = username;

      addOnline(
        username,
        socket.id
      );

      socket.emit(
        "presenceUpdate",
        {
          username,
          online: true
        }
      );

      io.emit(
        "presenceUpdate",
        {
          username,
          online: true
        }
      );
    } catch (err) {
      console.error(err);
    }
  });

  /* =========================
     PRIVATE CHAT
  ========================= */

  socket.on(
    "privateMessage",
    async data => {
      try {
        const sender =
          socket.username;

        const receiver =
          cleanUsername(
            data?.receiver
          );

        const message =
          cleanText(
            data?.message
          );

        if (
          !sender ||
          !receiver ||
          !message
        ) {
          return;
        }

        if (
          await isBlocked(
            sender,
            receiver
          )
        ) {
          return socket.emit(
            "messageError",
            {
              error:
                "User tokko block godhameera."
            }
          );
        }

        const id = makeId();

        await pool.query(
          `INSERT INTO private_messages
           (id,sender,receiver,message,
            is_read,deleted)
           VALUES
           ($1,$2,$3,$4,false,false)`,
          [
            id,
            sender,
            receiver,
            message
          ]
        );

        const msg = {
          id,
          sender,
          receiver,
          message,
          is_read: false,
          deleted: false,
          created_at:
            new Date()
        };

        socket.emit(
          "privateMessage",
          msg
        );

        const targets =
          onlineUsers.get(
            receiver
          );

        if (targets) {
          for (
            const socketId of targets
          ) {
            io.to(socketId).emit(
              "privateMessage",
              msg
            );
          }
        }

        await notifyUser(
          receiver,
          "message",
          `${sender} siif ergaa erge.`,
          {
            sender,
            messageId: id
          }
        );
      } catch (err) {
        console.error(
          "PRIVATE MESSAGE ERROR:",
          err
        );

        socket.emit(
          "messageError",
          {
            error:
              "Message hin ergamne."
          }
        );
      }
    }
  );

  /* MESSAGE READ */

  socket.on(
    "messageRead",
    async data => {
      try {
        const reader =
          socket.username;

        const sender =
          cleanUsername(
            data?.sender
          );

        if (
          !reader ||
          !sender
        ) {
          return;
        }

        await pool.query(
          `UPDATE private_messages
           SET is_read=true
           WHERE sender=$1
             AND receiver=$2
             AND is_read=false`,
          [
            sender,
            reader
          ]
        );

        const sockets =
          onlineUsers.get(
            sender
          );

        if (sockets) {
          for (
            const socketId of sockets
          ) {
            io.to(socketId).emit(
              "messageRead",
              {
                reader
              }
            );
          }
        }
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* DELETE MESSAGE */

  socket.on(
    "deleteMessage",
    async data => {
      try {
        const id =
          String(data?.id || "");

        if (
          !id ||
          !socket.username
        ) {
          return;
        }

        const result =
          await pool.query(
            `UPDATE private_messages
             SET deleted=true,
                 message='Ergaan haqameera.'
             WHERE id=$1
               AND sender=$2
             RETURNING id,sender,receiver`,
            [
              id,
              socket.username
            ]
          );

        if (!result.rowCount) {
          return;
        }

        const msg =
          result.rows[0];

        const targets =
          new Set();

        targets.add(socket.id);

        const receiverSockets =
          onlineUsers.get(
            msg.receiver
          );

        if (receiverSockets) {
          for (
            const sid
              of receiverSockets
          ) {
            targets.add(sid);
          }
        }

        for (
          const sid of targets
        ) {
          io.to(sid).emit(
            "messageDeleted",
            {
              id
            }
          );
        }
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* =========================
     VOICE / VIDEO CALL
  ========================= */

  socket.on(
    "callUser",
    async data => {
      try {
        const from =
          socket.username;

        const username =
          cleanUsername(
            data?.username
          );

        const callType =
          data?.callType === "video"
            ? "video"
            : "voice";

        if (
          !from ||
          !username
        ) {
          return;
        }

        if (
          await isBlocked(
            from,
            username
          )
        ) {
          return socket.emit(
            "callUnavailable",
            {
              username,
              reason: "blocked"
            }
          );
        }

        const targets =
          onlineUsers.get(
            username
          );

        const historyId =
          makeId();

        await pool.query(
          `INSERT INTO call_history
           (id,caller,receiver,
            call_type,status)
           VALUES
           ($1,$2,$3,$4,$5)`,
          [
            historyId,
            from,
            username,
            callType,
            "calling"
          ]
        );

        if (
          !targets ||
          targets.size === 0
        ) {
          socket.emit(
            "callUnavailable",
            {
              username,
              callType
            }
          );

          await pool.query(
            `UPDATE call_history
             SET status='unanswered',
                 ended_at=NOW()
             WHERE id=$1`,
            [historyId]
          );

          return;
        }

        for (
          const socketId
            of targets
        ) {
          io.to(socketId).emit(
            "incomingCall",
            {
              from,
              callType,
              callerSocketId:
                socket.id,
              historyId
            }
          );
        }

        socket.emit(
          "callStarted",
          {
            historyId,
            username,
            callType
          }
        );
      } catch (err) {
        console.error(
          "CALL ERROR:",
          err
        );
      }
    }
  );

  /* ACCEPT CALL */

  socket.on(
    "acceptCall",
    data => {
      try {
        const callerSocketId =
          String(
            data?.callerSocketId ||
            ""
          );

        const callType =
          data?.callType === "video"
            ? "video"
            : "voice";

        if (!callerSocketId) {
          return;
        }

        io.to(
          callerSocketId
        ).emit(
          "callAccepted",
          {
            targetSocketId:
              socket.id,
            targetUsername:
              socket.username,
            callType
          }
        );
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* REJECT CALL */

  socket.on(
    "rejectCall",
    data => {
      const callerSocketId =
        String(
          data?.callerSocketId ||
          ""
        );

      if (callerSocketId) {
        io.to(
          callerSocketId
        ).emit(
          "callRejected",
          {
            username:
              socket.username
          }
        );
      }
    }
  );

  /* END CALL */

  socket.on(
    "endCall",
    async data => {
      try {
        const targetSocketId =
          String(
            data?.targetSocketId ||
            ""
          );

        if (targetSocketId) {
          io.to(
            targetSocketId
          ).emit(
            "callEnded",
            {
              username:
                socket.username
            }
          );
        }

        const username =
          cleanUsername(
            data?.username
          );

        if (username) {
          await pool.query(
            `UPDATE call_history
             SET status='ended',
                 ended_at=NOW()
             WHERE
             (
               (caller=$1 AND receiver=$2)
               OR
               (caller=$2 AND receiver=$1)
             )
             AND ended_at IS NULL`,
            [
              socket.username,
              username
            ]
          );
        }
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* =========================
     WEBRTC
  ========================= */

  socket.on(
    "webrtc-offer",
    data => {
      const target =
        String(
          data?.targetSocketId ||
          ""
        );

      if (!target) return;

      io.to(target).emit(
        "webrtc-offer",
        {
          offer: data.offer,
          fromSocketId:
            socket.id
        }
      );
    }
  );

  socket.on(
    "webrtc-answer",
    data => {
      const target =
        String(
          data?.targetSocketId ||
          ""
        );

      if (!target) return;

      io.to(target).emit(
        "webrtc-answer",
        {
          answer: data.answer,
          fromSocketId:
            socket.id
        }
      );
    }
  );

  socket.on(
    "webrtc-ice",
    data => {
      const target =
        String(
          data?.targetSocketId ||
          ""
        );

      if (!target) return;

      io.to(target).emit(
        "webrtc-ice",
        {
          candidate:
            data.candidate,
          fromSocketId:
            socket.id
        }
      );
    }
  );

  /* =====================================================
     CLUB
  ===================================================== */

  /* CREATE CLUB */

  socket.on(
    "createClub",
    async (data, callback) => {
      try {
        const username =
          socket.username ||
          cleanUsername(
            data?.username
          );

        const name =
          cleanText(
            data?.name,
            100
          );

        if (
          !username ||
          !name
        ) {
          return callback?.({
            ok: false,
            error:
              "Maqaa club barbaachisa."
          });
        }

        const clubId =
          "GM-" +
          crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase();

        const seats =
          Array.from(
            { length: 15 },
            (_, index) => ({
              seat: index + 1,
              username:
                index === 0
                  ? username
                  : null,
              muted: false
            })
          );

        const club = {
          id: clubId,
          name,
          owner: username,
          members:
            new Set([username]),
          seats,
          messages: [],
          createdAt:
            new Date()
        };

        clubs.set(
          clubId,
          club
        );

        socket.clubId =
          clubId;

        socket.join(
          clubId
        );

        await pool.query(
          `INSERT INTO activity_history
           (id,username,type,description)
           VALUES ($1,$2,$3,$4)`,
          [
            makeId(),
            username,
            "club_create",
            `Club created: ${name}`
          ]
        );

        const dataOut =
          clubData(club);

        callback?.({
          ok: true,
          club: dataOut
        });

        io.to(
          clubId
        ).emit(
          "clubUpdated",
          dataOut
        );
      } catch (err) {
        console.error(
          "CREATE CLUB ERROR:",
          err
        );

        callback?.({
          ok: false,
          error:
            "Club uumuu hin dandeenye."
        });
      }
    }
  );

  /* JOIN CLUB */

  socket.on(
    "joinClub",
    async (data, callback) => {
      try {
        const username =
          socket.username ||
          cleanUsername(
            data?.username
          );

        const clubId =
          String(
            data?.clubId || ""
          ).trim();

        const club =
          clubs.get(clubId);

        if (!club) {
          return callback?.({
            ok: false,
            error:
              "Club hin argamne."
          });
        }

        if (!username) {
          return callback?.({
            ok: false,
            error:
              "Username barbaachisa."
          });
        }

        club.members.add(
          username
        );

        socket.clubId =
          clubId;

        socket.join(
          clubId
        );

        const dbMessages =
          await pool.query(
            `SELECT
               id,
               username,
               message,
               created_at
             FROM club_messages
             WHERE club_id=$1
             ORDER BY created_at ASC
             LIMIT 200`,
            [clubId]
          );

        club.messages =
          dbMessages.rows;

        const dataOut =
          clubData(club);

        callback?.({
          ok: true,
          club: dataOut
        });

        io.to(
          clubId
        ).emit(
          "clubUpdated",
          dataOut
        );
      } catch (err) {
        console.error(err);

        callback?.({
          ok: false,
          error:
            "Club seenuu hin dandeenye."
        });
      }
    }
  );

  /* REQUEST SEAT */

  socket.on(
    "requestSeat",
    () => {
      try {
        if (!socket.clubId) {
          return;
        }

        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        io.to(
          socket.clubId
        ).emit(
          "seatRequest",
          {
            username:
              socket.username
          }
        );
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* GIVE SEAT */

  socket.on(
    "giveSeat",
    data => {
      try {
        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        if (
          club.owner !==
          socket.username
        ) {
          return;
        }

        const username =
          cleanUsername(
            data?.username
          );

        const seatNumber =
          Number(data?.seat);

        if (
          !Number.isInteger(
            seatNumber
          ) ||
          seatNumber < 1 ||
          seatNumber > 15
        ) {
          return;
        }

        for (
          const seat
            of club.seats
        ) {
          if (
            seat.username ===
            username
          ) {
            seat.username =
              null;

            seat.muted =
              false;
          }
        }

        const targetSeat =
          club.seats.find(
            seat =>
              seat.seat ===
              seatNumber
          );

        if (!targetSeat) {
          return;
        }

        if (
          targetSeat.username &&
          targetSeat.username !==
            username
        ) {
          return;
        }

        targetSeat.username =
          username;

        targetSeat.muted =
          false;

        io.to(
          socket.clubId
        ).emit(
          "clubUpdated",
          clubData(club)
        );
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* LEAVE SEAT */

  socket.on(
    "leaveSeat",
    () => {
      try {
        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        const seat =
          club.seats.find(
            s =>
              s.username ===
              socket.username
          );

        if (seat) {
          seat.username =
            null;

          seat.muted =
            false;
        }

        io.to(
          socket.clubId
        ).emit(
          "clubUpdated",
          clubData(club)
        );
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* MUTE SELF */

  socket.on(
    "muteSelf",
    data => {
      try {
        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        const seat =
          club.seats.find(
            s =>
              s.username ===
              socket.username
          );

        if (!seat) return;

        seat.muted =
          Boolean(
            data?.muted
          );

        io.to(
          socket.clubId
        ).emit(
          "clubUpdated",
          clubData(club)
        );
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* OWNER MUTE */

  socket.on(
    "ownerMute",
    data => {
      try {
        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        if (
          club.owner !==
          socket.username
        ) {
          return;
        }

        const username =
          cleanUsername(
            data?.username
          );

        const seat =
          club.seats.find(
            s =>
              s.username ===
              username
          );

        if (!seat) return;

        seat.muted =
          !seat.muted;

        io.to(
          socket.clubId
        ).emit(
          "clubUpdated",
          clubData(club)
        );
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* REMOVE MEMBER */

  socket.on(
    "removeMember",
    data => {
      try {
        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        if (
          club.owner !==
          socket.username
        ) {
          return;
        }

        const username =
          cleanUsername(
            data?.username
          );

        if (
          username ===
          club.owner
        ) {
          return;
        }

        club.members.delete(
          username
        );

        for (
          const seat
            of club.seats
        ) {
          if (
            seat.username ===
            username
          ) {
            seat.username =
              null;

            seat.muted =
              false;
          }
        }

        for (
          const [
            socketId,
            name
          ] of socketUsers
        ) {
          if (
            name ===
            username
          ) {
            io.to(
              socketId
            ).emit(
              "removedFromClub",
              {
                clubId:
                  club.id
              }
            );

            const targetSocket =
              io.sockets.sockets.get(
                socketId
              );

            if (targetSocket) {
              targetSocket.leave(
                club.id
              );

              targetSocket.clubId =
                null;
            }
          }
        }

        io.to(
          club.id
        ).emit(
          "clubUpdated",
          clubData(club)
        );
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* CLUB CHAT */

  socket.on(
    "chatMessage",
    async data => {
      try {
        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        const message =
          cleanText(
            data?.message
          );

        if (!message) {
          return;
        }

        const item = {
          id: makeId(),
          club_id:
            club.id,
          username:
            socket.username,
          message,
          created_at:
            new Date()
        };

        await pool.query(
          `INSERT INTO club_messages
           (id,club_id,username,message)
           VALUES ($1,$2,$3,$4)`,
          [
            item.id,
            item.club_id,
            item.username,
            item.message
          ]
        );

        club.messages.push(
          item
        );

        if (
          club.messages.length >
          200
        ) {
          club.messages.shift();
        }

        io.to(
          club.id
        ).emit(
          "clubChatMessage",
          item
        );
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* GIFTS */

  socket.on(
    "sendGift",
    async data => {
      try {
        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        const giftList = [
          "❤️",
          "🌹",
          "🎁",
          "⭐",
          "👑"
        ];

        const gift =
          String(
            data?.gift || ""
          );

        if (
          !giftList.includes(
            gift
          )
        ) {
          return;
        }

        await pool.query(
          `INSERT INTO gifts
           (id,sender,receiver,gift)
           VALUES ($1,$2,$3,$4)`,
          [
            makeId(),
            socket.username,
            club.owner,
            gift
          ]
        );

        io.to(
          club.id
        ).emit(
          "giftReceived",
          {
            sender:
              socket.username,
            gift
          }
        );
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* CLUB MEMBERS */

  socket.on(
    "getClubMembers",
    () => {
      try {
        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        io.to(
          socket.id
        ).emit(
          "clubMembers",
          {
            members:
              [
                ...club.members
              ]
          }
        );
      } catch (err) {
        console.error(err);
      }
    }
  );

  /* CLUB WEBRTC */

  socket.on(
    "club-webrtc-offer",
    data => {
      const target =
        String(
          data?.targetSocketId ||
          ""
        );

      if (!target) return;

      io.to(target).emit(
        "club-webrtc-offer",
        {
          offer:
            data.offer,
          fromSocketId:
            socket.id,
          username:
            socket.username
        }
      );
    }
  );

  socket.on(
    "club-webrtc-answer",
    data => {
      const target =
        String(
          data?.targetSocketId ||
          ""
        );

      if (!target) return;

      io.to(target).emit(
        "club-webrtc-answer",
        {
          answer:
            data.answer,
          fromSocketId:
            socket.id
        }
      );
    }
  );

  socket.on(
    "club-webrtc-ice",
    data => {
      const target =
        String(
          data?.targetSocketId ||
          ""
        );

      if (!target) return;

      io.to(target).emit(
        "club-webrtc-ice",
        {
          candidate:
            data.candidate,
          fromSocketId:
            socket.id
        }
      );
    }
  );

  /* LEAVE CLUB */

  socket.on(
    "leaveClub",
    () => {
      leaveClub(socket);
    }
  );

  /* DISCONNECT */

  socket.on(
    "disconnect",
    () => {
      const username =
        removeOnline(
          socket.id
        );

      if (username) {
        io.emit(
          "presenceUpdate",
          {
            username,
            online: false
          }
        );
      }

      leaveClub(socket);

      console.log(
        "🔴 Socket disconnected:",
        socket.id
      );
    }
  );
});

/* =========================
   CLUB DATA
========================= */

function clubData(club) {
  return {
    id: club.id,
    name: club.name,
    owner: club.owner,
    members:
      [...club.members],
    seats: club.seats,
    messages:
      club.messages
  };
}

/* =========================
   LEAVE CLUB
========================= */

function leaveClub(socket) {
  try {
    const clubId =
      socket.clubId;

    if (!clubId) return;

    const club =
      clubs.get(clubId);

    if (!club) return;

    const username =
      socket.username;

    club.members.delete(
      username
    );

    for (
      const seat
        of club.seats
    ) {
      if (
        seat.username ===
        username
      ) {
        seat.username =
          null;

        seat.muted =
          false;
      }
    }

    socket.leave(
      clubId
    );

    socket.clubId =
      null;

    io.to(
      clubId
    ).emit(
      "clubMemberUpdate",
      clubData(club)
    );

    io.to(
      clubId
    ).emit(
      "clubUpdated",
      clubData(club)
    );

    if (
      club.members.size ===
      0
    ) {
      clubs.delete(
        clubId
      );
    }
  } catch (err) {
    console.error(
      "LEAVE CLUB ERROR:",
      err
    );
  }
}

/* =========================
   SPA FALLBACK
========================= */

app.get(
  "*",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================
   START
========================= */

async function start() {
  try {
    await initDatabase();

    server.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `🟢 Waliin-GM server running on port ${PORT}`
        );
      }
    );
  } catch (err) {
    console.error(
      "❌ SERVER START FAILED:",
      err
    );

    process.exit(1);
  }
}

start();

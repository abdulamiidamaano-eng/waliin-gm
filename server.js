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
  transports: ["websocket", "polling"]
});

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL hin argamne.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

/* =========================================================
   MEMORY
========================================================= */

const onlineUsers = new Map();
// username -> Set(socketId)

const socketUsers = new Map();
// socketId -> username

const clubs = new Map();
// clubId -> club object

/* =========================================================
   HELPERS
========================================================= */

function cleanUsername(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 50);
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

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(String(password))
    .digest("hex");
}

function authToken(req) {
  const header = req.headers.authorization || "";

  if (header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }

  return String(req.headers["x-auth-token"] || "").trim();
}

async function getUserByToken(token) {
  if (!token) return null;

  const result = await pool.query(
    `SELECT id, username, email, bio, avatar, status, coins
     FROM users
     WHERE token = $1
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
        error: "Login barbaachisa."
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("AUTH ERROR:", err);

    res.status(500).json({
      ok: false,
      error: "Server error."
    });
  }
}

async function isBlocked(username1, username2) {
  const result = await pool.query(
    `SELECT id
     FROM blocks
     WHERE (blocker_username = $1 AND blocked_username = $2)
        OR (blocker_username = $2 AND blocked_username = $1)
     LIMIT 1`,
    [username1, username2]
  );

  return result.rows.length > 0;
}

/* =========================================================
   ONLINE USERS
========================================================= */

function addOnline(username, socketId) {
  username = cleanUsername(username);

  if (!username) return;

  if (!onlineUsers.has(username)) {
    onlineUsers.set(username, new Set());
  }

  onlineUsers.get(username).add(socketId);
  socketUsers.set(socketId, username);
}

function removeOnline(socketId) {
  const username = socketUsers.get(socketId);

  if (!username) return;

  socketUsers.delete(socketId);

  const set = onlineUsers.get(username);

  if (!set) return;

  set.delete(socketId);

  if (set.size === 0) {
    onlineUsers.delete(username);
  }
}

function getUserSocketIds(username) {
  const set = onlineUsers.get(username);

  if (!set) return [];

  return [...set];
}

function sendToUser(username, event, data) {
  for (const socketId of getUserSocketIds(username)) {
    io.to(socketId).emit(event, data);
  }
}

function notifyUser(username, notification) {
  sendToUser(username, "notification", notification);
}

/* =========================================================
   CLUB DATA
========================================================= */

function createClubObject(id, name, owner, seatCount) {
  const seats = [];

  for (let i = 1; i <= seatCount; i++) {
    seats.push({
      seat: i,
      username: i === 1 ? owner : null,
      muted: false
    });
  }

  return {
    id,
    name,
    owner,
    seatCount,
    seats,
    members: new Set([owner]),
    seatRequests: new Set(),
    createdAt: Date.now()
  };
}

function getClubMemberList(club) {
  if (!club) return [];

  return [...club.members].map(username => {
    let seat = null;
    let muted = false;

    const found = club.seats.find(
      s => s.username === username
    );

    if (found) {
      seat = found.seat;
      muted = Boolean(found.muted);
    }

    return {
      username,
      seat,
      muted,
      owner: username === club.owner
    };
  });
}

/*
  IMPORTANT:

  Club Voice:
  - Seat users = speakers
  - No-seat members = listeners
  - All members can enter the voice room.
  - Only seated users can publish microphone.
*/

function getClubVoicePeers(club) {
  const peers = [];

  if (!club) return peers;

  for (const username of club.members) {
    const sockets = onlineUsers.get(username);

    if (!sockets) continue;

    const seatInfo =
      club.seats.find(
        s => s.username === username
      ) || null;

    for (const socketId of sockets) {
      const targetSocket =
        io.sockets.sockets.get(socketId);

      if (!targetSocket) continue;

      if (targetSocket.clubId !== club.id) {
        continue;
      }

      if (!targetSocket.clubVoiceReady) {
        continue;
      }

      peers.push({
        socketId,
        username,
        seat: seatInfo ? seatInfo.seat : null,
        muted: seatInfo
          ? Boolean(seatInfo.muted)
          : true,
        owner: username === club.owner,
        speaker: Boolean(seatInfo),
        listener: !seatInfo,
        voiceReady: true
      });
    }
  }

  return peers;
}

function broadcastClubVoicePeers(club) {
  if (!club) return;

  const peers = getClubVoicePeers(club);

  for (const username of club.members) {
    for (const socketId of getUserSocketIds(username)) {
      const socket =
        io.sockets.sockets.get(socketId);

      if (!socket) continue;

      if (socket.clubId !== club.id) continue;

      socket.emit("clubVoicePeers", {
        clubId: club.id,
        peers
      });
    }
  }
}

function broadcastClubMembers(club) {
  if (!club) return;

  const members = getClubMemberList(club);

  for (const username of club.members) {
    sendToUser(username, "clubMembers", {
      clubId: club.id,
      members
    });
  }
}

/* =========================================================
   DATABASE
========================================================= */

async function initDatabase() {
  console.log("🟡 Database initialization...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      token TEXT,
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      status TEXT DEFAULT 'offline',
      coins INTEGER DEFAULT 0,
      reset_token TEXT,
      reset_expires BIGINT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /*
    Existing Render database may have INTEGER id.
    Convert it to TEXT.
  */
  try {
    await pool.query(`
      ALTER TABLE users
      ALTER COLUMN id TYPE TEXT
      USING id::TEXT
    `);

    console.log("🟢 users.id converted to TEXT.");
  } catch (err) {
    const msg = String(err.message || "").toLowerCase();

    if (
      !msg.includes("already") &&
      !msg.includes("does not exist")
    ) {
      console.log(
        "ℹ️ users.id migration:",
        err.message
      );
    }
  }

  const columns = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS token TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'offline'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires BIGINT`
  ];

  for (const sql of columns) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.log("ℹ️ Column migration:", err.message);
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id TEXT PRIMARY KEY,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      message TEXT NOT NULL,
      deleted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS follows (
      id TEXT PRIMARY KEY,
      follower TEXT NOT NULL,
      following TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower, following)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      blocker_username TEXT NOT NULL,
      blocked_username TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(blocker_username, blocked_username)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gifts (
      id TEXT PRIMARY KEY,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      gift TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_history (
      id TEXT PRIMARY KEY,
      caller TEXT NOT NULL,
      receiver TEXT NOT NULL,
      call_type TEXT NOT NULL,
      status TEXT DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS club_messages (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_history (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      content TEXT DEFAULT '',
      image TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      username TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, username)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      username TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("🟢 Database ready.");
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      service: "Waliin-GM",
      database: "connected",
      port: PORT,
      onlineUsers: onlineUsers.size,
      clubs: clubs.size
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      database: "error",
      error: err.message
    });
  }
});

/* =========================================================
   REGISTER
========================================================= */

app.post("/api/register", async (req, res) => {
  try {
    const username = cleanUsername(
      req.body.username
    );

    const email = String(
      req.body.email || ""
    ).trim().toLowerCase();

    const password = String(
      req.body.password || ""
    );

    if (!username || !email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Username, email fi password guuti."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        ok: false,
        error: "Password yoo xiqqaate 6 characters qabaachuu qaba."
      });
    }

    const existing = await pool.query(
      `SELECT id
       FROM users
       WHERE LOWER(username) = LOWER($1)
          OR LOWER(email) = LOWER($2)
       LIMIT 1`,
      [username, email]
    );

    if (existing.rows.length) {
      return res.status(409).json({
        ok: false,
        error: "Username ykn email duraan jira."
      });
    }

    const id = makeId();
    const token = makeToken();
    const passwordHash = hashPassword(password);

    const result = await pool.query(
      `INSERT INTO users
       (id, username, email, password_hash, token, status)
       VALUES ($1, $2, $3, $4, $5, 'online')
       RETURNING id, username, email, bio, avatar, status, coins`,
      [
        id,
        username,
        email,
        passwordHash,
        token
      ]
    );

    await pool.query(
      `INSERT INTO activity_history
       (id, username, action, details)
       VALUES ($1, $2, $3, $4)`,
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
      user: result.rows[0]
    });

  } catch (err) {
    console.error("REGISTER ERROR:", err);

    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* =========================================================
   LOGIN
========================================================= */

app.post("/api/login", async (req, res) => {
  try {
    const login = cleanUsername(
      req.body.value ||
      req.body.login ||
      req.body.username ||
      req.body.email
    );

    const password = String(
      req.body.password || ""
    );

    if (!login || !password) {
      return res.status(400).json({
        ok: false,
        error: "Username/email ykn password guuti."
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM users
       WHERE LOWER(username) = LOWER($1)
          OR LOWER(email) = LOWER($1)
       LIMIT 1`,
      [login]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Username/email ykn password dogoggora."
      });
    }

    const passwordHash = hashPassword(password);

    if (passwordHash !== user.password_hash) {
      return res.status(401).json({
        ok: false,
        error: "Username/email ykn password dogoggora."
      });
    }

    const token = makeToken();

    await pool.query(
      `UPDATE users
       SET token = $1,
           status = 'online'
       WHERE id = $2`,
      [token, user.id]
    );

    await pool.query(
      `INSERT INTO activity_history
       (id, username, action, details)
       VALUES ($1, $2, $3, $4)`,
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
        avatar: user.avatar || "",
        status: "online",
        coins: user.coins || 0
      }
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);

    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/api/logout",
  requireAuth,
  async (req, res) => {
    try {
      await pool.query(
        `UPDATE users
         SET token = NULL,
             status = 'offline'
         WHERE id = $1`,
        [req.user.id]
      );

      removeOnlineByUsername(req.user.username);

      res.json({
        ok: true
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

function removeOnlineByUsername(username) {
  const sockets = onlineUsers.get(username);

  if (!sockets) return;

  for (const socketId of sockets) {
    socketUsers.delete(socketId);
  }

  onlineUsers.delete(username);
}

/* =========================================================
   PROFILE
========================================================= */

app.get(
  "/api/profile",
  requireAuth,
  async (req, res) => {
    res.json({
      ok: true,
      user: req.user
    });
  }
);

app.get(
  "/api/profile/:username",
  requireAuth,
  async (req, res) => {
    try {
      const username = cleanUsername(
        req.params.username
      );

      const result = await pool.query(
        `SELECT id, username, email, bio, avatar, status, coins
         FROM users
         WHERE LOWER(username) = LOWER($1)
         LIMIT 1`,
        [username]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          error: "User hin argamne."
        });
      }

      const target = result.rows[0];

      const follow = await pool.query(
        `SELECT id
         FROM follows
         WHERE follower = $1
           AND following = $2`,
        [req.user.username, target.username]
      );

      const blocked = await isBlocked(
        req.user.username,
        target.username
      );

      res.json({
        ok: true,
        user: target,
        following: follow.rows.length > 0,
        blocked
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.put(
  "/api/profile",
  requireAuth,
  async (req, res) => {
    try {
      const bio = cleanText(
        req.body.bio,
        1000
      );

      const avatar = String(
        req.body.avatar || ""
      ).slice(0, 1000000);

      const result = await pool.query(
        `UPDATE users
         SET bio = $1,
             avatar = $2
         WHERE id = $3
         RETURNING id, username, email, bio, avatar, status, coins`,
        [
          bio,
          avatar,
          req.user.id
        ]
      );

      res.json({
        ok: true,
        user: result.rows[0]
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   USER SEARCH
========================================================= */

app.get(
  "/api/users/search",
  requireAuth,
  async (req, res) => {
    try {
      const q = cleanUsername(
        req.query.q
      );

      const result = await pool.query(
        `SELECT id, username, bio, avatar, status
         FROM users
         WHERE LOWER(username) LIKE LOWER($1)
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
        error: err.message
      });
    }
  }
);

/* =========================================================
   ONLINE USERS
========================================================= */

app.get(
  "/api/users/online",
  requireAuth,
  async (req, res) => {
    try {
      const names = [...onlineUsers.keys()];

      if (!names.length) {
        return res.json({
          ok: true,
          users: []
        });
      }

      const result = await pool.query(
        `SELECT username, bio, avatar, status
         FROM users
         WHERE username = ANY($1::text[])`,
        [names]
      );

      res.json({
        ok: true,
        users: result.rows
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   FOLLOW
========================================================= */

app.post(
  "/api/follow/:username",
  requireAuth,
  async (req, res) => {
    try {
      const target = cleanUsername(
        req.params.username
      );

      if (target === req.user.username) {
        return res.status(400).json({
          ok: false,
          error: "Ofii kee follow gochuu hin dandeessu."
        });
      }

      await pool.query(
        `INSERT INTO follows
         (id, follower, following)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [
          makeId(),
          req.user.username,
          target
        ]
      );

      notifyUser(target, {
        type: "follow",
        message:
          `${req.user.username} si follow godhe.`
      });

      res.json({
        ok: true,
        following: true
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.delete(
  "/api/follow/:username",
  requireAuth,
  async (req, res) => {
    try {
      const target = cleanUsername(
        req.params.username
      );

      await pool.query(
        `DELETE FROM follows
         WHERE follower = $1
           AND following = $2`,
        [
          req.user.username,
          target
        ]
      );

      res.json({
        ok: true,
        following: false
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   BLOCK
========================================================= */

app.post(
  "/api/block/:username",
  requireAuth,
  async (req, res) => {
    try {
      const target = cleanUsername(
        req.params.username
      );

      await pool.query(
        `INSERT INTO blocks
         (id, blocker_username, blocked_username)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [
          makeId(),
          req.user.username,
          target
        ]
      );

      res.json({
        ok: true,
        blocked: true
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.delete(
  "/api/block/:username",
  requireAuth,
  async (req, res) => {
    try {
      const target = cleanUsername(
        req.params.username
      );

      await pool.query(
        `DELETE FROM blocks
         WHERE blocker_username = $1
           AND blocked_username = $2`,
        [
          req.user.username,
          target
        ]
      );

      res.json({
        ok: true,
        blocked: false
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   PRIVATE CHAT
========================================================= */

app.get(
  "/api/messages/:username",
  requireAuth,
  async (req, res) => {
    try {
      const other = cleanUsername(
        req.params.username
      );

      if (
        await isBlocked(
          req.user.username,
          other
        )
      ) {
        return res.json({
          ok: true,
          messages: []
        });
      }

      const result = await pool.query(
        `SELECT *
         FROM private_messages
         WHERE
           (sender = $1 AND receiver = $2)
           OR
           (sender = $2 AND receiver = $1)
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
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   NOTIFICATIONS
========================================================= */

app.get(
  "/api/notifications",
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT *
         FROM notifications
         WHERE username = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [req.user.username]
      );

      res.json({
        ok: true,
        notifications: result.rows
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
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
         SET read = TRUE
         WHERE username = $1`,
        [req.user.username]
      );

      res.json({
        ok: true
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   CALL HISTORY
========================================================= */

app.get(
  "/api/calls",
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT *
         FROM call_history
         WHERE caller = $1
            OR receiver = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [req.user.username]
      );

      res.json({
        ok: true,
        calls: result.rows
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   ACTIVITY
========================================================= */

app.get(
  "/api/activity",
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT *
         FROM activity_history
         WHERE username = $1
         ORDER BY created_at DESC
         LIMIT 200`,
        [req.user.username]
      );

      res.json({
        ok: true,
        activity: result.rows
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   POSTS
========================================================= */

app.get(
  "/api/posts",
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          p.*,
          (
            SELECT COUNT(*)
            FROM post_likes l
            WHERE l.post_id = p.id
          ) AS likes,
          (
            SELECT COUNT(*)
            FROM post_comments c
            WHERE c.post_id = p.id
          ) AS comments
        FROM posts p
        ORDER BY p.created_at DESC
        LIMIT 100
      `);

      res.json({
        ok: true,
        posts: result.rows
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.post(
  "/api/posts",
  requireAuth,
  async (req, res) => {
    try {
      const content = cleanText(
        req.body.content,
        10000
      );

      const image = String(
        req.body.image || ""
      ).slice(0, 2000000);

      if (!content && !image) {
        return res.status(400).json({
          ok: false,
          error: "Post empty ta'uu hin danda'u."
        });
      }

      const result = await pool.query(
        `INSERT INTO posts
         (id, username, content, image)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          makeId(),
          req.user.username,
          content,
          image
        ]
      );

      res.json({
        ok: true,
        post: result.rows[0]
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.delete(
  "/api/posts/:id",
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `DELETE FROM posts
         WHERE id = $1
           AND username = $2`,
        [
          req.params.id,
          req.user.username
        ]
      );

      res.json({
        ok: true,
        deleted: result.rowCount > 0
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.post(
  "/api/posts/:id/like",
  requireAuth,
  async (req, res) => {
    try {
      const existing = await pool.query(
        `SELECT id
         FROM post_likes
         WHERE post_id = $1
           AND username = $2`,
        [
          req.params.id,
          req.user.username
        ]
      );

      if (existing.rows.length) {
        await pool.query(
          `DELETE FROM post_likes
           WHERE post_id = $1
             AND username = $2`,
          [
            req.params.id,
            req.user.username
          ]
        );

        return res.json({
          ok: true,
          liked: false
        });
      }

      await pool.query(
        `INSERT INTO post_likes
         (id, post_id, username)
         VALUES ($1, $2, $3)`,
        [
          makeId(),
          req.params.id,
          req.user.username
        ]
      );

      res.json({
        ok: true,
        liked: true
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   COMMENTS
========================================================= */

app.get(
  "/api/posts/:id/comments",
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT *
         FROM post_comments
         WHERE post_id = $1
         ORDER BY created_at ASC`,
        [req.params.id]
      );

      res.json({
        ok: true,
        comments: result.rows
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.post(
  "/api/posts/:id/comments",
  requireAuth,
  async (req, res) => {
    try {
      const comment = cleanText(
        req.body.comment,
        3000
      );

      if (!comment) {
        return res.status(400).json({
          ok: false,
          error: "Comment barreessi."
        });
      }

      const result = await pool.query(
        `INSERT INTO post_comments
         (id, post_id, username, comment)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          makeId(),
          req.params.id,
          req.user.username,
          comment
        ]
      );

      res.json({
        ok: true,
        comment: result.rows[0]
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", socket => {

  console.log(
    "🔌 Socket connected:",
    socket.id
  );

  /* -------------------------------------------------------
     IDENTIFY
  ------------------------------------------------------- */

  socket.on("identify", async data => {
    try {
      const username = cleanUsername(
        data?.username
      );

      const token = String(
        data?.token || ""
      ).trim();

      if (!username) return;

      if (token) {
        const user = await getUserByToken(token);

        if (
          !user ||
          user.username !== username
        ) {
          socket.emit("authError", {
            error: "Token sirrii miti."
          });
          return;
        }
      }

      socket.username = username;

      addOnline(
        username,
        socket.id
      );

      await pool.query(
        `UPDATE users
         SET status = 'online'
         WHERE username = $1`,
        [username]
      );

      socket.emit("identified", {
        username
      });

      io.emit("onlineUsers", [
        ...onlineUsers.keys()
      ]);

    } catch (err) {
      console.error(
        "IDENTIFY ERROR:",
        err
      );
    }
  });

  /* -------------------------------------------------------
     PRIVATE MESSAGE
  ------------------------------------------------------- */

  socket.on("privateMessage", async data => {
    try {
      if (!socket.username) return;

      const receiver = cleanUsername(
        data?.receiver
      );

      const message = cleanText(
        data?.message,
        5000
      );

      if (!receiver || !message) return;

      if (
        await isBlocked(
          socket.username,
          receiver
        )
      ) {
        socket.emit("messageError", {
          error: "User kana waliin qunnamtii cufameera."
        });
        return;
      }

      const result = await pool.query(
        `INSERT INTO private_messages
         (id, sender, receiver, message)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          makeId(),
          socket.username,
          receiver,
          message
        ]
      );

      const msg = result.rows[0];

      sendToUser(
        receiver,
        "privateMessage",
        msg
      );

      socket.emit(
        "privateMessage",
        msg
      );

    } catch (err) {
      console.error(
        "PRIVATE MESSAGE ERROR:",
        err
      );
    }
  });

  /* -------------------------------------------------------
     READ MESSAGE
  ------------------------------------------------------- */

  socket.on("readMessages", async data => {
    try {
      if (!socket.username) return;

      const other = cleanUsername(
        data?.username
      );

      if (!other) return;

      socket.emit("messagesRead", {
        username: other
      });

    } catch (err) {
      console.error(
        "READ MESSAGE ERROR:",
        err
      );
    }
  });

  /* -------------------------------------------------------
     DELETE MESSAGE
  ------------------------------------------------------- */

  socket.on("deleteMessage", async data => {
    try {
      if (!socket.username) return;

      const id = String(
        data?.id || ""
      );

      if (!id) return;

      await pool.query(
        `UPDATE private_messages
         SET deleted = TRUE,
             message = '[Deleted]'
         WHERE id = $1
           AND sender = $2`,
        [
          id,
          socket.username
        ]
      );

      socket.emit("messageDeleted", {
        id
      });

    } catch (err) {
      console.error(
        "DELETE MESSAGE ERROR:",
        err
      );
    }
  });

  /* -------------------------------------------------------
     VOICE / VIDEO CALL SIGNALING
  ------------------------------------------------------- */

  socket.on("callUser", async data => {
    try {
      if (!socket.username) return;

      const target = cleanUsername(
        data?.username
      );

      const type =
        data?.type === "video"
          ? "video"
          : "voice";

      const targetSockets =
        getUserSocketIds(target);

      if (!targetSockets.length) {
        socket.emit("callError", {
          error: "User online miti."
        });
        return;
      }

      const callId = makeId();

      for (const socketId of targetSockets) {
        io.to(socketId).emit(
          "incomingCall",
          {
            callId,
            caller: socket.username,
            type,
            socketId: socket.id
          }
        );
      }

      socket.emit("callStarted", {
        callId,
        target,
        type
      });

    } catch (err) {
      console.error(
        "CALL ERROR:",
        err
      );
    }
  });

  socket.on("callAccepted", data => {
    if (!socket.username) return;

    const caller = cleanUsername(
      data?.caller
    );

    sendToUser(
      caller,
      "callAccepted",
      {
        username: socket.username,
        type: data?.type || "voice"
      }
    );
  });

  socket.on("callRejected", data => {
    if (!socket.username) return;

    const caller = cleanUsername(
      data?.caller
    );

    sendToUser(
      caller,
      "callRejected",
      {
        username: socket.username
      }
    );
  });

  socket.on("callEnded", data => {
    if (!socket.username) return;

    const other = cleanUsername(
      data?.username
    );

    sendToUser(
      other,
      "callEnded",
      {
        username: socket.username
      }
    );
  });

  /* -------------------------------------------------------
     NORMAL WEBRTC
  ------------------------------------------------------- */

  socket.on("webrtc-offer", data => {
    if (!socket.username) return;

    const target = cleanUsername(
      data?.targetUsername
    );

    sendToUser(
      target,
      "webrtc-offer",
      {
        offer: data.offer,
        fromUsername: socket.username,
        fromSocketId: socket.id
      }
    );
  });

  socket.on("webrtc-answer", data => {
    if (!socket.username) return;

    const target = cleanUsername(
      data?.targetUsername
    );

    sendToUser(
      target,
      "webrtc-answer",
      {
        answer: data.answer,
        fromUsername: socket.username,
        fromSocketId: socket.id
      }
    );
  });

  socket.on("webrtc-ice", data => {
    if (!socket.username) return;

    const target = cleanUsername(
      data?.targetUsername
    );

    sendToUser(
      target,
      "webrtc-ice",
      {
        candidate: data.candidate,
        fromUsername: socket.username,
        fromSocketId: socket.id
      }
    );
  });

  /* =======================================================
     CLUB CREATE
  ======================================================= */

  socket.on("createClub", async data => {
    try {
      if (!socket.username) {
        return socket.emit("clubError", {
          error: "Dura login godhi."
        });
      }

      const name = cleanText(
        data?.name,
        100
      );

      let seatCount =
        Number(data?.seatCount || 10);

      if (![10, 15].includes(seatCount)) {
        seatCount = 10;
      }

      const id = makeId();

      const club = createClubObject(
        id,
        name || `${socket.username} Club`,
        socket.username,
        seatCount
      );

      clubs.set(id, club);

      socket.clubId = id;
      socket.clubVoiceReady = false;

      socket.emit("clubCreated", {
        clubId: id,
        name: club.name,
        owner: club.owner,
        seatCount: club.seatCount,
        seats: club.seats
      });

      broadcastClubMembers(club);

      console.log(
        `🟢 Club created ${id} by ${socket.username}`
      );

    } catch (err) {
      console.error(
        "CREATE CLUB ERROR:",
        err
      );
    }
  });

  /* =======================================================
     CLUB JOIN
  ======================================================= */

  socket.on("joinClub", data => {
    try {
      if (!socket.username) {
        return socket.emit("clubError", {
          error: "Dura login godhi."
        });
      }

      const clubId = String(
        data?.clubId || ""
      ).trim();

      const club = clubs.get(clubId);

      if (!club) {
        return socket.emit("clubError", {
          error: "Club hin argamne."
        });
      }

      socket.clubId = clubId;
      socket.clubVoiceReady = false;

      club.members.add(
        socket.username
      );

      socket.emit("clubJoined", {
        clubId: club.id,
        name: club.name,
        owner: club.owner,
        seatCount: club.seatCount,
        seats: club.seats,
        members: getClubMemberList(club)
      });

      broadcastClubMembers(club);
      broadcastClubVoicePeers(club);

    } catch (err) {
      console.error(
        "JOIN CLUB ERROR:",
        err
      );
    }
  });

  /* =======================================================
     CLUB VOICE READY
  ======================================================= */

  socket.on("clubVoiceReady", () => {
    try {
      if (!socket.clubId) return;

      const club =
        clubs.get(socket.clubId);

      if (!club || !socket.username) {
        return;
      }

      /*
        IMPORTANT:
        Seat qabaachuun ykn qabaachuu dhiisuun
        voice room seenuuf gufuu miti.

        Seat qabaate:
          speaker

        Seat hin qabne:
          listener
      */

      const seat = club.seats.find(
        s => s.username === socket.username
      );

      socket.clubVoiceReady = true;

      socket.clubVoiceRole =
        seat ? "speaker" : "listener";

      socket.emit("clubVoiceStarted", {
        clubId: club.id,
        role: socket.clubVoiceRole,
        speaker: Boolean(seat),
        listener: !seat
      });

      broadcastClubVoicePeers(club);

      console.log(
        `🎙️ Club voice ready: ${socket.username} / ${socket.clubVoiceRole}`
      );

    } catch (err) {
      console.error(
        "CLUB VOICE READY ERROR:",
        err
      );
    }
  });

  /* =======================================================
     CLUB VOICE STOP
  ======================================================= */

  socket.on("clubVoiceStop", () => {
    try {
      const club =
        clubs.get(socket.clubId);

      socket.clubVoiceReady = false;
      socket.clubVoiceRole = null;

      if (club) {
        broadcastClubVoicePeers(club);
      }

    } catch (err) {
      console.error(
        "CLUB VOICE STOP ERROR:",
        err
      );
    }
  });

  /* =======================================================
     CLUB VOICE WEBRTC OFFER
  ======================================================= */

  socket.on("club-webrtc-offer", data => {
    try {
      if (!socket.clubId) return;

      const targetSocketId =
        String(data?.targetSocketId || "");

      if (!targetSocketId) return;

      const target =
        io.sockets.sockets.get(
          targetSocketId
        );

      if (!target) return;

      if (
        target.clubId !== socket.clubId
      ) {
        return;
      }

      target.emit(
        "club-webrtc-offer",
        {
          fromSocketId: socket.id,
          fromUsername: socket.username,
          offer: data.offer
        }
      );

    } catch (err) {
      console.error(
        "CLUB OFFER ERROR:",
        err
      );
    }
  });

  /* =======================================================
     CLUB VOICE WEBRTC ANSWER
  ======================================================= */

  socket.on("club-webrtc-answer", data => {
    try {
      if (!socket.clubId) return;

      const targetSocketId =
        String(data?.targetSocketId || "");

      if (!targetSocketId) return;

      const target =
        io.sockets.sockets.get(
          targetSocketId
        );

      if (!target) return;

      if (
        target.clubId !== socket.clubId
      ) {
        return;
      }

      target.emit(
        "club-webrtc-answer",
        {
          fromSocketId: socket.id,
          fromUsername: socket.username,
          answer: data.answer
        }
      );

    } catch (err) {
      console.error(
        "CLUB ANSWER ERROR:",
        err
      );
    }
  });

  /* =======================================================
     CLUB VOICE ICE
  ======================================================= */

  socket.on("club-webrtc-ice", data => {
    try {
      if (!socket.clubId) return;

      const targetSocketId =
        String(data?.targetSocketId || "");

      if (!targetSocketId) return;

      const target =
        io.sockets.sockets.get(
          targetSocketId
        );

      if (!target) return;

      if (
        target.clubId !== socket.clubId
      ) {
        return;
      }

      target.emit(
        "club-webrtc-ice",
        {
          fromSocketId: socket.id,
          fromUsername: socket.username,
          candidate: data.candidate
        }
      );

    } catch (err) {
      console.error(
        "CLUB ICE ERROR:",
        err
      );
    }
  });

  /* =======================================================
     REQUEST SEAT
  ======================================================= */

  socket.on("requestSeat", data => {
    try {
      if (!socket.clubId) return;

      const club =
        clubs.get(socket.clubId);

      if (!club) return;

      const username = socket.username;

      if (
        club.seats.some(
          s => s.username === username
        )
      ) {
        return;
      }

      club.seatRequests.add(
        username
      );

      sendToUser(
        club.owner,
        "seatRequest",
        {
          clubId: club.id,
          username
        }
      );

      socket.emit("seatRequested", {
        clubId: club.id
      });

    } catch (err) {
      console.error(
        "REQUEST SEAT ERROR:",
        err
      );
    }
  });

  /* =======================================================
     GIVE SEAT / PROMOTE
  ======================================================= */

  socket.on("giveSeat", data => {
    try {
      const club =
        clubs.get(socket.clubId);

      if (!club) return;

      if (
        socket.username !== club.owner
      ) {
        return;
      }

      const username =
        cleanUsername(data?.username);

      const requestedSeat =
        Number(data?.seat || 0);

      const seat =
        club.seats.find(
          s =>
            s.seat === requestedSeat &&
            !s.username
        ) ||
        club.seats.find(
          s => !s.username
        );

      if (!seat) {
        return socket.emit(
          "clubError",
          {
            error: "Seat guutameera."
          }
        );
      }

      seat.username = username;
      seat.muted = false;

      club.seatRequests.delete(
        username
      );

      sendToUser(
        username,
        "seatGranted",
        {
          clubId: club.id,
          seat: seat.seat
        }
      );

      broadcastClubMembers(club);
      broadcastClubVoicePeers(club);

    } catch (err) {
      console.error(
        "GIVE SEAT ERROR:",
        err
      );
    }
  });

  /* =======================================================
     LEAVE SEAT / DEMOTE
  ======================================================= */

  socket.on("leaveSeat", () => {
    try {
      const club =
        clubs.get(socket.clubId);

      if (!club) return;

      const seat =
        club.seats.find(
          s => s.username === socket.username
        );

      if (!seat) return;

      /*
        Owner seat 1 hin gadi lakkisu.
      */

      if (
        socket.username === club.owner &&
        seat.seat === 1
      ) {
        return socket.emit(
          "clubError",
          {
            error:
              "Owner seat 1 keessaa bahuu hin danda'u."
          }
        );
      }

      seat.username = null;
      seat.muted = false;

      broadcastClubMembers(club);
      broadcastClubVoicePeers(club);

    } catch (err) {
      console.error(
        "LEAVE SEAT ERROR:",
        err
      );
    }
  });

  /* =======================================================
     SELF MUTE
  ======================================================= */

  socket.on("muteSelf", data => {
    try {
      const club =
        clubs.get(socket.clubId);

      if (!club) return;

      const seat =
        club.seats.find(
          s => s.username === socket.username
        );

      if (!seat) {
        /*
          Listener mic hin qabu.
        */
        return;
      }

      seat.muted = Boolean(
        data?.muted
      );

      io.to(socket.clubId).emit(
        "memberMuteChanged",
        {
          username: socket.username,
          muted: seat.muted
        }
      );

      broadcastClubMembers(club);
      broadcastClubVoicePeers(club);

    } catch (err) {
      console.error(
        "MUTE SELF ERROR:",
        err
      );
    }
  });

  /* =======================================================
     OWNER MUTE
  ======================================================= */

  socket.on("ownerMute", data => {
    try {
      const club =
        clubs.get(socket.clubId);

      if (!club) return;

      if (
        socket.username !== club.owner
      ) {
        return;
      }

      const username =
        cleanUsername(data?.username);

      const seat =
        club.seats.find(
          s => s.username === username
        );

      if (!seat) return;

      seat.muted = Boolean(
        data?.muted ?? true
      );

      sendToUser(
        username,
        "ownerMuted",
        {
          clubId: club.id,
          muted: seat.muted
        }
      );

      io.to(socket.clubId).emit(
        "memberMuteChanged",
        {
          username,
          muted: seat.muted
        }
      );

      broadcastClubMembers(club);
      broadcastClubVoicePeers(club);

    } catch (err) {
      console.error(
        "OWNER MUTE ERROR:",
        err
      );
    }
  });

  /* =======================================================
     REMOVE MEMBER
  ======================================================= */

  socket.on("removeMember", data => {
    try {
      const club =
        clubs.get(socket.clubId);

      if (!club) return;

      if (
        socket.username !== club.owner
      ) {
        return;
      }

      const username =
        cleanUsername(data?.username);

      if (
        username === club.owner
      ) {
        return;
      }

      club.members.delete(
        username
      );

      const seat =
        club.seats.find(
          s => s.username === username
        );

      if (seat) {
        seat.username = null;
        seat.muted = false;
      }

      for (
        const socketId of getUserSocketIds(username)
      ) {
        const memberSocket =
          io.sockets.sockets.get(
            socketId
          );

        if (
          memberSocket &&
          memberSocket.clubId === club.id
        ) {
          memberSocket.clubVoiceReady = false;
          memberSocket.clubId = null;

          memberSocket.emit(
            "removedFromClub",
            {
              clubId: club.id
            }
          );
        }
      }

      broadcastClubMembers(club);
      broadcastClubVoicePeers(club);

    } catch (err) {
      console.error(
        "REMOVE MEMBER ERROR:",
        err
      );
    }
  });

  /* =======================================================
     CLUB CHAT
  ======================================================= */

  socket.on("clubMessage", async data => {
    try {
      const club =
        clubs.get(socket.clubId);

      if (!club) return;

      if (
        !club.members.has(
          socket.username
        )
      ) {
        return;
      }

      const message = cleanText(
        data?.message,
        5000
      );

      if (!message) return;

      const result = await pool.query(
        `INSERT INTO club_messages
         (id, club_id, username, message)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          makeId(),
          club.id,
          socket.username,
          message
        ]
      );

      io.to(socket.clubId).emit(
        "clubMessage",
        result.rows[0]
      );

    } catch (err) {
      console.error(
        "CLUB MESSAGE ERROR:",
        err
      );
    }
  });

  /* =======================================================
     CLUB CHAT HISTORY
  ======================================================= */

  socket.on("getClubMessages", async data => {
    try {
      const clubId =
        String(data?.clubId || "");

      const club =
        clubs.get(clubId);

      if (!club) return;

      const result = await pool.query(
        `SELECT *
         FROM club_messages
         WHERE club_id = $1
         ORDER BY created_at ASC
         LIMIT 500`,
        [clubId]
      );

      socket.emit(
        "clubMessagesHistory",
        {
          clubId,
          messages: result.rows
        }
      );

    } catch (err) {
      console.error(
        "CLUB HISTORY ERROR:",
        err
      );
    }
  });

  /* =======================================================
     GET CLUB MEMBERS
  ======================================================= */

  socket.on("getClubMembers", () => {
    try {
      const club =
        clubs.get(socket.clubId);

      if (!club) return;

      socket.emit(
        "clubMembers",
        {
          clubId: club.id,
          members: getClubMemberList(club)
        }
      );

    } catch (err) {
      console.error(
        "GET CLUB MEMBERS ERROR:",
        err
      );
    }
  });

  /* =======================================================
     GIFT
  ======================================================= */

  socket.on("sendGift", async data => {
    try {
      const club =
        clubs.get(socket.clubId);

      if (!club) return;

      const gift = cleanText(
        data?.gift,
        100
      );

      const receiver =
        cleanUsername(
          data?.receiver ||
          data?.username
        );

      if (!gift || !receiver) return;

      await pool.query(
        `INSERT INTO gifts
         (id, sender, receiver, gift)
         VALUES ($1, $2, $3, $4)`,
        [
          makeId(),
          socket.username,
          receiver,
          gift
        ]
      );

      io.to(socket.clubId).emit(
        "giftReceived",
        {
          sender: socket.username,
          receiver,
          gift
        }
      );

    } catch (err) {
      console.error(
        "GIFT ERROR:",
        err
      );
    }
  });

  /* =======================================================
     LEAVE CLUB
  ======================================================= */

  socket.on("leaveClub", () => {
    leaveClub(socket);
  });

  /* =======================================================
     DISCONNECT
  ======================================================= */

  socket.on("disconnect", async () => {
    try {
      const username =
        socket.username;

      if (socket.clubId) {
        leaveClub(socket);
      }

      removeOnline(socket.id);

      if (username) {
        const stillOnline =
          onlineUsers.has(username);

        if (!stillOnline) {
          await pool.query(
            `UPDATE users
             SET status = 'offline'
             WHERE username = $1`,
            [username]
          );
        }
      }

      io.emit("onlineUsers", [
        ...onlineUsers.keys()
      ]);

      console.log(
        "🔌 Socket disconnected:",
        socket.id
      );

    } catch (err) {
      console.error(
        "DISCONNECT ERROR:",
        err
      );
    }
  });
});

/* =========================================================
   LEAVE CLUB FUNCTION
========================================================= */

function leaveClub(socket) {
  try {
    const clubId =
      socket.clubId;

    if (!clubId) return;

    const club =
      clubs.get(clubId);

    socket.clubVoiceReady = false;
    socket.clubVoiceRole = null;

    if (!club) {
      socket.clubId = null;
      return;
    }

    /*
      Remove member only if this socket
      is the last socket of the user in club.
    */

    let anotherSocketInClub = false;

    for (
      const socketId of getUserSocketIds(
        socket.username
      )
    ) {
      if (socketId === socket.id) {
        continue;
      }

      const otherSocket =
        io.sockets.sockets.get(
          socketId
        );

      if (
        otherSocket &&
        otherSocket.clubId === club.id
      ) {
        anotherSocketInClub = true;
        break;
      }
    }

    if (!anotherSocketInClub) {
      club.members.delete(
        socket.username
      );

      const seat =
        club.seats.find(
          s => s.username === socket.username
        );

      if (seat) {
        /*
          Owner seat 1 yeroo owner disconnect
          ta'u illee club keessatti akka owner
          turuuf seat hin haqamu.
        */

        if (
          socket.username !== club.owner
        ) {
          seat.username = null;
          seat.muted = false;
        }
      }
    }

    socket.clubId = null;

    broadcastClubMembers(club);
    broadcastClubVoicePeers(club);

    /*
      Club keessatti nama tokko illee yoo hin jirre,
      memory keessaa haqi.
    */

    if (club.members.size === 0) {
      clubs.delete(club.id);

      console.log(
        `🗑️ Empty club deleted: ${club.id}`
      );
    }

  } catch (err) {
    console.error(
      "LEAVE CLUB ERROR:",
      err
    );
  }
}

/* =========================================================
   SPA FALLBACK
========================================================= */

app.get("*", (req, res) => {
  if (
    req.path.startsWith("/api/") ||
    req.path === "/health"
  ) {
    return res.status(404).json({
      ok: false,
      error: "Endpoint hin argamne."
    });
  }

  res.sendFile(
    path.join(
      publicDir,
      "index.html"
    )
  );
});

/* =========================================================
   START SERVER
========================================================= */

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

        console.log(
          `🟢 Public folder: ${publicDir}`
        );

        console.log(
          `🟢 Club Voice: listener + speaker mode enabled`
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

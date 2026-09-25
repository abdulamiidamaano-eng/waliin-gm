const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "waliin-gm-change-this-secret";

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, "public")));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

/* =========================
   DATABASE
========================= */

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL hin argamne.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      status VARCHAR(30) DEFAULT 'offline',
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      sender VARCHAR(50) NOT NULL,
      receiver VARCHAR(50) NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS follows (
      id BIGSERIAL PRIMARY KEY,
      follower VARCHAR(50) NOT NULL,
      following VARCHAR(50) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(follower, following)
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id BIGSERIAL PRIMARY KEY,
      blocker VARCHAR(50) NOT NULL,
      blocked VARCHAR(50) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(blocker, blocked)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      to_user VARCHAR(50) NOT NULL,
      from_user VARCHAR(50),
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log("✅ DATABASE INITIALIZED");
}

/* =========================
   HELPERS
========================= */

function cleanUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validUsername(username) {
  return /^[a-zA-Z0-9_.-]{3,50}$/.test(username);
}

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Authentication barbaachisa."
    });
  }

  const token = header.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      error: "Token sirrii miti ykn yeroo isaa darbe."
    });
  }
}

async function getUser(username) {
  const result = await pool.query(
    `SELECT id, username, email, bio, avatar, status, last_seen, created_at
     FROM users
     WHERE username=$1`,
    [cleanUsername(username)]
  );

  return result.rows[0] || null;
}

async function createNotification(toUser, fromUser, message) {
  await pool.query(
    `INSERT INTO notifications(to_user, from_user, message)
     VALUES($1,$2,$3)`,
    [toUser, fromUser || null, message]
  );

  const sockets = onlineUsers.get(toUser);

  if (sockets) {
    for (const socketId of sockets) {
      io.to(socketId).emit("notification", {
        message
      });
    }
  }
}

/* =========================
   ONLINE USERS
========================= */

const onlineUsers = new Map();
// username -> Set(socket.id)

const socketUsers = new Map();
// socket.id -> username

function addOnline(username, socketId) {
  username = cleanUsername(username);

  if (!onlineUsers.has(username)) {
    onlineUsers.set(username, new Set());
  }

  onlineUsers.get(username).add(socketId);
  socketUsers.set(socketId, username);
}

function removeOnline(socketId) {
  const username = socketUsers.get(socketId);

  if (!username) return null;

  const set = onlineUsers.get(username);

  if (set) {
    set.delete(socketId);

    if (set.size === 0) {
      onlineUsers.delete(username);
    }
  }

  socketUsers.delete(socketId);

  return username;
}

function getUserSocket(username) {
  const set = onlineUsers.get(cleanUsername(username));

  if (!set || set.size === 0) {
    return null;
  }

  return [...set][0];
}

/* =========================
   AUTH
========================= */

app.post("/api/register", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!validUsername(username)) {
      return res.status(400).json({
        error: "Username 3-50 characters qabaachuu qaba."
      });
    }

    if (!email || !email.includes("@")) {
      return res.status(400).json({
        error: "Email sirrii galchi."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password yoo xiqqaate 6 characters qabaachuu qaba."
      });
    }

    const exists = await pool.query(
      `SELECT id FROM users WHERE username=$1 OR email=$2`,
      [username, email]
    );

    if (exists.rows.length) {
      return res.status(409).json({
        error: "Username ykn email duraan jira."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users(username,email,password_hash)
       VALUES($1,$2,$3)
       RETURNING id,username,email,bio,avatar,status,last_seen,created_at`,
      [username, email, passwordHash]
    );

    const user = result.rows[0];
    const token = makeToken(user);

    res.json({
      ok: true,
      token,
      user
    });

  } catch (err) {
    console.error("REGISTER ERROR:", err);

    res.status(500).json({
      error: "Register irratti rakkoon uumame."
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const login = String(req.body.login || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const result = await pool.query(
      `SELECT * FROM users
       WHERE username=$1 OR email=$1
       LIMIT 1`,
      [login]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "Username/email ykn password sirrii miti."
      });
    }

    const dbUser = result.rows[0];

    const valid = await bcrypt.compare(
      password,
      dbUser.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: "Username/email ykn password sirrii miti."
      });
    }

    await pool.query(
      `UPDATE users
       SET status='online', last_seen=NOW()
       WHERE id=$1`,
      [dbUser.id]
    );

    const user = {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      bio: dbUser.bio,
      avatar: dbUser.avatar,
      status: "online",
      last_seen: new Date(),
      created_at: dbUser.created_at
    };

    const token = makeToken(user);

    res.json({
      ok: true,
      token,
      user
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);

    res.status(500).json({
      error: "Login irratti rakkoon uumame."
    });
  }
});

/* =========================
   USERS
========================= */

app.get("/api/users/search", authMiddleware, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();

    if (!q) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT username,bio,avatar,status,last_seen
       FROM users
       WHERE username ILIKE $1
       ORDER BY username
       LIMIT 30`,
      [`%${q}%`]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Search failed."
    });
  }
});

app.get("/api/users/online", authMiddleware, async (req, res) => {
  try {
    const usernames = [...onlineUsers.keys()];

    if (!usernames.length) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT username,bio,avatar,status,last_seen
       FROM users
       WHERE username = ANY($1::text[])`,
      [usernames]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Online users hin argamne."
    });
  }
});

/* =========================
   PROFILE
========================= */

app.get("/api/profile/:username", authMiddleware, async (req, res) => {
  try {
    const username = cleanUsername(req.params.username);

    const result = await pool.query(
      `SELECT id,username,email,bio,avatar,status,last_seen,created_at
       FROM users
       WHERE username=$1`,
      [username]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "User hin argamne."
      });
    }

    const followers = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM follows
       WHERE following=$1`,
      [username]
    );

    const following = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM follows
       WHERE follower=$1`,
      [username]
    );

    res.json({
      ...result.rows[0],
      followers: followers.rows[0].count,
      following: following.rows[0].count
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Profile hin banamne."
    });
  }
});

app.post("/api/profile/update", authMiddleware, async (req, res) => {
  try {
    const username = req.user.username;

    const bio = String(req.body.bio || "").slice(0, 1000);
    const avatar = String(req.body.avatar || "").slice(0, 500000);

    const result = await pool.query(
      `UPDATE users
       SET bio=$1, avatar=$2
       WHERE username=$3
       RETURNING id,username,email,bio,avatar,status,last_seen,created_at`,
      [bio, avatar, username]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "User hin argamne."
      });
    }

    res.json({
      ok: true,
      user: result.rows[0]
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Profile update failed."
    });
  }
});

/* =========================
   FOLLOW
========================= */

app.post("/api/follow", authMiddleware, async (req, res) => {
  try {
    const follower = req.user.username;
    const following = cleanUsername(req.body.following);

    if (!following || follower === following) {
      return res.status(400).json({
        error: "Follow sirrii miti."
      });
    }

    const target = await getUser(following);

    if (!target) {
      return res.status(404).json({
        error: "User hin argamne."
      });
    }

    const existing = await pool.query(
      `SELECT id FROM follows
       WHERE follower=$1 AND following=$2`,
      [follower, following]
    );

    if (existing.rows.length) {
      await pool.query(
        `DELETE FROM follows
         WHERE follower=$1 AND following=$2`,
        [follower, following]
      );

      return res.json({
        ok: true,
        following: false
      });
    }

    await pool.query(
      `INSERT INTO follows(follower,following)
       VALUES($1,$2)
       ON CONFLICT DO NOTHING`,
      [follower, following]
    );

    await createNotification(
      following,
      follower,
      `${follower} si hordofeera.`
    );

    res.json({
      ok: true,
      following: true
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Follow failed."
    });
  }
});

/* =========================
   BLOCK
========================= */

app.post("/api/block", authMiddleware, async (req, res) => {
  try {
    const blocker = req.user.username;
    const blocked = cleanUsername(req.body.blocked);

    if (!blocked || blocker === blocked) {
      return res.status(400).json({
        error: "Block sirrii miti."
      });
    }

    const existing = await pool.query(
      `SELECT id FROM blocks
       WHERE blocker=$1 AND blocked=$2`,
      [blocker, blocked]
    );

    if (existing.rows.length) {
      await pool.query(
        `DELETE FROM blocks
         WHERE blocker=$1 AND blocked=$2`,
        [blocker, blocked]
      );

      return res.json({
        ok: true,
        blocked: false
      });
    }

    await pool.query(
      `INSERT INTO blocks(blocker,blocked)
       VALUES($1,$2)
       ON CONFLICT DO NOTHING`,
      [blocker, blocked]
    );

    res.json({
      ok: true,
      blocked: true
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Block failed."
    });
  }
});

/* =========================
   MESSAGES
========================= */

app.get("/api/messages", authMiddleware, async (req, res) => {
  try {
    const current = req.user.username;
    const other = cleanUsername(req.query.user2 || req.query.user1);

    if (!other) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT id,sender,receiver,message,is_read,created_at
       FROM messages
       WHERE
       (sender=$1 AND receiver=$2)
       OR
       (sender=$2 AND receiver=$1)
       ORDER BY created_at ASC
       LIMIT 500`,
      [current, other]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Messages hin argamne."
    });
  }
});

/* =========================
   NOTIFICATIONS
========================= */

app.get(
  "/api/notifications/:username",
  authMiddleware,
  async (req, res) => {
    try {
      const username = req.user.username;

      const result = await pool.query(
        `SELECT id,to_user,from_user,message,is_read,created_at
         FROM notifications
         WHERE to_user=$1
         ORDER BY created_at DESC
         LIMIT 100`,
        [username]
      );

      res.json(result.rows);

    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: "Notifications hin argamne."
      });
    }
  }
);

app.post(
  "/api/notifications/read",
  authMiddleware,
  async (req, res) => {
    try {
      await pool.query(
        `UPDATE notifications
         SET is_read=true
         WHERE to_user=$1`,
        [req.user.username]
      );

      res.json({
        ok: true
      });

    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: "Notification read failed."
      });
    }
  }
);

app.get(
  "/api/notifications/unread-count/:username",
  authMiddleware,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM notifications
         WHERE to_user=$1 AND is_read=false`,
        [req.user.username]
      );

      res.json({
        count: result.rows[0].count
      });

    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: "Unread count failed."
      });
    }
  }
);

/* =========================
   CLUBS
========================= */

const clubs = new Map();

function createClubObject(name, owner, seatCount = 15) {
  const seats = [];

  for (let i = 1; i <= seatCount; i++) {
    seats.push({
      seat: i,
      username: i === 1 ? owner : null,
      muted: false,
      locked: false
    });
  }

  return {
    id: crypto.randomBytes(5).toString("hex"),
    name: String(name || "Waliin Club").slice(0, 100),
    owner,
    seatCount,
    seats,
    audience: [],
    seatRequests: [],
    messages: []
  };
}

function getClubBySocket(socket) {
  for (const club of clubs.values()) {
    const inRoom = socket.rooms.has(`club:${club.id}`);

    if (inRoom) {
      return club;
    }
  }

  return null;
}

function broadcastClub(club) {
  io.to(`club:${club.id}`).emit("clubUpdated", club);
}

/* CREATE CLUB */

io.on("connection", (socket) => {

  socket.on("identify", async (data) => {
    try {
      const username = cleanUsername(data?.username);

      if (!username) return;

      const user = await getUser(username);

      if (!user) return;

      addOnline(username, socket.id);

      socket.username = username;

      await pool.query(
        `UPDATE users
         SET status='online', last_seen=NOW()
         WHERE username=$1`,
        [username]
      );

      socket.emit("presenceUpdate", {
        username,
        online: true
      });

      socket.broadcast.emit("presenceUpdate", {
        username,
        online: true
      });

    } catch (err) {
      console.error("IDENTIFY ERROR:", err);
    }
  });

  /* =========================
     PRIVATE CHAT
  ========================= */

  socket.on("privateMessage", async (data) => {
    try {
      const sender = socket.username;

      if (!sender) return;

      const receiver = cleanUsername(data?.receiver);
      const message = String(data?.message || "").trim();

      if (!receiver || !message) return;

      if (message.length > 5000) return;

      const blocked = await pool.query(
        `SELECT id
         FROM blocks
         WHERE
         (blocker=$1 AND blocked=$2)
         OR
         (blocker=$2 AND blocked=$1)
         LIMIT 1`,
        [sender, receiver]
      );

      if (blocked.rows.length) {
        socket.emit("messageError", {
          error: "User tokko keessan keessaa tokko block godheera."
        });

        return;
      }

      const result = await pool.query(
        `INSERT INTO messages(sender,receiver,message)
         VALUES($1,$2,$3)
         RETURNING id,sender,receiver,message,is_read,created_at`,
        [sender, receiver, message]
      );

      const msg = result.rows[0];

      const receiverSockets = onlineUsers.get(receiver);

      if (receiverSockets) {
        for (const socketId of receiverSockets) {
          io.to(socketId).emit("privateMessage", msg);
        }
      }

      socket.emit("privateMessage", msg);

      await createNotification(
        receiver,
        sender,
        `${sender} siif message ergeera.`
      );

    } catch (err) {
      console.error("PRIVATE MESSAGE ERROR:", err);

      socket.emit("messageError", {
        error: "Message erguun hin milkoofne."
      });
    }
  });

  socket.on("messageRead", async (data) => {
    try {
      const reader = socket.username;
      const sender = cleanUsername(data?.sender || data?.username);

      if (!reader || !sender) return;

      await pool.query(
        `UPDATE messages
         SET is_read=true
         WHERE sender=$1 AND receiver=$2`,
        [sender, reader]
      );

      const senderSockets = onlineUsers.get(sender);

      if (senderSockets) {
        for (const socketId of senderSockets) {
          io.to(socketId).emit("messageRead", {
            username: reader
          });
        }
      }

    } catch (err) {
      console.error(err);
    }
  });

  socket.on("deleteMessage", async (data) => {
    try {
      const username = socket.username;
      const id = Number(data?.id);

      if (!username || !id) return;

      const result = await pool.query(
        `DELETE FROM messages
         WHERE id=$1 AND sender=$2
         RETURNING id,receiver`,
        [id, username]
      );

      if (!result.rows.length) {
        return socket.emit("messageError", {
          error: "Message haqaan haq hin qabdu."
        });
      }

      const receiver = result.rows[0].receiver;

      socket.emit("messageDeleted", {
        id
      });

      const receiverSockets = onlineUsers.get(receiver);

      if (receiverSockets) {
        for (const socketId of receiverSockets) {
          io.to(socketId).emit("messageDeleted", {
            id
          });
        }
      }

    } catch (err) {
      console.error(err);
    }
  });

  /* =========================
     CLUB CREATE
  ========================= */

  socket.on("createClub", (data, callback) => {
    try {
      const owner = socket.username || cleanUsername(data?.username);
      const name = String(data?.name || "Waliin Club");

      if (!owner) {
        return callback?.({
          ok: false,
          error: "Login godhi."
        });
      }

      let seatCount = Number(data?.seatCount || 15);

      if (![10, 15].includes(seatCount)) {
        seatCount = 15;
      }

      const club = createClubObject(
        name,
        owner,
        seatCount
      );

      clubs.set(club.id, club);

      socket.join(`club:${club.id}`);

      callback?.({
        ok: true,
        club
      });

      socket.emit("clubUpdated", club);

    } catch (err) {
      console.error("CREATE CLUB ERROR:", err);

      callback?.({
        ok: false,
        error: "Club uumuuun hin milkoofne."
      });
    }
  });

  /* =========================
     JOIN CLUB
  ========================= */

  socket.on("joinClub", (data, callback) => {
    try {
      const username = socket.username || cleanUsername(data?.username);
      const clubId = String(data?.clubId || "");

      const club = clubs.get(clubId);

      if (!club) {
        return callback?.({
          ok: false,
          error: "Club hin argamne."
        });
      }

      if (!username) {
        return callback?.({
          ok: false,
          error: "Login godhi."
        });
      }

      socket.username = username;
      socket.join(`club:${club.id}`);

      const alreadySeat = club.seats.find(
        s => s.username === username
      );

      const alreadyAudience =
        club.audience.includes(username);

      if (!alreadySeat && !alreadyAudience) {
        const freeSeat = club.seats.find(
          s => !s.username && !s.locked
        );

        if (freeSeat && username === club.owner) {
          freeSeat.username = username;
        } else {
          club.audience.push(username);
        }
      }

      callback?.({
        ok: true,
        club
      });

      broadcastClub(club);

      io.to(`club:${club.id}`).emit(
        "clubMemberUpdate",
        {
          username,
          action: "joined"
        }
      );

    } catch (err) {
      console.error("JOIN CLUB ERROR:", err);

      callback?.({
        ok: false,
        error: "Club seenuun hin milkoofne."
      });
    }
  });

  /* =========================
     REQUEST SEAT
  ========================= */

  socket.on("requestSeat", () => {
    try {
      const username = socket.username;
      const club = getClubBySocket(socket);

      if (!username || !club) return;

      if (!club.seatRequests.includes(username)) {
        club.seatRequests.push(username);
      }

      const ownerSocket = getUserSocket(club.owner);

      if (ownerSocket) {
        io.to(ownerSocket).emit("clubUpdated", club);

        io.to(ownerSocket).emit("notification", {
          message: `${username} teessoo club gaafate.`
        });
      }

      broadcastClub(club);

    } catch (err) {
      console.error(err);
    }
  });

  /* =========================
     GIVE SEAT
  ========================= */

  socket.on("giveSeat", (data) => {
    try {
      const owner = socket.username;
      const club = getClubBySocket(socket);

      if (!club || club.owner !== owner) return;

      const target = cleanUsername(data?.username);
      const seatNumber = Number(data?.seat || 0);

      const seat = club.seats.find(
        s => s.seat === seatNumber
      );

      if (!seat || seat.locked) return;

      for (const s of club.seats) {
        if (s.username === target) {
          s.username = null;
        }
      }

      seat.username = target;

      club.audience = club.audience.filter(
        u => u !== target
      );

      club.seatRequests = club.seatRequests.filter(
        u => u !== target
      );

      broadcastClub(club);

      const targetSocket = getUserSocket(target);

      if (targetSocket) {
        io.to(targetSocket).emit("notification", {
          message: `Teessoo ${seatNumber} argatte.`
        });
      }

    } catch (err) {
      console.error(err);
    }
  });

  /* =========================
     LEAVE SEAT
  ========================= */

  socket.on("leaveSeat", () => {
    try {
      const username = socket.username;
      const club = getClubBySocket(socket);

      if (!club || !username) return;

      const seat = club.seats.find(
        s => s.username === username
      );

      if (seat) {
        seat.username = null;
        seat.muted = false;
      }

      if (!club.audience.includes(username)) {
        club.audience.push(username);
      }

      broadcastClub(club);

    } catch (err) {
      console.error(err);
    }
  });

  /* =========================
     SELF MUTE
  ========================= */

  socket.on("muteSelf", () => {
    try {
      const username = socket.username;
      const club = getClubBySocket(socket);

      if (!club) return;

      const seat = club.seats.find(
        s => s.username === username
      );

      if (!seat) return;

      seat.muted = !seat.muted;

      broadcastClub(club);

    } catch (err) {
      console.error(err);
    }
  });

  /* =========================
     OWNER MUTE
  ========================= */

  socket.on("ownerMute", (data) => {
    try {
      const owner = socket.username;
      const club = getClubBySocket(socket);

      if (!club || club.owner !== owner) return;

      const target = cleanUsername(data?.username);

      const seat = club.seats.find(
        s => s.username === target
      );

      if (!seat) return;

      seat.muted = true;

      broadcastClub(club);

      const targetSocket = getUserSocket(target);

      if (targetSocket) {
        io.to(targetSocket).emit("notification", {
          message: "Owner microphone kee mute godheera."
        });
      }

    } catch (err) {
      console.error(err);
    }
  });

  /* =========================
     REMOVE MEMBER
  ========================= */

  socket.on("removeMember", (data) => {
    try {
      const owner = socket.username;
      const club = getClubBySocket(socket);

      if (!club || club.owner !== owner) return;

      const target = cleanUsername(data?.username);

      for (const seat of club.seats) {
        if (seat.username === target) {
          seat.username = null;
          seat.muted = false;
        }
      }

      club.audience = club.audience.filter(
        u => u !== target
      );

      club.seatRequests = club.seatRequests.filter(
        u => u !== target
      );

      const targetSocket = getUserSocket(target);

      if (targetSocket) {
        io.to(targetSocket).emit("removedFromClub", {
          clubId: club.id
        });

        const targetSocketObj = io.sockets.sockets.get(
          targetSocket
        );

        if (targetSocketObj) {
          targetSocketObj.leave(`club:${club.id}`);
        }
      }

      broadcastClub(club);

    } catch (err) {
      console.error(err);
    }
  });

  /* =========================
     CLUB CHAT
  ========================= */

  socket.on("chatMessage", (data) => {
    try {
      const username = socket.username;
      const club = getClubBySocket(socket);

      if (!club || !username) return;

      const message = String(data?.message || "").trim();

      if (!message || message.length > 3000) return;

      const item = {
        id: crypto.randomBytes(6).toString("hex"),
        username,
        message,
        created_at: new Date().toISOString()
      };

      club.messages.push(item);

      if (club.messages.length > 100) {
        club.messages.shift();
      }

      io.to(`club:${club.id}`).emit(
        "clubChatMessage",
        item
      );

    } catch (err) {
      console.error(err);
    }
  });

  /* =========================
     GIFTS
  ========================= */

  socket.on("sendGift", (data) => {
    try {
      const username = socket.username;
      const club = getClubBySocket(socket);

      if (!club || !username) return;

      const gift = String(data?.gift || "🎁").slice(0, 20);

      io.to(`club:${club.id}`).emit(
        "giftReceived",
        {
          from: username,
          gift
        }
      );

    } catch (err) {
      console.error(err);
    }
  });

  /* =========================
     LEAVE CLUB
  ========================= */

  socket.on("leaveClub", () => {
    try {
      const username = socket.username;
      const club = getClubBySocket(socket);

      if (!club || !username) return;

      for (const seat of club.seats) {
        if (seat.username === username) {
          seat.username = null;
          seat.muted = false;
        }
      }

      club.audience = club.audience.filter(
        u => u !== username
      );

      club.seatRequests = club.seatRequests.filter(
        u => u !== username
      );

      socket.leave(`club:${club.id}`);

      broadcastClub(club);

      socket.emit("clubMemberUpdate", {
        username,
        action: "left"
      });

    } catch (err) {
      console.error(err);
    }
  });

  /* =========================
     CALL SYSTEM
  ========================= */

  socket.on("callUser", (data) => {
    try {
      const caller = socket.username;
      const target = cleanUsername(data?.username);
      const callType =
        data?.callType === "video"
          ? "video"
          : "audio";

      if (!caller || !target) return;

      const targetSocket = getUserSocket(target);

      if (!targetSocket) {
        return socket.emit("callUnavailable", {
          message: "User online miti."
        });
      }

      io.to(targetSocket).emit("incomingCall", {
        from: caller,
        callType,
        callerSocketId: socket.id
      });

    } catch (err) {
      console.error(err);
    }
  });

  socket.on("acceptCall", (data) => {
    try {
      const callerSocketId =
        String(data?.callerSocketId || "");

      if (!callerSocketId) return;

      io.to(callerSocketId).emit(
        "callAccepted",
        {
          targetSocketId: socket.id
        }
      );

    } catch (err) {
      console.error(err);
    }
  });

  socket.on("rejectCall", (data) => {
    try {
      const callerSocketId =
        String(data?.callerSocketId || "");

      if (!callerSocketId) return;

      io.to(callerSocketId).emit(
        "callRejected",
        {
          from: socket.username
        }
      );

    } catch (err) {
      console.error(err);
    }
  });

  /* =========================
     WEBRTC
  ========================= */

  socket.on("webrtc-offer", (data) => {
    const targetSocketId =
      String(data?.targetSocketId || "");

    if (!targetSocketId) return;

    io.to(targetSocketId).emit(
      "webrtc-offer",
      {
        offer: data.offer,
        fromSocketId: socket.id
      }
    );
  });

  socket.on("webrtc-answer", (data) => {
    const targetSocketId =
      String(data?.targetSocketId || "");

    if (!targetSocketId) return;

    io.to(targetSocketId).emit(
      "webrtc-answer",
      {
        answer: data.answer,
        fromSocketId: socket.id
      }
    );
  });

  socket.on("webrtc-ice", (data) => {
    const targetSocketId =
      String(data?.targetSocketId || "");

    if (!targetSocketId) return;

    io.to(targetSocketId).emit(
      "webrtc-ice",
      {
        candidate: data.candidate,
        fromSocketId: socket.id
      }
    );
  });

  socket.on("endCall", (data) => {
    const targetSocketId =
      String(data?.targetSocketId || "");

    if (!targetSocketId) return;

    io.to(targetSocketId).emit(
      "callEnded",
      {
        from: socket.username
      }
    );
  });

  /* =========================
     LOGOUT
  ========================= */

  socket.on("disconnect", async () => {
    try {
      const username = removeOnline(socket.id);

      if (!username) return;

      if (!onlineUsers.has(username)) {
        await pool.query(
          `UPDATE users
           SET status='offline', last_seen=NOW()
           WHERE username=$1`,
          [username]
        );

        socket.broadcast.emit(
          "presenceUpdate",
          {
            username,
            online: false
          }
        );
      }

    } catch (err) {
      console.error("DISCONNECT ERROR:", err);
    }
  });
});

/* =========================
   LOGOUT API
========================= */

app.post("/api/logout", authMiddleware, async (req, res) => {
  try {
    const username = req.user.username;

    await pool.query(
      `UPDATE users
       SET status='offline', last_seen=NOW()
       WHERE username=$1`,
      [username]
    );

    const sockets = onlineUsers.get(username);

    if (sockets) {
      for (const socketId of sockets) {
        const s = io.sockets.sockets.get(socketId);

        if (s) {
          s.disconnect(true);
        }
      }
    }

    res.json({
      ok: true
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Logout failed."
    });
  }
});

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================
   ERROR HANDLER
========================= */

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  res.status(500).json({
    error: "Server irratti rakkoon uumame."
  });
});

/* =========================
   START
========================= */

async function startServer() {
  try {
    await initDatabase();

    server.listen(PORT, "0.0.0.0", () => {
      console.log("=================================");
      console.log("✅ WALIIN-GM SERVER IS LIVE");
      console.log(`✅ PORT: ${PORT}`);
      console.log("✅ DATABASE: CONNECTED");
      console.log("=================================");
    });

  } catch (err) {
    console.error(
      "❌ DATABASE INITIALIZATION FAILED:",
      err.message
    );

    process.exit(1);
  }
}

startServer();

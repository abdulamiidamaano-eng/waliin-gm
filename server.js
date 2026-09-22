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
  }
});

const PORT = process.env.PORT || 10000;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL hin argamne.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true }));

const onlineUsers = new Map();

function cleanUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function hashPassword(password, salt) {
  return crypto
    .pbkdf2Sync(String(password), salt, 120000, 64, "sha512")
    .toString("hex");
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function userSockets(username) {
  return onlineUsers.get(cleanUsername(username)) || new Set();
}

function notifyUser(username, data) {
  const sockets = userSockets(username);

  for (const socketId of sockets) {
    io.to(socketId).emit("notification", data);
  }
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      token TEXT,
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT ''
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id SERIAL PRIMARY KEY,
      sender VARCHAR(100) NOT NULL,
      receiver VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      deleted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE private_messages
    ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE private_messages
    ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS follows (
      id SERIAL PRIMARY KEY,
      follower VARCHAR(100) NOT NULL,
      following VARCHAR(100) NOT NULL,
      UNIQUE(follower, following)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) NOT NULL,
      type VARCHAR(50) NOT NULL,
      from_user VARCHAR(100),
      message TEXT,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      id SERIAL PRIMARY KEY,
      blocker VARCHAR(100) NOT NULL,
      blocked VARCHAR(100) NOT NULL,
      UNIQUE(blocker, blocked)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gifts (
      id SERIAL PRIMARY KEY,
      sender VARCHAR(100),
      receiver VARCHAR(100),
      gift VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ Database initialized");
}

/* =========================
   REGISTER
========================= */

app.post("/api/register", async (req, res) => {
  try {
    let { username, email, password } = req.body;

    username = cleanUsername(username);
    email = String(email || "").trim().toLowerCase();
    password = String(password || "");

    if (!username || !email || !password) {
      return res.json({
        success: false,
        message: "Username, email fi password guuti."
      });
    }

    if (password.length < 6) {
      return res.json({
        success: false,
        message: "Password yoo xiqqaate qubee 6 qabaachuu qaba."
      });
    }

    const exists = await pool.query(
      `SELECT id FROM users
       WHERE LOWER(username)=LOWER($1)
          OR LOWER(email)=LOWER($2)
       LIMIT 1`,
      [username, email]
    );

    if (exists.rows.length) {
      return res.json({
        success: false,
        message: "Username ykn email duraan jira."
      });
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const token = makeToken();

    const result = await pool.query(
      `INSERT INTO users
       (username,email,password_hash,salt,token)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,username,email,bio,avatar,created_at`,
      [username, email, passwordHash, salt, token]
    );

    res.json({
      success: true,
      message: "Account uumameera.",
      token,
      user: result.rows[0]
    });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Register irratti rakkoo uumame."
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const login = String(
      req.body.login ||
      req.body.email ||
      req.body.username ||
      ""
    ).trim().toLowerCase();

    const password = String(req.body.password || "");

    if (!login || !password) {
      return res.json({
        success: false,
        message: "Username/email fi password galchi."
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM users
       WHERE LOWER(email)=LOWER($1)
          OR LOWER(username)=LOWER($1)
       LIMIT 1`,
      [login]
    );

    if (!result.rows.length) {
      return res.json({
        success: false,
        message: "Username ykn email sirrii miti."
      });
    }

    const user = result.rows[0];
    const hash = hashPassword(password, user.salt);

    if (hash !== user.password_hash) {
      return res.json({
        success: false,
        message: "Password sirrii miti."
      });
    }

    const token = makeToken();

    await pool.query(
      `UPDATE users SET token=$1 WHERE id=$2`,
      [token, user.id]
    );

    delete user.password_hash;
    delete user.salt;

    res.json({
      success: true,
      message: "Seentee jirta.",
      token,
      user
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Login irratti rakkoo uumame."
    });
  }
});

/* =========================
   LOGOUT
========================= */

app.post("/api/logout", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);

    await pool.query(
      `UPDATE users SET token=NULL WHERE LOWER(username)=LOWER($1)`,
      [username]
    );

    res.json({
      success: true
    });

  } catch (err) {
    res.status(500).json({
      success: false
    });
  }
});

/* =========================
   PROFILE
========================= */

app.get("/api/profile/:username", async (req, res) => {
  try {
    const username = cleanUsername(req.params.username);

    const result = await pool.query(
      `SELECT id,username,email,bio,avatar,created_at
       FROM users
       WHERE LOWER(username)=LOWER($1)
       LIMIT 1`,
      [username]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User hin argamne."
      });
    }

    res.json({
      success: true,
      user: result.rows[0],
      online: onlineUsers.has(username)
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Profile error."
    });
  }
});

app.post("/api/profile/update", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const bio = String(req.body.bio || "").slice(0, 1000);
    const avatar = String(req.body.avatar || "").slice(0, 2500000);

    const result = await pool.query(
      `UPDATE users
       SET bio=$1, avatar=$2
       WHERE LOWER(username)=LOWER($3)
       RETURNING id,username,email,bio,avatar,created_at`,
      [bio, avatar, username]
    );

    if (!result.rows.length) {
      return res.json({
        success: false,
        message: "User hin argamne."
      });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (err) {
    console.error("PROFILE UPDATE:", err);
    res.status(500).json({
      success: false,
      message: "Profile update hin milkoofne."
    });
  }
});

/* =========================
   SEARCH USERS
========================= */

app.get("/api/users/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (!q) {
      return res.json({
        success: true,
        users: []
      });
    }

    const result = await pool.query(
      `SELECT id,username,bio,avatar,created_at
       FROM users
       WHERE username ILIKE $1
          OR email ILIKE $1
       ORDER BY username
       LIMIT 30`,
      [`%${q}%`]
    );

    res.json({
      success: true,
      users: result.rows.map(user => ({
        ...user,
        online: onlineUsers.has(user.username)
      }))
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      users: []
    });
  }
});

/* =========================
   ONLINE USERS
========================= */

app.get("/api/users/online", async (req, res) => {
  try {
    const usernames = [...onlineUsers.keys()];

    if (!usernames.length) {
      return res.json({
        success: true,
        users: []
      });
    }

    const result = await pool.query(
      `SELECT username,bio,avatar
       FROM users
       WHERE username = ANY($1::text[])`,
      [usernames]
    );

    res.json({
      success: true,
      users: result.rows
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      users: []
    });
  }
});

/* =========================
   FOLLOW
========================= */

app.post("/api/follow", async (req, res) => {
  try {
    const follower = cleanUsername(req.body.follower);
    const following = cleanUsername(req.body.following);

    if (!follower || !following || follower === following) {
      return res.json({
        success: false,
        message: "Follow hin danda'amu."
      });
    }

    const exists = await pool.query(
      `SELECT id FROM follows
       WHERE follower=$1 AND following=$2`,
      [follower, following]
    );

    if (exists.rows.length) {
      await pool.query(
        `DELETE FROM follows
         WHERE follower=$1 AND following=$2`,
        [follower, following]
      );

      return res.json({
        success: true,
        following: false
      });
    }

    await pool.query(
      `INSERT INTO follows(follower,following)
       VALUES($1,$2)`,
      [follower, following]
    );

    await pool.query(
      `INSERT INTO notifications
       (username,type,from_user,message)
       VALUES($1,$2,$3,$4)`,
      [
        following,
        "follow",
        follower,
        `${follower} si hordofe.`
      ]
    );

    notifyUser(following, {
      type: "follow",
      from: follower,
      message: `${follower} si hordofe.`
    });

    res.json({
      success: true,
      following: true
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Follow error."
    });
  }
});

app.get("/api/follow/status", async (req, res) => {
  try {
    const follower = cleanUsername(req.query.follower);
    const following = cleanUsername(req.query.following);

    const result = await pool.query(
      `SELECT id FROM follows
       WHERE follower=$1 AND following=$2`,
      [follower, following]
    );

    res.json({
      success: true,
      following: result.rows.length > 0
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      following: false
    });
  }
});

/* =========================
   BLOCK / UNBLOCK
========================= */

app.post("/api/block", async (req, res) => {
  try {
    const blocker = cleanUsername(req.body.blocker);
    const blocked = cleanUsername(req.body.blocked);

    if (!blocker || !blocked || blocker === blocked) {
      return res.json({
        success: false,
        message: "Block hin danda'amu."
      });
    }

    const exists = await pool.query(
      `SELECT id FROM blocks
       WHERE blocker=$1 AND blocked=$2`,
      [blocker, blocked]
    );

    if (exists.rows.length) {
      await pool.query(
        `DELETE FROM blocks
         WHERE blocker=$1 AND blocked=$2`,
        [blocker, blocked]
      );

      return res.json({
        success: true,
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
      success: true,
      blocked: true
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Block error."
    });
  }
});

app.get("/api/block/status", async (req, res) => {
  try {
    const blocker = cleanUsername(req.query.blocker);
    const blocked = cleanUsername(req.query.blocked);

    const result = await pool.query(
      `SELECT id FROM blocks
       WHERE blocker=$1 AND blocked=$2`,
      [blocker, blocked]
    );

    res.json({
      success: true,
      blocked: result.rows.length > 0
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      blocked: false
    });
  }
});

async function isBlocked(a, b) {
  const result = await pool.query(
    `SELECT id FROM blocks
     WHERE (blocker=$1 AND blocked=$2)
        OR (blocker=$2 AND blocked=$1)
     LIMIT 1`,
    [a, b]
  );

  return result.rows.length > 0;
}

/* =========================
   NOTIFICATIONS
========================= */

app.get("/api/notifications/:username", async (req, res) => {
  try {
    const username = cleanUsername(req.params.username);

    const result = await pool.query(
      `SELECT id,type,from_user,message,is_read,created_at
       FROM notifications
       WHERE username=$1
       ORDER BY created_at DESC
       LIMIT 100`,
      [username]
    );

    res.json({
      success: true,
      notifications: result.rows
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      notifications: []
    });
  }
});

app.get("/api/notifications/unread-count/:username", async (req, res) => {
  try {
    const username = cleanUsername(req.params.username);

    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM notifications
       WHERE username=$1 AND is_read=false`,
      [username]
    );

    res.json({
      success: true,
      count: result.rows[0].count
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      count: 0
    });
  }
});

app.post("/api/notifications/read", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);

    await pool.query(
      `UPDATE notifications
       SET is_read=true
       WHERE username=$1`,
      [username]
    );

    res.json({
      success: true
    });

  } catch (err) {
    res.status(500).json({
      success: false
    });
  }
});

/* =========================
   PRIVATE CHAT HISTORY
========================= */

app.get("/api/messages", async (req, res) => {
  try {
    const user1 = cleanUsername(req.query.user1);
    const user2 = cleanUsername(req.query.user2);

    const result = await pool.query(
      `SELECT id,sender,receiver,message,is_read,deleted,created_at
       FROM private_messages
       WHERE
       (sender=$1 AND receiver=$2)
       OR
       (sender=$2 AND receiver=$1)
       ORDER BY created_at ASC
       LIMIT 500`,
      [user1, user2]
    );

    res.json({
      success: true,
      messages: result.rows
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      messages: []
    });
  }
});

/* =========================
   UNREAD CHAT COUNT
========================= */

app.get("/api/messages/unread/:username", async (req, res) => {
  try {
    const username = cleanUsername(req.params.username);

    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM private_messages
       WHERE receiver=$1
       AND is_read=false
       AND deleted=false`,
      [username]
    );

    res.json({
      success: true,
      count: result.rows[0].count
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      count: 0
    });
  }
});

/* =========================
   CLUBS
========================= */

const clubs = new Map();

function makeClubId() {
  return crypto.randomBytes(5).toString("hex");
}

function getClub(clubId) {
  return clubs.get(clubId);
}

io.on("connection", socket => {

  console.log("🔌 Connected:", socket.id);

  /* =========================
     IDENTIFY / ONLINE
  ========================= */

  socket.on("identify", ({ username }) => {
    username = cleanUsername(username);

    if (!username) return;

    socket.username = username;

    if (!onlineUsers.has(username)) {
      onlineUsers.set(username, new Set());
    }

    onlineUsers.get(username).add(socket.id);

    io.emit("presenceUpdate", {
      username,
      online: true
    });

    console.log("IDENTIFIED:", username);
  });

  /* =========================
     PRIVATE MESSAGE
  ========================= */

  socket.on("privateMessage", async ({ receiver, message }) => {
    try {
      const sender = cleanUsername(socket.username);
      receiver = cleanUsername(receiver);
      message = String(message || "").trim();

      if (!sender || !receiver || !message) return;

      if (await isBlocked(sender, receiver)) {
        socket.emit("messageError", {
          message: "Namni kun si block godhe ykn ati isa block goote."
        });
        return;
      }

      const result = await pool.query(
        `INSERT INTO private_messages
         (sender,receiver,message)
         VALUES($1,$2,$3)
         RETURNING id,sender,receiver,message,is_read,deleted,created_at`,
        [sender, receiver, message]
      );

      const item = result.rows[0];

      socket.emit("privateMessage", item);

      for (const s of io.sockets.sockets.values()) {
        if (s.username === receiver) {
          s.emit("privateMessage", item);
        }
      }

      await pool.query(
        `INSERT INTO notifications
         (username,type,from_user,message)
         VALUES($1,$2,$3,$4)`,
        [
          receiver,
          "message",
          sender,
          `${sender} ergaa siif erge.`
        ]
      );

      notifyUser(receiver, {
        type: "message",
        from: sender,
        message: `${sender} ergaa siif erge.`
      });

    } catch (err) {
      console.error("PRIVATE MESSAGE ERROR:", err);
    }
  });

  /* =========================
     MESSAGE READ
  ========================= */

  socket.on("messageRead", async ({ sender }) => {
    try {
      const receiver = cleanUsername(socket.username);
      sender = cleanUsername(sender);

      if (!receiver || !sender) return;

      await pool.query(
        `UPDATE private_messages
         SET is_read=true
         WHERE sender=$1
           AND receiver=$2
           AND is_read=false`,
        [sender, receiver]
      );

      for (const s of io.sockets.sockets.values()) {
        if (s.username === sender) {
          s.emit("messageRead", {
            by: receiver
          });
        }
      }

    } catch (err) {
      console.error("READ ERROR:", err);
    }
  });

  /* =========================
     DELETE MESSAGE
  ========================= */

  socket.on("deleteMessage", async ({ id }) => {
    try {
      const username = cleanUsername(socket.username);

      const result = await pool.query(
        `UPDATE private_messages
         SET deleted=true, message='Ergaan haqameera.'
         WHERE id=$1
           AND sender=$2
         RETURNING id,sender,receiver,message,deleted`,
        [id, username]
      );

      if (!result.rows.length) return;

      const item = result.rows[0];

      for (const s of io.sockets.sockets.values()) {
        if (
          s.username === item.sender ||
          s.username === item.receiver
        ) {
          s.emit("messageDeleted", item);
        }
      }

    } catch (err) {
      console.error("DELETE MESSAGE:", err);
    }
  });

  /* =========================
     1-TO-1 CALL
  ========================= */

  socket.on("callUser", ({ username, callType }) => {
    const caller = cleanUsername(socket.username);
    const target = cleanUsername(username);

    if (!caller || !target) return;

    const targets = userSockets(target);

    if (!targets.size) {
      socket.emit("callUnavailable", {
        username: target,
        message: "User kun online miti."
      });
      return;
    }

    for (const targetSocket of targets) {
      io.to(targetSocket).emit("incomingCall", {
        from: caller,
        callType: callType === "video" ? "video" : "voice",
        callerSocketId: socket.id
      });
    }
  });

  socket.on("acceptCall", ({ callerSocketId, callType }) => {
    io.to(callerSocketId).emit("callAccepted", {
      targetSocketId: socket.id,
      callType: callType === "video" ? "video" : "voice"
    });
  });

  socket.on("rejectCall", ({ callerSocketId }) => {
    io.to(callerSocketId).emit("callRejected", {
      from: socket.username
    });
  });

  socket.on("endCall", ({ targetSocketId }) => {
    if (targetSocketId) {
      io.to(targetSocketId).emit("callEnded", {
        from: socket.username
      });
    }
  });

  /* =========================
     CLUB CREATE
  ========================= */

  socket.on("createClub", ({ name, username }, callback) => {
    username = cleanUsername(username || socket.username);

    const clubId = makeClubId();

    const club = {
      id: clubId,
      name: String(name || "Waliin Club").slice(0, 100),
      owner: username,
      members: new Map(),
      seats: Array.from({ length: 15 }, (_, i) => ({
        seat: i,
        username: i === 0 ? username : null,
        muted: false
      }))
    };

    club.members.set(socket.id, {
      socketId: socket.id,
      username
    });

    clubs.set(clubId, club);

    socket.clubId = clubId;
    socket.join(clubId);

    if (callback) {
      callback({
        success: true,
        club
      });
    }

    io.to(clubId).emit("clubUpdate", club);
  });

  /* =========================
     JOIN CLUB
  ========================= */

  socket.on("joinClub", ({ clubId, username }, callback) => {
    username = cleanUsername(username || socket.username);

    const club = getClub(clubId);

    if (!club) {
      if (callback) {
        callback({
          success: false,
          message: "Club hin argamne."
        });
      }
      return;
    }

    club.members.set(socket.id, {
      socketId: socket.id,
      username
    });

    socket.clubId = clubId;
    socket.join(clubId);

    if (callback) {
      callback({
        success: true,
        club
      });
    }

    io.to(clubId).emit("clubUpdate", club);
  });

  /* =========================
     REQUEST SEAT
  ========================= */

  socket.on("requestSeat", () => {
    const club = getClub(socket.clubId);

    if (!club) return;

    io.to(club.id).emit("seatRequested", {
      username: socket.username
    });
  });

  /* =========================
     GIVE SEAT
  ========================= */

  socket.on("giveSeat", ({ username, seat }) => {
    const club = getClub(socket.clubId);

    if (!club || club.owner !== socket.username) return;

    seat = Number(seat);

    if (seat < 0 || seat > 14) return;

    for (const s of club.seats) {
      if (s.username === username) {
        s.username = null;
      }
    }

    club.seats[seat].username = cleanUsername(username);

    io.to(club.id).emit("clubUpdate", club);
  });

  /* =========================
     LEAVE SEAT
  ========================= */

  socket.on("leaveSeat", () => {
    const club = getClub(socket.clubId);

    if (!club) return;

    for (const seat of club.seats) {
      if (seat.username === socket.username) {
        seat.username = null;
      }
    }

    io.to(club.id).emit("clubUpdate", club);
  });

  /* =========================
     MUTE SELF
  ========================= */

  socket.on("muteSelf", ({ muted }) => {
    const club = getClub(socket.clubId);

    if (!club) return;

    for (const seat of club.seats) {
      if (seat.username === socket.username) {
        seat.muted = !!muted;
      }
    }

    io.to(club.id).emit("clubUpdate", club);
  });

  /* =========================
     OWNER MUTE
  ========================= */

  socket.on("ownerMute", ({ username }) => {
    const club = getClub(socket.clubId);

    if (!club || club.owner !== socket.username) return;

    for (const seat of club.seats) {
      if (seat.username === cleanUsername(username)) {
        seat.muted = !seat.muted;
      }
    }

    io.to(club.id).emit("clubUpdate", club);
  });

  /* =========================
     REMOVE MEMBER
  ========================= */

  socket.on("removeMember", ({ username }) => {
    const club = getClub(socket.clubId);

    if (!club || club.owner !== socket.username) return;

    username = cleanUsername(username);

    for (const [socketId, member] of club.members.entries()) {
      if (member.username === username) {
        io.to(socketId).emit("removedFromClub");
        io.sockets.sockets.get(socketId)?.leave(club.id);
        club.members.delete(socketId);
      }
    }

    for (const seat of club.seats) {
      if (seat.username === username) {
        seat.username = null;
      }
    }

    io.to(club.id).emit("clubUpdate", club);
  });

  /* =========================
     CLUB CHAT
  ========================= */

  socket.on("chatMessage", ({ message }) => {
    const club = getClub(socket.clubId);

    if (!club) return;

    const item = {
      username: socket.username,
      message: String(message || "").slice(0, 1000),
      created_at: new Date().toISOString()
    };

    io.to(club.id).emit("chatMessage", item);
  });

  /* =========================
     GIFT
  ========================= */

  socket.on("sendGift", async ({ gift }) => {
    const club = getClub(socket.clubId);

    if (!club) return;

    const allowed = ["❤️", "🌹", "🎁", "⭐", "👑"];

    if (!allowed.includes(gift)) return;

    await pool.query(
      `INSERT INTO gifts(sender,gift)
       VALUES($1,$2)`,
      [socket.username, gift]
    );

    io.to(club.id).emit("giftReceived", {
      username: socket.username,
      gift
    });
  });

  /* =========================
     WEBRTC SIGNALING
  ========================= */

  socket.on("webrtc-offer", ({ target, offer }) => {
    io.to(target).emit("webrtc-offer", {
      from: socket.id,
      offer
    });
  });

  socket.on("webrtc-answer", ({ target, answer }) => {
    io.to(target).emit("webrtc-answer", {
      from: socket.id,
      answer
    });
  });

  socket.on("webrtc-ice", ({ target, candidate }) => {
    io.to(target).emit("webrtc-ice", {
      from: socket.id,
      candidate
    });
  });

  /* =========================
     CLUB MEMBERS
  ========================= */

  socket.on("getClubMembers", callback => {
    const club = getClub(socket.clubId);

    if (!club) {
      if (callback) callback([]);
      return;
    }

    const members = [...club.members.values()];

    if (callback) callback(members);
  });

  /* =========================
     LEAVE CLUB
  ========================= */

  socket.on("leaveClub", () => {
    leaveCurrentClub(socket);
  });

  /* =========================
     DISCONNECT
  ========================= */

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);

    if (socket.username) {
      const username = socket.username;

      const set = onlineUsers.get(username);

      if (set) {
        set.delete(socket.id);

        if (set.size === 0) {
          onlineUsers.delete(username);

          io.emit("presenceUpdate", {
            username,
            online: false
          });
        }
      }
    }

    leaveCurrentClub(socket);
  });
});

/* =========================
   LEAVE CLUB FUNCTION
========================= */

function leaveCurrentClub(socket) {
  const clubId = socket.clubId;

  if (!clubId) return;

  const club = clubs.get(clubId);

  if (!club) return;

  club.members.delete(socket.id);

  for (const seat of club.seats) {
    if (seat.username === socket.username) {
      seat.username = null;
    }
  }

  socket.leave(clubId);
  socket.clubId = null;

  if (club.members.size === 0) {
    clubs.delete(clubId);
  } else {
    io.to(clubId).emit("clubUpdate", club);
  }
}

/* =========================
   HEALTH
========================= */

app.get("/health", (req, res) => {
  res.json({
    success: true,
    app: "Waliin-GM",
    onlineUsers: onlineUsers.size,
    clubs: clubs.size,
    time: new Date().toISOString()
  });
});

/* =========================
   STATIC
========================= */

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================
   START SERVER
========================= */

initDatabase()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Waliin-GM server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("❌ DATABASE INIT FAILED:", err);
    process.exit(1);
  });

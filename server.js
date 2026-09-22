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

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const onlineUsers = new Map();
const clubs = new Map();

function cleanUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function makeId() {
  return crypto.randomBytes(8).toString("hex");
}

function hashPassword(password, salt) {
  return crypto
    .createHash("sha256")
    .update(String(password) + String(salt))
    .digest("hex");
}

function userSockets(username) {
  return onlineUsers.get(cleanUsername(username)) || new Set();
}

function notifyUser(username, data) {
  for (const socketId of userSockets(username)) {
    io.to(socketId).emit("notification", data);
  }
}

async function isBlocked(a, b) {
  const result = await pool.query(
    `SELECT 1
     FROM blocks
     WHERE (username=$1 AND blocked_username=$2)
        OR (username=$2 AND blocked_username=$1)
     LIMIT 1`,
    [cleanUsername(a), cleanUsername(b)]
  );

  return result.rows.length > 0;
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      token TEXT,
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id SERIAL PRIMARY KEY,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      deleted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS follows (
      id SERIAL PRIMARY KEY,
      follower TEXT NOT NULL,
      following TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(follower, following)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      type TEXT NOT NULL,
      from_user TEXT,
      message TEXT,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      blocked_username TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(username, blocked_username)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gifts (
      id SERIAL PRIMARY KEY,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      gift TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log("✅ Database initialized.");
}

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      ok: true,
      database: true,
      service: "Waliin-GM"
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      database: false,
      error: error.message
    });
  }
});

/* =========================
   REGISTER
========================= */

app.post("/api/register", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const email = cleanText(req.body.email, 150).toLowerCase();
    const password = String(req.body.password || "");

    if (!username || !email || !password) {
      return res.status(400).json({
        error: "Username, email fi password guuti."
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        error: "Username yoo xiqqaate qubee 3 qabaachuu qaba."
      });
    }

    if (password.length < 4) {
      return res.status(400).json({
        error: "Password yoo xiqqaate qubee 4 qabaachuu qaba."
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
      return res.status(409).json({
        error: "Username ykn email duraan jira."
      });
    }

    const salt = makeToken();
    const passwordHash = hashPassword(password, salt);
    const token = makeToken();

    const result = await pool.query(
      `INSERT INTO users
       (username,email,password_hash,salt,token)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id,username,email,bio,avatar,created_at`,
      [username, email, passwordHash, salt, token]
    );

    res.json({
      ok: true,
      token,
      user: result.rows[0]
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    res.status(500).json({
      error: "Register irratti dogoggorri uumame."
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const login = cleanText(
      req.body.login || req.body.email || req.body.username,
      150
    );

    const password = String(req.body.password || "");

    if (!login || !password) {
      return res.status(400).json({
        error: "Username/email fi password galchi."
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
      return res.status(401).json({
        error: "Username/email ykn password sirrii miti."
      });
    }

    const user = result.rows[0];

    const hash = hashPassword(password, user.salt);

    if (hash !== user.password_hash) {
      return res.status(401).json({
        error: "Username/email ykn password sirrii miti."
      });
    }

    const token = makeToken();

    await pool.query(
      `UPDATE users SET token=$1 WHERE id=$2`,
      [token, user.id]
    );

    delete user.password_hash;
    delete user.salt;
    delete user.token;

    res.json({
      ok: true,
      token,
      user
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    res.status(500).json({
      error: "Login irratti dogoggorri uumame."
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
      `UPDATE users SET token=NULL WHERE username=$1`,
      [username]
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: "Logout failed."
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
       WHERE username=$1`,
      [username]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "User hin argamne."
      });
    }

    const user = result.rows[0];

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
      ...user,
      followers: followers.rows[0].count,
      following: following.rows[0].count
    });
  } catch (error) {
    res.status(500).json({
      error: "Profile error."
    });
  }
});

app.post("/api/profile/update", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const bio = cleanText(req.body.bio, 500);
    const avatar = String(req.body.avatar || "").slice(0, 500000);

    const result = await pool.query(
      `UPDATE users
       SET bio=$1, avatar=$2
       WHERE username=$3
       RETURNING id,username,email,bio,avatar,created_at`,
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
  } catch (error) {
    console.error("PROFILE UPDATE:", error);
    res.status(500).json({
      error: "Profile update failed."
    });
  }
});

/* =========================
   SEARCH
========================= */

app.get("/api/users/search", async (req, res) => {
  try {
    const q = cleanText(req.query.q, 100);

    if (!q) return res.json([]);

    const result = await pool.query(
      `SELECT username,bio,avatar
       FROM users
       WHERE username ILIKE $1
       ORDER BY username
       LIMIT 30`,
      [`%${q}%`]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json([]);
  }
});

/* =========================
   ONLINE USERS
========================= */

app.get("/api/users/online", async (req, res) => {
  try {
    const usernames = [...onlineUsers.keys()];

    if (!usernames.length) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT username,bio,avatar
       FROM users
       WHERE username = ANY($1::text[])
       ORDER BY username`,
      [usernames]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json([]);
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
      return res.status(400).json({
        error: "Follow data sirrii miti."
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

    await pool.query(
      `INSERT INTO notifications
       (username,type,from_user,message)
       VALUES($1,$2,$3,$4)`,
      [
        following,
        "follow",
        follower,
        `${follower} si hordofeera.`
      ]
    );

    notifyUser(following, {
      type: "follow",
      from: follower,
      message: `${follower} si hordofeera.`
    });

    res.json({
      ok: true,
      following: true
    });
  } catch (error) {
    res.status(500).json({
      error: "Follow failed."
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
      following: result.rows.length > 0
    });
  } catch (error) {
    res.status(500).json({
      following: false
    });
  }
});

/* =========================
   BLOCK
========================= */

app.post("/api/block", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const blocked = cleanUsername(req.body.blocked);

    if (!username || !blocked || username === blocked) {
      return res.status(400).json({
        error: "Block data sirrii miti."
      });
    }

    const existing = await pool.query(
      `SELECT id FROM blocks
       WHERE username=$1 AND blocked_username=$2`,
      [username, blocked]
    );

    if (existing.rows.length) {
      await pool.query(
        `DELETE FROM blocks
         WHERE username=$1 AND blocked_username=$2`,
        [username, blocked]
      );

      return res.json({
        ok: true,
        blocked: false
      });
    }

    await pool.query(
      `INSERT INTO blocks(username,blocked_username)
       VALUES($1,$2)
       ON CONFLICT DO NOTHING`,
      [username, blocked]
    );

    res.json({
      ok: true,
      blocked: true
    });
  } catch (error) {
    res.status(500).json({
      error: "Block failed."
    });
  }
});

app.get("/api/block/status", async (req, res) => {
  try {
    const username = cleanUsername(req.query.username);
    const blocked = cleanUsername(req.query.blocked);

    const result = await pool.query(
      `SELECT id FROM blocks
       WHERE username=$1 AND blocked_username=$2`,
      [username, blocked]
    );

    res.json({
      blocked: result.rows.length > 0
    });
  } catch (error) {
    res.json({
      blocked: false
    });
  }
});

/* =========================
   NOTIFICATIONS
========================= */

app.get("/api/notifications/:username", async (req, res) => {
  try {
    const username = cleanUsername(req.params.username);

    const result = await pool.query(
      `SELECT *
       FROM notifications
       WHERE username=$1
       ORDER BY created_at DESC
       LIMIT 100`,
      [username]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json([]);
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
      count: result.rows[0].count
    });
  } catch (error) {
    res.json({ count: 0 });
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

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false });
  }
});

/* =========================
   MESSAGES
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

    res.json(result.rows);
  } catch (error) {
    res.status(500).json([]);
  }
});

app.get("/api/messages/unread/:username", async (req, res) => {
  try {
    const username = cleanUsername(req.params.username);

    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM private_messages
       WHERE receiver=$1 AND is_read=false`,
      [username]
    );

    res.json({
      count: result.rows[0].count
    });
  } catch (error) {
    res.json({
      count: 0
    });
  }
});

/* =========================
   SOCKET.IO
========================= */

io.engine.on("connection_error", (err) => {
  console.error(
    "❌ SOCKET CONNECTION ERROR:",
    err.message,
    "CODE:",
    err.code
  );
});

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

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

    console.log("👤 Identified:", username);
  });

  /* PRIVATE MESSAGE */

  socket.on("privateMessage", async ({ receiver, message }) => {
    try {
      const sender = cleanUsername(socket.username);
      receiver = cleanUsername(receiver);
      message = cleanText(message);

      if (!sender || !receiver || !message) return;

      if (await isBlocked(sender, receiver)) {
        socket.emit("messageError", {
          message:
            "Namni kun si block godhe ykn ati isa block goote."
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
    } catch (error) {
      console.error("PRIVATE MESSAGE:", error);
      socket.emit("messageError", {
        message: "Ergaa erguu hin dandeenye."
      });
    }
  });

  /* MESSAGE READ */

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
    } catch (error) {
      console.error("READ ERROR:", error);
    }
  });

  /* DELETE MESSAGE */

  socket.on("deleteMessage", async ({ id }) => {
    try {
      const username = cleanUsername(socket.username);

      const result = await pool.query(
        `UPDATE private_messages
         SET deleted=true,
             message='Ergaan haqameera.'
         WHERE id=$1 AND sender=$2
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
    } catch (error) {
      console.error("DELETE MESSAGE:", error);
    }
  });

  /* =========================
     VOICE / VIDEO CALL
  ========================= */

  socket.on("callUser", ({ username, callType }) => {
    const caller = cleanUsername(socket.username);
    const target = cleanUsername(username);

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
        callType:
          callType === "video"
            ? "video"
            : "voice",
        callerSocketId: socket.id
      });
    }
  });

  socket.on(
    "acceptCall",
    ({ callerSocketId, callType }) => {
      io.to(callerSocketId).emit("callAccepted", {
        targetSocketId: socket.id,
        callType:
          callType === "video"
            ? "video"
            : "voice"
      });
    }
  );

  socket.on("rejectCall", ({ callerSocketId }) => {
    io.to(callerSocketId).emit("callRejected", {
      from: socket.username
    });
  });

  socket.on("endCall", ({ targetSocketId }) => {
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("callEnded", {
      from: socket.username
    });
  });

  /* =========================
     WEBRTC
  ========================= */

  socket.on("webrtc-offer", ({ target, offer }) => {
    if (!target || !offer) return;

    io.to(target).emit("webrtc-offer", {
      from: socket.id,
      offer
    });
  });

  socket.on("webrtc-answer", ({ target, answer }) => {
    if (!target || !answer) return;

    io.to(target).emit("webrtc-answer", {
      from: socket.id,
      answer
    });
  });

  socket.on("webrtc-ice", ({ target, candidate }) => {
    if (!target || !candidate) return;

    io.to(target).emit("webrtc-ice", {
      from: socket.id,
      candidate
    });
  });

  /* =========================
     CLUB CREATE
  ========================= */

  socket.on("createClub", ({ name, username }, callback) => {
    username = cleanUsername(username);
    name = cleanText(name, 100);

    if (!username || !name) {
      return callback?.({
        ok: false,
        error: "Maqaa club galchi."
      });
    }

    const clubId = makeId();

    const seats = Array.from(
      { length: 15 },
      (_, index) => ({
        seat: index,
        username:
          index === 0 ? username : null,
        muted: false
      })
    );

    const club = {
      id: clubId,
      name,
      owner: username,
      members: new Set([username]),
      seats,
      messages: []
    };

    clubs.set(clubId, club);

    socket.join(`club:${clubId}`);
    socket.clubId = clubId;

    callback?.({
      ok: true,
      club
    });

    io.to(`club:${clubId}`).emit(
      "clubUpdated",
      clubData(club)
    );
  });

  /* =========================
     JOIN CLUB
  ========================= */

  socket.on("joinClub", ({ clubId, username }, callback) => {
    username = cleanUsername(username);
    clubId = cleanText(clubId, 100);

    const club = clubs.get(clubId);

    if (!club) {
      return callback?.({
        ok: false,
        error: "Club hin argamne."
      });
    }

    club.members.add(username);

    socket.join(`club:${clubId}`);
    socket.clubId = clubId;
    socket.username = username;

    callback?.({
      ok: true,
      club: clubData(club)
    });

    io.to(`club:${clubId}`).emit(
      "clubMemberUpdate",
      clubData(club)
    );
  });

  /* =========================
     REQUEST SEAT
  ========================= */

  socket.on("requestSeat", () => {
    const club = clubs.get(socket.clubId);

    if (!club) return;

    io.to(`club:${club.id}`).emit(
      "seatRequest",
      {
        username: socket.username
      }
    );
  });

  /* =========================
     GIVE SEAT
  ========================= */

  socket.on("giveSeat", ({ username, seat }) => {
    const club = clubs.get(socket.clubId);

    if (!club) return;

    if (club.owner !== socket.username) return;

    seat = Number(seat);

    if (seat < 0 || seat > 14) return;

    for (const s of club.seats) {
      if (s.username === username) {
        s.username = null;
      }
    }

    club.seats[seat].username = username;
    club.seats[seat].muted = false;

    io.to(`club:${club.id}`).emit(
      "clubUpdated",
      clubData(club)
    );
  });

  /* =========================
     LEAVE SEAT
  ========================= */

  socket.on("leaveSeat", () => {
    const club = clubs.get(socket.clubId);

    if (!club) return;

    for (const s of club.seats) {
      if (s.username === socket.username) {
        s.username = null;
        s.muted = false;
      }
    }

    io.to(`club:${club.id}`).emit(
      "clubUpdated",
      clubData(club)
    );
  });

  /* =========================
     SELF MUTE
  ========================= */

  socket.on("muteSelf", ({ muted }) => {
    const club = clubs.get(socket.clubId);

    if (!club) return;

    for (const s of club.seats) {
      if (s.username === socket.username) {
        s.muted = !!muted;
      }
    }

    io.to(`club:${club.id}`).emit(
      "clubUpdated",
      clubData(club)
    );
  });

  /* =========================
     OWNER MUTE
  ========================= */

  socket.on("ownerMute", ({ username }) => {
    const club = clubs.get(socket.clubId);

    if (!club) return;
    if (club.owner !== socket.username) return;

    for (const s of club.seats) {
      if (s.username === username) {
        s.muted = !s.muted;
      }
    }

    io.to(`club:${club.id}`).emit(
      "clubUpdated",
      clubData(club)
    );
  });

  /* =========================
     REMOVE MEMBER
  ========================= */

  socket.on("removeMember", ({ username }) => {
    const club = clubs.get(socket.clubId);

    if (!club) return;
    if (club.owner !== socket.username) return;
    if (username === club.owner) return;

    club.members.delete(username);

    for (const s of club.seats) {
      if (s.username === username) {
        s.username = null;
        s.muted = false;
      }
    }

    for (const s of io.sockets.sockets.values()) {
      if (
        s.username === username &&
        s.clubId === club.id
      ) {
        s.leave(`club:${club.id}`);
        s.clubId = null;

        s.emit("removedFromClub");
      }
    }

    io.to(`club:${club.id}`).emit(
      "clubUpdated",
      clubData(club)
    );
  });

  /* =========================
     CLUB CHAT
  ========================= */

  socket.on("chatMessage", ({ message }) => {
    const club = clubs.get(socket.clubId);

    if (!club) return;

    message = cleanText(message);

    if (!message) return;

    const item = {
      id: makeId(),
      username: socket.username,
      message,
      created_at: new Date().toISOString()
    };

    club.messages.push(item);

    if (club.messages.length > 200) {
      club.messages.shift();
    }

    io.to(`club:${club.id}`).emit(
      "clubChatMessage",
      item
    );
  });

  /* =========================
     GIFT
  ========================= */

  socket.on("sendGift", async ({ gift }) => {
    try {
      const club = clubs.get(socket.clubId);

      if (!club) return;

      const allowed = [
        "❤️",
        "🌹",
        "🎁",
        "⭐",
        "👑"
      ];

      if (!allowed.includes(gift)) return;

      await pool.query(
        `INSERT INTO gifts(sender,receiver,gift)
         VALUES($1,$2,$3)`,
        [
          socket.username,
          club.owner,
          gift
        ]
      );

      io.to(`club:${club.id}`).emit(
        "giftReceived",
        {
          from: socket.username,
          gift
        }
      );
    } catch (error) {
      console.error("GIFT ERROR:", error);
    }
  });

  /* =========================
     CLUB MEMBERS
  ========================= */

  socket.on("getClubMembers", () => {
    const club = clubs.get(socket.clubId);

    if (!club) return;

    socket.emit(
      "clubMembers",
      clubData(club)
    );
  });

  /* =========================
     CLUB WEBRTC
  ========================= */

  socket.on(
    "club-webrtc-offer",
    ({ target, offer }) => {
      if (!target || !offer) return;

      io.to(target).emit(
        "club-webrtc-offer",
        {
          from: socket.id,
          offer
        }
      );
    }
  );

  socket.on(
    "club-webrtc-answer",
    ({ target, answer }) => {
      if (!target || !answer) return;

      io.to(target).emit(
        "club-webrtc-answer",
        {
          from: socket.id,
          answer
        }
      );
    }
  );

  socket.on(
    "club-webrtc-ice",
    ({ target, candidate }) => {
      if (!target || !candidate) return;

      io.to(target).emit(
        "club-webrtc-ice",
        {
          from: socket.id,
          candidate
        }
      );
    }
  );

  /* =========================
     LEAVE CLUB
  ========================= */

  socket.on("leaveClub", () => {
    leaveClub(socket);
  });

  /* =========================
     DISCONNECT
  ========================= */

  socket.on("disconnect", (reason) => {
    console.log(
      "🔴 Socket disconnected:",
      socket.id,
      reason
    );

    const username = cleanUsername(socket.username);

    if (username && onlineUsers.has(username)) {
      onlineUsers.get(username).delete(socket.id);

      if (onlineUsers.get(username).size === 0) {
        onlineUsers.delete(username);

        io.emit("presenceUpdate", {
          username,
          online: false
        });
      }
    }

    leaveClub(socket);
  });
});

/* =========================
   CLUB HELPERS
========================= */

function clubData(club) {
  return {
    id: club.id,
    name: club.name,
    owner: club.owner,
    members: [...club.members],
    seats: club.seats,
    messages: club.messages
  };
}

function leaveClub(socket) {
  const clubId = socket.clubId;

  if (!clubId) return;

  const club = clubs.get(clubId);

  if (!club) {
    socket.clubId = null;
    return;
  }

  club.members.delete(socket.username);

  for (const s of club.seats) {
    if (s.username === socket.username) {
      s.username = null;
      s.muted = false;
    }
  }

  socket.leave(`club:${clubId}`);
  socket.clubId = null;

  io.to(`club:${clubId}`).emit(
    "clubUpdated",
    clubData(club)
  );

  if (
    club.members.size === 0 ||
    club.owner === socket.username
  ) {
    if (club.members.size === 0) {
      clubs.delete(clubId);
    }
  }
}

/* =========================
   FRONTEND
========================= */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================
   START SERVER
========================= */

initDatabase()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(
        `🚀 Waliin-GM server running on port ${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error(
      "❌ DATABASE INITIALIZATION FAILED:",
      error
    );
    process.exit(1);
  });

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL || "";

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function initDatabase() {
  if (!pool) {
    console.log("⚠️ DATABASE_URL hin jiru.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      token TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gifts (
      id SERIAL PRIMARY KEY,
      club_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      gift TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ Database ready.");
}

function hashPassword(password, salt) {
  return crypto
    .createHash("sha256")
    .update(String(password) + salt)
    .digest("hex");
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function makeClubId() {
  return crypto.randomBytes(4).toString("hex");
}

/* =========================
   REGISTER
========================= */

app.post("/api/register", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        success: false,
        message: "DATABASE_URL hin qindaa'in."
      });
    }

    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Username, email fi password guuti."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password yoo xiqqaate 6 characters haa qabaatu."
      });
    }

    const exists = await pool.query(
      "SELECT id FROM users WHERE email=$1",
      [email]
    );

    if (exists.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email kun duraan jira."
      });
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const token = createToken();

    const result = await pool.query(
      `INSERT INTO users
       (username,email,password_hash,salt,token)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,username,email,token`,
      [
        username,
        email,
        passwordHash,
        salt,
        token
      ]
    );

    res.json({
      success: true,
      message: "Account uumame.",
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
    if (!pool) {
      return res.status(500).json({
        success: false,
        message: "DATABASE_URL hin qindaa'in."
      });
    }

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");

    const result = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Email ykn password sirrii miti."
      });
    }

    const user = result.rows[0];

    const passwordHash = hashPassword(
      password,
      user.salt
    );

    if (passwordHash !== user.password_hash) {
      return res.status(401).json({
        success: false,
        message: "Email ykn password sirrii miti."
      });
    }

    const token = createToken();

    await pool.query(
      "UPDATE users SET token=$1 WHERE id=$2",
      [token, user.id]
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        token
      }
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
    if (pool && req.body.token) {
      await pool.query(
        "UPDATE users SET token=NULL WHERE token=$1",
        [req.body.token]
      );
    }

    res.json({
      success: true
    });

  } catch (err) {
    res.json({
      success: true
    });
  }
});

/* =========================
   CLUB SYSTEM
========================= */

const clubs = new Map();

function createClub(name, owner, ownerSocketId) {

  const id = makeClubId();

  const club = {
    id,
    name: name || "Waliin-GM Club",
    owner,
    members: new Map(),
    requests: [],
    seats: Array(15).fill(null),
    messages: [],
    createdAt: Date.now()
  };

  club.members.set(owner, {
    username: owner,
    socketId: ownerSocketId,
    muted: false,
    seat: 0
  });

  club.seats[0] = owner;

  clubs.set(id, club);

  return club;
}

/* =========================
   PUBLIC CLUB DATA
========================= */

function publicClub(club) {

  return {
    id: club.id,

    name: club.name,

    owner: club.owner,

    members: [...club.members.values()],

    requests: club.requests,

    seats: club.seats,

    messages: club.messages,

    listenerCount: Math.max(
      0,
      club.members.size -
      club.seats.filter(Boolean).length
    )
  };
}

/* =========================
   SOCKET CONNECTION
========================= */

io.on("connection", (socket) => {

  console.log("🟢 Connected:", socket.id);

  /* =========================
     CREATE CLUB
  ========================= */

  socket.on("createClub", ({ name, username }, callback) => {

    if (!username) {
      return callback?.({
        success: false,
        message: "Username barbaachisa."
      });
    }

    const club = createClub(
      name,
      username,
      socket.id
    );

    socket.join(club.id);

    socket.clubId = club.id;
    socket.username = username;

    callback?.({
      success: true,
      club: publicClub(club)
    });

    io.to(club.id).emit(
      "clubUpdate",
      publicClub(club)
    );
  });

  /* =========================
     JOIN CLUB
  ========================= */

  socket.on("joinClub", ({ clubId, username }, callback) => {

    const club = clubs.get(clubId);

    if (!club) {
      return callback?.({
        success: false,
        message: "Club hin argamne."
      });
    }

    if (!username) {
      return callback?.({
        success: false,
        message: "Username barbaachisa."
      });
    }

    /*
      Yoo username duraan jiru,
      socket ID haarawa itti galchina.
    */

    if (club.members.has(username)) {

      const member = club.members.get(username);

      member.socketId = socket.id;

      socket.join(clubId);

      socket.clubId = clubId;
      socket.username = username;

      callback?.({
        success: true,
        club: publicClub(club)
      });

      io.to(club.id).emit(
        "clubUpdate",
        publicClub(club)
      );

      return;
    }

    club.members.set(username, {
      username,
      socketId: socket.id,
      muted: false,
      seat: null
    });

    socket.join(clubId);

    socket.clubId = clubId;
    socket.username = username;

    callback?.({
      success: true,
      club: publicClub(club)
    });

    io.to(club.id).emit(
      "clubUpdate",
      publicClub(club)
    );
  });

  /* =========================
     REQUEST SEAT
  ========================= */

  socket.on("requestSeat", () => {

    const club = clubs.get(socket.clubId);

    if (!club) return;

    if (!club.members.has(socket.username)) {
      return;
    }

    if (!club.requests.includes(socket.username)) {

      club.requests.push(
        socket.username
      );
    }

    io.to(club.id).emit(
      "seatRequest",
      {
        username: socket.username
      }
    );

    io.to(club.id).emit(
      "clubUpdate",
      publicClub(club)
    );
  });

  /* =========================
     GIVE SEAT
  ========================= */

  socket.on("giveSeat", ({ username, seat }) => {

    const club = clubs.get(socket.clubId);

    if (!club) return;

    if (socket.username !== club.owner) {
      return;
    }

    seat = Number(seat);

    if (
      Number.isNaN(seat) ||
      seat < 0 ||
      seat >= 15
    ) {
      return;
    }

    if (club.seats[seat]) {
      return;
    }

    const member = club.members.get(username);

    if (!member) {
      return;
    }

    if (member.seat !== null) {
      return;
    }

    club.seats[seat] = username;

    member.seat = seat;

    club.requests = club.requests.filter(
      u => u !== username
    );

    io.to(club.id).emit(
      "clubUpdate",
      publicClub(club)
    );

    io.to(club.id).emit(
      "seatGranted",
      {
        username,
        seat
      }
    );
  });

  /* =========================
     LEAVE SEAT
  ========================= */

  socket.on("leaveSeat", () => {

    const club = clubs.get(socket.clubId);

    if (!club) return;

    const member =
      club.members.get(socket.username);

    if (!member) return;

    if (member.seat !== null) {

      club.seats[member.seat] = null;

      member.seat = null;
    }

    io.to(club.id).emit(
      "clubUpdate",
      publicClub(club)
    );
  });

  /* =========================
     SELF MUTE
  ========================= */

  socket.on("muteSelf", ({ muted }) => {

    const club = clubs.get(socket.clubId);

    if (!club) return;

    const member =
      club.members.get(socket.username);

    if (!member) return;

    member.muted = !!muted;

    io.to(club.id).emit(
      "memberMute",
      {
        username: socket.username,
        muted: member.muted
      }
    );

    io.to(club.id).emit(
      "clubUpdate",
      publicClub(club)
    );
  });

  /* =========================
     OWNER MUTE
  ========================= */

  socket.on("ownerMute", ({ username }) => {

    const club = clubs.get(socket.clubId);

    if (!club) return;

    if (socket.username !== club.owner) {
      return;
    }

    const member =
      club.members.get(username);

    if (!member) return;

    member.muted = true;

    io.to(club.id).emit(
      "memberMute",
      {
        username,
        muted: true,
        byOwner: true
      }
    );

    io.to(club.id).emit(
      "clubUpdate",
      publicClub(club)
    );
  });

  /* =========================
     REMOVE MEMBER
  ========================= */

  socket.on("removeMember", ({ username }) => {

    const club = clubs.get(socket.clubId);

    if (!club) return;

    if (socket.username !== club.owner) {
      return;
    }

    if (username === club.owner) {
      return;
    }

    const member =
      club.members.get(username);

    if (!member) return;

    if (member.seat !== null) {
      club.seats[member.seat] = null;
    }

    club.members.delete(username);

    club.requests =
      club.requests.filter(
        u => u !== username
      );

    for (
      const s of io.sockets.sockets.values()
    ) {

      if (
        s.clubId === club.id &&
        s.username === username
      ) {

        s.emit("removedFromClub");

        s.leave(club.id);

        s.clubId = null;
      }
    }

    io.to(club.id).emit(
      "clubUpdate",
      publicClub(club)
    );
  });

  /* =========================
     CHAT
  ========================= */

  socket.on("chatMessage", ({ message }) => {

    const club = clubs.get(socket.clubId);

    if (!club) return;

    const text =
      String(message || "").trim();

    if (!text) return;

    const item = {
      username: socket.username,
      message: text,
      time: Date.now()
    };

    club.messages.push(item);

    if (club.messages.length > 100) {
      club.messages.shift();
    }

    io.to(club.id).emit(
      "chatMessage",
      item
    );
  });

  /* =========================
     GIFTS
  ========================= */

  socket.on("sendGift", async ({ gift }) => {

    const club = clubs.get(socket.clubId);

    if (!club) return;

    const allowed = [
      "❤️",
      "🌹",
      "🎁",
      "⭐",
      "👑"
    ];

    if (!allowed.includes(gift)) {
      return;
    }

    const item = {
      username: socket.username,
      gift,
      time: Date.now()
    };

    if (pool) {

      try {

        await pool.query(
          `INSERT INTO gifts
           (club_id,sender,gift)
           VALUES ($1,$2,$3)`,
          [
            club.id,
            socket.username,
            gift
          ]
        );

      } catch (err) {

        console.error(
          "Gift DB error:",
          err.message
        );
      }
    }

    io.to(club.id).emit(
      "giftReceived",
      item
    );
  });

  /* ==================================================
     WEBRTC SIGNALING
     ================================================== */

  /*
    User tokko nama biraa argachuuf
    socket ID isaa barbaada.

    Backend kun socket ID members keessatti
    dabala.
  */

  socket.on(
    "webrtc-offer",
    ({ target, offer }) => {

      if (!target || !offer) return;

      io.to(target).emit(
        "webrtc-offer",
        {
          from: socket.id,
          offer
        }
      );
    }
  );

  socket.on(
    "webrtc-answer",
    ({ target, answer }) => {

      if (!target || !answer) return;

      io.to(target).emit(
        "webrtc-answer",
        {
          from: socket.id,
          answer
        }
      );
    }
  );

  socket.on(
    "webrtc-ice",
    ({ target, candidate }) => {

      if (!target || !candidate) return;

      io.to(target).emit(
        "webrtc-ice",
        {
          from: socket.id,
          candidate
        }
      );
    }
  );

  /* =========================
     GET MY SOCKET INFO
  ========================= */

  socket.on("getClubMembers", (callback) => {

    const club = clubs.get(socket.clubId);

    if (!club) {
      return callback?.({
        success: false
      });
    }

    callback?.({
      success: true,
      members: [...club.members.values()]
    });
  });

  /* =========================
     LEAVE CLUB
  ========================= */

  socket.on("leaveClub", () => {

    const club =
      clubs.get(socket.clubId);

    if (!club) return;

    const member =
      club.members.get(socket.username);

    if (member && member.seat !== null) {

      club.seats[member.seat] = null;
    }

    club.members.delete(
      socket.username
    );

    club.requests =
      club.requests.filter(
        u => u !== socket.username
      );

    socket.leave(club.id);

    io.to(club.id).emit(
      "clubUpdate",
      publicClub(club)
    );

    socket.clubId = null;
  });

  /* =========================
     DISCONNECT
  ========================= */

  socket.on("disconnect", () => {

    const club =
      clubs.get(socket.clubId);

    if (!club) return;

    const member =
      club.members.get(socket.username);

    /*
      Socket ID isaa qofa yoo disconnect ta'e
      member haqna.
    */

    if (
      member &&
      member.socketId === socket.id
    ) {

      if (member.seat !== null) {
        club.seats[member.seat] = null;
      }

      club.members.delete(
        socket.username
      );

      club.requests =
        club.requests.filter(
          u => u !== socket.username
        );

      io.to(club.id).emit(
        "clubUpdate",
        publicClub(club)
      );
    }

    console.log(
      "🔴 Disconnected:",
      socket.id
    );
  });
});

/* =========================
   HEALTH CHECK
========================= */

app.get("/health", (req, res) => {

  res.json({
    success: true,

    app: "Waliin-GM",

    server: "online",

    database: !!pool,

    features: {
      login: true,
      register: true,
      home: true,
      voiceClub: true,
      seats: 15,
      requestSeat: true,
      ownerControl: true,
      mute: true,
      remove: true,
      chat: true,
      gift: true,
      webrtc: true,
      socketIds: true
    }
  });
});

/* =========================
   FRONTEND
========================= */

app.get("*", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================
   START SERVER
========================= */

async function startServer() {

  try {

    await initDatabase();

    server.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `🚀 Waliin-GM server running on port ${PORT}`
        );
      }
    );

  } catch (err) {

    console.error(
      "❌ SERVER START ERROR:",
      err
    );

    process.exit(1);
  }
}

startServer();

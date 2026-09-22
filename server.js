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
    origin: "*"
  }
});

const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   DATABASE
========================= */

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  pool.on("error", (err) => {
    console.error("DATABASE ERROR:", err.message);
  });
} else {
  console.warn("DATABASE_URL hin argamne. Login/Register database hin fayyadamu.");
}

/* =========================
   PASSWORD HASH
========================= */

function hashPassword(password, salt) {
  return crypto
    .createHash("sha256")
    .update(password + salt)
    .digest("hex");
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

/* =========================
   DATABASE TABLES
========================= */

async function initDatabase() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(40) UNIQUE NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      token TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gifts (
      id SERIAL PRIMARY KEY,
      club_id VARCHAR(50),
      sender VARCHAR(40),
      gift VARCHAR(40),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("Database tables ready.");
}

/* =========================
   AUTH
========================= */

app.post("/api/register", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        ok: false,
        message: "DATABASE_URL hin qindaa'in."
      });
    }

    const username = String(req.body.username || "")
      .trim()
      .slice(0, 40);

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase()
      .slice(0, 150);

    const password = String(req.body.password || "");

    if (!username || !email || password.length < 6) {
      return res.status(400).json({
        ok: false,
        message: "Username, email fi password sirrii galchi. Password yoo xiqqaate 6 ta'u qaba."
      });
    }

    const exists = await pool.query(
      `SELECT id FROM users WHERE username=$1 OR email=$2`,
      [username, email]
    );

    if (exists.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        message: "Username ykn email duraan jira."
      });
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const token = createToken();

    const result = await pool.query(
      `INSERT INTO users
       (username,email,password_hash,salt,token)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,username,email`,
      [username, email, passwordHash, salt, token]
    );

    res.json({
      ok: true,
      message: "Account uumameera.",
      user: result.rows[0],
      token
    });

  } catch (err) {
    console.error("REGISTER ERROR:", err.message);

    res.status(500).json({
      ok: false,
      message: "Register irratti rakkoo uumame."
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        ok: false,
        message: "DATABASE_URL hin qindaa'in."
      });
    }

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");

    const result = await pool.query(
      `SELECT * FROM users WHERE email=$1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        ok: false,
        message: "Email ykn password sirrii miti."
      });
    }

    const user = result.rows[0];

    const passwordHash =
      hashPassword(password, user.salt);

    if (passwordHash !== user.password_hash) {
      return res.status(401).json({
        ok: false,
        message: "Email ykn password sirrii miti."
      });
    }

    const token = createToken();

    await pool.query(
      `UPDATE users SET token=$1 WHERE id=$2`,
      [token, user.id]
    );

    res.json({
      ok: true,
      message: "Seentee jirta.",
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      token
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err.message);

    res.status(500).json({
      ok: false,
      message: "Login irratti rakkoo uumame."
    });
  }
});

app.post("/api/logout", async (req, res) => {
  try {
    if (pool && req.body.token) {
      await pool.query(
        `UPDATE users SET token=NULL WHERE token=$1`,
        [req.body.token]
      );
    }

    res.json({
      ok: true,
      message: "Baateetta."
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      message: "Logout irratti rakkoo uumame."
    });
  }
});

/* =========================
   CLUBS / VOICE ROOMS
========================= */

const clubs = new Map();

function createClub(id, name, seats, ownerId, ownerName) {
  return {
    id,
    name,
    seats,
    ownerId,
    members: new Map(),
    requests: [],
    gifts: {}
  };
}

function getClubMembers(club) {
  return [...club.members.entries()].map(([id, user]) => ({
    id,
    username: user.username,
    seat: user.seat,
    speaker: user.speaker,
    muted: user.muted,
    owner: id === club.ownerId
  }));
}

function updateClub(clubId) {
  const club = clubs.get(clubId);

  if (!club) return;

  io.to(clubId).emit("clubUpdate", {
    id: club.id,
    name: club.name,
    seats: club.seats,
    ownerId: club.ownerId,
    members: getClubMembers(club),
    requests: club.requests.map(id => {
      const member = club.members.get(id);

      return {
        id,
        username: member ? member.username : "Unknown"
      };
    }),
    gifts: club.gifts
  });
}

/* =========================
   SOCKET CONNECTION
========================= */

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  /* CREATE CLUB */

  socket.on("createClub", (data = {}) => {
    const username =
      String(data.username || "Guest")
        .trim()
        .slice(0, 40);

    const name =
      String(data.name || "Waliin-GM Club")
        .trim()
        .slice(0, 80);

    const seats =
      Number(data.seats) === 10 ? 10 : 15;

    const clubId =
      crypto.randomBytes(4).toString("hex");

    const club =
      createClub(
        clubId,
        name,
        seats,
        socket.id,
        username
      );

    club.members.set(socket.id, {
      username,
      seat: 1,
      speaker: true,
      muted: false
    });

    clubs.set(clubId, club);

    socket.join(clubId);

    socket.emit("clubCreated", {
      id: clubId,
      name,
      seats,
      ownerId: socket.id
    });

    updateClub(clubId);
  });

  /* JOIN CLUB */

  socket.on("joinClub", (data = {}) => {
    const clubId =
      String(data.clubId || "").trim();

    const username =
      String(data.username || "Guest")
        .trim()
        .slice(0, 40);

    const club = clubs.get(clubId);

    if (!club) {
      socket.emit(
        "errorMessage",
        "Club hin argamne."
      );
      return;
    }

    if (club.members.has(socket.id)) return;

    club.members.set(socket.id, {
      username,
      seat: 0,
      speaker: false,
      muted: true
    });

    socket.join(clubId);

    socket.emit("joinedClub", {
      id: club.id,
      name: club.name,
      seats: club.seats,
      ownerId: club.ownerId
    });

    updateClub(clubId);
  });

  /* REQUEST SEAT */

  socket.on("requestSeat", (data = {}) => {
    const club = clubs.get(data.clubId);

    if (!club) return;

    const member =
      club.members.get(socket.id);

    if (!member) return;

    if (member.seat > 0) {
      socket.emit(
        "errorMessage",
        "Ati seat qabda."
      );
      return;
    }

    if (!club.requests.includes(socket.id)) {
      club.requests.push(socket.id);
    }

    updateClub(club.id);
  });

  /* GIVE SEAT */

  socket.on("giveSeat", (data = {}) => {
    const club = clubs.get(data.clubId);

    if (!club) return;

    if (socket.id !== club.ownerId) {
      socket.emit(
        "errorMessage",
        "Owner qofa seat kennuu danda'a."
      );
      return;
    }

    const target =
      club.members.get(data.targetId);

    if (!target) return;

    const usedSeats = new Set(
      [...club.members.values()]
        .map(user => user.seat)
        .filter(Boolean)
    );

    let freeSeat = 0;

    for (
      let i = 1;
      i <= club.seats;
      i++
    ) {
      if (!usedSeats.has(i)) {
        freeSeat = i;
        break;
      }
    }

    if (!freeSeat) {
      socket.emit(
        "errorMessage",
        "Seat hundi guutameera."
      );
      return;
    }

    target.seat = freeSeat;
    target.speaker = true;
    target.muted = false;

    club.requests =
      club.requests.filter(
        id => id !== data.targetId
      );

    io.to(data.targetId).emit(
      "seatGranted"
    );

    updateClub(club.id);
  });

  /* LEAVE SEAT */

  socket.on("leaveSeat", (data = {}) => {
    const club = clubs.get(data.clubId);

    if (!club) return;

    const member =
      club.members.get(socket.id);

    if (!member) return;

    if (socket.id === club.ownerId) {
      socket.emit(
        "errorMessage",
        "Owner Seat 1 dhiisuu hin danda'u."
      );
      return;
    }

    member.seat = 0;
    member.speaker = false;
    member.muted = true;

    updateClub(club.id);
  });

  /* MUTE OWN MIC */

  socket.on("mute", (data = {}) => {
    const club = clubs.get(data.clubId);

    if (!club) return;

    const member =
      club.members.get(socket.id);

    if (!member) return;

    if (member.seat === 0) {
      member.muted = true;
      member.speaker = false;
      return;
    }

    member.muted =
      Boolean(data.muted);

    updateClub(club.id);
  });

  /* OWNER MUTE USER */

  socket.on("ownerMute", (data = {}) => {
    const club = clubs.get(data.clubId);

    if (!club) return;

    if (socket.id !== club.ownerId) {
      socket.emit(
        "errorMessage",
        "Owner qofa nama mute godhu danda'a."
      );
      return;
    }

    const target =
      club.members.get(data.targetId);

    if (!target) return;

    target.muted = true;

    io.to(data.targetId).emit(
      "forcedMute"
    );

    updateClub(club.id);
  });

  /* REMOVE USER */

  socket.on("removeMember", (data = {}) => {
    const club = clubs.get(data.clubId);

    if (!club) return;

    if (socket.id !== club.ownerId) {
      socket.emit(
        "errorMessage",
        "Owner qofa nama remove godhu danda'a."
      );
      return;
    }

    if (data.targetId === club.ownerId) {
      return;
    }

    const target =
      club.members.get(data.targetId);

    if (!target) return;

    club.members.delete(data.targetId);

    club.requests =
      club.requests.filter(
        id => id !== data.targetId
      );

    io.to(data.targetId).emit(
      "removedFromClub"
    );

    const targetSocket =
      io.sockets.sockets.get(data.targetId);

    if (targetSocket) {
      targetSocket.leave(club.id);
    }

    updateClub(club.id);
  });

  /* CHAT */

  socket.on("chatMessage", (data = {}) => {
    const club = clubs.get(data.clubId);

    if (!club) return;

    const member =
      club.members.get(socket.id);

    if (!member) return;

    const message =
      String(data.message || "")
        .trim()
        .slice(0, 500);

    if (!message) return;

    io.to(club.id).emit(
      "chatMessage",
      {
        id: socket.id,
        username: member.username,
        message,
        time: new Date().toISOString()
      }
    );
  });

  /* GIFT */

  socket.on("sendGift", async (data = {}) => {
    const club = clubs.get(data.clubId);

    if (!club) return;

    const member =
      club.members.get(socket.id);

    if (!member) return;

    const allowedGifts = [
      "❤️",
      "🌹",
      "🎁",
      "⭐",
      "👑"
    ];

    const gift =
      allowedGifts.includes(data.gift)
        ? data.gift
        : "❤️";

    club.gifts[gift] =
      (club.gifts[gift] || 0) + 1;

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO gifts
           (club_id,sender,gift)
           VALUES ($1,$2,$3)`,
          [
            club.id,
            member.username,
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
      {
        username: member.username,
        gift
      }
    );

    updateClub(club.id);
  });

  /* WEBRTC OFFER */

  socket.on(
    "webrtc-offer",
    ({ target, offer } = {}) => {
      if (!target || !offer) return;

      io.to(target).emit(
        "webrtc-offer",
        {
          sender: socket.id,
          offer
        }
      );
    }
  );

  /* WEBRTC ANSWER */

  socket.on(
    "webrtc-answer",
    ({ target, answer } = {}) => {
      if (!target || !answer) return;

      io.to(target).emit(
        "webrtc-answer",
        {
          sender: socket.id,
          answer
        }
      );
    }
  );

  /* ICE */

  socket.on(
    "webrtc-ice",
    ({ target, candidate } = {}) => {
      if (!target || !candidate) return;

      io.to(target).emit(
        "webrtc-ice",
        {
          sender: socket.id,
          candidate
        }
      );
    }
  );

  /* LEAVE CLUB */

  socket.on("leaveClub", (data = {}) => {
    leaveClub(
      socket,
      data.clubId
    );
  });

  /* DISCONNECT */

  socket.on("disconnect", () => {
    for (const [clubId, club] of clubs) {
      if (club.members.has(socket.id)) {
        leaveClub(
          socket,
          clubId
        );
      }
    }

    console.log(
      "Disconnected:",
      socket.id
    );
  });
});

/* =========================
   LEAVE CLUB FUNCTION
========================= */

function leaveClub(socket, clubId) {
  const club = clubs.get(clubId);

  if (!club) return;

  const wasOwner =
    socket.id === club.ownerId;

  club.members.delete(socket.id);

  club.requests =
    club.requests.filter(
      id => id !== socket.id
    );

  socket.leave(clubId);

  if (club.members.size === 0) {
    clubs.delete(clubId);
    return;
  }

  if (wasOwner) {
    const nextOwner =
      [...club.members.entries()][0];

    if (nextOwner) {
      club.ownerId =
        nextOwner[0];

      nextOwner[1].seat = 1;
      nextOwner[1].speaker = true;
      nextOwner[1].muted = false;

      io.to(nextOwner[0]).emit(
        "newOwner"
      );
    }
  }

  updateClub(clubId);
}

/* =========================
   HEALTH
========================= */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Waliin-GM",
    version: "3.0.0",
    login: true,
    register: true,
    home: true,
    voiceClub: true,
    gift: true,
    chat: true,
    mute: true,
    remove: true
  });
});

/* =========================
   START SERVER
========================= */

async function startServer() {
  try {
    await initDatabase();

    server.listen(PORT, () => {
      console.log(
        `Waliin-GM running on port ${PORT}`
      );
    });

  } catch (err) {
    console.error(
      "SERVER START ERROR:",
      err.message
    );

    process.exit(1);
  }
}

startServer();

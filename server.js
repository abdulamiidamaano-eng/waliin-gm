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

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL || "";

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  pool.on("error", (err) => {
    console.error("POSTGRES ERROR:", err.message);
  });
}

/* =====================================================
   HELPERS
===================================================== */

function cleanUsername(value) {
  return String(value || "").trim();
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

/* =====================================================
   DATABASE
===================================================== */

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
    CREATE TABLE IF NOT EXISTS gifts (
      id SERIAL PRIMARY KEY,
      club_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      gift TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id SERIAL PRIMARY KEY,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS follows (
      id SERIAL PRIMARY KEY,
      follower TEXT NOT NULL,
      following TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower, following)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      type TEXT NOT NULL,
      from_user TEXT,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ Database ready.");
}

/* =====================================================
   FIND USER
===================================================== */

async function findUser(username) {
  if (!pool) return null;

  const result = await pool.query(
    `SELECT id,username,email,bio,avatar,created_at
     FROM users
     WHERE username=$1
     LIMIT 1`,
    [username]
  );

  return result.rows[0] || null;
}

/* =====================================================
   REGISTER
===================================================== */

app.post("/api/register", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        success: false,
        message: "DATABASE_URL hin qindaa'in."
      });
    }

    const username = cleanUsername(req.body.username);

    const email = String(
      req.body.email || ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      req.body.password || ""
    );

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Username, email fi password guuti."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password yoo xiqqaate 6 characters haa qabaatu."
      });
    }

    const emailExists = await pool.query(
      `SELECT id
       FROM users
       WHERE LOWER(email)=LOWER($1)
       LIMIT 1`,
      [email]
    );

    if (emailExists.rows.length) {
      return res.status(409).json({
        success: false,
        message: "Email kun duraan jira."
      });
    }

    const usernameExists = await pool.query(
      `SELECT id
       FROM users
       WHERE LOWER(username)=LOWER($1)
       LIMIT 1`,
      [username]
    );

    if (usernameExists.rows.length) {
      return res.status(409).json({
        success: false,
        message: "Username kun duraan jira."
      });
    }

    const salt = crypto.randomBytes(16).toString("hex");

    const passwordHash = hashPassword(
      password,
      salt
    );

    const token = createToken();

    const result = await pool.query(
      `INSERT INTO users
       (username,email,password_hash,salt,token)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,username,email,token,bio,avatar`,
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
    console.error(
      "REGISTER ERROR:",
      err
    );

    res.status(500).json({
      success: false,
      message:
        "Register irratti rakkoo uumame."
    });
  }
});

/* =====================================================
   LOGIN
   Gmail YKN Username + Password
===================================================== */

app.post("/api/login", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        success: false,
        message:
          "DATABASE_URL hin qindaa'in."
      });
    }

    /*
      Frontend irraa:
      login
      ykn
      email
      ykn
      username

      keessaa kamiyyuu fudhata.
    */

    const login = String(
      req.body.login ||
      req.body.email ||
      req.body.username ||
      ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      req.body.password || ""
    );

    if (!login || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Username/Gmail fi password guuti."
      });
    }

    /*
      Gmail ykn Username lamaan isaanii barbaada.
    */

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
        success: false,
        message:
          "Username/Gmail ykn password sirrii miti."
      });
    }

    const user = result.rows[0];

    /*
      Password hash mirkaneessa.
    */

    const passwordHash = hashPassword(
      password,
      user.salt
    );

    if (
      passwordHash !==
      user.password_hash
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Username/Gmail ykn password sirrii miti."
      });
    }

    /*
      Login milkaa'e.
      Token haaraa uuma.
    */

    const token = createToken();

    await pool.query(
      `UPDATE users
       SET token=$1
       WHERE id=$2`,
      [
        token,
        user.id
      ]
    );

    res.json({
      success: true,
      message: "Login milkaa'e.",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        token: token,
        bio: user.bio || "",
        avatar: user.avatar || ""
      }
    });

  } catch (err) {
    console.error(
      "LOGIN ERROR:",
      err
    );

    res.status(500).json({
      success: false,
      message:
        "Login irratti rakkoo uumame."
    });
  }
});

/* =====================================================
   LOGOUT
===================================================== */

app.post("/api/logout", async (req, res) => {
  try {
    if (pool && req.body.token) {
      await pool.query(
        `UPDATE users
         SET token=NULL
         WHERE token=$1`,
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

/* =====================================================
   PROFILE
===================================================== */

app.get(
  "/api/profile/:username",
  async (req, res) => {

    try {
      const username =
        cleanUsername(
          decodeURIComponent(
            req.params.username
          )
        );

      const user =
        await findUser(username);

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            "User hin argamne."
        });
      }

      res.json({
        success: true,
        user
      });

    } catch (err) {
      res.status(500).json({
        success: false,
        message:
          "Profile fiduu hin dandeenye."
      });
    }
  }
);

/* =====================================================
   PROFILE UPDATE
===================================================== */

app.post(
  "/api/profile/update",
  async (req, res) => {

    try {
      if (!pool) {
        return res.status(500).json({
          success: false,
          message:
            "Database hin jiru."
        });
      }

      const username =
        cleanUsername(
          req.body.username
        );

      const bio =
        String(
          req.body.bio || ""
        ).trim();

      const avatar =
        String(
          req.body.avatar || ""
        ).trim();

      if (!username) {
        return res.status(400).json({
          success: false,
          message:
            "Username barbaachisa."
        });
      }

      const result =
        await pool.query(
          `UPDATE users
           SET bio=$1, avatar=$2
           WHERE username=$3
           RETURNING id,username,email,bio,avatar`,
          [
            bio,
            avatar,
            username
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          message:
            "User hin argamne."
        });
      }

      res.json({
        success: true,
        user:
          result.rows[0]
      });

    } catch (err) {
      console.error(
        "PROFILE UPDATE:",
        err
      );

      res.status(500).json({
        success: false,
        message:
          "Profile update hin milkoofne."
      });
    }
  }
);

/* =====================================================
   USER SEARCH
===================================================== */

app.get(
  "/api/users/search",
  async (req, res) => {

    try {
      if (!pool) {
        return res.json({
          success: false,
          users: []
        });
      }

      const q =
        String(
          req.query.q || ""
        ).trim();

      if (!q) {
        return res.json({
          success: true,
          users: []
        });
      }

      const result =
        await pool.query(
          `SELECT id,username,email,bio,avatar,created_at
           FROM users
           WHERE username ILIKE $1
           ORDER BY username
           LIMIT 30`,
          [`%${q}%`]
        );

      res.json({
        success: true,
        users:
          result.rows
      });

    } catch (err) {
      console.error(
        "SEARCH ERROR:",
        err
      );

      res.status(500).json({
        success: false,
        users: []
      });
    }
  }
);

/* =====================================================
   FOLLOW
===================================================== */

app.post(
  "/api/follow",
  async (req, res) => {

    try {
      if (!pool) {
        return res.status(500).json({
          success: false,
          message:
            "Database hin jiru."
        });
      }

      const follower =
        cleanUsername(
          req.body.follower
        );

      const following =
        cleanUsername(
          req.body.following
        );

      if (!follower || !following) {
        return res.status(400).json({
          success: false,
          message:
            "Follow data guutuu miti."
        });
      }

      if (follower === following) {
        return res.status(400).json({
          success: false,
          message:
            "Ofii kee follow gochuu hin dandeessu."
        });
      }

      const target =
        await findUser(
          following
        );

      if (!target) {
        return res.status(404).json({
          success: false,
          message:
            "User hin argamne."
        });
      }

      const exists =
        await pool.query(
          `SELECT id
           FROM follows
           WHERE follower=$1
           AND following=$2`,
          [
            follower,
            following
          ]
        );

      if (exists.rows.length) {

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
          success: true,
          following: false,
          message:
            "Unfollow godhame."
        });
      }

      await pool.query(
        `INSERT INTO follows
         (follower,following)
         VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [
          follower,
          following
        ]
      );

      await pool.query(
        `INSERT INTO notifications
         (username,type,from_user,message)
         VALUES ($1,$2,$3,$4)`,
        [
          following,
          "follow",
          follower,
          `${follower} si follow godhe.`
        ]
      );

      notifyUser(
        following,
        {
          type: "follow",
          from: follower,
          message:
            `${follower} si follow godhe.`
        }
      );

      res.json({
        success: true,
        following: true,
        message:
          "Follow godhame."
      });

    } catch (err) {
      console.error(
        "FOLLOW ERROR:",
        err
      );

      res.status(500).json({
        success: false,
        message:
          "Follow irratti rakkoo."
      });
    }
  }
);

/* =====================================================
   FOLLOW STATUS
===================================================== */

app.get(
  "/api/follow/status",
  async (req, res) => {

    try {
      if (!pool) {
        return res.json({
          success: false,
          following: false
        });
      }

      const follower =
        cleanUsername(
          req.query.follower
        );

      const following =
        cleanUsername(
          req.query.following
        );

      const result =
        await pool.query(
          `SELECT id
           FROM follows
           WHERE follower=$1
           AND following=$2`,
          [
            follower,
            following
          ]
        );

      res.json({
        success: true,
        following:
          result.rows.length > 0
      });

    } catch (err) {
      res.json({
        success: false,
        following: false
      });
    }
  }
);

/* =====================================================
   NOTIFICATIONS
===================================================== */

app.get(
  "/api/notifications/:username",
  async (req, res) => {

    try {
      if (!pool) {
        return res.json({
          success: false,
          notifications: []
        });
      }

      const username =
        cleanUsername(
          decodeURIComponent(
            req.params.username
          )
        );

      const result =
        await pool.query(
          `SELECT *
           FROM notifications
           WHERE username=$1
           ORDER BY created_at DESC
           LIMIT 100`,
          [username]
        );

      res.json({
        success: true,
        notifications:
          result.rows
      });

    } catch (err) {
      res.status(500).json({
        success: false,
        notifications: []
      });
    }
  }
);

/* =====================================================
   READ NOTIFICATIONS
===================================================== */

app.post(
  "/api/notifications/read",
  async (req, res) => {

    try {
      if (pool && req.body.username) {

        await pool.query(
          `UPDATE notifications
           SET is_read=true
           WHERE username=$1`,
          [
            cleanUsername(
              req.body.username
            )
          ]
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
  }
);

/* =====================================================
   PRIVATE MESSAGE HISTORY
===================================================== */

app.get(
  "/api/messages",
  async (req, res) => {

    try {
      if (!pool) {
        return res.json({
          success: false,
          messages: []
        });
      }

      const user1 =
        cleanUsername(
          req.query.user1
        );

      const user2 =
        cleanUsername(
          req.query.user2
        );

      if (!user1 || !user2) {
        return res.json({
          success: true,
          messages: []
        });
      }

      const result =
        await pool.query(
          `SELECT id,sender,receiver,message,created_at
           FROM private_messages
           WHERE
           (sender=$1 AND receiver=$2)
           OR
           (sender=$2 AND receiver=$1)
           ORDER BY created_at ASC
           LIMIT 200`,
          [
            user1,
            user2
          ]
        );

      res.json({
        success: true,
        messages:
          result.rows
      });

    } catch (err) {
      console.error(
        "MESSAGE HISTORY:",
        err
      );

      res.status(500).json({
        success: false,
        messages: []
      });
    }
  }
);

/* =====================================================
   SOCKET USER NOTIFY
===================================================== */

function notifyUser(username, data) {

  for (
    const s of
    io.sockets.sockets.values()
  ) {

    if (
      s.username ===
      cleanUsername(username)
    ) {
      s.emit(
        "notification",
        data
      );
    }
  }
}

/* =====================================================
   CLUB SYSTEM
===================================================== */

const clubs = new Map();

function createClub(
  name,
  owner,
  ownerSocketId
) {

  const id =
    makeClubId();

  const club = {
    id,

    name:
      name ||
      "Waliin-GM Club",

    owner,

    members:
      new Map(),

    requests: [],

    seats:
      Array(15).fill(null),

    messages: [],

    createdAt:
      Date.now()
  };

  club.members.set(
    owner,
    {
      username: owner,
      socketId:
        ownerSocketId,
      muted: false,
      seat: 0
    }
  );

  club.seats[0] =
    owner;

  clubs.set(
    id,
    club
  );

  return club;
}

function publicClub(club) {

  return {
    id: club.id,
    name: club.name,
    owner: club.owner,

    members:
      [
        ...club.members.values()
      ],

    requests:
      club.requests,

    seats:
      club.seats,

    messages:
      club.messages,

    listenerCount:
      Math.max(
        0,
        club.members.size -
        club.seats.filter(Boolean).length
      )
  };
}

/* =====================================================
   SOCKET
===================================================== */

io.on(
  "connection",
  (socket) => {

    console.log(
      "🟢 Connected:",
      socket.id
    );

    /* =================================================
       IDENTIFY
    ================================================= */

    socket.on(
      "identify",
      ({ username }) => {

        socket.username =
          cleanUsername(
            username
          );

        console.log(
          "IDENTIFIED:",
          socket.username
        );
      }
    );

    /* =================================================
       PRIVATE MESSAGE
    ================================================= */

    socket.on(
      "privateMessage",
      async ({
        receiver,
        message
      }) => {

        try {

          const sender =
            cleanUsername(
              socket.username
            );

          receiver =
            cleanUsername(
              receiver
            );

          message =
            String(
              message || ""
            ).trim();

          if (
            !sender ||
            !receiver ||
            !message
          ) {
            return;
          }

          if (!pool) {
            return socket.emit(
              "privateMessageError",
              {
                message:
                  "Database hin jiru."
              }
            );
          }

          const targetUser =
            await findUser(
              receiver
            );

          if (!targetUser) {
            return socket.emit(
              "privateMessageError",
              {
                message:
                  "User hin argamne."
              }
            );
          }

          const result =
            await pool.query(
              `INSERT INTO private_messages
               (sender,receiver,message)
               VALUES ($1,$2,$3)
               RETURNING id,sender,receiver,message,created_at`,
              [
                sender,
                receiver,
                message
              ]
            );

          const item =
            result.rows[0];

          socket.emit(
            "privateMessage",
            item
          );

          for (
            const s of
            io.sockets.sockets.values()
          ) {

            if (
              s.username ===
              receiver
            ) {
              s.emit(
                "privateMessage",
                item
              );
            }
          }

          await pool.query(
            `INSERT INTO notifications
             (username,type,from_user,message)
             VALUES ($1,$2,$3,$4)`,
            [
              receiver,
              "message",
              sender,
              `${sender} ergaa siif erge.`
            ]
          );

          notifyUser(
            receiver,
            {
              type: "message",
              from: sender,
              message:
                `${sender} ergaa siif erge.`
            }
          );

        } catch (err) {

          console.error(
            "PRIVATE MESSAGE ERROR:",
            err
          );
        }
      }
    );

    /* =================================================
       CREATE CLUB
    ================================================= */

    socket.on(
      "createClub",
      ({ name, username }, callback) => {

        username =
          cleanUsername(
            username
          );

        if (!username) {
          return callback?.({
            success: false,
            message:
              "Username barbaachisa."
          });
        }

        socket.username =
          username;

        const club =
          createClub(
            name,
            username,
            socket.id
          );

        socket.join(
          club.id
        );

        socket.clubId =
          club.id;

        callback?.({
          success: true,
          club:
            publicClub(club)
        });

        io.to(
          club.id
        ).emit(
          "clubUpdate",
          publicClub(club)
        );
      }
    );

    /* =================================================
       JOIN CLUB
    ================================================= */

    socket.on(
      "joinClub",
      ({ clubId, username }, callback) => {

        const club =
          clubs.get(
            clubId
          );

        if (!club) {
          return callback?.({
            success: false,
            message:
              "Club hin argamne."
          });
        }

        username =
          cleanUsername(
            username
          );

        if (!username) {
          return callback?.({
            success: false,
            message:
              "Username barbaachisa."
          });
        }

        socket.username =
          username;

        if (
          club.members.has(
            username
          )
        ) {

          const member =
            club.members.get(
              username
            );

          member.socketId =
            socket.id;

          socket.join(
            clubId
          );

          socket.clubId =
            clubId;

          callback?.({
            success: true,
            club:
              publicClub(club)
          });

          io.to(
            club.id
          ).emit(
            "clubUpdate",
            publicClub(club)
          );

          return;
        }

        club.members.set(
          username,
          {
            username,
            socketId:
              socket.id,
            muted: false,
            seat: null
          }
        );

        socket.join(
          clubId
        );

        socket.clubId =
          clubId;

        callback?.({
          success: true,
          club:
            publicClub(club)
        });

        io.to(
          club.id
        ).emit(
          "clubUpdate",
          publicClub(club)
        );
      }
    );

    /* =================================================
       REQUEST SEAT
    ================================================= */

    socket.on(
      "requestSeat",
      () => {

        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        if (
          !club.members.has(
            socket.username
          )
        ) {
          return;
        }

        if (
          !club.requests.includes(
            socket.username
          )
        ) {

          club.requests.push(
            socket.username
          );
        }

        io.to(
          club.id
        ).emit(
          "seatRequest",
          {
            username:
              socket.username
          }
        );

        io.to(
          club.id
        ).emit(
          "clubUpdate",
          publicClub(club)
        );
      }
    );

    /* =================================================
       GIVE SEAT
    ================================================= */

    socket.on(
      "giveSeat",
      ({ username, seat }) => {

        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        if (
          socket.username !==
          club.owner
        ) {
          return;
        }

        seat =
          Number(seat);

        if (
          Number.isNaN(seat) ||
          seat < 0 ||
          seat >= 15
        ) {
          return;
        }

        if (
          club.seats[seat]
        ) {
          return;
        }

        const member =
          club.members.get(
            username
          );

        if (!member) return;

        if (
          member.seat !== null
        ) {
          return;
        }

        club.seats[seat] =
          username;

        member.seat =
          seat;

        club.requests =
          club.requests.filter(
            u =>
              u !== username
          );

        io.to(
          club.id
        ).emit(
          "clubUpdate",
          publicClub(club)
        );

        io.to(
          club.id
        ).emit(
          "seatGranted",
          {
            username,
            seat
          }
        );
      }
    );

    /* =================================================
       LEAVE SEAT
    ================================================= */

    socket.on(
      "leaveSeat",
      () => {

        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        const member =
          club.members.get(
            socket.username
          );

        if (!member) return;

        if (
          member.seat !== null
        ) {

          club.seats[
            member.seat
          ] = null;

          member.seat =
            null;
        }

        io.to(
          club.id
        ).emit(
          "clubUpdate",
          publicClub(club)
        );
      }
    );

    /* =================================================
       MUTE SELF
    ================================================= */

    socket.on(
      "muteSelf",
      ({ muted }) => {

        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        const member =
          club.members.get(
            socket.username
          );

        if (!member) return;

        member.muted =
          !!muted;

        io.to(
          club.id
        ).emit(
          "memberMute",
          {
            username:
              socket.username,
            muted:
              member.muted
          }
        );

        io.to(
          club.id
        ).emit(
          "clubUpdate",
          publicClub(club)
        );
      }
    );

    /* =================================================
       OWNER MUTE
    ================================================= */

    socket.on(
      "ownerMute",
      ({ username }) => {

        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        if (
          socket.username !==
          club.owner
        ) {
          return;
        }

        const member =
          club.members.get(
            username
          );

        if (!member) return;

        member.muted =
          true;

        io.to(
          club.id
        ).emit(
          "memberMute",
          {
            username,
            muted: true,
            byOwner: true
          }
        );

        io.to(
          club.id
        ).emit(
          "clubUpdate",
          publicClub(club)
        );
      }
    );

    /* =================================================
       REMOVE MEMBER
    ================================================= */

    socket.on(
      "removeMember",
      ({ username }) => {

        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        if (
          socket.username !==
          club.owner
        ) {
          return;
        }

        if (
          username ===
          club.owner
        ) {
          return;
        }

        const member =
          club.members.get(
            username
          );

        if (!member) return;

        if (
          member.seat !== null
        ) {

          club.seats[
            member.seat
          ] = null;
        }

        club.members.delete(
          username
        );

        club.requests =
          club.requests.filter(
            u =>
              u !== username
          );

        for (
          const s of
          io.sockets.sockets.values()
        ) {

          if (
            s.clubId === club.id &&
            s.username === username
          ) {

            s.emit(
              "removedFromClub"
            );

            s.leave(
              club.id
            );

            s.clubId =
              null;
          }
        }

        io.to(
          club.id
        ).emit(
          "clubUpdate",
          publicClub(club)
        );
      }
    );

    /* =================================================
       CLUB CHAT
    ================================================= */

    socket.on(
      "chatMessage",
      ({ message }) => {

        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        const text =
          String(
            message || ""
          ).trim();

        if (!text) return;

        const item = {
          username:
            socket.username,

          message:
            text,

          time:
            Date.now()
        };

        club.messages.push(
          item
        );

        if (
          club.messages.length >
          100
        ) {
          club.messages.shift();
        }

        io.to(
          club.id
        ).emit(
          "chatMessage",
          item
        );
      }
    );

    /* =================================================
       GIFTS
    ================================================= */

    socket.on(
      "sendGift",
      async ({ gift }) => {

        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        const allowed = [
          "❤️",
          "🌹",
          "🎁",
          "⭐",
          "👑"
        ];

        if (
          !allowed.includes(
            gift
          )
        ) {
          return;
        }

        const item = {
          username:
            socket.username,

          gift,

          time:
            Date.now()
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
              "Gift DB:",
              err.message
            );
          }
        }

        io.to(
          club.id
        ).emit(
          "giftReceived",
          item
        );
      }
    );

    /* =================================================
       WEBRTC OFFER
    ================================================= */

    socket.on(
      "webrtc-offer",
      ({ target, offer }) => {

        if (
          !target ||
          !offer
        ) return;

        io.to(
          target
        ).emit(
          "webrtc-offer",
          {
            from:
              socket.id,
            offer
          }
        );
      }
    );

    /* =================================================
       WEBRTC ANSWER
    ================================================= */

    socket.on(
      "webrtc-answer",
      ({ target, answer }) => {

        if (
          !target ||
          !answer
        ) return;

        io.to(
          target
        ).emit(
          "webrtc-answer",
          {
            from:
              socket.id,
            answer
          }
        );
      }
    );

    /* =================================================
       WEBRTC ICE
    ================================================= */

    socket.on(
      "webrtc-ice",
      ({ target, candidate }) => {

        if (
          !target ||
          !candidate
        ) return;

        io.to(
          target
        ).emit(
          "webrtc-ice",
          {
            from:
              socket.id,
            candidate
          }
        );
      }
    );

    /* =================================================
       CLUB MEMBERS
    ================================================= */

    socket.on(
      "getClubMembers",
      (callback) => {

        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) {
          return callback?.({
            success: false
          });
        }

        callback?.({
          success: true,

          members:
            [
              ...club.members.values()
            ]
        });
      }
    );

    /* =================================================
       LEAVE CLUB
    ================================================= */

    socket.on(
      "leaveClub",
      () => {

        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) return;

        const member =
          club.members.get(
            socket.username
          );

        if (
          member &&
          member.seat !== null
        ) {

          club.seats[
            member.seat
          ] = null;
        }

        club.members.delete(
          socket.username
        );

        club.requests =
          club.requests.filter(
            u =>
              u !==
              socket.username
          );

        socket.leave(
          club.id
        );

        io.to(
          club.id
        ).emit(
          "clubUpdate",
          publicClub(club)
        );

        socket.clubId =
          null;
      }
    );

    /* =================================================
       DISCONNECT
    ================================================= */

    socket.on(
      "disconnect",
      () => {

        const club =
          clubs.get(
            socket.clubId
          );

        if (!club) {

          console.log(
            "🔴 Disconnected:",
            socket.id
          );

          return;
        }

        const member =
          club.members.get(
            socket.username
          );

        if (
          member &&
          member.socketId ===
            socket.id
        ) {

          if (
            member.seat !== null
          ) {

            club.seats[
              member.seat
            ] = null;
          }

          club.members.delete(
            socket.username
          );

          club.requests =
            club.requests.filter(
              u =>
                u !==
                socket.username
            );

          io.to(
            club.id
          ).emit(
            "clubUpdate",
            publicClub(club)
          );
        }

        console.log(
          "🔴 Disconnected:",
          socket.id
        );
      }
    );
  }
);

/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/health",
  (req, res) => {

    res.json({
      success: true,

      app:
        "Waliin-GM",

      server:
        "online",

      database:
        !!pool,

      features: {
        login: true,
        loginWithEmail: true,
        loginWithUsername: true,
        register: true,
        profile: true,
        search: true,
        follow: true,
        notifications: true,
        privateChat: true,
        home: true,
        voiceClub: true,
        seats: 15,
        requestSeat: true,
        ownerControl: true,
        mute: true,
        remove: true,
        clubChat: true,
        gift: true,
        webrtc: true
      }
    });
  }
);

/* =====================================================
   FRONTEND
===================================================== */

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

/* =====================================================
   START SERVER
===================================================== */

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

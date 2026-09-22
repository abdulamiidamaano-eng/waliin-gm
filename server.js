const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

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

const clubs = new Map();

function createClub(id, name, seats, ownerId, ownerName) {
  const club = {
    id,
    name,
    seats,
    ownerId,
    members: new Map(),
    requests: []
  };

  // Owner yeroo jalqabaatiif Seat 1 qaba
  club.members.set(ownerId, {
    username: ownerName || "Owner",
    seat: 1,
    speaker: true,
    muted: false
  });

  return club;
}

function updateClub(clubId) {
  const club = clubs.get(clubId);
  if (!club) return;

  const members = [...club.members.entries()].map(([id, user]) => ({
    id,
    username: user.username,
    seat: user.seat,
    speaker: user.speaker,
    muted: user.muted,
    owner: id === club.ownerId
  }));

  io.to(clubId).emit("clubUpdate", {
    id: club.id,
    name: club.name,
    seats: club.seats,
    ownerId: club.ownerId,
    members,
    requests: club.requests
  });
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("createClub", (data = {}) => {
    const username = String(data.username || "Guest").slice(0, 40);
    const name = String(data.name || "Waliin-GM Club").slice(0, 80);

    const seats =
      Number(data.seats) === 10 ? 10 : 15;

    const clubId =
      Math.random().toString(36).substring(2, 9);

    const club = createClub(
      clubId,
      name,
      seats,
      socket.id,
      username
    );

    clubs.set(clubId, club);

    socket.join(clubId);

    socket.emit("clubCreated", {
      id: clubId,
      name: club.name,
      seats: club.seats,
      ownerId: club.ownerId
    });

    updateClub(clubId);
  });

  socket.on("joinClub", (data = {}) => {
    const clubId = String(data.clubId || "").trim();
    const username = String(data.username || "Guest").slice(0, 40);

    const club = clubs.get(clubId);

    if (!club) {
      socket.emit("errorMessage", "Club hin argamne.");
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

  // Request Seat
  socket.on("requestSeat", (data = {}) => {
    const club = clubs.get(data.clubId);
    if (!club) return;

    const member = club.members.get(socket.id);
    if (!member) return;

    if (member.seat > 0) {
      socket.emit("errorMessage", "Ati seat qabda.");
      return;
    }

    if (!club.requests.includes(socket.id)) {
      club.requests.push(socket.id);
    }

    updateClub(club.id);
  });

  // Owner qofa seat kennuu danda'a
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

    const target = club.members.get(data.targetId);

    if (!target) return;

    if (target.seat > 0) {
      socket.emit(
        "errorMessage",
        "Namni kun seat qaba."
      );
      return;
    }

    const usedSeats = new Set(
      [...club.members.values()]
        .map(user => user.seat)
        .filter(Boolean)
    );

    let freeSeat = 0;

    for (let i = 1; i <= club.seats; i++) {
      if (!usedSeats.has(i)) {
        freeSeat = i;
        break;
      }
    }

    if (!freeSeat) {
      socket.emit(
        "errorMessage",
        "Teessoon hundi guutameera."
      );
      return;
    }

    target.seat = freeSeat;
    target.speaker = true;
    target.muted = false;

    club.requests =
      club.requests.filter(id => id !== data.targetId);

    updateClub(club.id);

    // Namni seat argate microphone akka banu beeksisa
    io.to(data.targetId).emit("seatGranted");
  });

  // Seat dhiisuu
  socket.on("leaveSeat", (data = {}) => {
    const club = clubs.get(data.clubId);
    if (!club) return;

    const member = club.members.get(socket.id);
    if (!member) return;

    // Owner seat 1 akka hin dhiifne
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

  // Mic state
  socket.on("mute", (data = {}) => {
    const club = clubs.get(data.clubId);
    if (!club) return;

    const member = club.members.get(socket.id);
    if (!member) return;

    if (member.seat === 0) {
      member.muted = true;
      member.speaker = false;
      return;
    }

    member.muted = Boolean(data.muted);

    socket.to(club.id).emit("memberMuted", {
      id: socket.id,
      muted: member.muted
    });

    updateClub(club.id);
  });

  // WebRTC offer
  socket.on("webrtc-offer", ({ target, offer }) => {
    if (!target || !offer) return;

    io.to(target).emit("webrtc-offer", {
      sender: socket.id,
      offer
    });
  });

  // WebRTC answer
  socket.on("webrtc-answer", ({ target, answer }) => {
    if (!target || !answer) return;

    io.to(target).emit("webrtc-answer", {
      sender: socket.id,
      answer
    });
  });

  // ICE candidate
  socket.on("webrtc-ice", ({ target, candidate }) => {
    if (!target || !candidate) return;

    io.to(target).emit("webrtc-ice", {
      sender: socket.id,
      candidate
    });
  });

  // Club chat
  socket.on("chatMessage", (data = {}) => {
    const club = clubs.get(data.clubId);
    if (!club) return;

    const member = club.members.get(socket.id);
    if (!member) return;

    const message =
      String(data.message || "").trim().slice(0, 500);

    if (!message) return;

    io.to(club.id).emit("chatMessage", {
      username: member.username,
      message
    });
  });

  // Leave Club
  socket.on("leaveClub", (data = {}) => {
    leaveClub(socket, data.clubId);
  });

  socket.on("disconnect", () => {
    for (const [clubId, club] of clubs) {
      if (club.members.has(socket.id)) {
        leaveClub(socket, clubId);
      }
    }

    console.log("Disconnected:", socket.id);
  });
});

function leaveClub(socket, clubId) {
  const club = clubs.get(clubId);
  if (!club) return;

  const wasOwner = socket.id === club.ownerId;

  club.members.delete(socket.id);

  club.requests =
    club.requests.filter(id => id !== socket.id);

  socket.leave(clubId);

  if (club.members.size === 0) {
    clubs.delete(clubId);
    return;
  }

  // Yoo owner ba'e, nama biraa owner godhi
  if (wasOwner) {
    const nextOwner =
      [...club.members.entries()][0];

    if (nextOwner) {
      club.ownerId = nextOwner[0];

      nextOwner[1].seat = 1;
      nextOwner[1].speaker = true;
      nextOwner[1].muted = false;

      io.to(nextOwner[0]).emit("newOwner");
    }
  }

  updateClub(clubId);
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Waliin-GM",
    voiceClub: true,
    version: "2.0.0"
  });
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

server.listen(PORT, () => {
  console.log(
    `Waliin-GM server running on port ${PORT}`
  );
});

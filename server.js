const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const clubs = new Map();

function makeClub(id, name, seats) {
  return {
    id,
    name,
    seats,
    members: new Map(),
    requests: []
  };
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("createClub", ({ name, seats, username }) => {
    const clubId = Math.random().toString(36).substring(2, 9);

    const club = makeClub(
      clubId,
      name || "Waliin-GM Club",
      Number(seats) === 10 ? 10 : 15
    );

    club.members.set(socket.id, {
      username: username || "Guest",
      seat: 0,
      speaker: true
    });

    clubs.set(clubId, club);
    socket.join(clubId);

    socket.emit("clubCreated", {
      id: clubId,
      name: club.name,
      seats: club.seats
    });

    sendClubUpdate(clubId);
  });

  socket.on("joinClub", ({ clubId, username }) => {
    const club = clubs.get(clubId);

    if (!club) {
      socket.emit("errorMessage", "Club hin argamne.");
      return;
    }

    club.members.set(socket.id, {
      username: username || "Guest",
      seat: 0,
      speaker: false
    });

    socket.join(clubId);

    socket.emit("joinedClub", {
      id: club.id,
      name: club.name,
      seats: club.seats
    });

    sendClubUpdate(clubId);
  });

  socket.on("requestSeat", ({ clubId }) => {
    const club = clubs.get(clubId);
    if (!club) return;

    if (!club.requests.includes(socket.id)) {
      club.requests.push(socket.id);
    }

    sendClubUpdate(clubId);
  });

  socket.on("giveSeat", ({ clubId, targetId }) => {
    const club = clubs.get(clubId);
    if (!club) return;

    const target = club.members.get(targetId);
    if (!target) return;

    const usedSeats = [...club.members.values()]
      .map(m => m.seat)
      .filter(Boolean);

    let freeSeat = 0;

    for (let i = 1; i <= club.seats; i++) {
      if (!usedSeats.includes(i)) {
        freeSeat = i;
        break;
      }
    }

    if (!freeSeat) {
      io.to(targetId).emit(
        "errorMessage",
        "Teessoon hundi guutameera."
      );
      return;
    }

    target.seat = freeSeat;
    target.speaker = true;

    club.requests = club.requests.filter(id => id !== targetId);

    sendClubUpdate(clubId);
  });

  socket.on("leaveSeat", ({ clubId }) => {
    const club = clubs.get(clubId);
    if (!club) return;

    const member = club.members.get(socket.id);
    if (!member) return;

    member.seat = 0;
    member.speaker = false;

    sendClubUpdate(clubId);
  });

  socket.on("mute", ({ clubId, muted }) => {
    socket.to(clubId).emit("memberMuted", {
      id: socket.id,
      muted
    });
  });

  socket.on("chatMessage", ({ clubId, username, message }) => {
    if (!clubs.has(clubId)) return;

    io.to(clubId).emit("chatMessage", {
      username: username || "Guest",
      message: String(message).slice(0, 500)
    });
  });

  socket.on("leaveClub", ({ clubId }) => {
    leaveClub(socket, clubId);
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

  club.members.delete(socket.id);
  club.requests = club.requests.filter(id => id !== socket.id);

  socket.leave(clubId);

  if (club.members.size === 0) {
    clubs.delete(clubId);
  } else {
    sendClubUpdate(clubId);
  }
}

function sendClubUpdate(clubId) {
  const club = clubs.get(clubId);
  if (!club) return;

  const members = [...club.members.entries()].map(([id, data]) => ({
    id,
    username: data.username,
    seat: data.seat,
    speaker: data.speaker
  }));

  io.to(clubId).emit("clubUpdate", {
    id: club.id,
    name: club.name,
    seats: club.seats,
    members,
    requests: club.requests
  });
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Waliin-GM"
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Waliin-GM server running on port ${PORT}`);
});
